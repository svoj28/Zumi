/**
 * Maps between screen (view) space and canvas (document) space.
 *
 * The canvas is drawn with `screen = T + R(rotation) · (scale · canvas)`, which matches the
 * Skia transform array `[{translateX}, {translateY}, {rotate}, {scale}]`.
 * All functions are worklets so gesture callbacks can call them on the UI thread.
 */

export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
  /** Radians. */
  rotation: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;

export function screenToCanvas(t: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  'worklet';
  const dx = sx - t.tx;
  const dy = sy - t.ty;
  const cos = Math.cos(-t.rotation);
  const sin = Math.sin(-t.rotation);
  return {
    x: (dx * cos - dy * sin) / t.scale,
    y: (dx * sin + dy * cos) / t.scale,
  };
}

export function canvasToScreen(t: ViewTransform, cx: number, cy: number): { x: number; y: number } {
  'worklet';
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const x = cx * t.scale;
  const y = cy * t.scale;
  return { x: t.tx + x * cos - y * sin, y: t.ty + x * sin + y * cos };
}

/**
 * Computes a new transform for a two-finger gesture so that the canvas point that was under
 * the starting focal point stays under the current focal point (pan + pinch + rotate in one).
 */
export function applyFocalGesture(
  start: ViewTransform,
  startFocalX: number,
  startFocalY: number,
  focalX: number,
  focalY: number,
  scaleFactor: number,
  rotationDelta: number,
): ViewTransform {
  'worklet';
  const anchor = screenToCanvas(start, startFocalX, startFocalY);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * scaleFactor));
  const rotation = start.rotation + rotationDelta;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const ax = anchor.x * scale;
  const ay = anchor.y * scale;
  return {
    tx: focalX - (ax * cos - ay * sin),
    ty: focalY - (ax * sin + ay * cos),
    scale,
    rotation,
  };
}

/** Transform that centers and fits a document inside a viewport with padding. */
export function fitTransform(
  viewWidth: number,
  viewHeight: number,
  docWidth: number,
  docHeight: number,
  padding = 24,
): ViewTransform {
  'worklet';
  const availW = Math.max(1, viewWidth - padding * 2);
  const availH = Math.max(1, viewHeight - padding * 2);
  const scale = Math.min(availW / docWidth, availH / docHeight);
  return {
    tx: (viewWidth - docWidth * scale) / 2,
    ty: (viewHeight - docHeight * scale) / 2,
    scale,
    rotation: 0,
  };
}

/** Same view, rotated back to 0 around the viewport centre (zoom and centred content kept). */
export function uprightTransform(t: ViewTransform, viewWidth: number, viewHeight: number): ViewTransform {
  'worklet';
  const cx = viewWidth / 2;
  const cy = viewHeight / 2;
  const anchor = screenToCanvas(t, cx, cy);
  return { tx: cx - anchor.x * t.scale, ty: cy - anchor.y * t.scale, scale: t.scale, rotation: 0 };
}

/** Wraps an angle into (-π, π]. */
export function normalizeAngle(a: number): number {
  'worklet';
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  if (r > Math.PI) r -= twoPi;
  return r;
}

/**
 * If the view is within `tolerance` radians of a right angle, returns the view rotated onto it
 * around the viewport centre; otherwise null. Used to settle near-straight rotations.
 */
export function snapRotation(
  t: ViewTransform,
  viewWidth: number,
  viewHeight: number,
  tolerance: number,
): ViewTransform | null {
  'worklet';
  const quarter = Math.PI / 2;
  const target = Math.round(t.rotation / quarter) * quarter;
  const delta = target - t.rotation;
  if (delta === 0 || Math.abs(delta) > tolerance) return null;
  const cx = viewWidth / 2;
  const cy = viewHeight / 2;
  const anchor = screenToCanvas(t, cx, cy);
  const cos = Math.cos(target);
  const sin = Math.sin(target);
  const ax = anchor.x * t.scale;
  const ay = anchor.y * t.scale;
  return { tx: cx - (ax * cos - ay * sin), ty: cy - (ax * sin + ay * cos), scale: t.scale, rotation: target };
}

/**
 * Interpolates between two views for animation. Rather than lerping the raw matrix terms
 * (which makes content swing on an arc), the canvas point at the viewport centre in `from`
 * travels in a straight line to where `to` puts it, while zoom (geometrically) and rotation
 * (shortest way round) ease in between.
 */
export function interpolateView(
  from: ViewTransform,
  to: ViewTransform,
  progress: number,
  viewWidth: number,
  viewHeight: number,
): ViewTransform {
  'worklet';
  if (progress >= 1) return to;
  const cx = viewWidth / 2;
  const cy = viewHeight / 2;
  const anchor = screenToCanvas(from, cx, cy);
  const end = canvasToScreen(to, anchor.x, anchor.y);
  const sx = cx + (end.x - cx) * progress;
  const sy = cy + (end.y - cy) * progress;
  const scale = from.scale * Math.pow(to.scale / from.scale, progress);
  const rotation = from.rotation + normalizeAngle(to.rotation - from.rotation) * progress;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const ax = anchor.x * scale;
  const ay = anchor.y * scale;
  return { tx: sx - (ax * cos - ay * sin), ty: sy - (ay * cos + ax * sin), scale, rotation };
}
