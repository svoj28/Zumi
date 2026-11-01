import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';

import type { Rect } from '@/engine/types';

/** Probe resolution: large enough for a snug box, small enough to scan instantly. */
const PROBE_SIDE = 256;

/**
 * Approximate bounds of the non-transparent pixels of `image` (in its own coordinates), or
 * null if it is empty. The image is downsampled before scanning, so the result is rounded
 * outwards to the probe grid — ideal for a transform box, not for pixel-exact work.
 */
export function contentBounds(image: SkImage): Rect | null {
  const w = image.width();
  const h = image.height();
  const scale = Math.min(1, PROBE_SIDE / Math.max(w, h));
  const pw = Math.max(1, Math.ceil(w * scale));
  const ph = Math.max(1, Math.ceil(h * scale));
  const surface = Skia.Surface.Make(pw, ph);
  if (!surface) return { x: 0, y: 0, width: w, height: h };
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  // Linear+mipmap averages coverage, so even a thin stroke leaves a trace in the probe.
  canvas.drawImageRectOptions(image, Skia.XYWHRect(0, 0, w, h), Skia.XYWHRect(0, 0, pw, ph), FilterMode.Linear, MipmapMode.Linear, null);
  surface.flush();
  const probe = surface.makeImageSnapshot();
  const px = probe.readPixels(0, 0, { width: pw, height: ph, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  probe.dispose();
  surface.dispose();
  if (!px) return { x: 0, y: 0, width: w, height: h };

  const alphaScale = px instanceof Float32Array ? 255 : 1;
  let x0 = pw;
  let y0 = ph;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (px[(y * pw + x) * 4 + 3] * alphaScale > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  // Back to image space, padded by one probe cell to cover what downsampling blurred away.
  const cell = 1 / scale;
  const left = Math.max(0, Math.floor((x0 - 1) * cell));
  const top = Math.max(0, Math.floor((y0 - 1) * cell));
  const right = Math.min(w, Math.ceil((x1 + 2) * cell));
  const bottom = Math.min(h, Math.ceil((y1 + 2) * cell));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
