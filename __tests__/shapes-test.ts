import { SHAPES, shapeSamples } from '@/engine/brush/shapes';
import { SAMPLE_STRIDE } from '@/engine/types';

/** Bounding box of a shape's sample points. */
function bounds(samples: number[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < samples.length; i += SAMPLE_STRIDE) {
    minX = Math.min(minX, samples[i]);
    maxX = Math.max(maxX, samples[i]);
    minY = Math.min(minY, samples[i + 1]);
    maxY = Math.max(maxY, samples[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

describe('shapes', () => {
  it.each(SHAPES.filter((s) => !['line', 'arrow'].includes(s.kind)).map((s) => s.kind))(
    '%s fills the dragged box',
    (kind) => {
      const b = bounds(shapeSamples(kind, 100, 200, 300, 350, false, 2));
      expect(b.minX).toBeCloseTo(100, 0);
      expect(b.maxX).toBeCloseTo(300, 0);
      expect(b.minY).toBeCloseTo(200, 0);
      expect(b.maxY).toBeCloseTo(350, 0);
    },
  );

  it('closed shapes end where they start', () => {
    for (const s of SHAPES) {
      if (s.kind === 'line' || s.kind === 'arrow') continue;
      const out = shapeSamples(s.kind, 0, 0, 100, 80, false, 2);
      const n = out.length - SAMPLE_STRIDE;
      expect(out[n]).toBeCloseTo(out[0], 6);
      expect(out[n + 1]).toBeCloseTo(out[1], 6);
    }
  });

  it('the arrow ends at its tip with a head on both sides', () => {
    const out = shapeSamples('arrow', 0, 0, 200, 0, false, 2);
    const b = bounds(out);
    expect(b.maxX).toBeCloseTo(200, 6);
    expect(b.minY).toBeLessThan(-5);
    expect(b.maxY).toBeGreaterThan(5);
  });

  it('a constrained hexagon is regular', () => {
    const b = bounds(shapeSamples('hexagon', 0, 0, 200, 200, true, 1));
    expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(2 / Math.sqrt(3), 2);
  });
});
