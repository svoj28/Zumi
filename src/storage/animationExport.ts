import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { renderComposite } from '@/engine/render/composite';
import { exportsDir, safeFileName } from '@/storage/exportService';
import { gifSink, isVideoExportAvailable, TIMELAPSE_FILE_TYPES, videoSink, type FrameSink, type TimelapseFormat } from '@/storage/timelapseExport';

/**
 * Exports a frame-by-frame animation (see AnimationSettings) as an animated GIF or MP4 video.
 * Frames are composited at a size capped for sharing; a "background" bottom frame is drawn under
 * every frame; ping-pong plays the frames back and forth once.
 */

/** Longest side of the exported animation. */
const MAX_SIDE = 1080;

export { isVideoExportAvailable, TIMELAPSE_FILE_TYPES as ANIMATION_FILE_TYPES };

/** Exact-size RGBA bytes of a composite image (encoders need plain, even-sized frames). */
function framePixels(image: ReturnType<typeof renderComposite>, width: number, height: number): Uint8Array {
  if (!image) throw new Error('Not enough memory to render the artwork.');
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error('Not enough memory to render the artwork.');
  surface.getCanvas().drawImage(image, 0, 0);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const px = snapshot.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  snapshot.dispose();
  surface.dispose();
  image.dispose();
  if (!px) throw new Error('Not enough memory to render the artwork.');
  return px instanceof Uint8Array ? px : Uint8Array.from(px, (v) => Math.round(v * 255));
}

/** The still artwork as a GIF or MP4 (one frame, held for two seconds so videos have a length). */
export async function renderArtworkClip(doc: DrawingDocument, format: TimelapseFormat): Promise<File> {
  const scale = Math.min(1, MAX_SIDE / Math.max(doc.info.width, doc.info.height));
  let width = Math.max(2, Math.round(doc.info.width * scale));
  let height = Math.max(2, Math.round(doc.info.height * scale));
  if (format === 'mp4') {
    width += width % 2;
    height += height % 2;
  }
  const file = new File(exportsDir(), `${safeFileName(doc.info.name)}.${TIMELAPSE_FILE_TYPES[format].ext}`);
  let sink: FrameSink | null = null;
  let finished = false;
  try {
    sink = format === 'mp4' ? await videoSink(file, width, height) : gifSink(file, width, height);
    await sink.add(framePixels(renderComposite(doc, scale, { underlay: 'white' }), width, height), 200);
    await sink.finish();
    finished = true;
    return file;
  } finally {
    if (sink && !finished) await sink.abort().catch(() => {});
  }
}

export async function renderAnimation(
  doc: DrawingDocument,
  format: TimelapseFormat,
  onProgress: (fraction: number) => void,
): Promise<File> {
  const frames = doc.frames;
  const { fps, loop, background } = doc.animation;
  const first = background && frames.length > 1 ? 1 : 0;
  const indices = frames.map((_, i) => i).slice(first);
  if (indices.length === 0) throw new Error('Add at least one frame first.');
  const order = loop === 'pingPong' && indices.length > 2 ? [...indices, ...indices.slice(1, -1).reverse()] : indices;

  const scale = Math.min(1, MAX_SIDE / Math.max(doc.info.width, doc.info.height));
  let width = Math.max(2, Math.round(doc.info.width * scale));
  let height = Math.max(2, Math.round(doc.info.height * scale));
  // Video encoders need even sizes.
  if (format === 'mp4') {
    width += width % 2;
    height += height % 2;
  }
  const file = new File(exportsDir(), `${safeFileName(doc.info.name)}-animation.${TIMELAPSE_FILE_TYPES[format].ext}`);
  const delayCs = Math.max(2, Math.round(100 / fps));

  let sink: FrameSink | null = null;
  let finished = false;
  try {
    sink = format === 'mp4' ? await videoSink(file, width, height) : gifSink(file, width, height);
    for (let n = 0; n < order.length; n++) {
      const layers = [...(first === 1 ? frames[0].layers : []), ...frames[order[n]].layers];
      const image = renderComposite(doc, scale, { layers, underlay: 'white' });
      if (!image) throw new Error('Not enough memory to render the animation.');
      // Exact output size (rounding and even sizes) and plain RGBA bytes for the encoders.
      const surface = Skia.Surface.Make(width, height);
      if (!surface) throw new Error('Not enough memory to render the animation.');
      surface.getCanvas().drawImage(image, 0, 0);
      surface.flush();
      const snapshot = surface.makeImageSnapshot();
      const px = snapshot.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
      snapshot.dispose();
      surface.dispose();
      image.dispose();
      if (!px) throw new Error('Not enough memory to render the animation.');
      await sink.add(px instanceof Uint8Array ? px : Uint8Array.from(px, (v) => Math.round(v * 255)), delayCs);
      onProgress((n + 1) / order.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await sink.finish();
    finished = true;
    return file;
  } finally {
    if (sink && !finished) await sink.abort().catch(() => {});
  }
}