/**
 * Perspective guides: vanishing points and stroke snapping (worklets, no Skia).
 * Points are in canvas pixels.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Directions a stroke starting at `origin` may snap to: toward each vanishing point, plus the
 * true verticals (and horizontals in 1-point perspective, where they stay parallel).
 */
export function snapDirections(origin: Point, vps: readonly Point[]): Point[] {
  'worklet';
  const dirs: Point[] = [];
  for (const vp of vps) {
    const dx = vp.x - origin.x;
    const dy = vp.y - origin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-6) dirs.push({ x: dx / len, y: dy / len });
  }
  if (vps.length < 3) dirs.push({ x: 0, y: 1 });
  if (vps.length === 1) dirs.push({ x: 1, y: 0 });
  return dirs;
}

/** The direction among `dirs` closest to the movement `(dx, dy)` (either way along the line). */
export function closestDirection(dirs: readonly Point[], dx: number, dy: number): Point | null {
  'worklet';
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return null;
  let best: Point | null = null;
  let bestDot = -1;
  for (const d of dirs) {
    const dot = Math.abs((d.x * dx + d.y * dy) / len);
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
}

/** `p` projected onto the line through `origin` along unit direction `dir`. */
export function projectOnLine(origin: Point, dir: Point, p: Point): Point {
  'worklet';
  const t = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
}

/** Vanishing points in canvas pixels for the given mode (fractions → pixels). */
export function vanishingPoints(mode: number, fractions: readonly Point[], width: number, height: number): Point[] {
  'worklet';
  const out: Point[] = [];
  for (let i = 0; i < Math.min(mode, fractions.length); i++) out.push({ x: fractions[i].x * width, y: fractions[i].y * height });
  return out;
}
