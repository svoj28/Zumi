import { IDENTITY_TRANSFORM } from '@/engine/layers/layerTransform';
import { homography, isValidQuad, mapHomography, meshFromTransform, moveMeshPoint, translateMesh } from '@/engine/layers/meshWarp';

const box = { x: 10, y: 20, width: 100, height: 50 };

describe('distort (perspective)', () => {
  it('maps the rectangle corners onto the quad', () => {
    const quad = [{ x: 0, y: 0 }, { x: 200, y: 30 }, { x: 180, y: 160 }, { x: 15, y: 120 }];
    const m = homography(box, quad);
    const corners = [[10, 20], [110, 20], [110, 70], [10, 70]];
    corners.forEach(([x, y], i) => {
      const p = mapHomography(m, x, y);
      expect(p.x).toBeCloseTo(quad[i].x, 6);
      expect(p.y).toBeCloseTo(quad[i].y, 6);
    });
  });

  it('is a plain move when the quad is the moved rectangle', () => {
    const quad = [{ x: 15, y: 25 }, { x: 115, y: 25 }, { x: 115, y: 75 }, { x: 15, y: 75 }];
    const m = homography(box, quad);
    const p = mapHomography(m, 60, 45);
    expect(p.x).toBeCloseTo(65, 6);
    expect(p.y).toBeCloseTo(50, 6);
    expect(m[6]).toBeCloseTo(0, 9);
    expect(m[7]).toBeCloseTo(0, 9);
  });

  it('rejects twisted or collapsed quads', () => {
    expect(isValidQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
    expect(isValidQuad([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    expect(isValidQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }])).toBe(false);
  });
});

describe('warp mesh', () => {
  const mesh = meshFromTransform(box, IDENTITY_TRANSFORM);

  it('starts on the content box with straight edges', () => {
    expect(mesh[0]).toEqual({ x: 10, y: 20 });
    expect(mesh[3]).toEqual({ x: 110, y: 20 });
    expect(mesh[6]).toEqual({ x: 110, y: 70 });
    expect(mesh[9]).toEqual({ x: 10, y: 70 });
    expect(mesh[1].y).toBeCloseTo(20);
    expect(mesh[1].x).toBeCloseTo(10 + 100 / 3);
  });

  it('dragging a corner carries its edge handles; dragging a handle moves only it', () => {
    const moved = moveMeshPoint(mesh, 0, 0, 0, 'warp');
    expect(moved[0]).toEqual({ x: 0, y: 0 });
    expect(moved[1].x).toBeCloseTo(mesh[1].x - 10);
    expect(moved[11].y).toBeCloseTo(mesh[11].y - 20);
    expect(moved[2]).toEqual(mesh[2]);
    const bent = moveMeshPoint(mesh, 1, 40, 0, 'warp');
    expect(bent[1]).toEqual({ x: 40, y: 0 });
    expect(bent[2]).toEqual(mesh[2]);
  });

  it('distort keeps edges straight', () => {
    const moved = moveMeshPoint(mesh, 3, 140, 0, 'distort');
    expect(moved[1].x).toBeCloseTo(10 + (140 - 10) / 3);
    expect(moved[1].y).toBeCloseTo(20 + (0 - 20) / 3);
  });

  it('moves as a whole', () => {
    expect(translateMesh(mesh, 5, -5)[6]).toEqual({ x: 115, y: 65 });
  });
});
