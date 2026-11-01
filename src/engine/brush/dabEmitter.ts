import type { BrushPreset } from '@/engine/brush/brushPreset';

/**
 * Dab emitter: walks along an (already smoothed and interpolated) stroke and places brush
 * stamps ("dabs") at a spacing proportional to the dab diameter, evaluating the preset's
 * dynamics for each one — pressure/tilt response, size/opacity/rotation jitter and scatter.
 *
 * Output is a flat record list, DAB_STRIDE numbers per dab:
 *
 *   [x, y, diameter, rotation (radians), alpha (0..1), …]
 *
 * which the stamp renderer turns into one GPU atlas draw. Randomness comes from a seeded PRNG
 * carried in the state and every dab consumes the same number of draws, so replaying the same
 * samples with the same seed reproduces the live preview exactly.
 *
 * All functions are worklets (UI thread for the live preview, JS thread for the commit).
 */

export const DAB_STRIDE = 5;
export const D_X = 0;
export const D_Y = 1;
export const D_SIZE = 2;
export const D_ROTATION = 3;
export const D_ALPHA = 4;

export interface DabState {
  lastX: number;
  lastY: number;
  lastP: number;
  lastTiltX: number;
  lastTiltY: number;
  /** Distance travelled since the last dab was placed. */
  travelled: number;
  started: boolean;
  /** PRNG state (mulberry32 counter). */
  rng: number;
  /** Current stroke direction, radians. */
  direction: number;
}

export function createDabState(seed: number): DabState {
  'worklet';
  return { lastX: 0, lastY: 0, lastP: 1, lastTiltX: 0, lastTiltY: 0, travelled: 0, started: false, rng: seed | 0, direction: 0 };
}

/** mulberry32: returns a value in [0, 1) for a given counter state. */
function hash01(state: number): number {
  'worklet';
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const RNG_STEP = 0x6d2b79f5;
const RANDOMS_PER_DAB = 5;

/** Nominal diameter (before jitter) — also used for spacing. */
export function baseDiameter(b: BrushPreset, pressure: number, tiltX: number, tiltY: number): number {
  'worklet';
  const pc = Math.pow(Math.min(1, Math.max(0, pressure)), b.pressure.curve);
  let factor = 1 - b.pressure.size * (1 - pc);
  if (b.tilt.mode === 'size') {
    // Tilting the stylus (shading with the side of a pencil) widens the mark.
    const tilt = Math.min(90, Math.sqrt(tiltX * tiltX + tiltY * tiltY)) / 90;
    factor *= 1 + b.tilt.amount * tilt * 2;
  }
  return Math.max(b.minSize, b.size * factor);
}

function placeDab(
  rngIn: number,
  x: number,
  y: number,
  p: number,
  tiltX: number,
  tiltY: number,
  direction: number,
  b: BrushPreset,
  out: number[],
): number {
  'worklet';
  let rng = rngIn;
  const r: number[] = [];
  for (let i = 0; i < RANDOMS_PER_DAB; i++) {
    rng = (rng + RNG_STEP) | 0;
    r.push(hash01(rng));
  }

  const tiltMag = Math.min(90, Math.sqrt(tiltX * tiltX + tiltY * tiltY)) / 90;
  let d = baseDiameter(b, p, tiltX, tiltY) * (1 + b.jitter.size * (r[0] * 2 - 1));
  d = Math.max(0.5, d);

  const ox = (r[1] * 2 - 1) * b.scatter * d;
  const oy = (r[2] * 2 - 1) * b.scatter * d;

  let rotation = (b.rotation.angle * Math.PI) / 180 + b.jitter.rotation * (r[3] * 2 - 1) * Math.PI;
  if (b.rotation.followStroke) rotation += direction;
  if (b.tilt.mode === 'angle' && tiltMag > 0.01) rotation += Math.atan2(tiltY, tiltX) * b.tilt.amount;

  const pc = Math.pow(Math.min(1, Math.max(0, p)), b.pressure.curve);
  let alpha = b.flow * (1 - b.pressure.opacity * (1 - pc)) * (1 - b.jitter.opacity * r[4]);
  if (b.tilt.mode === 'opacity') alpha *= 1 - b.tilt.amount * tiltMag;

  out.push(x + ox, y + oy, d, rotation, Math.min(1, Math.max(0, alpha)));
  return rng;
}

/** Appends dabs for a new stroke point to `out`, returning the updated emitter state. */
export function emitDabs(
  state: DabState,
  x: number,
  y: number,
  p: number,
  tiltX: number,
  tiltY: number,
  b: BrushPreset,
  out: number[],
): DabState {
  'worklet';
  if (!state.started) {
    const rng = placeDab(state.rng, x, y, p, tiltX, tiltY, state.direction, b, out);
    return { lastX: x, lastY: y, lastP: p, lastTiltX: tiltX, lastTiltY: tiltY, travelled: 0, started: true, rng, direction: state.direction };
  }

  const dx = x - state.lastX;
  const dy = y - state.lastY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-4) return { ...state, lastP: p, lastTiltX: tiltX, lastTiltY: tiltY };

  const direction = Math.atan2(dy, dx);
  let rng = state.rng;
  let travelled = state.travelled;
  let pos = 0;
  // Hard cap protects against pathological input (e.g. huge jumps with tiny brushes).
  for (let guard = 0; guard < 20000; guard++) {
    const f = pos / dist;
    const pAt = state.lastP + (p - state.lastP) * f;
    const step = Math.max(0.5, baseDiameter(b, pAt, state.lastTiltX, state.lastTiltY) * b.spacing);
    const needed = step - travelled;
    if (pos + needed > dist) {
      travelled += dist - pos;
      break;
    }
    pos += needed;
    travelled = 0;
    const t = pos / dist;
    rng = placeDab(
      rng,
      state.lastX + dx * t,
      state.lastY + dy * t,
      state.lastP + (p - state.lastP) * t,
      state.lastTiltX + (tiltX - state.lastTiltX) * t,
      state.lastTiltY + (tiltY - state.lastTiltY) * t,
      direction,
      b,
      out,
    );
  }

  return { lastX: x, lastY: y, lastP: p, lastTiltX: tiltX, lastTiltY: tiltY, travelled, started: true, rng, direction };
}
