import { BlendMode, BlurStyle, PaintStyle, Skia, TileMode, type SkCanvas, type SkColorFilter, type SkImage, type SkShader } from '@shopify/react-native-skia';

import { isToneTexture, type BrushTexture, type BrushTip } from '@/engine/brush/brushPreset';

/**
 * Procedural brush tips and paper textures. Everything is generated on-device with Skia (no
 * bundled bitmaps), rendered once and cached. Tips are white alpha masks; the stamp renderer
 * tints them per dab.
 */

/** Tip bitmap size. Large enough that big hard brushes keep crisp edges. */
export const TIP_SIZE = 128;
/** Paper texture tile size (seamlessly tileable). */
export const TEXTURE_TILE = 256;

const tipCache = new Map<string, SkImage>();
const textureCache = new Map<string, SkImage>();

/** Colour filter producing white with alpha = k·luma + b (contrast-adjusted noise mask). */
function lumaAlpha(k: number, b: number): SkColorFilter {
  // Translation column is normalised (0..1).
  return Skia.ColorFilter.MakeMatrix([
    0, 0, 0, 0, 1,
    0, 0, 0, 0, 1,
    0, 0, 0, 0, 1,
    0.2126 * k, 0.7152 * k, 0.0722 * k, 0, b,
  ]);
}

interface NoiseSpec {
  shader: (tile: number) => SkShader;
  k: number;
  b: number;
}

/** Grain character of textured tips. */
const TIP_NOISE: Partial<Record<BrushTip, NoiseSpec>> = {
  pencil: { shader: (t) => Skia.Shader.MakeFractalNoise(0.45, 0.45, 2, 7, t, t), k: 2.2, b: -0.35 },
  chalk: { shader: (t) => Skia.Shader.MakeFractalNoise(0.18, 0.18, 3, 11, t, t), k: 3, b: -0.9 },
  charcoal: { shader: (t) => Skia.Shader.MakeTurbulence(0.05, 0.4, 3, 5, t, t), k: 2.5, b: -0.6 },
  grain: { shader: (t) => Skia.Shader.MakeFractalNoise(0.6, 0.6, 1, 3, t, t), k: 4, b: -1.6 },
};

