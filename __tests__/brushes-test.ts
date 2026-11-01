import { isCircleTone, isToneTexture, normalizePreset } from '@/engine/brush/brushPreset';
import { BASE_PRESET, BUILT_IN_BRUSHES } from '@/engine/brush/builtInBrushes';

describe('built-in brushes', () => {
  it('have unique ids', () => {
    const ids = BUILT_IN_BRUSHES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('survive normalisation unchanged (all values in range)', () => {
    for (const b of BUILT_IN_BRUSHES) expect(normalizePreset(b, BASE_PRESET)).toEqual(b);
  });

  it('include screentone brushes with a dot size and density', () => {
    const tones = BUILT_IN_BRUSHES.filter((b) => b.category === 'tone');
    expect(tones.length).toBeGreaterThanOrEqual(4);
    for (const t of tones) {
      expect(isToneTexture(t.texture.kind)).toBe(true);
      expect(t.texture.strength).toBeGreaterThan(0);
    }
  });

  it('include diagonal tones and circle tones of mixed sizes', () => {
    const tones = BUILT_IN_BRUSHES.filter((b) => b.category === 'tone');
    expect(tones.some((t) => t.texture.kind === 'tone-lines' && Math.abs(t.texture.angle) === 45)).toBe(true);
    expect(tones.some((t) => isCircleTone(t.texture.kind) && t.texture.variation > 0)).toBe(true);
  });

  it('include blending brushes and more airbrushes', () => {
    expect(BUILT_IN_BRUSHES.filter((b) => b.category === 'blending' && b.blend > 0).length).toBeGreaterThanOrEqual(3);
    expect(BUILT_IN_BRUSHES.filter((b) => b.category === 'airbrush').length).toBeGreaterThanOrEqual(5);
    // Only blending brushes mix; everything else paints.
    for (const b of BUILT_IN_BRUSHES) if (b.category !== 'blending') expect(b.blend).toBe(0);
  });
});

describe('preset normalisation', () => {
  it('fills the new fields of presets saved before they existed', () => {
    const old = { ...BASE_PRESET, texture: { kind: 'tone-dots', strength: 0.5, scale: 1 } } as Record<string, unknown>;
    delete old.blend;
    const p = normalizePreset(old, BASE_PRESET);
    expect(p.blend).toBe(0);
    expect(p.texture.angle).toBe(0);
    expect(p.texture.variation).toBe(0);
  });

  it('clamps blend, angle and variation', () => {
    const p = normalizePreset({ ...BASE_PRESET, blend: 3, texture: { ...BASE_PRESET.texture, angle: 500, variation: -1 } }, BASE_PRESET);
    expect(p.blend).toBe(1);
    expect(p.texture.angle).toBe(180);
    expect(p.texture.variation).toBe(0);
  });
});
