import { groupLayers, isAttached, maskMatrix } from '@/engine/layers/layerGroups';

const layer = (id: string, meta: { clip?: boolean; mask?: boolean } = {}) => ({ id, meta });

describe('layer groups (clipping layers and masks)', () => {
  it('keeps ordinary layers as separate groups', () => {
    const groups = groupLayers([layer('a'), layer('b')]);
    expect(groups.map((g) => [g.base.id, g.attached.map((l) => l.id)])).toEqual([
      ['a', []],
      ['b', []],
    ]);
  });

  it('attaches clipping layers and masks to the nearest ordinary layer below', () => {
    const groups = groupLayers([layer('base'), layer('clip1', { clip: true }), layer('mask', { mask: true }), layer('clip2', { clip: true }), layer('top')]);
    expect(groups.map((g) => [g.base.id, g.attached.map((l) => l.id)])).toEqual([
      ['base', ['clip1', 'mask', 'clip2']],
      ['top', []],
    ]);
  });

  it('draws a clipping layer with nothing below it as an ordinary layer', () => {
    const groups = groupLayers([layer('orphan', { clip: true }), layer('c', { clip: true })]);
    expect(groups.map((g) => [g.base.id, g.attached.map((l) => l.id)])).toEqual([['orphan', ['c']]]);
  });

  it('knows which layers are attached', () => {
    expect(isAttached({})).toBe(false);
    expect(isAttached({ clip: true })).toBe(true);
    expect(isAttached({ mask: true })).toBe(true);
  });
});

describe('mask matrix', () => {
  // Alpha row: coverage = 0.2126·r + 0.7152·g + 0.0722·b (weighted by opacity) + (1 − opacity).
  const alpha = (m: number[], r: number, g: number, b: number) => m[15] * r + m[16] * g + m[17] * b + m[19];

  it('shows white and hides black at full opacity', () => {
    const m = maskMatrix(1);
    expect(alpha(m, 1, 1, 1)).toBeCloseTo(1);
    expect(alpha(m, 0, 0, 0)).toBeCloseTo(0);
  });

  it('has no effect at zero opacity', () => {
    const m = maskMatrix(0);
    expect(alpha(m, 0, 0, 0)).toBeCloseTo(1);
  });
});
