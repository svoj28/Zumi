import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { isTransparentColor } from '@/engine/render/checker';
import { toSkBlendMode } from '@/engine/render/blendModes';

/**
 * Magnified preview for the eyedropper loupe: a (2·radius+1)² pixel patch around the sample
 * point, composited as displayed and scaled by `zoom` with nearest-neighbour sampling so
 * individual pixels are visible. JS thread; cheap enough to call on every move.
 */
export function renderLoupe(doc: DrawingDocument, x: number, y: number, radius = 5, zoom = 10): SkImage | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const n = radius * 2 + 1;
  const size = n * zoom;
  const surface = Skia.Surface.Make(size, size);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  // Outside-canvas / transparent areas show as neutral grey.
  canvas.clear(Skia.Color('#6b6b72'));
  const src = Skia.XYWHRect(ix - radius, iy - radius, n, n);
  const dst = Skia.XYWHRect(0, 0, size, size);
  if (!isTransparentColor(doc.info.background)) {
    const paperPaint = Skia.Paint();
    paperPaint.setColor(Skia.Color(doc.info.background));
    // Only the part of the patch that lies on the canvas gets paper colour.
    const x0 = Math.max(0, ix - radius);
    const y0 = Math.max(0, iy - radius);
    const x1 = Math.min(doc.info.width, ix + radius + 1);
    const y1 = Math.min(doc.info.height, iy + radius + 1);
    if (x1 > x0 && y1 > y0) {
      canvas.drawRect(Skia.XYWHRect((x0 - (ix - radius)) * zoom, (y0 - (iy - radius)) * zoom, (x1 - x0) * zoom, (y1 - y0) * zoom), paperPaint);
    }
  }
  for (const layer of doc.layers.list) {
    if (!layer.meta.visible || layer.meta.opacity <= 0) continue;
    const paint = Skia.Paint();
    paint.setAlphaf(layer.meta.opacity);
    paint.setBlendMode(toSkBlendMode(layer.meta.blendMode));
    canvas.drawImageRectOptions(layer.image, src, dst, FilterMode.Nearest, MipmapMode.None, paint);
  }
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

/**
 * Eyedropper: returns the visible colour (all visible layers + paper, with opacity and blend
 * modes) at a canvas coordinate as `#rrggbb`, or null outside the canvas or where the result
 * is fully transparent. Renders a single pixel, so it is cheap enough to call while dragging.
 */
export function sampleColor(doc: DrawingDocument, x: number, y: number): string | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= doc.info.width || iy >= doc.info.height) return null;

  const surface = Skia.Surface.Make(1, 1);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.translate(-ix, -iy);
  if (!isTransparentColor(doc.info.background)) canvas.drawColor(Skia.Color(doc.info.background));
  for (const layer of doc.layers.list) {
    if (!layer.meta.visible || layer.meta.opacity <= 0) continue;
    const paint = Skia.Paint();
    paint.setAlphaf(layer.meta.opacity);
    paint.setBlendMode(toSkBlendMode(layer.meta.blendMode));
    canvas.drawImage(layer.image, 0, 0, paint);
  }
  surface.flush();
  const image = surface.makeImageSnapshot();
  const px = image.readPixels(0, 0, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  image.dispose();
  surface.dispose();
  if (!px || px.length < 4) return null;

  // Float32Array results are 0..1, Uint8Array results are 0..255.
  const scale = px instanceof Float32Array ? 255 : 1;
  const [r, g, b, a] = [px[0] * scale, px[1] * scale, px[2] * scale, px[3] * scale];
  if (a < 8) return null;
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
