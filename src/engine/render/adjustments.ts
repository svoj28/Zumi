import {
  BlendMode,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

/**
 * Image adjustments and filters for a layer. Everything except blur runs through one SkSL
 * shader (`ADJUST_SKSL`), so the live preview on the canvas (GPU) and the applied result (CPU)
 * come from the same code. Blur uses Skia's Gaussian blur image filter.
 */

export type AdjustmentKind =
  | 'hsl'
  | 'brightnessContrast'
  | 'levels'
  | 'curves'
  | 'colorBalance'
  | 'invert'
  | 'grayscale'
  | 'posterize'
  | 'threshold'
  | 'sharpen'
  | 'noise'
  | 'blur';

export interface AdjustmentParam {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** Shown value: percent (×100), degrees, pixels or a plain number. */
  unit: '%' | '°' | 'px' | '';
  step?: number;
}

export interface AdjustmentInfo {
  kind: AdjustmentKind;
  label: string;
  group: 'Colour' | 'Tone' | 'Filters';
  params: AdjustmentParam[];
}

export const ADJUSTMENTS: readonly AdjustmentInfo[] = [
  {
    kind: 'hsl',
    label: 'Hue / Saturation',
    group: 'Colour',
    params: [
      { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0, unit: '°', step: 1 },
      { key: 'saturation', label: 'Saturation', min: -1, max: 1, default: 0, unit: '%' },
      { key: 'lightness', label: 'Lightness', min: -1, max: 1, default: 0, unit: '%' },
    ],
  },
  {
    kind: 'colorBalance',
    label: 'Colour balance',
    group: 'Colour',
    params: [
      { key: 'temperature', label: 'Temperature (cool ↔ warm)', min: -1, max: 1, default: 0, unit: '%' },
      { key: 'tint', label: 'Tint (green ↔ magenta)', min: -1, max: 1, default: 0, unit: '%' },
    ],
  },
  { kind: 'grayscale', label: 'Black & white', group: 'Colour', params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, default: 1, unit: '%' }] },
  { kind: 'invert', label: 'Invert', group: 'Colour', params: [] },
  {
    kind: 'brightnessContrast',
    label: 'Brightness / Contrast',
    group: 'Tone',
    params: [
      { key: 'brightness', label: 'Brightness', min: -1, max: 1, default: 0, unit: '%' },
      { key: 'contrast', label: 'Contrast', min: -1, max: 1, default: 0, unit: '%' },
    ],
  },
  {
    kind: 'levels',
    label: 'Levels',
    group: 'Tone',
    params: [
      { key: 'inBlack', label: 'Input black', min: 0, max: 0.9, default: 0, unit: '%' },
      { key: 'inWhite', label: 'Input white', min: 0.1, max: 1, default: 1, unit: '%' },
      { key: 'gamma', label: 'Midtones (gamma)', min: 0.2, max: 3, default: 1, unit: '' },
      { key: 'outBlack', label: 'Output black', min: 0, max: 1, default: 0, unit: '%' },
      { key: 'outWhite', label: 'Output white', min: 0, max: 1, default: 1, unit: '%' },
    ],
  },
  {
    kind: 'curves',
    label: 'Curves',
    group: 'Tone',
    params: [
      { key: 'shadows', label: 'Shadows', min: -1, max: 1, default: 0, unit: '%' },
      { key: 'midtones', label: 'Midtones', min: -1, max: 1, default: 0, unit: '%' },
      { key: 'highlights', label: 'Highlights', min: -1, max: 1, default: 0, unit: '%' },
    ],
  },
  { kind: 'posterize', label: 'Posterize', group: 'Tone', params: [{ key: 'levels', label: 'Levels', min: 2, max: 16, default: 4, unit: '', step: 1 }] },
  { kind: 'threshold', label: 'Threshold', group: 'Tone', params: [{ key: 'level', label: 'Level', min: 0, max: 1, default: 0.5, unit: '%' }] },
  { kind: 'blur', label: 'Gaussian blur', group: 'Filters', params: [{ key: 'radius', label: 'Radius', min: 0, max: 100, default: 6, unit: 'px', step: 0.5 }] },
  { kind: 'sharpen', label: 'Sharpen', group: 'Filters', params: [{ key: 'amount', label: 'Amount', min: 0, max: 3, default: 0.8, unit: '%' }] },
  {
    kind: 'noise',
    label: 'Noise',
    group: 'Filters',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, default: 0.15, unit: '%' },
      { key: 'mono', label: 'Monochrome', min: 0, max: 1, default: 1, unit: '', step: 1 },
    ],
  },
];

export interface Adjustment {
  kind: AdjustmentKind;
  values: Record<string, number>;
}

export function adjustmentInfo(kind: AdjustmentKind): AdjustmentInfo {
  return ADJUSTMENTS.find((a) => a.kind === kind)!;
}

