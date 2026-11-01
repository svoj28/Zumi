import { mapPoint, type LayerTransform } from '@/engine/layers/layerTransform';
import type { Rect } from '@/engine/types';

/**
 * Distort and warp of transformed content (worklets, no Skia).
 *
 * A mesh is a Coons patch: 12 points in canvas coordinates, in Skia's `drawPatch` order —
 *   0 top-left, 1-2 top edge, 3 top-right, 4-5 right edge, 6 bottom-right,
 *   7-8 bottom edge (right → left), 9 bottom-left, 10-11 left edge (bottom → top).
 * Distort uses only the four corners (a true perspective transform); warp also bends the edges
 * with the eight edge handles.
 */

export type MeshMode = 'free' | 'distort' | 'warp';

export interface Point {
  x: number;
  y: number;
}

export type Mesh = Point[];

/** Indices of the four corners in a mesh: top-left, top-right, bottom-right, bottom-left. */
export const MESH_CORNERS = [0, 3, 6, 9] as const;

function lerp(a: Point, b: Point, t: number): Point {
  'worklet';
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Mesh with straight edges through four corners (handles at the thirds). */
export function meshFromCorners(tl: Point, tr: Point, br: Point, bl: Point): Mesh {
  'worklet';
  return [tl, lerp(tl, tr, 1 / 3), lerp(tl, tr, 2 / 3), tr, lerp(tr, br, 1 / 3), lerp(tr, br, 2 / 3), br, lerp(br, bl, 1 / 3), lerp(br, bl, 2 / 3), bl, lerp(bl, tl, 1 / 3), lerp(bl, tl, 2 / 3)];
}

/** The mesh covering `box` after the (free) transform `t`, so distorting continues from it. */
export function meshFromTransform(box: Rect, t: LayerTransform): Mesh {
  'worklet';
  const p = (x: number, y: number) => mapPoint(t, x, y);
  return meshFromCorners(
    p(box.x, box.y),
    p(box.x + box.width, box.y),
    p(box.x + box.width, box.y + box.height),
    p(box.x, box.y + box.height),
  );
}

/**
 * Moves one mesh point. Dragging a corner carries its two neighbouring edge handles along, so
 * the edges keep their bend; in distort mode the edges are kept straight.
 */
export function moveMeshPoint(mesh: Mesh, index: number, x: number, y: number, mode: MeshMode): Mesh {
  'worklet';
  const next = mesh.map((p) => ({ ...p }));
  const dx = x - mesh[index].x;
  const dy = y - mesh[index].y;
  next[index] = { x, y };
  if (index % 3 === 0) {
    for (const n of [(index + 11) % 12, (index + 1) % 12]) next[n] = { x: mesh[n].x + dx, y: mesh[n].y + dy };
  }
  return mode === 'distort' ? meshFromCorners(next[0], next[3], next[6], next[9]) : next;
}

export function translateMesh(mesh: Mesh, dx: number, dy: number): Mesh {
  'worklet';
  return mesh.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Projective matrix (row-major 3x3) mapping rectangle `src` onto the quadrilateral `quad`
 * (top-left, top-right, bottom-right, bottom-left). Square-to-quad (Heckbert), composed with
 * the rectangle's normalisation.
 */
export function homography(src: Rect, quad: readonly Point[]): number[] {
  'worklet';
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) > 1e-12 && (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12)) {
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  // Unit square → quad: [a b p0.x; d e p0.y; g h 1]. Then rectangle → unit square.
  const sx = 1 / Math.max(1e-9, src.width);
  const sy = 1 / Math.max(1e-9, src.height);
  const tx = -src.x * sx;
  const ty = -src.y * sy;
  return [
    a * sx, b * sy, a * tx + b * ty + p0.x,
    d * sx, e * sy, d * tx + e * ty + p0.y,
    g * sx, h * sy, g * tx + h * ty + 1,
  ];
}

/** Applies a row-major projective matrix to a point. */
export function mapHomography(m: readonly number[], x: number, y: number): Point {
  'worklet';
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** Whether a distorted quad is still drawable (convex, non-degenerate, not turned inside out). */
export function isValidQuad(quad: readonly Point[]): boolean {
  'worklet';
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A patch corner with its incoming (c1) and outgoing (c2) edge controls. */
export interface PatchHandle {
  pos: Point;
  c1: Point;
  c2: Point;
}

/** Patch handles (corner + its two controls) for Skia's declarative <Patch>: TL, TR, BR, BL. */
export function patchHandles(mesh: Mesh): [PatchHandle, PatchHandle, PatchHandle, PatchHandle] {
  'worklet';
  const v = (p: Point) => ({ x: p.x, y: p.y });
  return [
    { pos: v(mesh[0]), c1: v(mesh[11]), c2: v(mesh[1]) },
    { pos: v(mesh[3]), c1: v(mesh[2]), c2: v(mesh[4]) },
    { pos: v(mesh[6]), c1: v(mesh[5]), c2: v(mesh[7]) },
    { pos: v(mesh[9]), c1: v(mesh[8]), c2: v(mesh[10]) },
  ];
}
