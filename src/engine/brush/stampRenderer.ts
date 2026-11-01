import {
  BlendMode,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';

import { D_ALPHA, D_ROTATION, D_SIZE, D_X, D_Y, DAB_STRIDE } from '@/engine/brush/dabEmitter';
import type { BrushPreset } from '@/engine/brush/brushPreset';
import { getTextureImage, getTipImage, textureMatrix, TIP_SIZE } from '@/engine/brush/tips';
import type { Rect, StrokeRecipe } from '@/engine/types';

/**
 * Stamp renderer: draws dab records as tinted brush-tip sprites with a single `drawAtlas`
 * call. A stroke is composited in its own layer — dabs accumulate inside it (flow), the layer
 * is applied with the preset's opacity (the stroke can never exceed it) and optionally masked
 * by a paper texture fixed to canvas space.
 */

export function colorToRgb(color: string): [number, number, number] {
  const c = Skia.Color(color);
  return [c[0], c[1], c[2]];
}

/**
 * Converts dab records [from, end) into atlas transforms/colours/sprite rects, appending to the
 * given arrays. Worklet: used on the UI thread for the live preview and on JS for commits.
 */
export function appendAtlas(
  dabs: number[],
  from: number,
  rgb: readonly number[],
  sprite: SkRect,
  xforms: SkRSXform[],
  colors: SkColor[],
  sprites: SkRect[],
): void {
  'worklet';
  const half = TIP_SIZE / 2;
  for (let i = from; i + DAB_STRIDE <= dabs.length; i += DAB_STRIDE) {
    const s = dabs[i + D_SIZE] / TIP_SIZE;
    const rot = dabs[i + D_ROTATION];
    const scos = s * Math.cos(rot);
    const ssin = s * Math.sin(rot);
    // RSXform maps sprite (u, v) → (scos·u − ssin·v + tx, ssin·u + scos·v + ty); centre the tip.
    const tx = dabs[i + D_X] - (scos * half - ssin * half);
    const ty = dabs[i + D_Y] - (ssin * half + scos * half);
    xforms.push(Skia.RSXform(scos, ssin, tx, ty));
    colors.push(Float32Array.of(rgb[0], rgb[1], rgb[2], dabs[i + D_ALPHA]));
    sprites.push(sprite);
  }
}

/** Integer bounds covering every dab (rotation-safe) plus an anti-aliasing margin. */
export function dabBounds(dabs: number[]): Rect | null {
  if (dabs.length < DAB_STRIDE) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + DAB_STRIDE <= dabs.length; i += DAB_STRIDE) {
    const r = dabs[i + D_SIZE] / 2;
    x0 = Math.min(x0, dabs[i + D_X] - r);
    y0 = Math.min(y0, dabs[i + D_Y] - r);
    x1 = Math.max(x1, dabs[i + D_X] + r);
    y1 = Math.max(y1, dabs[i + D_Y] + r);
  }
  const x = Math.floor(x0) - 2;
  const y = Math.floor(y0) - 2;
  return { x, y, width: Math.ceil(x1) + 2 - x, height: Math.ceil(y1) + 2 - y };
}

/**
 * Blur radius (sigma, canvas px) a blending brush mixes colours over, or 0 for a brush that
 * paints. The eraser always erases, whatever preset it uses.
 */
export function blendSigma(b: BrushPreset, tool: StrokeRecipe['tool']): number {
  // Smudge is committed exactly (see smudge.ts); its live preview approximates it with a blur.
  const amount = Math.max(b.blend, (b.smudge ?? 0) * 0.35);
  if (tool === 'eraser' || amount <= 0) return 0;
  return Math.max(0.5, b.size * amount * 0.5);
}

/**
 * Rasterises a stroke's dabs onto `canvas` (JS thread, used when committing and for previews).
 * A blending brush needs `source`, the layer's pixels before the stroke: the dabs then only
 * mask a blurred copy of it, so colours under the stroke run together instead of being painted.
 */
export function drawDabs(
  canvas: SkCanvas,
  dabs: number[],
  recipe: Pick<StrokeRecipe, 'tool' | 'color' | 'brush'>,
  bounds: Rect,
  source: SkImage | null = null,
): void {
  const b = recipe.brush;
  const eraser = recipe.tool === 'eraser';
  const sigma = source ? blendSigma(b, recipe.tool) : 0;
  const tip = getTipImage(b.shape.tip, b.hardness, b.shape.roundness, b.shape.image);
  const rgb = eraser ? [0, 0, 0] : colorToRgb(recipe.color);
  const sprite = Skia.XYWHRect(0, 0, TIP_SIZE, TIP_SIZE);
  const xforms: SkRSXform[] = [];
  const colors: SkColor[] = [];
  const sprites: SkRect[] = [];
  appendAtlas(dabs, 0, rgb, sprite, xforms, colors, sprites);
  const area = Skia.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height);

  const layer = Skia.Paint();
  layer.setAlphaf(b.opacity);
  if (eraser) layer.setBlendMode(BlendMode.DstOut);
  canvas.saveLayer(layer, area);
  canvas.drawAtlas(tip, sprites, xforms, Skia.Paint(), BlendMode.Modulate, colors, {
    filter: FilterMode.Linear,
    mipmap: MipmapMode.Linear,
  });

  const texture = getTextureImage(b.texture.kind, b.texture.strength, b.texture.variation);
  if (texture) {
    const mask = Skia.Paint();
    mask.setShader(
      texture.makeShaderOptions(
        TileMode.Repeat,
        TileMode.Repeat,
        FilterMode.Linear,
        MipmapMode.None,
        Skia.Matrix(textureMatrix(b.texture.scale, b.texture.angle)),
      ),
    );
    mask.setBlendMode(BlendMode.DstIn);
    canvas.drawRect(area, mask);
  }
  if (source && sigma > 0) {
    // The stroke so far is a coverage mask; fill it with the blurred layer.
    const mix = Skia.Paint();
    mix.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Decal, null));
    mix.setBlendMode(BlendMode.SrcIn);
    canvas.drawImage(source, 0, 0, mix);
  }
  canvas.restore();
}
