import { closestDirection, projectOnLine, snapDirections, vanishingPoints } from '@/engine/render/perspective';

describe('perspective snapping', () => {
  it('offers lines toward each vanishing point plus verticals', () => {
    const dirs = snapDirections({ x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: -100, y: 0 }]);
    expect(dirs).toEqual([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }]);
  });

  it('1-point perspective also keeps horizontals; 3-point has no fixed verticals', () => {
    expect(snapDirections({ x: 0, y: 0 }, [{ x: 0, y: -50 }])).toHaveLength(3);
    expect(snapDirections({ x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: -10, y: 0 }, { x: 0, y: 99 }])).toHaveLength(3);
  });

  it('picks the line closest to where the stroke heads, in either direction', () => {
    const dirs = snapDirections({ x: 0, y: 0 }, [{ x: 100, y: 100 }]);
    expect(closestDirection(dirs, 10, 12)).toEqual(dirs[0]);
    expect(closestDirection(dirs, -10, -9)).toEqual(dirs[0]);
    expect(closestDirection(dirs, 1, 20)).toEqual({ x: 0, y: 1 });
  });

  it('projects the pen onto the chosen line', () => {
    const p = projectOnLine({ x: 0, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(5);
  });

  it('converts vanishing points from canvas fractions for the active mode', () => {
    const vps = vanishingPoints(2, [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 0, y: 2 }], 200, 100);
    expect(vps).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
  });
});
