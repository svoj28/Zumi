import { BlendMode, Skia, type SkCanvas, type SkImage } from '@shopify/react-native-skia';

import { smudgeImage } from '@/engine/brush/smudge';

import { dabBounds, drawDabs } from '@/engine/brush/stampRenderer';
import { replayStroke } from '@/engine/brush/strokeInterpolator';
import { applySymmetry } from '@/engine/brush/symmetry';
import { SAMPLE_STRIDE, type Rect, type StrokeRecipe } from '@/engine/types';

/**
 * JS-thread half of the brush engine: replays a finished stroke recipe into dabs and returns
 * what the layer engine needs to rasterise it.
 */

export interface BuiltStroke {
  /** Integer bounds of the affected pixels (unclamped). */
  bounds: Rect;
  dabCount: number;
  render: (canvas: SkCanvas) => void;
}

/** `source` is the layer's current pixels, which a blending brush mixes (see `drawDabs`). */
export function buildStroke(recipe: StrokeRecipe, source: SkImage | null = null): BuiltStroke | null {
  if (recipe.samples.length < SAMPLE_STRIDE) return null;
  const dabs: number[] = [];
  replayStroke(recipe.samples, recipe.brush, recipe.seed, dabs);
  applySymmetry(dabs, recipe.symmetry);
  const bounds = dabBounds(dabs);
  if (!bounds) return null;
  if (source && recipe.tool === 'brush' && (recipe.brush.smudge ?? 0) > 0) {
    // Smudge replaces the stroke's area with the dragged pixels.
    return {
      bounds,
      dabCount: dabs.length,
      render: (canvas) => {
        const image = smudgeImage(source, dabs, recipe.brush, bounds);
        if (!image) return;
        const paint = Skia.Paint();
        paint.setBlendMode(BlendMode.Src);
        canvas.drawImage(image, bounds.x, bounds.y, paint);
        image.dispose();
      },
    };
  }
  return {
    bounds,
    dabCount: dabs.length,
    render: (canvas) => drawDabs(canvas, dabs, recipe, bounds, source),
  };
}
