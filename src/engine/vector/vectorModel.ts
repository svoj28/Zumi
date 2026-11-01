/**
 * Vector layer model (pure, no Skia). A vector layer keeps its shapes as data; its pixels are a
 * rendering of them, so compositing, export and thumbnails need no special casing.
 *
 * A shape is a Bézier path: nodes with an anchor and two handles stored *relative* to the
 * anchor (so moving a node moves its handles), open or closed, with an optional fill and stroke.
 */

export interface VNode {
  x: number;
  y: number;
  /** Incoming handle, relative to the anchor (0, 0 = corner). */
  inX: number;
  inY: number;
  /** Outgoing handle, relative to the anchor. */
  outX: number;
  outY: number;
}

export interface VShape {
  id: string;
  nodes: VNode[];
  closed: boolean;
  /** '#rrggbb' or null for no fill. */
  fill: string | null;
  /** '#rrggbb' or null for no stroke. */
  stroke: string | null;
  strokeWidth: number;
}

export interface VectorDoc {
  shapes: VShape[];
}

export const EMPTY_VECTOR: VectorDoc = { shapes: [] };

/** Safety caps for untrusted files. */
const MAX_SHAPES = 20000;
const MAX_NODES = 200000;

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Validates untrusted JSON into a vector document; null when it is not one. */
export function parseVectorDoc(raw: unknown): VectorDoc | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { shapes?: unknown }).shapes)) return null;
  let nodeCount = 0;
  const shapes: VShape[] = [];
  for (const s of (raw as { shapes: unknown[] }).shapes.slice(0, MAX_SHAPES)) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Partial<VShape>;
    if (!Array.isArray(r.nodes)) continue;
    const nodes = r.nodes
      .filter((n): n is VNode => !!n && typeof n === 'object')
      .map((n) => ({ x: num(n.x), y: num(n.y), inX: num(n.inX), inY: num(n.inY), outX: num(n.outX), outY: num(n.outY) }));
    nodeCount += nodes.length;
    if (nodes.length === 0 || nodeCount > MAX_NODES) continue;
    shapes.push({
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : `s${shapes.length}`,
      nodes,
      closed: r.closed === true,
      fill: isHex(r.fill) ? r.fill.toLowerCase() : null,
      stroke: isHex(r.stroke) ? r.stroke.toLowerCase() : null,
      strokeWidth: Math.min(500, Math.max(0, num(r.strokeWidth, 0))),
    });
  }
  return { shapes };
}

let idCounter = 0;
export function newShapeId(): string {
  idCounter = (idCounter + 1) % 1e9;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function cornerNode(x: number, y: number): VNode {
  return { x, y, inX: 0, inY: 0, outX: 0, outY: 0 };
}

/** A smooth node whose handles mirror each other (dragging out a curve with the pen). */
export function smoothNode(x: number, y: number, hx: number, hy: number): VNode {
  return { x, y, inX: -hx, inY: -hy, outX: hx, outY: hy };
}

export function updateShape(doc: VectorDoc, id: string, update: (s: VShape) => VShape): VectorDoc {
  return { shapes: doc.shapes.map((s) => (s.id === id ? update(s) : s)) };
}

export function removeShape(doc: VectorDoc, id: string): VectorDoc {
  return { shapes: doc.shapes.filter((s) => s.id !== id) };
}

/** Moves a shape one step up/down the stacking order, or to the top/bottom. */
export function reorderShape(doc: VectorDoc, id: string, to: 'up' | 'down' | 'top' | 'bottom'): VectorDoc {
  const i = doc.shapes.findIndex((s) => s.id === id);
  if (i < 0) return doc;
  const shapes = [...doc.shapes];
  const [shape] = shapes.splice(i, 1);
  const j = to === 'top' ? shapes.length : to === 'bottom' ? 0 : Math.max(0, Math.min(shapes.length, i + (to === 'up' ? 1 : -1)));
  shapes.splice(j, 0, shape);
  return { shapes };
}

export function translateShape(s: VShape, dx: number, dy: number): VShape {
  return { ...s, nodes: s.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) };
}

/** Moves a node's anchor (its handles follow). */
export function moveAnchor(s: VShape, index: number, x: number, y: number): VShape {
  return { ...s, nodes: s.nodes.map((n, i) => (i === index ? { ...n, x, y } : n)) };
}

/**
 * Moves one handle to an absolute position. With `mirror`, the opposite handle turns to stay
 * opposite (keeping its own length), so the curve stays smooth through the node.
 */
