import { D_ROTATION, D_X, D_Y, DAB_STRIDE } from '@/engine/brush/dabEmitter';

/**
 * Symmetry drawing. Mirroring happens on dab records (after the brush engine has placed its
 * stamps), so the live preview and the committed stroke run the very same function and every
 * brush, shape and dynamic is mirrored for free. Copies of one stroke share its layer, so
 * where they overlap they build up like a single stroke (never beyond the brush opacity).
 *
 * All functions are worklets.
 */

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'quadrant' | 'radial';

export interface Symmetry {
  mode: SymmetryMode;
  /** Axis centre, canvas coordinates. */
  x: number;
  y: number;
  /** Radial only: number of rotated copies (including the original). */
  segments: number;
}

export const MIN_RADIAL_SEGMENTS = 2;
export const MAX_RADIAL_SEGMENTS = 16;

/** Appends the mirrored copies of every dab in `dabs` and returns the same array. */
export function applySymmetry(dabs: number[], s: Symmetry | null | undefined): number[] {
  'worklet';
  if (!s || s.mode === 'off') return dabs;
  const n = dabs.length - (dabs.length % DAB_STRIDE);
  const copy = (i: number, x: number, y: number, rot: number) => {
    for (let k = 0; k < DAB_STRIDE; k++) dabs.push(dabs[i + k]);
    const j = dabs.length - DAB_STRIDE;
    dabs[j + D_X] = x;
    dabs[j + D_Y] = y;
    dabs[j + D_ROTATION] = rot;
  };
  for (let i = 0; i < n; i += DAB_STRIDE) {
    const x = dabs[i + D_X];
    const y = dabs[i + D_Y];
    const rot = dabs[i + D_ROTATION];
    const mx = 2 * s.x - x;
    const my = 2 * s.y - y;
    if (s.mode === 'vertical' || s.mode === 'quadrant') copy(i, mx, y, Math.PI - rot);
    if (s.mode === 'horizontal' || s.mode === 'quadrant') copy(i, x, my, -rot);
    if (s.mode === 'quadrant') copy(i, mx, my, rot + Math.PI);
    if (s.mode === 'radial') {
      const count = Math.max(MIN_RADIAL_SEGMENTS, Math.min(MAX_RADIAL_SEGMENTS, Math.round(s.segments)));
      for (let k = 1; k < count; k++) {
        const a = (k * 2 * Math.PI) / count;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const dx = x - s.x;
        const dy = y - s.y;
        copy(i, s.x + dx * cos - dy * sin, s.y + dx * sin + dy * cos, rot + a);
      }
    }
  }
  return dabs;
}

/**
 * Axis lines as flat [x0, y0, x1, y1, …] segments across a `width` × `height` canvas, for the
 * on-screen overlay (never rasterised or exported).
 */
export function symmetryAxes(s: Symmetry, width: number, height: number): number[] {
  'worklet';
  const out: number[] = [];
  if (s.mode === 'vertical' || s.mode === 'quadrant') out.push(s.x, 0, s.x, height);
  if (s.mode === 'horizontal' || s.mode === 'quadrant') out.push(0, s.y, width, s.y);
  if (s.mode === 'radial') {
    const count = Math.max(MIN_RADIAL_SEGMENTS, Math.min(MAX_RADIAL_SEGMENTS, Math.round(s.segments)));
    const reach = Math.hypot(width, height);
    for (let k = 0; k < count; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / count;
      out.push(s.x, s.y, s.x + Math.cos(a) * reach, s.y + Math.sin(a) * reach);
    }
  }
  return out;
}
