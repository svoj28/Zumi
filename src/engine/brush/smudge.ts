import { BlendMode, Skia, type SkImage } from '@shopify/react-native-skia';

import type { BrushPreset } from '@/engine/brush/brushPreset';
import { D_ALPHA, D_SIZE, D_X, D_Y, DAB_STRIDE } from '@/engine/brush/dabEmitter';
import { getTipImage, TIP_SIZE } from '@/engine/brush/tips';
import type { Rect } from '@/engine/types';

/**
 * Smudge: each dab picks up the colour under the previous dab and lays it down at its own
 * position (through the brush tip, at `brush.smudge` strength), so paint is dragged along the
 * stroke like a finger in wet paint. Works on a copy of the stroke's bounds only; each dab
 * reads back just its own square. JS thread (runs when the stroke is committed).
 *
 * Returns the smudged pixels of `bounds` (canvas coordinates), or null when out of memory.
 */
export function smudgeImage(source: SkImage, dabs: readonly number[], brush: BrushPreset, bounds: Rect): SkImage | null {
  const surface = Skia.Surface.Make(Math.max(1, bounds.width), Math.max(1, bounds.height));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.drawImage(source, -bounds.x, -bounds.y);
  const tip = getTipImage(brush.shape.tip, brush.hardness, brush.shape.roundness, brush.shape.image);
  const tipRect = Skia.XYWHRect(0, 0, TIP_SIZE, TIP_SIZE);
  const mask = Skia.Paint();
  mask.setBlendMode(BlendMode.DstIn);
  let pickup: SkImage | null = null;

  for (let i = 0; i + DAB_STRIDE <= dabs.length; i += DAB_STRIDE) {
    const d = Math.max(1, dabs[i + D_SIZE]);
    const x = dabs[i + D_X] - bounds.x - d / 2;
    const y = dabs[i + D_Y] - bounds.y - d / 2;
    const rect = Skia.XYWHRect(x, y, d, d);
    if (pickup) {
      const layer = Skia.Paint();
      // Dab alpha already carries flow and pressure; smudge sets how much colour is carried.
      layer.setAlphaf(Math.min(1, brush.smudge * Math.max(0.15, dabs[i + D_ALPHA] / Math.max(0.01, brush.flow))));
      canvas.saveLayer(layer, rect);
      canvas.drawImageRect(pickup, Skia.XYWHRect(0, 0, pickup.width(), pickup.height()), rect, Skia.Paint());
      canvas.drawImageRect(tip, tipRect, rect, mask);
      canvas.restore();
      pickup.dispose();
    }
    // What is under this dab now is what the next dab drags along.
    surface.flush();
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(bounds.width, Math.ceil(x + d));
    const y1 = Math.min(bounds.height, Math.ceil(y + d));
    pickup = x1 > x0 && y1 > y0 ? surface.makeImageSnapshot(Skia.XYWHRect(x0, y0, x1 - x0, y1 - y0)) : null;
  }
  pickup?.dispose();
  surface.flush();
  const result = surface.makeImageSnapshot();
  surface.dispose();
  return result;
}