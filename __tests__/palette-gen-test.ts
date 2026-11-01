import { hexToHsv } from '@/engine/color/colorMath';
import { extractPalette, HARMONIES, harmony } from '@/engine/color/paletteGen';

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('colour harmonies', () => {
  it('start with the base colour and are distinct', () => {
    for (const h of HARMONIES) {
      const out = harmony('#3a7bd5', h.id);
      expect(out.length).toBeGreaterThanOrEqual(3);
      expect(new Set(out).size).toBe(out.length);
      if (h.id !== 'shades') expect(out[0]).toBe('#3a7bd5');
    }
  });

  it('complementary is the opposite hue', () => {
    const [base, comp] = harmony('#e63946', 'complementary');
    expect(hueDistance(hexToHsv(base).h, hexToHsv(comp).h)).toBeCloseTo(180, 0);
  });

  it('triadic hues are a third of the wheel apart', () => {
    const [a, b, c] = harmony('#2a9d8f', 'triadic').map((x) => hexToHsv(x).h);
    expect(hueDistance(a, b)).toBeCloseTo(120, 0);
    expect(hueDistance(b, c)).toBeCloseTo(120, 0);
  });
});

describe('image palette extraction', () => {
  /** RGBA pixels: `n` of each colour. */
  const pixels = (cols: number[][], n: number) => cols.flatMap((c) => Array.from({ length: n }, () => [...c, 255]).flat());

  it('finds the distinct colours of an image, dark to light', () => {
    const out = extractPalette(pixels([[255, 0, 0], [0, 0, 255], [250, 250, 250], [10, 10, 10]], 50), 4);
    expect(out).toEqual(['#0a0a0a', '#0000ff', '#ff0000', '#fafafa']);
  });

  it('ignores transparent pixels', () => {
    const data = [...pixels([[0, 255, 0]], 20), ...Array.from({ length: 20 }, () => [255, 0, 0, 0]).flat()];
    expect(extractPalette(data, 4)).toEqual(['#00ff00']);
  });

  it('returns nothing for an empty image', () => {
    expect(extractPalette([], 6)).toEqual([]);
  });
});
