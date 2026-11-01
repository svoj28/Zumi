import type { BrushPreset } from '@/engine/brush/brushPreset';
import { createDabState, emitDabs, type DabState } from '@/engine/brush/dabEmitter';
import { S_PRESSURE, S_TILT_X, S_TILT_Y, S_X, S_Y, SAMPLE_STRIDE, type FlatSamples } from '@/engine/types';

/**
 * Turns sparse input samples into a smooth, continuous stroke.
 *
 * Touch screens report points at 60–240 Hz; at speed they can be far apart, and joining them
 * with straight lines produces visible corners. Instead each segment between two samples is
 * drawn along a *centripetal Catmull–Rom* spline through its neighbours. The centripetal
 * parameterisation (α = 0.5) never overshoots or forms loops on sharp turns, unlike the
 * uniform variant. Pressure and tilt are interpolated along the same curve.
 *
 * A segment P1→P2 needs the next point P3, so the newest segment is always one sample behind.
 * `strokeTail` fills that gap for the live preview (recomputed on every event), and `strokeEnd`
 * flushes it when the stroke finishes. Live drawing and the final commit (`replayStroke`) run
 * the exact same functions, so the committed stroke matches what the artist saw.
 *
 * Output is dab records (see dabEmitter). All functions are worklets; control points are kept
 * as a flat [x, y, pressure, tiltX, tiltY, …] array.
 */

const C = 5; // control point stride

export interface StrokePathState {
  dab: DabState;
  /** Up to the last 3 control points, flat [x, y, p, tiltX, tiltY, …]. */
  ctrl: number[];
}

/** Points closer than this (canvas px) are treated as jitter and skipped. */
const MIN_POINT_DISTANCE_SQ = 0.25;
/** Curve subdivision length in canvas px (dab spacing is handled by the dab emitter). */
const SUBDIVISION_PX = 2.5;
const MAX_SUBDIVISIONS = 96;

// NOTE: worklet functions capture the variables they reference when they are *defined*
// (the worklets Babel plugin builds their closures eagerly), so helpers must be declared
// before the worklets that call them — function hoisting does not apply.

/**
 * Emits dabs along the centripetal Catmull–Rom segment P1→P2 (control points P0 and P3),
 * evaluated with the Barry–Goldman pyramid.
 */
function emitCurve(
  c: number[],
  i0: number,
  i1: number,
  i2: number,
  i3: number,
  dab: DabState,
  brush: BrushPreset,
  out: number[],
): DabState {
  'worklet';
  const x0 = c[i0 * C], y0 = c[i0 * C + 1];
  const x1 = c[i1 * C], y1 = c[i1 * C + 1], p1 = c[i1 * C + 2], tx1 = c[i1 * C + 3], ty1 = c[i1 * C + 4];
  const x2 = c[i2 * C], y2 = c[i2 * C + 1], p2 = c[i2 * C + 2], tx2 = c[i2 * C + 3], ty2 = c[i2 * C + 4];
  const x3 = c[i3 * C], y3 = c[i3 * C + 1];

  // Knot intervals: sqrt of chord length (α = 0.5). The epsilon keeps duplicated end points
  // (used at stroke start/end) well-defined; with P0 = P1 the formula degenerates exactly.
  const knot = (ax: number, ay: number, bx: number, by: number) =>
    Math.max(1e-4, Math.sqrt(Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)));
  const t0 = 0;
  const t1 = t0 + knot(x0, y0, x1, y1);
  const t2 = t1 + knot(x1, y1, x2, y2);
  const t3 = t2 + knot(x2, y2, x3, y3);

  const chord = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const steps = Math.min(MAX_SUBDIVISIONS, Math.max(1, Math.ceil(chord / SUBDIVISION_PX)));

  let state = dab;
  for (let s = 1; s <= steps; s++) {
    const u = s / steps;
    const t = t1 + (t2 - t1) * u;
    const a1x = ((t1 - t) * x0 + (t - t0) * x1) / (t1 - t0);
    const a1y = ((t1 - t) * y0 + (t - t0) * y1) / (t1 - t0);
    const a2x = ((t2 - t) * x1 + (t - t1) * x2) / (t2 - t1);
    const a2y = ((t2 - t) * y1 + (t - t1) * y2) / (t2 - t1);
    const a3x = ((t3 - t) * x2 + (t - t2) * x3) / (t3 - t2);
    const a3y = ((t3 - t) * y2 + (t - t2) * y3) / (t3 - t2);
    const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
    const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
    const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
    const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
    const x = ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1);
    const y = ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1);
    state = emitDabs(state, x, y, p1 + (p2 - p1) * u, tx1 + (tx2 - tx1) * u, ty1 + (ty2 - ty1) * u, brush, out);
  }
  return state;
}

