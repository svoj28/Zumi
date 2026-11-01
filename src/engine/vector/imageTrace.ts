import { extractPalette } from '@/engine/color/paletteGen';
import { cornerNode, newShapeId, smoothNode, type Pt, type VectorDoc, type VShape } from '@/engine/vector/vectorModel';

/**
 * Image trace: turns pixels into flat-colour vector shapes (the WPAP / pop-art look).
 *
 * 1. The image is reduced to `colors` main colours (median cut) and every pixel snapped to the
 *    nearest one; a majority filter removes speckles.
 * 2. Colours are stacked largest first. Each colour's shape covers its own pixels *and* every
 *    colour stacked above it, so shapes overlap instead of meeting edge to edge — there are
 *    never hairline gaps between neighbouring regions.
 * 3. Each connected region's outer boundary is traced along pixel edges and simplified
 *    (Douglas–Peucker), then turned into straight (faceted) or smooth (curved) shapes.
 * Pure: works on raw RGBA at whatever (small) resolution it is given; `scale` maps to canvas.
 */

export interface TraceOptions {
  colors: number;
  /** Simplification tolerance in trace pixels (higher = fewer, larger facets). */
  tolerance: number;
  /** Regions smaller than this (trace pixels) are dropped. */
  minArea: number;
  smooth: boolean;
  /** Trace pixel → canvas pixel. */
  scale: number;
}

export function traceImage(rgba: Uint8Array | number[], width: number, height: number, o: TraceOptions): VectorDoc {
  const palette = extractPalette(rgba, o.colors).map(hexRgb);
  if (palette.length === 0) return { shapes: [] };
  // 1. Snap pixels to the palette (-1 = transparent).
  let labels: Int16Array<ArrayBufferLike> = new Int16Array(width * height);
  for (let i = 0; i < width * height; i++) {
    labels[i] = rgba[i * 4 + 3] < 128 ? -1 : nearest(palette, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  labels = majorityFilter(labels, width, height);

  // 2. Stack colours by area, largest first.
  const area = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) area[labels[i]]++;
  const order = palette.map((_, i) => i).filter((i) => area[i] > 0).sort((a, b) => area[b] - area[a]);
  const rank = new Int16Array(palette.length).fill(-1);
  order.forEach((c, r) => (rank[c] = r));

  const shapes: VShape[] = [];
  const mask = new Uint8Array(width * height);
  for (let r = 0; r < order.length; r++) {
    // This colour plus everything stacked above it.
    for (let i = 0; i < labels.length; i++) mask[i] = labels[i] >= 0 && rank[labels[i]] >= r ? 1 : 0;
    const hex = rgbHex(palette[order[r]]);
    for (const outline of traceRegions(mask, width, height, o.minArea)) {
      const pts = simplifyClosed(outline, o.tolerance);
      if (pts.length < 3) continue;
      const scaled = pts.map((p) => ({ x: p.x * o.scale, y: p.y * o.scale }));
      shapes.push({
        id: newShapeId(),
        nodes: o.smooth ? smoothNodes(scaled) : scaled.map((p) => cornerNode(p.x, p.y)),
        closed: true,
        fill: hex,
        stroke: null,
        strokeWidth: 0,
      });
    }
  }
  return { shapes };
}

// ---- colour --------------------------------------------------------------------------------

function hexRgb(hex: string): number[] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbHex(c: number[]): string {
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function nearest(palette: number[][], r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    // Weighted RGB distance (closer to perceived difference than plain RGB).
    const d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 3×3 majority vote: removes isolated pixels and smooths ragged region edges. */
function majorityFilter(labels: Int16Array, w: number, h: number): Int16Array {
  const out = new Int16Array(labels.length);
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      counts.clear();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const l = labels[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
          counts.set(l, (counts.get(l) ?? 0) + 1);
        }
      }
      let best = labels[y * w + x];
      let bestN = counts.get(best) ?? 0;
      for (const [l, n] of counts) if (n > bestN) [best, bestN] = [l, n];
      out[y * w + x] = bestN >= 5 ? best : labels[y * w + x];
    }
  }
  return out;
}

