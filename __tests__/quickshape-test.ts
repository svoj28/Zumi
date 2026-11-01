import { recognizeShape } from '@/engine/brush/quickShape';

/** Flat stroke samples from points (pressure 1, 10 ms apart). */
function stroke(points: [number, number][]): number[] {
  return points.flatMap(([x, y], i) => [x, y, 1, i * 10, 0, 0]);
}

const wobble = (i: number) => Math.sin(i * 1.7) * 1.5;

describe('QuickShape', () => {
  it('recognises a shaky straight line', () => {
    const pts: [number, number][] = Array.from({ length: 40 }, (_, i) => [i * 5, 100 + wobble(i)]);
    const shape = recognizeShape(stroke(pts));
    expect(shape?.kind).toBe('line');
    // The clean line runs from the first to the last point.
    expect(shape!.samples[0]).toBeCloseTo(0);
    expect(shape!.samples[shape!.samples.length - 6]).toBeCloseTo(195);
  });

  it('recognises a circle', () => {
    const pts: [number, number][] = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 59) * Math.PI * 2;
      return [200 + Math.cos(a) * (80 + wobble(i)), 200 + Math.sin(a) * (80 + wobble(i))];
    });
    expect(recognizeShape(stroke(pts))?.kind).toBe('circle');
  });

  it('recognises an ellipse', () => {
    const pts: [number, number][] = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 59) * Math.PI * 2;
      return [200 + Math.cos(a) * 120, 200 + Math.sin(a) * 50];
    });
    expect(recognizeShape(stroke(pts))?.kind).toBe('ellipse');
  });

  it('recognises a triangle', () => {
    const corners: [number, number][] = [
      [100, 300],
      [200, 100],
      [300, 300],
      [100, 300],
    ];
    const pts: [number, number][] = [];
    for (let s = 0; s < 3; s++) {
      for (let k = 0; k < 20; k++) {
        const t = k / 20;
        pts.push([corners[s][0] + (corners[s + 1][0] - corners[s][0]) * t, corners[s][1] + (corners[s + 1][1] - corners[s][1]) * t]);
      }
    }
    pts.push(corners[3]);
    expect(recognizeShape(stroke(pts))?.kind).toBe('polygon');
  });

  it('leaves scribbles and tiny strokes alone', () => {
    expect(recognizeShape(stroke([[0, 0], [1, 1], [2, 0], [3, 1]]))).toBeNull();
    const scribble: [number, number][] = Array.from({ length: 50 }, (_, i) => [i * 6, 100 + (i % 2 ? 40 : -40) * Math.sin(i)]);
    expect(recognizeShape(stroke(scribble))).toBeNull();
  });
});