export function strokeBegin(
  x: number,
  y: number,
  p: number,
  tiltX: number,
  tiltY: number,
  brush: BrushPreset,
  seed: number,
  out: number[],
): StrokePathState {
  'worklet';
  return { dab: emitDabs(createDabState(seed), x, y, p, tiltX, tiltY, brush, out), ctrl: [x, y, p, tiltX, tiltY] };
}

export function strokeAdd(
  state: StrokePathState,
  x: number,
  y: number,
  p: number,
  tiltX: number,
  tiltY: number,
  brush: BrushPreset,
  out: number[],
): StrokePathState {
  'worklet';
  const last = state.ctrl.length - C;
  const dx = x - state.ctrl[last];
  const dy = y - state.ctrl[last + 1];
  if (dx * dx + dy * dy < MIN_POINT_DISTANCE_SQ) return state;

  const ctrl = state.ctrl.concat([x, y, p, tiltX, tiltY]);
  const n = ctrl.length / C;
  let dab = state.dab;
  if (n >= 3) {
    // Emit the segment between the 2nd- and 3rd-newest points, now that its successor exists.
    const i1 = n - 3;
    const i0 = n >= 4 ? n - 4 : i1;
    dab = emitCurve(ctrl, i0, i1, n - 2, n - 1, dab, brush, out);
  }
  return { dab, ctrl: n > 3 ? ctrl.slice(ctrl.length - 3 * C) : ctrl };
}

/** Flushes the final pending segment. Returns the final dab state. */
export function strokeEnd(state: StrokePathState, brush: BrushPreset, out: number[]): DabState {
  'worklet';
  const n = state.ctrl.length / C;
  if (n < 2) return state.dab;
  const i1 = n - 2;
  const i0 = n >= 3 ? n - 3 : i1;
  return emitCurve(state.ctrl, i0, i1, n - 1, n - 1, state.dab, brush, out);
}

/**
 * Live-preview tail: dabs from the last emitted point through the pending control point to the
 * current raw input position. Written to a separate list that is replaced every event, so the
 * stroke visually reaches the finger/pen with no smoothing or lookahead lag. Uses a copy of the
 * emitter state, so it never disturbs the deterministic main sequence.
 */
export function strokeTail(
  state: StrokePathState,
  rawX: number,
  rawY: number,
  rawP: number,
  rawTiltX: number,
  rawTiltY: number,
  brush: BrushPreset,
  out: number[],
): void {
  'worklet';
  let dab = state.dab;
  const last = state.ctrl.length - C;
  const c = state.ctrl;
  if (c[last] !== dab.lastX || c[last + 1] !== dab.lastY) {
    dab = emitDabs(dab, c[last], c[last + 1], c[last + 2], c[last + 3], c[last + 4], brush, out);
  }
  emitDabs(dab, rawX, rawY, rawP, rawTiltX, rawTiltY, brush, out);
}

/** Rebuilds a complete stroke's dabs from recorded samples (used when committing). */
export function replayStroke(samples: FlatSamples, brush: BrushPreset, seed: number, out: number[]): void {
  'worklet';
  if (samples.length < SAMPLE_STRIDE) return;
  const s = samples;
  let state = strokeBegin(s[S_X], s[S_Y], s[S_PRESSURE], s[S_TILT_X], s[S_TILT_Y], brush, seed, out);
  for (let i = SAMPLE_STRIDE; i + SAMPLE_STRIDE <= s.length; i += SAMPLE_STRIDE) {
    state = strokeAdd(state, s[i + S_X], s[i + S_Y], s[i + S_PRESSURE], s[i + S_TILT_X], s[i + S_TILT_Y], brush, out);
  }
  strokeEnd(state, brush, out);
}
