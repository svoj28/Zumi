import {
  AlphaType,
  BlendMode,
  ClipOp,
  ColorType,
  FilterMode,
  matchFont,
  MipmapMode,
  Skia,
  type SkCanvas,
  type SkFont,
  type SkSurface,
} from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import ZumiVideoEncoder from '../../modules/zumi-video-encoder';
import { toSkBlendMode } from '@/engine/render/blendModes';
import { isTransparentColor } from '@/engine/render/checker';
import { GifEncoder } from '@/engine/timelapse/gifEncoder';
import {
  outputScale,
  planPlayback,
  TIMELAPSE_FPS,
  TIMELAPSE_VIDEO_FPS,
  type TimelapseFrame,
  type TimelapseLayerState,
} from '@/engine/timelapse/timelapseFormat';
import { exportsDir, safeFileName, type ShareType } from '@/storage/exportService';
import { loadTimelapse } from '@/storage/timelapseRepository';

/**
 * Turns a timelapse recording into an animated GIF or an MP4 video, entirely on the device.
 *
 * The recorded patches are replayed onto one small surface per layer at the output size (the
 * canvas divided by 1, 2, 4 or 8), so memory stays proportional to the output, not the canvas.
 * Hidden layers are skipped before their patches are even decoded. Each output frame goes to a
 * sink: the TypeScript GIF encoder, or the native H.264 encoder (modules/zumi-video-encoder).
 * Work yields to the UI regularly, reports progress, and can be cancelled.
 */

export type WatermarkCorner = 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft';
export type TimelapseFormat = 'gif' | 'mp4';

export interface TimelapseExportOptions {
  format: TimelapseFormat;
  /** Length of the animation, including the closing hold on the finished artwork. */
  seconds: number;
  /** Layers left out of the timelapse. */
  hiddenLayerIds: readonly string[];
  watermark: { text: string; corner: WatermarkCorner } | null;
}

export const TIMELAPSE_FILE_TYPES: Record<TimelapseFormat, ShareType & { ext: string }> = {
  gif: { mime: 'image/gif', uti: 'com.compuserve.gif', ext: 'gif' },
  mp4: { mime: 'video/mp4', uti: 'public.mpeg-4', ext: 'mp4' },
};

/** True when this build of the app includes the native video encoder. */
export const isVideoExportAvailable = (): boolean => ZumiVideoEncoder !== null;

/** Pixel size of the exported timelapse (video needs even dimensions). */
export function timelapseOutputSize(width: number, height: number, format: TimelapseFormat): { width: number; height: number } {
  const out = outputScale(width, height);
  return format === 'mp4' ? { width: out.width + (out.width % 2), height: out.height + (out.height % 2) } : out;
}

/** Time slice before yielding to the UI, ms. */
const SLICE_MS = 40;
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class TimelapseCancelled extends Error {
  constructor() {
    super('Timelapse export cancelled.');
  }
}

/** Where rendered frames go (also used by animation export). */
export interface FrameSink {
  readonly fps: number;
  add(rgba: Uint8Array, delayCs: number): Promise<void>;
  /** Keeps the last frame on screen longer. */
  hold(delayCs: number): void;
  finish(): Promise<void>;
  /** Stops and removes the partial file. */
  abort(): Promise<void>;
}

export function gifSink(file: File, width: number, height: number): FrameSink {
  const gif = new GifEncoder(width, height);
  return {
    fps: TIMELAPSE_FPS,
    add: async (rgba, delayCs) => gif.addFrame(rgba, delayCs),
    hold: (delayCs) => gif.holdLast(delayCs),
    finish: async () => {
      file.create({ overwrite: true });
      file.writeSync(gif.finish());
    },
    abort: async () => {},
  };
}

