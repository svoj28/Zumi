jest.mock('@shopify/react-native-skia', () => ({ Skia: {}, BlendMode: {}, FilterMode: {}, MipmapMode: {}, TileMode: {} }));

import { ADJUSTMENTS, adjustUniforms, defaultAdjustment, formatParam, isNeutral } from '@/engine/render/adjustments';
import { stackItems } from '@/engine/layers/layerGroups';
import type { LayerGroupMeta } from '@/engine/types';

describe('adjustments', () => {
  it('start neutral (nothing to apply) except one-shot filters', () => {
    for (const a of ADJUSTMENTS) {
      const neutral = isNeutral(defaultAdjustment(a.kind));
      if (['invert', 'posterize', 'threshold', 'grayscale', 'blur', 'sharpen', 'noise'].includes(a.kind)) continue;
      expect(neutral).toBe(true);
    }
    expect(isNeutral(defaultAdjustment('invert'))).toBe(false);
  });

  it('become active when a value changes', () => {
    const adj = defaultAdjustment('hsl');
    expect(isNeutral({ ...adj, values: { ...adj.values, hue: 30 } })).toBe(false);
  });

  it('pack uniforms in shader order', () => {
    const u = adjustUniforms({ kind: 'levels', values: { inBlack: 0.1, inWhite: 0.9, gamma: 1.2, outBlack: 0, outWhite: 1 } });
    expect(u.p).toEqual([0.1, 0.9, 1.2, 0]);
    expect(u.q).toEqual([0, 1, 0, 0]);
  });

  it('format values for display', () => {
    expect(formatParam({ key: 'x', label: '', min: 0, max: 1, default: 0, unit: '%' }, 0.25)).toBe('25%');
    expect(formatParam({ key: 'x', label: '', min: 0, max: 1, default: 0, unit: '°', step: 1 }, 44.6)).toBe('45°');
  });
});

describe('layer folders and frames', () => {
  const layer = (id: string, meta: { groupId?: string; clip?: boolean } = {}) => ({ id, meta });
  const group = (id: string): LayerGroupMeta => ({ id, name: id, visible: true, opacity: 1, blendMode: 'srcOver', collapsed: false });

  it('splits the stack into folders and units', () => {
    const groups = new Map([['g', group('g')]]);
    const items = stackItems([layer('bg'), layer('a', { groupId: 'g' }), layer('b', { groupId: 'g', clip: true }), layer('top')], groups);
    expect(items.map((i) => i.kind)).toEqual(['unit', 'folder', 'unit']);
    const folder = items[1];
    expect(folder.kind === 'folder' && folder.units[0].attached.map((l) => l.id)).toEqual(['b']);
  });

  it('ignores group ids without a group (treated as loose layers)', () => {
    const items = stackItems([layer('a', { groupId: 'missing' }), layer('b')], new Map());
    expect(items.map((i) => i.kind)).toEqual(['unit', 'unit']);
  });
});