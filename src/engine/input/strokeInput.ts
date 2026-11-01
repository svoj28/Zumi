/**
 * Raw pointer → stroke sample processing (pressure normalisation + smoothing).
 * Worklets: executed on the UI thread inside gesture callbacks, so no React state is involved.
 */

/** Mirrors react-native-gesture-handler's PointerType enum values. */
export const POINTER_TOUCH = 0;
export const POINTER_STYLUS = 1;
export const POINTER_MOUSE = 2;

export interface SmoothingState {
  x: number;
  y: number;
  p: number;
  primed: boolean;
}

export function createSmoothingState(): SmoothingState {
  'worklet';
  return { x: 0, y: 0, p: 1, primed: false };
}

/** Monotonic milliseconds, available on both the JS and UI runtimes. */
export function nowMs(): number {
  'worklet';
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/** True when the pointer reports real pressure (pressure-sensitive stylus). */
export function hasRealPressure(pointerType: number, stylusPressure: number | undefined): boolean {
  'worklet';
  return pointerType === POINTER_STYLUS && stylusPressure !== undefined && stylusPressure > 0;
}

/**
 * Converts gesture-handler stylus data into a 0..1 pressure value.
 * Touch, capacitive styluses and mouse have no pressure, so they draw at full pressure.
 */
export function resolvePressure(pointerType: number, stylusPressure: number | undefined): number {
  'worklet';
  if (!hasRealPressure(pointerType, stylusPressure)) return 1;
  return Math.min(1, Math.max(0.02, stylusPressure as number));
}

export interface SpeedPressureState {
  x: number;
  y: number;
  t: number;
  p: number;
  primed: boolean;
}

export function createSpeedPressureState(): SpeedPressureState {
  'worklet';
  return { x: 0, y: 0, t: 0, p: 1, primed: false };
}

/** Screen speed (px/ms) at which simulated pressure reaches its minimum. */
const FAST_SPEED = 3.5;
const MIN_SIMULATED_PRESSURE = 0.3;

/**
 * Simulated pressure for input without pressure: faster movement → lower value, eased so the
 * width changes smoothly. Uses *screen* coordinates so the feel is independent of zoom.
 */
export function updateSpeedPressure(state: SpeedPressureState, sx: number, sy: number, t: number): SpeedPressureState {
  'worklet';
  if (!state.primed) return { x: sx, y: sy, t, p: 1, primed: true };
  const dt = Math.max(1, t - state.t);
  const speed = Math.sqrt((sx - state.x) ** 2 + (sy - state.y) ** 2) / dt;
  const target = Math.max(MIN_SIMULATED_PRESSURE, 1 - (speed / FAST_SPEED) * (1 - MIN_SIMULATED_PRESSURE));
  return { x: sx, y: sy, t, p: state.p + (target - state.p) * 0.3, primed: true };
}

/** Follow time constant (ms) at full stabiliser strength. */
const MAX_FOLLOW_MS = 320;
/** Follow time constant (ms) at the lowest strength (still noticeably smoothing). */
const MIN_FOLLOW_MS = 12;

/** Time constant of the stabiliser for a strength 0..1 (eased: fine control at low values). */
export function followTimeMs(strength: number): number {
  'worklet';
  const s = Math.min(1, Math.max(0, strength));
  return MIN_FOLLOW_MS + (MAX_FOLLOW_MS - MIN_FOLLOW_MS) * s * s;
}

/**
 * Time-based stabiliser step (as in most painting apps): the brush tip glides toward the
 * pointer, covering a fixed share of the remaining distance per unit of time, and keeps
 * gliding while the pointer rests. Jitter averages out and changes of direction become smooth
 * curves; a stronger setting follows more slowly. Frame-rate independent.
 */
export function followStep(
  tipX: number,
  tipY: number,
  px: number,
  py: number,
  dtMs: number,
  strength: number,
): { x: number; y: number } {
  'worklet';
  const k = 1 - Math.exp(-Math.max(0, dtMs) / followTimeMs(strength));
  return { x: tipX + (px - tipX) * k, y: tipY + (py - tipY) * k };
}

/**
 * Exponential moving average smoothing ("stabiliser"). Returns the new state; the smoothed
 * sample is the state's x/y/p.
 */
export function smoothSample(
  state: SmoothingState,
  x: number,
  y: number,
  p: number,
  smoothing: number,
): SmoothingState {
  'worklet';
  if (!state.primed) {
    return { x, y, p, primed: true };
  }
  // smoothing 0 → follow input exactly; smoothing 1 → heavy lag (never fully frozen).
  const alpha = 1 - Math.min(0.95, Math.max(0, smoothing) * 0.95);
  return {
    x: state.x + (x - state.x) * alpha,
    y: state.y + (y - state.y) * alpha,
    p: state.p + (p - state.p) * alpha,
    primed: true,
  };
}
