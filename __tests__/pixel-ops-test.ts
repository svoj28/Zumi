import { alphaMask, floodFillMask, growMask, maskArea, maskBounds, maskToRects } from '@/engine/raster/pixelOps';

/** A w×h RGBA image filled with one colour, with optional painted pixels. */
function image(w: number, h: number, fill: number[], painted: { x: number; y: number; c: number[] }[] = []): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(fill, i * 4);
  for (const p of painted) px.set(p.c, (p.y * w + p.x) * 4);
  return px;
}

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

describe('flood fill', () => {
  it('fills a closed area and stops at lines', () => {
    // 7×7 white with a black square outline from (1,1) to (5,5).
    const lines: { x: number; y: number; c: number[] }[] = [];
    for (let i = 1; i <= 5; i++) lines.push({ x: i, y: 1, c: BLACK }, { x: i, y: 5, c: BLACK }, { x: 1, y: i, c: BLACK }, { x: 5, y: i, c: BLACK });
    const px = image(7, 7, WHITE, lines);
    const inside = floodFillMask(px, 7, 7, 3, 3, 0)!;
    expect(maskArea(inside)).toBe(9);
    expect(maskBounds(inside, 7, 7)).toEqual({ x: 2, y: 2, width: 3, height: 3 });
    const outside = floodFillMask(px, 7, 7, 0, 0, 0)!;
    expect(maskArea(outside)).toBe(49 - 16 - 9);
  });

  it('respects tolerance', () => {
    const px = image(4, 1, [100, 100, 100, 255], [{ x: 2, y: 0, c: [120, 100, 100, 255] }]);
    expect(maskArea(floodFillMask(px, 4, 1, 0, 0, 0)!)).toBe(2);
    expect(maskArea(floodFillMask(px, 4, 1, 0, 0, 0.1)!)).toBe(4);
  });

  it('can take every matching pixel (not only connected ones)', () => {
    const px = image(5, 1, WHITE, [{ x: 2, y: 0, c: BLACK }]);
    expect(maskArea(floodFillMask(px, 5, 1, 0, 0, 0, true)!)).toBe(2);
    expect(maskArea(floodFillMask(px, 5, 1, 0, 0, 0, false)!)).toBe(4);
  });

  it('returns null outside the image', () => {
    expect(floodFillMask(image(2, 2, WHITE), 2, 2, 5, 0, 0)).toBeNull();
  });
});

describe('masks', () => {
  it('grows and shrinks', () => {
    const mask = new Uint8Array(25);
    mask[12] = 255; // centre of 5×5
    expect(maskArea(growMask(mask, 5, 5, 1))).toBe(9);
    const full = new Uint8Array(25).fill(255);
    expect(maskArea(growMask(full, 5, 5, -1))).toBe(9);
  });

  it('turns into non-overlapping rectangles that cover it exactly', () => {
    const mask = new Uint8Array(16);
    for (const i of [0, 1, 4, 5, 10, 15]) mask[i] = 255;
    const rects = maskToRects(mask, 4, 4);
    expect(rects.reduce((n, r) => n + r.width * r.height, 0)).toBe(6);
    expect(rects).toContainEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('selects painted pixels by alpha', () => {
    const px = image(3, 1, [0, 0, 0, 0], [{ x: 1, y: 0, c: [10, 10, 10, 200] }]);
    expect(Array.from(alphaMask(px, 3, 1, 8))).toEqual([0, 255, 0]);
  });
});