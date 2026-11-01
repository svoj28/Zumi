import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';

import { extractPalette } from '@/engine/color/paletteGen';

/** Images are shrunk to this many pixels on the long side before analysis (plenty for a palette). */
const SAMPLE_SIDE = 96;

/** Main colours of an image (or of a region of it), dark to light. */
export function paletteFromImage(
  image: SkImage,
  count: number,
  region?: { x: number; y: number; w: number; h: number },
): string[] {
  const src = region ?? { x: 0, y: 0, w: image.width(), h: image.height() };
  const k = Math.min(1, SAMPLE_SIDE / Math.max(src.w, src.h));
  const w = Math.max(1, Math.round(src.w * k));
  const h = Math.max(1, Math.round(src.h * k));
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return [];
  try {
    surface
      .getCanvas()
      .drawImageRectOptions(
        image,
        Skia.XYWHRect(src.x, src.y, src.w, src.h),
        Skia.XYWHRect(0, 0, w, h),
        FilterMode.Linear,
        MipmapMode.Linear,
        null,
      );
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    const pixels = snapshot.readPixels(0, 0, { width: w, height: h, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 });
    snapshot.dispose();
    if (!pixels) return [];
    return extractPalette(pixels instanceof Uint8Array ? pixels : Array.from(pixels, (v) => Math.round(v * 255)), count);
  } finally {
    surface.dispose();
  }
}
