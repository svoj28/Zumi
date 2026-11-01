/**
 * Pending transform of layer (or selection) content, in canvas coordinates:
 *
 *   p' = T + R(rotation) · diag(sx, sy) · p,   sx = ±scale, sy = ±scale (sign = flip)
 *
 * Flips are part of the model (not negative scales smuggled through a view transform), so
 * pinch, drag and handle gestures compose correctly with them. All functions are worklets.
 */
export interface LayerTransform {
  tx: number;
  ty: number;
  scale: number;
  /** Radians. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export const IDENTITY_TRANSFORM: LayerTransform = { tx: 0, ty: 0, scale: 1, rotation: 0, flipX: false, flipY: false };

export const MIN_LAYER_SCALE = 0.02;
export const MAX_LAYER_SCALE = 50;

export function isIdentityTransform(t: LayerTransform): boolean {
  'worklet';
  return t.tx === 0 && t.ty === 0 && t.scale === 1 && t.rotation === 0 && !t.flipX && !t.flipY;
}

export function mapPoint(t: LayerTransform, x: number, y: number): { x: number; y: number } {
  'worklet';
  const sx = (t.flipX ? -x : x) * t.scale;
  const sy = (t.flipY ? -y : y) * t.scale;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return { x: t.tx + sx * cos - sy * sin, y: t.ty + sx * sin + sy * cos };
}

/**
 * Applies a similarity gesture (pinch/drag) in canvas space: the content point under canvas
 * point (f0x, f0y) moves to (f1x, f1y), scaled by `k` and rotated by `dr` around it.
 * Flips are preserved.
 */
export function composeGesture(
  start: LayerTransform,
  f0x: number,
  f0y: number,
  f1x: number,
  f1y: number,
  k: number,
  dr: number,
): LayerTransform {
  'worklet';
  const scale = Math.min(MAX_LAYER_SCALE, Math.max(MIN_LAYER_SCALE, start.scale * k));
  const kk = scale / start.scale;
  const cos = Math.cos(dr);
  const sin = Math.sin(dr);
  const dx = (start.tx - f0x) * kk;
  const dy = (start.ty - f0y) * kk;
  return {
    ...start,
    tx: f1x + dx * cos - dy * sin,
    ty: f1y + dx * sin + dy * cos,
    scale,
    rotation: start.rotation + dr,
  };
}

/**
 * Mirrors the content in its own frame around content point (cx, cy) — i.e. the object
 * flips in place, whatever its current rotation.
 */
export function flipTransform(t: LayerTransform, axis: 'x' | 'y', cx: number, cy: number): LayerTransform {
  'worklet';
  // M' = M · (translate c · F · translate −c)  ⇒  T' = T + R · D · (I − F) · c
  const sx = (t.flipX ? -1 : 1) * t.scale;
  const sy = (t.flipY ? -1 : 1) * t.scale;
  const lx = axis === 'x' ? 2 * cx * sx : 0;
  const ly = axis === 'y' ? 2 * cy * sy : 0;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    ...t,
    tx: t.tx + lx * cos - ly * sin,
    ty: t.ty + lx * sin + ly * cos,
    flipX: axis === 'x' ? !t.flipX : t.flipX,
    flipY: axis === 'y' ? !t.flipY : t.flipY,
  };
}

/** Row-major 3×3 matrix (Skia's order) for canvases and paths. */
export function transformMatrix(t: LayerTransform): number[] {
  'worklet';
  const sx = (t.flipX ? -1 : 1) * t.scale;
  const sy = (t.flipY ? -1 : 1) * t.scale;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return [cos * sx, -sin * sy, t.tx, sin * sx, cos * sy, t.ty, 0, 0, 1];
}

/** Declarative `transform` prop equivalent (applied left to right). */
export function transformProp(t: LayerTransform) {
  'worklet';
  return [
    { translateX: t.tx },
    { translateY: t.ty },
    { rotate: t.rotation },
    { scaleX: (t.flipX ? -1 : 1) * t.scale },
    { scaleY: (t.flipY ? -1 : 1) * t.scale },
  ];
}
