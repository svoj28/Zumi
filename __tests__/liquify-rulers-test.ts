jest.mock('@shopify/react-native-skia', () => ({ Skia: {} }));

import { distanceToLine, rulerSnap, type RulerGeometry } from '@/engine/input/rulers';
import { createLiquifyMesh, isDeformed, liquifyIndices, liquifyStep } from '@/engine/layers/liquify';

describe('liquify mesh', () => {
  const tex = createLiquifyMesh(100, 100, 4);

  it('starts undeformed with a vertex grid and triangles', () => {
    expect(tex.length).toBe(5 * 5 * 2);
    expect(isDeformed(tex, tex)).toBe(false);
    expect(liquifyIndices(4).length).toBe(4 * 4 * 6);
  });

  it('pushes vertices near the brush and leaves far ones', () => {
    const moved = liquifyStep(tex, tex, 50, 50, 10, 0, 30, 1, 'push');
    expect(isDeformed(moved, tex)).toBe(true);
    // Centre vertex (index 12) moves right by the full delta; a corner does not move.
    expect(moved[24]).toBeCloseTo(60);
    expect(moved[0]).toBe(0);
  });

  it('restores toward the original', () => {
    const moved = liquifyStep(tex, tex, 50, 50, 10, 0, 30, 1, 'push');
    const back = liquifyStep(moved, tex, 50, 50, 0, 0, 30, 1, 'restore');
    expect(Math.abs(back[24] - 50)).toBeLessThan(Math.abs(moved[24] - 50));
  });
});

describe('rulers', () => {
  const line: RulerGeometry = { kind: 'line', ax: 0, ay: 100, bx: 100, by: 100 };

  it('snaps strokes that start near the line ruler onto it', () => {
    expect(distanceToLine(line, { x: 50, y: 110 })).toBeCloseTo(10);
    expect(rulerSnap(line, { x: 10, y: 105 }, { x: 80, y: 130 }, 20)).toEqual({ x: 80, y: 100 });
    // Far away: free drawing.
    expect(rulerSnap(line, { x: 10, y: 300 }, { x: 80, y: 330 }, 20)).toEqual({ x: 80, y: 330 });
  });

  it('keeps strokes parallel to the parallel ruler', () => {
    const p = rulerSnap({ ...line, kind: 'parallel' }, { x: 0, y: 300 }, { x: 50, y: 320 }, 20);
    expect(p.y).toBeCloseTo(300);
    expect(p.x).toBeCloseTo(50);
  });

  it('aims focus lines at the centre', () => {
    const r: RulerGeometry = { kind: 'radial', ax: 0, ay: 0, bx: 0, by: 0 };
    const p = rulerSnap(r, { x: 100, y: 100 }, { x: 50, y: 70 }, 20);
    expect(p.x).toBeCloseTo(p.y);
  });

  it('keeps ellipse strokes on the concentric ellipse through their start', () => {
    const r: RulerGeometry = { kind: 'ellipse', ax: 0, ay: 0, bx: 100, by: 50 };
    const p = rulerSnap(r, { x: 200, y: 0 }, { x: 0, y: 500 }, 20);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
  });
});