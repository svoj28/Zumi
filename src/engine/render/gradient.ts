import { Skia, TileMode, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';

/**
 * Gradient tool: linear and radial colour gradients, and a screentone ("manga") gradient whose
 * halftone dots shrink from the start point to the end point. The shader is built the same way
 * for the live preview (UI thread) and the commit (JS thread).
 */

export type GradientKind = 'linear' | 'radial' | 'tone';

export interface GradientSpec {
  kind: GradientKind;
  /** Start and end in canvas pixels (radial: centre and a point on the edge). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Start and end colours as RGBA 0..1 (the end is often transparent). */
  from: readonly number[];
  to: readonly number[];
  /** Screentone gradient: dot cell size (px) and pattern angle (degrees). */
  cell: number;
  angle: number;
}

/** Dots on a rotated grid whose size follows the gradient: full at the start, none at the end. */
export const TONE_GRADIENT_SKSL = `
uniform float2 a;
uniform float2 b;
uniform float cell;
uniform float angle;
uniform float4 color;

half4 main(float2 xy) {
  float2 ab = b - a;
  float t = dot(xy - a, ab) / max(dot(ab, ab), 0.0001);
  float coverage = 1.0 - clamp(t, 0.0, 1.0);
  float c = cos(angle);
  float s = sin(angle);
  float2 r = float2(c * xy.x + s * xy.y, -s * xy.x + c * xy.y);
  float2 cellPos = fract(r / cell) - 0.5;
  float d = length(cellPos) * cell;
  // Dot radius so the inked share of the cell follows the coverage (dots merge near full).
  float radius = sqrt(coverage / 3.14159) * cell * 1.08;
  float alpha = coverage <= 0.001 ? 0.0 : clamp(radius - d + 0.5, 0.0, 1.0);
  return half4(color.rgb * color.a * alpha, color.a * alpha);
}
`;

let toneEffect: SkRuntimeEffect | null | undefined;

/** The compiled screentone gradient shader (null if unavailable). */
export function toneGradientEffect(): SkRuntimeEffect | null {
  if (toneEffect === undefined) {
    toneEffect = Skia.RuntimeEffect.Make(TONE_GRADIENT_SKSL);
    if (!toneEffect) console.warn('[gradient] Could not compile the tone gradient shader');
  }
  return toneEffect;
}

/** Shader for a gradient, or null when it is too short. Worklet: also used for the live preview. */
export function gradientShader(spec: GradientSpec, tone: SkRuntimeEffect | null): SkShader | null {
  'worklet';
  const length = Math.hypot(spec.x1 - spec.x0, spec.y1 - spec.y0);
  if (length < 1) return null;
  const c0 = Float32Array.of(spec.from[0], spec.from[1], spec.from[2], spec.from[3]);
  const c1 = Float32Array.of(spec.to[0], spec.to[1], spec.to[2], spec.to[3]);
  if (spec.kind === 'linear') {
    return Skia.Shader.MakeLinearGradient({ x: spec.x0, y: spec.y0 }, { x: spec.x1, y: spec.y1 }, [c0, c1], null, TileMode.Clamp);
  }
  if (spec.kind === 'radial') {
    return Skia.Shader.MakeRadialGradient({ x: spec.x0, y: spec.y0 }, length, [c0, c1], null, TileMode.Clamp);
  }
  if (!tone) return null;
  return tone.makeShader([
    spec.x0,
    spec.y0,
    spec.x1,
    spec.y1,
    Math.max(2, spec.cell),
    (spec.angle * Math.PI) / 180,
    spec.from[0],
    spec.from[1],
    spec.from[2],
    spec.from[3],
  ]);
}