/** Five-pointed star in the 100×100 shape box. */
function starPath(): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 48 : 20;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(52 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join(' L')} Z`;
}

/** Outline tips as SVG paths in a 100×100 box (centred on 50, 50). */
const SHAPE_PATHS: Partial<Record<BrushTip, () => string>> = {
  square: () => 'M8 8 H92 V92 H8 Z',
  triangle: () => 'M50 6 L94 90 H6 Z',
  star: starPath,
  heart: () => 'M50 90 C20 68 4 50 4 31 C4 15 16 6 29 6 C39 6 46 12 50 21 C54 12 61 6 71 6 C84 6 96 15 96 31 C96 50 80 68 50 90 Z',
  leaf: () => 'M50 3 C82 24 88 64 50 97 C12 64 18 24 50 3 Z',
  splat: () => {
    // A blob with droplets, from fixed offsets so the tip is the same every time.
    const drops = [
      [50, 50, 30],
      [22, 30, 9],
      [82, 36, 8],
      [76, 78, 10],
      [26, 76, 7],
      [52, 12, 6],
      [92, 60, 4],
      [8, 54, 5],
    ];
    return drops.map(([x, y, r]) => `M${x - r} ${y} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`).join(' ');
  },
};

/** Screentone cells across one texture tile (cell = TEXTURE_TILE / TONE_CELLS at scale 1). */
export const TONE_CELLS = 8;

/** Cell size of a screentone in canvas pixels for a texture scale. */
export function toneCellSize(scale: number): number {
  return (TEXTURE_TILE / TONE_CELLS) * scale;
}

/**
 * Canvas → texture-tile matrix (row-major 3×3) for a texture drawn at `scale`, its pattern
 * turned by `angleDeg`. Worklet: shared by the live preview and the commit.
 */
export function textureMatrix(scale: number, angleDeg: number): number[] {
  'worklet';
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a) * scale;
  const s = Math.sin(a) * scale;
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Deterministic 0..1 value per tone cell, so a tile always comes out the same. */
function cellRandom(r: number, c: number, salt: number): number {
  let t = Math.imul(r * 7919 + c * 104729 + salt * 15485863, 0x9e3779b1) | 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

const wrap = (i: number) => ((i % TONE_CELLS) + TONE_CELLS) % TONE_CELLS;

type ToneKind = 'tone-dots' | 'tone-rings' | 'tone-lines' | 'tone-crosshatch' | 'tone-stipple';

/**
 * Screentone tile. Dots and rings sit on a staggered grid (rows offset by half a cell, like
 * printed tone); lines and crosshatch are parallel bars; stipple is random specks. `density`
 * 0..1 sets the inked area / line thickness; `variation` 0..1 shrinks each circle by a random,
 * per-cell amount, mixing large and small circles. Seamless: the row count is even, so the
 * stagger repeats, and per-cell randomness uses wrapped cell indices.
 */
function drawTone(canvas: SkCanvas, kind: ToneKind, density: number, variation: number, T: number): void {
  const cell = T / TONE_CELLS;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color('white'));
  if (kind === 'tone-lines' || kind === 'tone-crosshatch') {
    // Crosshatch inks two sets of lines, so each is thinner for the same density.
    const share = kind === 'tone-crosshatch' ? 0.55 : 1;
    const h = Math.max(1, cell * (0.12 + 0.76 * density) * share);
    for (let r = 0; r < TONE_CELLS; r++) {
      const at = r * cell + (cell - h) / 2;
      canvas.drawRect(Skia.XYWHRect(0, at, T, h), paint);
      if (kind === 'tone-crosshatch') canvas.drawRect(Skia.XYWHRect(at, 0, h, T), paint);
    }
    return;
  }
  // Dot radius so the inked area ≈ density (dots start to merge near the top of the range).
  const radius = cell * Math.min(0.62, Math.sqrt((0.06 + 0.84 * density) / Math.PI));
  const sizeAt = (r: number, c: number) => radius * (1 - variation * 0.85 * cellRandom(wrap(r), wrap(c), 1));
  if (kind === 'tone-stipple') {
    // A few specks per cell at random spots; drawn with ±1 tile copies so edges wrap.
    const specks = 1 + Math.round(density * 3);
    const speck = radius * 0.45;
    for (let r = 0; r < TONE_CELLS; r++) {
      for (let c = 0; c < TONE_CELLS; c++) {
        for (let k = 0; k < specks; k++) {
          const x = (c + cellRandom(r, c, 2 + k * 3)) * cell;
          const y = (r + cellRandom(r, c, 3 + k * 3)) * cell;
          const rad = speck * (1 - variation * 0.85 * cellRandom(r, c, 4 + k * 3));
          for (let oy = -T; oy <= T; oy += T) {
            for (let ox = -T; ox <= T; ox += T) canvas.drawCircle(x + ox, y + oy, rad, paint);
          }
        }
      }
    }
    return;
  }
  if (kind === 'tone-rings') {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(Math.max(0.8, cell * (0.05 + 0.12 * density)));
  }
  const ringScale = kind === 'tone-rings' ? 0.75 : 1;
  for (let r = -1; r <= TONE_CELLS; r++) {
    const offset = r % 2 === 0 ? 0 : cell / 2;
    for (let c = -1; c <= TONE_CELLS; c++) {
      canvas.drawCircle(c * cell + cell / 2 + offset, r * cell + cell / 2, sizeAt(r, c) * ringScale, paint);
    }
  }
}

const TEXTURE_NOISE: Record<'paper' | 'canvas' | 'grain', NoiseSpec> = {
  paper: { shader: (t) => Skia.Shader.MakeFractalNoise(0.06, 0.06, 4, 21, t, t), k: 1.8, b: -0.4 },
  canvas: { shader: (t) => Skia.Shader.MakeFractalNoise(0.015, 0.12, 3, 33, t, t), k: 2, b: -0.5 },
  grain: { shader: (t) => Skia.Shader.MakeFractalNoise(0.5, 0.5, 1, 45, t, t), k: 2.5, b: -0.75 },
};

/**
 * Returns the stamp image for a tip shape. Hardness controls the radial falloff; roundness
 * squashes the tip into an ellipse (flat brushes). Parameters are quantised for caching.
 */
/**
 * Image tips are stored outside the engine (storage/brushTips registers a loader at start-up);
 * the loader returns a white alpha mask of TIP_SIZE × TIP_SIZE, or null if missing.
 */
let imageTipLoader: ((id: string) => SkImage | null) | null = null;

export function setImageTipLoader(loader: (id: string) => SkImage | null): void {
  imageTipLoader = loader;
}

export function getTipImage(tip: BrushTip, hardness: number, roundness: number, imageId?: string): SkImage {
  // A missing image tip falls back to a round tip, so the brush still paints.
  const loaded = tip === 'image' && imageId && imageTipLoader ? imageTipLoader(imageId) : null;
  if (tip === 'image' && loaded) return squashed(loaded, roundness, imageId ?? '');
  if (tip === 'image') tip = 'round';
  const h = Math.round(hardness * 20) / 20;
  const r = Math.round(roundness * 20) / 20;
  const key = `${tip}|${h}|${r}`;
  const cached = tipCache.get(key);
  if (cached) return cached;

  const S = TIP_SIZE;
  const surface = Skia.Surface.Make(S, S);
  if (!surface) throw new Error('Unable to allocate brush tip');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const radius = S / 2 - 1;
  const shape = SHAPE_PATHS[tip];
  const path = shape ? Skia.Path.MakeFromSVGString(shape()) : null;
  if (path) {
    // Softness blurs the outline; the shape shrinks so the blur stays inside the tip.
    const margin = (1 - h) * S * 0.18;
    paint.setColor(Skia.Color('white'));
    if (h < 0.999) paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(0.5, margin / 2.5), true));
    const k = (S - 2 - margin * 2) / 100;
    canvas.save();
    canvas.translate(S / 2, S / 2);
    canvas.scale(k, k * Math.max(0.05, r));
    canvas.translate(-50, -50);
    canvas.drawPath(path, paint);
    canvas.restore();
  } else if (h >= 0.999) {
    paint.setColor(Skia.Color('white'));
  } else {
    const solid = Math.max(0.001, Math.min(0.995, h));
    paint.setShader(
      Skia.Shader.MakeRadialGradient(
        { x: S / 2, y: S / 2 },
        radius,
        [Skia.Color('white'), Skia.Color('white'), Skia.Color('rgba(255,255,255,0)')],
        [0, solid, 1],
        TileMode.Clamp,
      ),
    );
  }
  if (!path) {
    canvas.save();
    canvas.translate(S / 2, S / 2);
    canvas.scale(1, Math.max(0.05, r));
    canvas.translate(-S / 2, -S / 2);
    canvas.drawCircle(S / 2, S / 2, radius, paint);
    canvas.restore();
  }

  const noise = TIP_NOISE[tip];
  if (noise) {
    const mask = Skia.Paint();
    mask.setShader(noise.shader(S));
    mask.setColorFilter(lumaAlpha(noise.k, noise.b));
    mask.setBlendMode(BlendMode.DstIn);
    canvas.drawRect(Skia.XYWHRect(0, 0, S, S), mask);
  }

  surface.flush();
  const image = surface.makeImageSnapshot();
  tipCache.set(key, image);
  return image;
}

/** An image tip squashed by the brush's roundness (cached per tip and roundness). */
function squashed(image: SkImage, roundness: number, id: string): SkImage {
  const r = Math.round(roundness * 20) / 20;
  if (r >= 1) return image;
  const key = `image:${id}|${r}`;
  const cached = tipCache.get(key);
  if (cached) return cached;
  const S = TIP_SIZE;
  const surface = Skia.Surface.Make(S, S);
  if (!surface) return image;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, (S * (1 - r)) / 2, S, S * r), Skia.Paint());
  surface.flush();
  const out = surface.makeImageSnapshot();
  tipCache.set(key, out);
  return out;
}

/**
 * Tileable paper texture used as a stroke mask: alpha = 1 − strength · (1 − grain), so
 * strength 0 leaves the stroke untouched and 1 lets only the paper's peaks take colour.
 * Returns null when there is no texture.
 */
export function getTextureImage(kind: BrushTexture, strength: number, variation = 0): SkImage | null {
  if (kind === 'none' || strength <= 0.001) return null;
  const s = Math.round(strength * 20) / 20;
  const v = Math.round(variation * 20) / 20;
  const key = `${kind}|${s}|${v}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const T = TEXTURE_TILE;
  const surface = Skia.Surface.Make(T, T);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  if (isToneTexture(kind)) {
    drawTone(canvas, kind as ToneKind, s, v, T);
    surface.flush();
    const tone = surface.makeImageSnapshot();
    textureCache.set(key, tone);
    return tone;
  }
  const spec = TEXTURE_NOISE[kind as keyof typeof TEXTURE_NOISE];
  const paint = Skia.Paint();
  paint.setShader(spec.shader(T));
  // alpha = s·(k·luma + b) + (1 − s)
  paint.setColorFilter(lumaAlpha(s * spec.k, s * spec.b + 1 - s));
  canvas.drawRect(Skia.XYWHRect(0, 0, T, T), paint);
  surface.flush();
  const image = surface.makeImageSnapshot();
  textureCache.set(key, image);
  return image;
}