export async function videoSink(file: File, width: number, height: number): Promise<FrameSink> {
  const encoder = ZumiVideoEncoder;
  if (!encoder) throw new Error('Video export needs the latest version of the app. Export as GIF instead.');
  const frameUs = Math.round(1_000_000 / TIMELAPSE_VIDEO_FPS);
  // ~0.2 bits per pixel per frame: clean edges for line art without huge files.
  const bitRate = Math.round(Math.min(12_000_000, Math.max(1_500_000, width * height * TIMELAPSE_VIDEO_FPS * 0.2)));
  await encoder.start(file.uri, width, height, bitRate, TIMELAPSE_VIDEO_FPS);
  let timeUs = 0;
  let lastFrame: Uint8Array | null = null;
  let lastPtsUs = 0;
  return {
    fps: TIMELAPSE_VIDEO_FPS,
    add: async (rgba, delayCs) => {
      await encoder.appendFrame(rgba, timeUs);
      lastFrame = rgba;
      lastPtsUs = timeUs;
      timeUs += delayCs * 10_000;
    },
    hold: (delayCs) => {
      timeUs += delayCs * 10_000;
    },
    finish: async () => {
      // Repeat the final frame just before the end so every player holds it for the full time.
      if (lastFrame && timeUs - frameUs > lastPtsUs) await encoder.appendFrame(lastFrame, timeUs - frameUs);
      await encoder.finish(timeUs);
    },
    abort: () => encoder.cancel(),
  };
}

/**
 * Renders the timelapse into the app cache and returns the file. Throws `TimelapseCancelled`
 * when `isCancelled` turns true.
 */
export async function renderTimelapse(
  projectId: string,
  artworkName: string,
  options: TimelapseExportOptions,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<File> {
  const recording = loadTimelapse(projectId);
  if (!recording) throw new Error('Nothing has been recorded for this artwork yet. Paint something first.');
  const { state, frames, patchesDir } = recording;
  const { divisor } = outputScale(state.width, state.height);
  const { width, height } = timelapseOutputSize(state.width, state.height, options.format);
  const hidden = new Set(options.hiddenLayerIds);
  const type = TIMELAPSE_FILE_TYPES[options.format];
  const file = new File(exportsDir(), `${safeFileName(artworkName)}-timelapse.${type.ext}`);

  const layers = new Map<string, SkSurface>();
  const output = Skia.Surface.Make(width, height);
  if (!output) throw new Error('Not enough memory to render the timelapse.');
  const watermark = options.watermark?.text.trim() ? prepareWatermark(options.watermark, width, height) : null;

  const layerSurface = (id: string): SkSurface => {
    let surface = layers.get(id);
    if (!surface) {
      const created = Skia.Surface.Make(width, height);
      if (!created) throw new Error('Not enough memory to render the timelapse. Try hiding some layers.');
      created.getCanvas().clear(Skia.Color('transparent'));
      layers.set(id, created);
      surface = created;
    }
    return surface;
  };

  let stack: TimelapseLayerState[] = [];
  let background = '#ffffff';
  const replace = Skia.Paint();
  replace.setBlendMode(BlendMode.Src);

  /** Applies one recorded frame; returns true if it changes what the output shows. */
  const apply = (frame: TimelapseFrame): boolean => {
    let visibleChange = false;
    if (frame.stack) {
      stack = frame.stack;
      visibleChange = true;
    }
    if (frame.background) {
      background = frame.background;
      visibleChange = true;
    }
    for (const patch of frame.patches) {
      if (hidden.has(patch.layerId)) continue;
      const patchFile = new File(patchesDir, patch.file);
      if (!patchFile.exists) {
        console.warn('[timelapse] Missing patch', patch.file);
        continue;
      }
      const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(patchFile.bytesSync()));
      if (!image) continue;
      const canvas = layerSurface(patch.layerId).getCanvas();
      const dst = Skia.XYWHRect(patch.x / divisor, patch.y / divisor, patch.width / divisor, patch.height / divisor);
      canvas.save();
      canvas.clipRect(dst, ClipOp.Intersect, false);
      canvas.drawImageRectOptions(image, Skia.XYWHRect(0, 0, image.width(), image.height()), dst, FilterMode.Linear, MipmapMode.Linear, replace);
      canvas.restore();
      image.dispose();
      visibleChange = true;
    }
    return visibleChange;
  };

  const render = (): Uint8Array => {
    const canvas = output.getCanvas();
    // Neither GIF nor MP4 has partial transparency: transparent paper is shown as white.
    canvas.clear(Skia.Color('white'));
    canvas.saveLayer();
    if (!isTransparentColor(background)) canvas.drawColor(Skia.Color(background));
    for (const entry of stack) {
      if (!entry.visible || entry.opacity <= 0 || hidden.has(entry.id)) continue;
      const surface = layers.get(entry.id);
      if (!surface) continue;
      surface.flush();
      const image = surface.makeImageSnapshot();
      const paint = Skia.Paint();
      paint.setAlphaf(entry.opacity);
      paint.setBlendMode(toSkBlendMode(entry.blendMode));
      canvas.drawImage(image, 0, 0, paint);
      image.dispose();
    }
    canvas.restore();
    watermark?.(canvas);
    output.flush();
    const snapshot = output.makeImageSnapshot();
    const px = snapshot.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    snapshot.dispose();
    if (!px) throw new Error('Not enough memory to render the timelapse.');
    // Float results are 0..1, byte results 0..255.
    return px instanceof Uint8Array ? px : Uint8Array.from(px, (v) => Math.round(v * 255));
  };

  let sink: FrameSink | null = null;
  let finished = false;
  try {
    sink = options.format === 'mp4' ? await videoSink(file, width, height) : gifSink(file, width, height);
    const plan = planPlayback(frames.length, options.seconds, sink.fps);
    let next = 0;
    let sliceStart = Date.now();
    for (let i = 0; i < plan.frames.length; i++) {
      let changed = i === 0;
      while (next <= plan.frames[i]) {
        if (apply(frames[next])) changed = true;
        next += 1;
      }
      if (changed) await sink.add(render(), plan.delaysCs[i]);
      else sink.hold(plan.delaysCs[i]);
      if (Date.now() - sliceStart > SLICE_MS) {
        onProgress((i + 1) / plan.frames.length);
        await yieldToUi();
        if (isCancelled()) throw new TimelapseCancelled();
        sliceStart = Date.now();
      }
    }
    if (isCancelled()) throw new TimelapseCancelled();
    await sink.finish();
    finished = true;
    onProgress(1);
    return file;
  } finally {
    if (sink && !finished) {
      await sink.abort().catch((error: unknown) => console.warn('[timelapse] Could not stop the encoder', error));
    }
    for (const surface of layers.values()) surface.dispose();
    output.dispose();
  }
}