// ---- contours ------------------------------------------------------------------------------

/**
 * Outer boundaries of the connected (4-neighbour) regions of a binary mask, as closed polygons
 * through pixel corners, clockwise on screen. Regions smaller than `minArea` pixels are skipped.
 */
export function traceRegions(mask: Uint8Array, w: number, h: number, minArea: number): Pt[][] {
  const region = new Int32Array(w * h).fill(-1);
  const out: Pt[][] = [];
  const stack: number[] = [];
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || region[start] >= 0) continue;
    let count = 0;
    stack.push(start);
    region[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      const x = i % w;
      const y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && mask[j] && region[j] < 0) {
          region[j] = id;
          stack.push(j);
        }
      }
    }
    // `start` is the region's first pixel in scan order, so its top edge lies on the outer boundary.
    if (count >= minArea) out.push(outerBoundary(region, id, w, h, start % w, (start / w) | 0));
    id++;
  }
  return out;
}

/**
 * Outer boundary of region `id`: every pixel edge between the region and the outside, directed
 * so the region is on the right (clockwise on screen), linked into a loop starting at the top
 * edge of pixel (sx, sy). At pinch points (two edges leaving one corner) the right turn is taken,
 * which keeps to the outer boundary. Only corners where the direction changes are returned.
 */
function outerBoundary(region: Int32Array, id: number, w: number, h: number, sx: number, sy: number): Pt[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && region[y * w + x] === id;
  // Outgoing edges per corner: corner key → list of directions (0 right, 1 down, 2 left, 3 up).
  const edges = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const add = (x: number, y: number, d: number) => {
    const k = key(x, y);
    const list = edges.get(k);
    if (list) list.push(d);
    else edges.set(k, [d]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, 0); // top edge, going right
      if (!inside(x + 1, y)) add(x + 1, y, 1); // right edge, going down
      if (!inside(x, y + 1)) add(x + 1, y + 1, 2); // bottom edge, going left
      if (!inside(x - 1, y)) add(x, y + 1, 3); // left edge, going up
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const pts: Pt[] = [];
  let x = sx;
  let y = sy;
  let dir = 0;
  const limit = 4 * w * h + 4;
  for (let step = 0; step < limit; step++) {
    const options = edges.get(key(x, y)) ?? [];
    // Prefer right turn, then straight, then left (the boundary always has one of them).
    let next = -1;
    for (const d of [(dir + 1) % 4, dir, (dir + 3) % 4]) {
      if (options.includes(d)) {
        next = d;
        break;
      }
    }
    if (next < 0) break;
    if (next !== dir || pts.length === 0) pts.push({ x, y });
    // Consume the edge so a pinch corner is not reused in the same direction.
    options.splice(options.indexOf(next), 1);
    dir = next;
    x += DX[dir];
    y += DY[dir];
    if (x === sx && y === sy) break;
  }
  return pts;
}

/** Douglas–Peucker on a closed polygon. */
export function simplifyClosed(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 4) return pts;
  // Split at the point farthest from the first one and simplify both halves.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > farD) [far, farD] = [i, d];
  }
  const a = rdp(pts.slice(0, far + 1), tolerance);
  const b = rdp([...pts.slice(far), pts[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let idx = 0;
  let maxD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
    if (d > maxD) [idx, maxD] = [i, d];
  }
  if (maxD <= tol) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), tol).slice(0, -1), ...rdp(pts.slice(idx), tol)];
}

/** Smooth closed curve through the points (Catmull-Rom tangents as Bézier handles). */
function smoothNodes(pts: Pt[]) {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    return smoothNode(p.x, p.y, (next.x - prev.x) / 6, (next.y - prev.y) / 6);
  });
}
