import { SAMPLE_STRIDE } from '@/engine/types';

/**
 * QuickShape: when a stroke ends with the pen held still, the rough stroke is recognised as a
 * clean line, polyline, polygon, circle or ellipse and replaced with it. All functions are
 * worklets (the snap happens live on the UI thread) and pure (unit-tested).
 *
 * Input and output are flat stroke samples ([x, y, pressure, t, tiltX, tiltY], ...).
 */

export type QuickShapeKind = 'line' | 'polyline' | 'polygon' | 'circle' | 'ellipse';

export interface QuickShapeResult {
  kind: QuickShapeKind;
  samples: number[];
}

interface Pt {
  x: number;
  y: number;
}

function toPoints(samples: readonly number[]): Pt[] {
  'worklet';
  const pts: Pt[] = [];
  for (let i = 0; i + SAMPLE_STRIDE <= samples.length; i += SAMPLE_STRIDE) pts.push({ x: samples[i], y: samples[i + 1] });
  return pts;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  'worklet';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function pathLength(pts: readonly Pt[]): number {
  'worklet';
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Ramer–Douglas–Peucker simplification (iterative). */
export function simplify(pts: readonly Pt[], epsilon: number): Pt[] {
  'worklet';
  if (pts.length < 3) return [...pts];
  const keep: boolean[] = pts.map(() => false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: number[] = [0, pts.length - 1];
  while (stack.length > 0) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    let worst = -1;
    let worstD = epsilon;
    for (let i = first + 1; i < last; i++) {
      const d = distToSegment(pts[i], pts[first], pts[last]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push(first, worst, worst, last);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Largest distance from any point to the polyline through `vertices`. */
function polylineError(pts: readonly Pt[], vertices: readonly Pt[], closed: boolean): number {
  'worklet';
  let worst = 0;
  const segs = closed ? vertices.length : vertices.length - 1;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i < segs; i++) best = Math.min(best, distToSegment(p, vertices[i], vertices[(i + 1) % vertices.length]));
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Samples along a polyline every `step` px, carrying a constant pressure. */
function samplePolyline(vertices: readonly Pt[], closed: boolean, step: number, pressure: number): number[] {
  'worklet';
  const out: number[] = [];
  const pts = closed ? [...vertices, vertices[0]] : vertices;
  let t = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      out.push(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, pressure, t, 0, 0);
      t += 4;
    }
  }
  return out;
}

/** Samples around an ellipse (centre, radii, rotation) every `step` px. */
function sampleEllipse(cx: number, cy: number, rx: number, ry: number, angle: number, step: number, pressure: number): number[] {
  'worklet';
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(24, Math.ceil(perimeter / step));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push(cx + x * cos - y * sin, cy + x * sin + y * cos, pressure, i * 4, 0, 0);
  }
  return out;
}

/** Median pressure of the stroke, so the clean shape keeps roughly the drawn weight. */
function medianPressure(samples: readonly number[]): number {
  'worklet';
  const ps: number[] = [];
  for (let i = 2; i < samples.length; i += SAMPLE_STRIDE) ps.push(samples[i]);
  ps.sort((a, b) => a - b);
  return ps.length ? ps[Math.floor(ps.length / 2)] : 1;
}

/**
 * Recognises the stroke, or returns null when it is too short or no shape fits well. `scale`
 * is document pixels per screen point, so tolerances feel the same at any zoom.
 */
export function recognizeShape(samples: readonly number[], scale = 1): QuickShapeResult | null {
  'worklet';
  const pts = toPoints(samples);
  if (pts.length < 4) return null;
  const length = pathLength(pts);
  if (length < 24 * scale) return null;
  const pressure = medianPressure(samples);
  const step = Math.max(1, 2 * scale);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);

  // Straight line: everything close to the chord.
  if (chord > 0.7 * length) {
    const err = polylineError(pts, [first, last], false);
    if (err < Math.max(3 * scale, chord * 0.06)) return { kind: 'line', samples: samplePolyline([first, last], false, step, pressure) };
  }

  const closed = chord < Math.max(12 * scale, diag * 0.22);
  const eps = Math.max(4 * scale, diag * 0.06);

  if (closed) {
    // Polygon (triangle, rectangle, …): few corners and straight sides.
    const ring = simplify([...pts.slice(0, -1), first], eps);
    const vertices = ring.slice(0, -1);
    if (vertices.length >= 3 && vertices.length <= 6 && polylineError(pts, vertices, true) < eps * 0.9) {
      // Corners must really be corners (not a smooth curve cut into pieces).
      let sharp = true;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[(i + vertices.length - 1) % vertices.length];
        const b = vertices[i];
        const c = vertices[(i + 1) % vertices.length];
        const v1x = a.x - b.x;
        const v1y = a.y - b.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        const cosA = (v1x * v2x + v1y * v2y) / Math.max(1e-6, Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
        if (cosA < -0.85) sharp = false;
      }
      if (sharp) return { kind: 'polygon', samples: samplePolyline(vertices, true, step, pressure) };
    }

    // Ellipse from the point cloud's second moments.
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      sxx += (p.x - cx) ** 2;
      syy += (p.y - cy) ** 2;
      sxy += (p.x - cx) * (p.y - cy);
    }
    sxx /= pts.length;
    syy /= pts.length;
    sxy /= pts.length;
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const tr = sxx + syy;
    const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
    // For points spread around an ellipse, the variance along an axis is radius² / 2.
    const rx = Math.sqrt(2 * Math.max(0, tr / 2 + det));
    const ry = Math.sqrt(2 * Math.max(0, tr / 2 - det));
    if (rx < 4 * scale || ry < 2 * scale) return null;
    // How far the stroke is from that ellipse (as a fraction of its size).
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let err = 0;
    for (const p of pts) {
      const x = (p.x - cx) * cos - (p.y - cy) * sin;
      const y = (p.x - cx) * sin + (p.y - cy) * cos;
      err += Math.abs(Math.hypot(x / rx, y / ry) - 1);
    }
    err /= pts.length;
    if (err > 0.16) return null;
    if (ry / rx > 0.88) {
      const r = (rx + ry) / 2;
      return { kind: 'circle', samples: sampleEllipse(cx, cy, r, r, 0, step, pressure) };
    }
    return { kind: 'ellipse', samples: sampleEllipse(cx, cy, rx, ry, angle, step, pressure) };
  }

  // Open polyline (a few straight segments, like a zigzag or a corner).
  const vertices = simplify(pts, eps);
  if (vertices.length >= 3 && vertices.length <= 5 && polylineError(pts, vertices, false) < eps * 0.9) {
    return { kind: 'polyline', samples: samplePolyline(vertices, false, step, pressure) };
  }
  return null;
}