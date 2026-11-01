import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';

import { traceImage } from '@/engine/vector/imageTrace';
import type { VectorDoc } from '@/engine/vector/vectorModel';

export type TraceDetail = 'low' | 'medium' | 'high';

/** Trace resolution (long side), simplification tolerance and smallest region per detail level. */
const DETAIL: Record<TraceDetail, { side: number; tolerance: number; minArea: number }> = {
  low: { side: 160, tolerance: 1.6, minArea: 12 },
  medium: { side: 280, tolerance: 1.1, minArea: 8 },
  high: { side: 420, tolerance: 0.8, minArea: 5 },
};

/**
 * Traces an image (e.g. a layer) into flat-colour vector shapes in the image's own pixel space.
 * The image is shrunk first: tracing works on shapes, not pixel detail, and stays fast.
 */
export function traceLayerImage(image: SkImage, colors: number, detail: TraceDetail, smooth: boolean): VectorDoc {
  const d = DETAIL[detail];
  const k = Math.min(1, d.side / Math.max(image.width(), image.height()));
  const w = Math.max(1, Math.round(image.width() * k));
  const h = Math.max(1, Math.round(image.height() * k));
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return { shapes: [] };
  try {
    surface.getCanvas().drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, w, h),
      FilterMode.Linear,
      MipmapMode.Linear,
      null,
    );
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    const pixels = snapshot.readPixels(0, 0, { width: w, height: h, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 });
    snapshot.dispose();
    if (!pixels) return { shapes: [] };
    const rgba = pixels instanceof Uint8Array ? pixels : Array.from(pixels, (v) => Math.round(v * 255));
    return traceImage(rgba, w, h, { colors, tolerance: d.tolerance, minArea: d.minArea, smooth, scale: image.width() / w });
  } finally {
    surface.dispose();
  }
}
