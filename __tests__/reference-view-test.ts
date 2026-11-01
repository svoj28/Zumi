import {
  displayedAspect,
  filterMatrix,
  fitScale,
  imagePointAt,
  maxPan,
  REFERENCE_FILTERS,
  type ReferenceViewState,
} from '@/engine/render/referenceView';

/** Applies the transform list (outermost first) to a point, like the renderer does. */
function apply(v: ReferenceViewState, x: number, y: number) {
  // Same maths as referenceTransform, applied innermost first.
  let px = x - v.iw / 2;
  let py = y - v.ih / 2;
  px *= v.flipX ? -1 : 1;
  py *= v.flipY ? -1 : 1;
  const a = (v.quarter * Math.PI) / 2;
  [px, py] = [px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)];
  const s = fitScale(v.W, v.H, v.iw, v.ih, v.quarter) * v.zoom;
  return { x: px * s + v.W / 2 + v.panX, y: py * s + v.H / 2 + v.panY };
}

const base: ReferenceViewState = { W: 300, H: 200, iw: 1200, ih: 800, quarter: 0, flipX: false, flipY: false, zoom: 1, panX: 0, panY: 0 };

describe('reference window geometry', () => {
  it('fits the image, rotated or not', () => {
    expect(fitScale(300, 200, 1200, 800, 0)).toBeCloseTo(0.25);
    expect(fitScale(200, 300, 1200, 800, 1)).toBeCloseTo(0.25);
    expect(displayedAspect(1.5, 1)).toBeCloseTo(1 / 1.5);
  });

  it.each([
    { quarter: 0, flipX: false, flipY: false },
    { quarter: 1, flipX: true, flipY: false },
    { quarter: 2, flipX: false, flipY: true },
    { quarter: 3, flipX: true, flipY: true },
  ])('maps a tap back to the image pixel under it (%o)', (o) => {
    const v = { ...base, ...o, zoom: 2.5, panX: 30, panY: -12 };
    for (const [x, y] of [[0, 0], [1200, 800], [317, 641]]) {
      const screen = apply(v, x, y);
      const back = imagePointAt(v, screen.x, screen.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('only allows panning when zoomed past the frame', () => {
    expect(maxPan(base)).toEqual({ x: 0, y: 0 });
    const zoomed = maxPan({ ...base, zoom: 2 });
    expect(zoomed.x).toBeCloseTo(150);
    expect(zoomed.y).toBeCloseTo(100);
  });

  it('has a colour matrix for every colour filter', () => {
    for (const f of REFERENCE_FILTERS) {
      const m = filterMatrix(f.id);
      if (f.id === 'none') expect(m).toBeNull();
      else expect(m).toHaveLength(20);
    }
  });
});