/** The adjustment with every parameter at its default. */
export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  return { kind, values: Object.fromEntries(adjustmentInfo(kind).params.map((p) => [p.key, p.default])) };
}

/** True when applying would leave the image unchanged. */
export function isNeutral(adj: Adjustment): boolean {
  switch (adj.kind) {
    case 'invert':
    case 'posterize':
    case 'threshold':
      return false;
    case 'grayscale':
    case 'noise':
    case 'sharpen':
      return (adj.values.amount ?? 0) === 0;
    case 'blur':
      return (adj.values.radius ?? 0) <= 0;
    default: {
      const info = adjustmentInfo(adj.kind);
      return info.params.every((p) => Math.abs((adj.values[p.key] ?? p.default) - p.default) < 1e-6);
    }
  }
}

const KIND_CODE: Record<Exclude<AdjustmentKind, 'blur'>, number> = {
  hsl: 0,
  brightnessContrast: 1,
  levels: 2,
  curves: 3,
  colorBalance: 4,
  invert: 5,
  grayscale: 6,
  posterize: 7,
  threshold: 8,
  sharpen: 9,
  noise: 10,
};

/**
 * One shader for all colour/tone adjustments plus sharpen and noise. Works on un-premultiplied
 * colour so semi-transparent pixels adjust like opaque ones, and never changes alpha.
 */
export const ADJUST_SKSL = `
uniform shader image;
uniform float kind;
uniform float4 p;
uniform float4 q;

float3 rgb2hsl(float3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float h = 0.0;
  float s = 0.0;
  float d = mx - mn;
  if (d > 0.00001) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return float3(h, s, l);
}

float hue2rgb(float p1, float q1, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p1 + (q1 - p1) * 6.0 * t;
  if (t < 0.5) return q1;
  if (t < 2.0 / 3.0) return p1 + (q1 - p1) * (2.0 / 3.0 - t) * 6.0;
  return p1;
}

float3 hsl2rgb(float3 c) {
  if (c.y <= 0.0) return float3(c.z);
  float q1 = c.z < 0.5 ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
  float p1 = 2.0 * c.z - q1;
  return float3(hue2rgb(p1, q1, c.x + 1.0 / 3.0), hue2rgb(p1, q1, c.x), hue2rgb(p1, q1, c.x - 1.0 / 3.0));
}

float luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

float hash(float2 v) { return fract(sin(dot(v, float2(12.9898, 78.233))) * 43758.5453); }

float3 zumiUnpremultiply(half4 c) { return c.a > 0.0 ? float3(c.rgb) / float(c.a) : float3(0.0); }

half4 main(float2 xy) {
  half4 src = image.eval(xy);
  if (src.a <= 0.0) return src;
  float3 c = zumiUnpremultiply(src);
  int k = int(kind + 0.5);
  if (k == 0) {
    float3 hsl = rgb2hsl(c);
    hsl.x = fract(hsl.x + p.x / 360.0 + 1.0);
    hsl.y = clamp(p.y >= 0.0 ? hsl.y + (1.0 - hsl.y) * p.y : hsl.y * (1.0 + p.y), 0.0, 1.0);
    hsl.z = clamp(p.z >= 0.0 ? hsl.z + (1.0 - hsl.z) * p.z : hsl.z * (1.0 + p.z), 0.0, 1.0);
    c = hsl2rgb(hsl);
  } else if (k == 1) {
    c = c + p.x;
    float f = p.y >= 0.0 ? 1.0 / max(0.001, 1.0 - p.y) : 1.0 + p.y;
    c = (c - 0.5) * f + 0.5;
  } else if (k == 2) {
    c = clamp((c - p.x) / max(0.001, p.y - p.x), 0.0, 1.0);
    c = pow(c, float3(1.0 / max(0.01, p.z)));
    c = q.x + c * (q.y - q.x);
  } else if (k == 3) {
    float3 sh = (1.0 - smoothstep(0.0, 0.5, c)) * p.x;
    float3 md = (1.0 - abs(c - 0.5) * 2.0) * p.y;
    float3 hi = smoothstep(0.5, 1.0, c) * p.z;
    c = c + (sh + md + hi) * 0.5;
  } else if (k == 4) {
    c.r += p.x * 0.15;
    c.b -= p.x * 0.15;
    c.g -= p.y * 0.12;
    c.r += p.y * 0.05;
    c.b += p.y * 0.05;
  } else if (k == 5) {
    c = 1.0 - c;
  } else if (k == 6) {
    c = mix(c, float3(luma(c)), p.x);
  } else if (k == 7) {
    float n = max(2.0, floor(p.x + 0.5));
    c = floor(c * (n - 1.0) + 0.5) / (n - 1.0);
  } else if (k == 8) {
    c = float3(luma(c) >= p.x ? 1.0 : 0.0);
  } else if (k == 9) {
    float3 n = zumiUnpremultiply(image.eval(xy + float2(1, 0))) + zumiUnpremultiply(image.eval(xy - float2(1, 0)))
             + zumiUnpremultiply(image.eval(xy + float2(0, 1))) + zumiUnpremultiply(image.eval(xy - float2(0, 1)));
    c = c + (c * 4.0 - n) * p.x * 0.25;
  } else if (k == 10) {
    float r = hash(xy) - 0.5;
    float3 rn = p.y > 0.5 ? float3(r) : float3(r, hash(xy + 17.0) - 0.5, hash(xy + 41.0) - 0.5);
    c = c + rn * p.x;
  }
  c = clamp(c, 0.0, 1.0);
  return half4(half3(c) * src.a, src.a);
}
`;

