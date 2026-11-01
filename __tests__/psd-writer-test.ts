import { packBits, writePsd, type PsdLayer } from '@/engine/export/psdWriter';

/** PackBits decoder (for checking the encoder). */
function unpackBits(data: Uint8Array, length: number): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (out.length < length && i < data.length) {
    const n = data[i] > 127 ? data[i] - 256 : data[i];
    i++;
    if (n >= 0) {
      for (let k = 0; k <= n; k++) out.push(data[i++]);
    } else if (n !== -128) {
      for (let k = 0; k < 1 - n; k++) out.push(data[i]);
      i++;
    }
  }
  return Uint8Array.from(out);
}

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const i16 = (b: Uint8Array, o: number) => (u16(b, o) > 32767 ? u16(b, o) - 65536 : u16(b, o));

describe('PackBits', () => {
  it.each([[[1, 1, 1, 1, 2, 3, 4, 4]], [[5]], [Array.from({ length: 300 }, (_, i) => i % 7)], [Array.from({ length: 300 }, () => 9)]])(
    'round-trips %#',
    (row) => {
      const data = Uint8Array.from(row);
      expect(Array.from(unpackBits(packBits(data), data.length))).toEqual(row);
    },
  );
});

describe('PSD writer', () => {
  const layer = (overrides: Partial<PsdLayer> = {}): PsdLayer => ({
    name: 'Ink',
    top: 1,
    left: 1,
    bottom: 3,
    right: 3,
    rgba: new Uint8Array(2 * 2 * 4).fill(200),
    opacity: 255,
    visible: true,
    blendKey: 'norm',
    clipping: false,
    ...overrides,
  });

  it('writes a valid header and layer count', () => {
    const psd = writePsd(4, 4, [layer(), layer({ name: 'Shade', clipping: true, blendKey: 'mul ' })], new Uint8Array(4 * 4 * 4));
    expect(String.fromCharCode(...psd.slice(0, 4))).toBe('8BPS');
    expect(u16(psd, 4)).toBe(1);
    expect(u16(psd, 12)).toBe(4); // channels
    expect(u32(psd, 14)).toBe(4); // height
    expect(u32(psd, 18)).toBe(4); // width
    expect(u16(psd, 24)).toBe(3); // RGB
    // After colour mode (4) and resources (4): layer & mask section length, layer info length, count.
    const layerMaskLength = u32(psd, 34);
    expect(layerMaskLength % 2).toBe(0);
    expect(i16(psd, 42)).toBe(-2);
    // The first record's rectangle.
    expect(u32(psd, 44)).toBe(1);
    // The merged image section follows the layer & mask section and starts with RLE.
    expect(u16(psd, 38 + layerMaskLength)).toBe(1);
  });

  it('includes group markers and layer masks', () => {
    const psd = writePsd(4, 4, [
      layer({ name: '</Layer group>', section: 'divider', top: 0, left: 0, bottom: 0, right: 0, rgba: new Uint8Array(0) }),
      layer({ mask: { top: 0, left: 0, bottom: 4, right: 4, data: new Uint8Array(16).fill(255), defaultColor: 255 } }),
      layer({ name: 'Folder', section: 'open', top: 0, left: 0, bottom: 0, right: 0, rgba: new Uint8Array(0) }),
    ], new Uint8Array(64));
    const text = String.fromCharCode(...psd);
    expect(text.split('lsct').length - 1).toBe(2);
    expect(text).toContain('Folder');
  });
});