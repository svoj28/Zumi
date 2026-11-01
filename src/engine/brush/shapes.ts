import { SAMPLE_STRIDE, type FlatSamples } from '@/engine/types';

/**
 * Shape tools. A shape is only an outline generator: it turns the drag (start → end) into
 * points, which become ordinary stroke samples. The brush engine then paints them exactly like
 * a hand-drawn stroke, so shapes get the current brush, colour, size, opacity, texture,
 * symmetry, selection clipping and undo without any special casing.
 *
 * To add a shape: add its kind, a SHAPES entry for the UI, and a case in `shapeOutline`.
 */

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'heart';

export interface ShapeInfo {
  kind: ShapeKind;
  label: string;
  /** Name when "constrain" is on (e.g. square instead of rectangle). */
  constrainedLabel: string;
  icon:
    | 'remove-outline'
    | 'arrow-forward-outline'
    | 'square-outline'
    | 'ellipse-outline'
    | 'triangle-outline'
    | 'diamond-outline'
    | 'prism-outline'
    | 'star-outline'
    | 'heart-outline';
}

export const SHAPES: readonly ShapeInfo[] = [
  { kind: 'line', label: 'Line', constrainedLabel: 'Line', icon: 'remove-outline' },
  { kind: 'arrow', label: 'Arrow', constrainedLabel: 'Arrow', icon: 'arrow-forward-outline' },
  { kind: 'rect', label: 'Rectangle', constrainedLabel: 'Square', icon: 'square-outline' },
  { kind: 'ellipse', label: 'Ellipse', constrainedLabel: 'Circle', icon: 'ellipse-outline' },
  { kind: 'triangle', label: 'Triangle', constrainedLabel: 'Triangle', icon: 'triangle-outline' },
  { kind: 'diamond', label: 'Diamond', constrainedLabel: 'Diamond', icon: 'diamond-outline' },
  { kind: 'hexagon', label: 'Hexagon', constrainedLabel: 'Regular hexagon', icon: 'prism-outline' },
  { kind: 'star', label: 'Star', constrainedLabel: 'Star', icon: 'star-outline' },
  { kind: 'heart', label: 'Heart', constrainedLabel: 'Heart', icon: 'heart-outline' },
];

export const SHAPE_KINDS: readonly ShapeKind[] = SHAPES.map((s) => s.kind);

/** Closed outline through unit points ([-1, 1] box), fitted into the dragged box. */
function fitUnit(unit: number[], cx: number, cy: number, rx: number, ry: number): number[] {
  'worklet';
  const out: number[] = [];
  for (let i = 0; i + 1 < unit.length; i += 2) out.push(cx + unit[i] * rx, cy + unit[i + 1] * ry);
  out.push(out[0], out[1]);
  return out;
}

/** Unit-box outline of a closed shape (not repeated at the end). */
function unitOutline(kind: ShapeKind): number[] {
  'worklet';
  const pts: number[] = [];
  if (kind === 'triangle') return [0, -1, 1, 1, -1, 1];
  if (kind === 'diamond') return [0, -1, 1, 0, 0, 1, -1, 0];
  if (kind === 'hexagon') {
    // Flat-topped, stretched to fill the box (a regular one is √3/2 as tall as wide).
    const k = 2 / Math.sqrt(3);
    for (let i = 0; i < 6; i++) pts.push(Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3) * k);
    return pts;
  }
  if (kind === 'star') {
    // Five points; this inner radius makes the classic star's edges line up.
    const inner = 0.382;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1 : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    // Stretch to fill the box (the points span x ±0.951, y -1..0.809).
    return pts.map((v, i) => (i % 2 === 1 ? (v + 1) / 0.9045 - 1 : v / 0.951));
  }
  // Heart: the classic parametric curve, y down (lobes at -12, tip at 17), fitted to the box.
  const n = 96;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push(x / 16, (y - 2.5) / 14.5);
  }
  return pts;
}

/** Undo-history label for a committed shape. */
export function shapeLabel(kind: ShapeKind, constrain: boolean): string {
  const info = SHAPES.find((s) => s.kind === kind);
  return info ? (constrain ? info.constrainedLabel : info.label) : 'Shape';
}

/** Corner/vertex outline as flat [x, y, …]; closed shapes repeat the first point at the end. */
function shapeOutline(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, constrain: boolean): number[] {
  'worklet';
  if (kind === 'line' || kind === 'arrow') {
    let ex = x1;
    let ey = y1;
    if (constrain) {
      // Snap to 15° steps.
      const step = Math.PI / 12;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / step) * step;
      ex = x0 + Math.cos(a) * len;
      ey = y0 + Math.sin(a) * len;
    }
    if (kind === 'line') return [x0, y0, ex, ey];
    // Arrow: shaft to the tip, then the head as one path (tip → barb → tip → barb). The stroke
    // is composited once, so the retraced barb never darkens.
    const len = Math.hypot(ex - x0, ey - y0);
    const head = Math.min(len * 0.35, Math.max(12, len * 0.22));
    const a = Math.atan2(ey - y0, ex - x0);
    const spread = Math.PI / 7;
    const b1x = ex - Math.cos(a - spread) * head;
    const b1y = ey - Math.sin(a - spread) * head;
    const b2x = ex - Math.cos(a + spread) * head;
    const b2y = ey - Math.sin(a + spread) * head;
    return [x0, y0, ex, ey, b1x, b1y, ex, ey, b2x, b2y];
  }
  let w = x1 - x0;
  let h = y1 - y0;
  if (constrain) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = (w < 0 ? -1 : 1) * side;
    h = (h < 0 ? -1 : 1) * side;
  }
  if (kind === 'rect') {
    return [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h, x0, y0];
  }
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  if (kind !== 'ellipse') {
    // A regular hexagon is wider than tall; constrain keeps its true proportions.
    const ryFit = kind === 'hexagon' && constrain ? rx * (Math.sqrt(3) / 2) : ry;
    return fitUnit(unitOutline(kind), cx, cy, rx, ryFit);
  }
  // Ellipse inscribed in the dragged box; vertex count follows the circumference.
  const n = Math.max(24, Math.min(720, Math.ceil((Math.PI * (rx + ry)) / 3)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

/**
 * Stroke samples for a shape: the outline densified to `spacing` so the stroke spline follows
 * straight edges and keeps corners crisp, at full pressure with no tilt.
 */
export function shapeSamples(
  kind: ShapeKind,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  constrain: boolean,
  spacing: number,
): FlatSamples {
  'worklet';
  const pts = shapeOutline(kind, x0, y0, x1, y1, constrain);
  const step = Math.max(0.5, spacing);
  const out: number[] = [pts[0], pts[1], 1, 0, 0, 0];
  let t = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const ax = pts[i - 2];
    const ay = pts[i - 1];
    const bx = pts[i];
    const by = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      // Synthetic time (1 ms per pixel) keeps time-based dynamics well-behaved.
      t += len / n;
      out.push(ax + (bx - ax) * f, ay + (by - ay) * f, 1, t, 0, 0);
    }
  }
  return out.length >= SAMPLE_STRIDE ? out : [];
}