export function moveHandle(s: VShape, index: number, which: 'in' | 'out', x: number, y: number, mirror: boolean): VShape {
  return {
    ...s,
    nodes: s.nodes.map((n, i) => {
      if (i !== index) return n;
      const hx = x - n.x;
      const hy = y - n.y;
      const next = which === 'in' ? { ...n, inX: hx, inY: hy } : { ...n, outX: hx, outY: hy };
      if (!mirror) return next;
      const len = Math.hypot(hx, hy) || 1;
      const otherLen = which === 'in' ? Math.hypot(n.outX, n.outY) : Math.hypot(n.inX, n.inY);
      const ox = (-hx / len) * otherLen;
      const oy = (-hy / len) * otherLen;
      return which === 'in' ? { ...next, outX: ox, outY: oy } : { ...next, inX: ox, inY: oy };
    }),
  };
}

/** Turns a corner into a smooth node (handles along the neighbours' direction) or back. */
export function toggleSmooth(s: VShape, index: number): VShape {
  const n = s.nodes[index];
  if (n.inX || n.inY || n.outX || n.outY) {
    return { ...s, nodes: s.nodes.map((m, i) => (i === index ? cornerNode(m.x, m.y) : m)) };
  }
  const count = s.nodes.length;
  const prev = s.nodes[(index - 1 + count) % count];
  const next = s.nodes[(index + 1) % count];
  const tx = (next.x - prev.x) / 6;
  const ty = (next.y - prev.y) / 6;
  return { ...s, nodes: s.nodes.map((m, i) => (i === index ? smoothNode(m.x, m.y, tx, ty) : m)) };
}

export function deleteNode(s: VShape, index: number): VShape | null {
  const nodes = s.nodes.filter((_, i) => i !== index);
  return nodes.length === 0 ? null : { ...s, nodes, closed: s.closed && nodes.length > 2 };
}

/** Applies a map to every node (handles transform as vectors) and scales strokes. */
export function mapVector(doc: VectorDoc, map: (x: number, y: number) => { x: number; y: number }, strokeScale: number): VectorDoc {
  return {
    shapes: doc.shapes.map((s) => ({
      ...s,
      strokeWidth: s.strokeWidth * strokeScale,
      nodes: s.nodes.map((n) => {
        const a = map(n.x, n.y);
        const i = map(n.x + n.inX, n.y + n.inY);
        const o = map(n.x + n.outX, n.y + n.outY);
        return { x: a.x, y: a.y, inX: i.x - a.x, inY: i.y - a.y, outX: o.x - a.x, outY: o.y - a.y };
      }),
    })),
  };
}

// ---- geometry --------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

/** The shape's outline sampled into points (each curved segment into `steps` pieces). */
export function flattenShape(s: VShape, steps = 12): Pt[] {
  const out: Pt[] = [];
  const n = s.nodes.length;
  if (n === 0) return out;
  out.push({ x: s.nodes[0].x, y: s.nodes[0].y });
  const segs = s.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = s.nodes[i];
    const b = s.nodes[(i + 1) % n];
    const p1 = { x: a.x + a.outX, y: a.y + a.outY };
    const p2 = { x: b.x + b.inX, y: b.y + b.inY };
    const straight = !a.outX && !a.outY && !b.inX && !b.inY;
    const k = straight ? 1 : steps;
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      const u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y,
      });
    }
  }
  return out;
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Topmost shape under a point: inside its fill, or within `tolerance` of its outline. */
export function hitShape(doc: VectorDoc, x: number, y: number, tolerance: number): string | null {
  const p = { x, y };
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i];
    const pts = flattenShape(s);
    if (s.fill && s.closed && pts.length > 2 && pointInPolygon(p, pts)) return s.id;
    const reach = tolerance + (s.stroke ? s.strokeWidth / 2 : 0);
    for (let k = 1; k < pts.length; k++) if (distToSegment(p, pts[k - 1], pts[k]) <= reach) return s.id;
  }
  return null;
}

export type NodeHit = { index: number; part: 'anchor' | 'in' | 'out' };

/** Node anchor or handle of a shape within `radius` of a point (anchors first). */
export function hitNode(s: VShape, x: number, y: number, radius: number): NodeHit | null {
  const r2 = radius * radius;
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r2) return { index: i, part: 'anchor' };
  }
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    if ((n.outX || n.outY) && (n.x + n.outX - x) ** 2 + (n.y + n.outY - y) ** 2 <= r2) return { index: i, part: 'out' };
    if ((n.inX || n.inY) && (n.x + n.inX - x) ** 2 + (n.y + n.inY - y) ** 2 <= r2) return { index: i, part: 'in' };
  }
  return null;
}
