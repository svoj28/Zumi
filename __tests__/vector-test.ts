import { simplifyClosed, traceImage, traceRegions } from '@/engine/vector/imageTrace';
import {
  cornerNode,
  hitNode,
  hitShape,
  mapVector,
  moveHandle,
  parseVectorDoc,
  reorderShape,
  smoothNode,
  type VectorDoc,
  type VShape,
} from '@/engine/vector/vectorModel';

const square = (id: string, x: number, y: number, s: number, fill: string | null = '#ff0000'): VShape => ({
  id,
  nodes: [cornerNode(x, y), cornerNode(x + s, y), cornerNode(x + s, y + s), cornerNode(x, y + s)],
  closed: true,
  fill,
  stroke: null,
  strokeWidth: 0,
});

describe('vector model', () => {
  it('validates saved data and drops junk', () => {
    const doc = parseVectorDoc({ shapes: [square('a', 0, 0, 10), { nodes: 'x' }, { id: 'b', nodes: [], closed: true }, { id: 'c', nodes: [{ x: 1, y: 2 }], fill: 'red' }] });
    expect(doc?.shapes.map((s) => s.id)).toEqual(['a', 'c']);
    expect(doc?.shapes[1].fill).toBeNull();
    expect(parseVectorDoc('nope')).toBeNull();
  });

  it('hits the topmost filled shape, or an outline within tolerance', () => {
    const doc: VectorDoc = { shapes: [square('under', 0, 0, 100), square('over', 50, 50, 100), square('ring', 300, 300, 50, null)] };
    expect(hitShape(doc, 75, 75, 2)).toBe('over');
    expect(hitShape(doc, 10, 10, 2)).toBe('under');
    expect(hitShape(doc, 325, 325, 2)).toBeNull(); // inside an unfilled outline
    expect(hitShape(doc, 301, 325, 2)).toBe('ring');
  });

  it('mirrors the opposite handle when dragging a smooth handle', () => {
    const s: VShape = { ...square('a', 0, 0, 10), nodes: [smoothNode(0, 0, 10, 0), cornerNode(50, 0)] };
    const moved = moveHandle(s, 0, 'out', 0, 20, true);
    expect(moved.nodes[0].outY).toBe(20);
    expect(moved.nodes[0].inX).toBeCloseTo(0);
    expect(moved.nodes[0].inY).toBeCloseTo(-10);
    expect(hitNode(moved, 0, 19, 3)).toEqual({ index: 0, part: 'out' });
  });

  it('reorders and transforms shapes', () => {
    const doc: VectorDoc = { shapes: [square('a', 0, 0, 1), square('b', 0, 0, 1), square('c', 0, 0, 1)] };
    expect(reorderShape(doc, 'a', 'top').shapes.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(reorderShape(doc, 'c', 'down').shapes.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    const scaled = mapVector({ shapes: [square('a', 1, 1, 2)] }, (x, y) => ({ x: x * 2, y: y * 2 }), 2);
    expect(scaled.shapes[0].nodes[2]).toEqual(cornerNode(6, 6));
  });
});

describe('image trace', () => {
  it('traces the outline of a pixel region clockwise around its corners', () => {
    // A 3×2 block inside a 5×4 mask.
    const w = 5;
    const h = 4;
    const mask = new Uint8Array(w * h);
    for (let y = 1; y < 3; y++) for (let x = 1; x < 4; x++) mask[y * w + x] = 1;
    const [outline] = traceRegions(mask, w, h, 1);
    expect(outline).toEqual([{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }, { x: 1, y: 3 }]);
  });

  it('keeps an L-shape and drops regions below the minimum size', () => {
    const w = 6;
    const h = 6;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < 4; y++) mask[y * w] = 1; // vertical bar
    for (let x = 0; x < 4; x++) mask[3 * w + x] = 1; // foot
    mask[5 * w + 5] = 1; // speck
    const outlines = traceRegions(mask, w, h, 2);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]).toHaveLength(6);
  });

  it('turns a two-colour image into stacked shapes without gaps', () => {
    // Left half red, right half blue, 20×10.
    const w = 20;
    const h = 10;
    const rgba: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.push(...(x < 10 ? [220, 20, 30, 255] : [20, 40, 220, 255]));
    const doc = traceImage(rgba, w, h, { colors: 4, tolerance: 1, minArea: 4, smooth: false, scale: 3 });
    expect(doc.shapes).toHaveLength(2);
    // The bottom shape covers the whole image, so the top one never leaves a gap.
    const xs = doc.shapes[0].nodes.map((n) => n.x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(60);
  });

  it('simplifies straight runs away', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(simplifyClosed(pts, 0.5)).toHaveLength(4);
  });
});
