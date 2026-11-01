import { BASE_PRESET } from '@/engine/brush/builtInBrushes';
import { resolveSlot, sizeLimit, type ToolSlot } from '@/state/brushStore';
import { parseEntry, PERCENT_ENTRY, SIZE_ENTRY } from '@/ui/valueEntry';

describe('typed slider values', () => {
  it('reads sizes in px, with units, commas and clamping', () => {
    expect(parseEntry('120', SIZE_ENTRY, 1, 4096)).toBe(120);
    expect(parseEntry('12.5 px', SIZE_ENTRY, 1, 4096)).toBe(12.5);
    expect(parseEntry('7,25', SIZE_ENTRY, 1, 4096)).toBe(7.3);
    expect(parseEntry('99999', SIZE_ENTRY, 1, 4096)).toBe(4096);
    expect(parseEntry('0', SIZE_ENTRY, 1, 4096)).toBe(1);
  });

  it('reads opacity as a percentage', () => {
    expect(parseEntry('40', PERCENT_ENTRY, 0.01, 1)).toBeCloseTo(0.4);
    expect(parseEntry('40%', PERCENT_ENTRY, 0.01, 1)).toBeCloseTo(0.4);
    expect(parseEntry('150', PERCENT_ENTRY, 0.01, 1)).toBe(1);
  });

  it('ignores text without a number', () => {
    expect(parseEntry('abc', SIZE_ENTRY, 1, 100)).toBeNull();
    expect(parseEntry('', PERCENT_ENTRY, 0.01, 1)).toBeNull();
  });
});

describe('canvas-sized brushes', () => {
  const preset = { ...BASE_PRESET, minSize: 1, maxSize: 40 };
  const slot: ToolSlot = { presetId: preset.id, size: 3000, opacity: 1, hardness: null };

  it('keeps the preset maximum when off', () => {
    expect(sizeLimit(preset, false, 4096)).toBe(40);
    expect(resolveSlot(preset, slot).size).toBe(40);
  });

  it('allows sizes up to the canvas longest side when on', () => {
    const limit = sizeLimit(preset, true, 4096);
    expect(limit).toBe(4096);
    const brush = resolveSlot(preset, slot, limit);
    expect(brush.size).toBe(3000);
    expect(brush.maxSize).toBe(4096);
    expect(resolveSlot(preset, { ...slot, size: 9000 }, limit).size).toBe(4096);
  });

  it('honours a typed size beyond the slider range, up to the canvas', () => {
    const limit = sizeLimit(preset, false, 4096);
    const brush = resolveSlot(preset, { ...slot, size: 300 }, limit, 4096);
    expect(brush.size).toBe(300);
    expect(brush.maxSize).toBe(40); // the slider range is unchanged
    expect(resolveSlot(preset, { ...slot, size: 9000 }, limit, 4096).size).toBe(4096);
    expect(parseEntry('300', { ...SIZE_ENTRY, max: 4096 }, 1, 4096)).toBe(300);
  });

  it('never goes below the preset maximum (e.g. before a canvas is open)', () => {
    expect(sizeLimit(preset, true, 0)).toBe(40);
    expect(sizeLimit(preset, true, 16)).toBe(40);
  });
});