let effect: SkRuntimeEffect | null | undefined;

/** The compiled adjustment shader (null if the device's Skia rejects it). */
export function adjustEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(ADJUST_SKSL);
    if (!effect) console.warn('[adjust] Could not compile the adjustment shader');
  }
  return effect;
}

/** Uniforms for ADJUST_SKSL, in declaration order: kind, p (vec4), q (vec4). */
export function adjustUniforms(adj: Adjustment): { kind: number; p: number[]; q: number[] } {
  const v = (key: string) => adj.values[key] ?? adjustmentInfo(adj.kind).params.find((p) => p.key === key)?.default ?? 0;
  const zero = [0, 0, 0, 0];
  switch (adj.kind) {
    case 'hsl':
      return { kind: KIND_CODE.hsl, p: [v('hue'), v('saturation'), v('lightness'), 0], q: zero };
    case 'brightnessContrast':
      return { kind: KIND_CODE.brightnessContrast, p: [v('brightness') * 0.5, v('contrast'), 0, 0], q: zero };
    case 'levels':
      return { kind: KIND_CODE.levels, p: [v('inBlack'), v('inWhite'), v('gamma'), 0], q: [v('outBlack'), v('outWhite'), 0, 0] };
    case 'curves':
      return { kind: KIND_CODE.curves, p: [v('shadows'), v('midtones'), v('highlights'), 0], q: zero };
    case 'colorBalance':
      return { kind: KIND_CODE.colorBalance, p: [v('temperature'), v('tint'), 0, 0], q: zero };
    case 'grayscale':
      return { kind: KIND_CODE.grayscale, p: [v('amount'), 0, 0, 0], q: zero };
    case 'posterize':
      return { kind: KIND_CODE.posterize, p: [v('levels'), 0, 0, 0], q: zero };
    case 'threshold':
      return { kind: KIND_CODE.threshold, p: [v('level'), 0, 0, 0], q: zero };
    case 'sharpen':
      return { kind: KIND_CODE.sharpen, p: [v('amount'), 0, 0, 0], q: zero };
    case 'noise':
      return { kind: KIND_CODE.noise, p: [v('amount'), v('mono'), 0, 0], q: zero };
    case 'invert':
      return { kind: KIND_CODE.invert, p: zero, q: zero };
    case 'blur':
      return { kind: -1, p: zero, q: zero };
  }
}

/** Blur sigma for a radius in pixels (radius ≈ 3 sigma). */
export function blurSigma(adj: Adjustment): number {
  return Math.max(0.01, (adj.values.radius ?? 0) / 3);
}

/** A paint that draws `image` adjusted (at 0,0, in image pixels), or null if unsupported. */
export function adjustmentPaint(image: SkImage, adj: Adjustment): SkPaint | null {
  const paint = Skia.Paint();
  if (adj.kind === 'blur') {
    const s = blurSigma(adj);
    paint.setImageFilter(Skia.ImageFilter.MakeBlur(s, s, TileMode.Decal, null));
    return paint;
  }
  const fx = adjustEffect();
  if (!fx) return null;
  const u = adjustUniforms(adj);
  const child = image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None);
  paint.setShader(fx.makeShaderWithChildren([u.kind, ...u.p, ...u.q], [child]));
  return paint;
}

/** Draws `image` adjusted onto `canvas`, replacing what is there (Src blend). */
export function drawAdjusted(canvas: SkCanvas, image: SkImage, adj: Adjustment): boolean {
  const paint = adjustmentPaint(image, adj);
  if (!paint) return false;
  paint.setBlendMode(BlendMode.Src);
  if (adj.kind === 'blur') canvas.drawImage(image, 0, 0, paint);
  else canvas.drawRect(Skia.XYWHRect(0, 0, image.width(), image.height()), paint);
  return true;
}

/** Formats a parameter value for display. */
export function formatParam(param: AdjustmentParam, value: number): string {
  switch (param.unit) {
    case '%':
      return `${Math.round(value * 100)}%`;
    case '°':
      return `${Math.round(value)}°`;
    case 'px':
      return `${value.toFixed(value < 10 ? 1 : 0)} px`;
    default:
      return param.step === 1 ? String(Math.round(value)) : value.toFixed(2);
  }
}