/** Returns a function drawing the watermark text, or null when no system font is available. */
function prepareWatermark(
  watermark: { text: string; corner: WatermarkCorner },
  width: number,
  height: number,
): ((canvas: SkCanvas) => void) | null {
  const text = watermark.text.trim();
  const size = Math.max(12, Math.round(Math.min(width, height) * 0.045));
  let font: SkFont;
  try {
    font = matchFont({ fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' }), fontSize: size, fontWeight: 'bold' });
  } catch (error) {
    console.warn('[timelapse] No font for the watermark', error);
    return null;
  }
  const textWidth = font.measureText(text).width;
  const margin = Math.round(size * 0.8);
  const right = watermark.corner === 'bottomRight' || watermark.corner === 'topRight';
  const bottom = watermark.corner === 'bottomRight' || watermark.corner === 'bottomLeft';
  const x = right ? width - margin - textWidth : margin;
  const y = bottom ? height - margin : margin + size * 0.8;
  const shadow = Skia.Paint();
  shadow.setAntiAlias(true);
  shadow.setColor(Skia.Color('rgba(0,0,0,0.45)'));
  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  fill.setColor(Skia.Color('rgba(255,255,255,0.9)'));
  const offset = Math.max(1, Math.round(size / 14));
  return (canvas) => {
    canvas.drawText(text, x + offset, y + offset, shadow, font);
    canvas.drawText(text, x, y, fill, font);
  };
}
