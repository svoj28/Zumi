import { ByteWriter, changedBox, GifEncoder, lzwEncode } from '@/engine/timelapse/gifEncoder';

/** Independent reference GIF LZW decoder (straight from the GIF89a spec). */
function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    codeSize = minCodeSize + 1;
  };
  reset();
  let pos = 0;
  let bit = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[(bit + i) >> 3];
      code |= ((byte >> ((bit + i) & 7)) & 1) << i;
    }
    bit += codeSize;
    return code;
  };
  let prev: number[] | null = null;
  while (bit + codeSize <= data.length * 8) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error(`bad code ${code}`);
    for (const v of entry) out[pos++] = v;
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize += 1;
    prev = entry;
  }
  expect(pos).toBe(pixelCount);
  return out;
}

/** Joins GIF sub-blocks starting at `offset`; returns the data and the offset after them. */
function readSubBlocks(gif: Uint8Array, offset: number): { data: Uint8Array; next: number } {
  const parts: number[] = [];
  let p = offset;
  while (gif[p] !== 0) {
    const len = gif[p];
    for (let i = 1; i <= len; i++) parts.push(gif[p + i]);
    p += len + 1;
  }
  return { data: Uint8Array.from(parts), next: p + 1 };
}

interface DecodedFrame {
  rgb: Uint8Array;
  delayCs: number;
}

/** Decodes a GIF written by GifEncoder into fully composited RGB frames. */
function decodeGif(gif: Uint8Array): { width: number; height: number; frames: DecodedFrame[] } {
  expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a');
  const u16 = (i: number) => gif[i] | (gif[i + 1] << 8);
  const width = u16(6);
  const height = u16(8);
  const canvas = new Uint8Array(width * height * 3);
  const frames: DecodedFrame[] = [];
  let p = 13;
  let delay = 0;
  let transparentIndex = -1;
  while (gif[p] !== 0x3b) {
    if (gif[p] === 0x21) {
      if (gif[p + 1] === 0xf9) {
        transparentIndex = gif[p + 3] & 1 ? gif[p + 6] : -1;
        delay = u16(p + 4);
      }
      p = readSubBlocks(gif, p + 2).next;
      continue;
    }
    expect(gif[p]).toBe(0x2c);
    const [x, y, w, h] = [u16(p + 1), u16(p + 3), u16(p + 5), u16(p + 7)];
    const packed = gif[p + 9];
    expect(packed & 0x80).toBeTruthy();
    const tableSize = 2 << (packed & 7);
    const palette = gif.subarray(p + 10, p + 10 + tableSize * 3);
    p += 10 + tableSize * 3;
    const minCode = gif[p];
    const { data, next } = readSubBlocks(gif, p + 1);
    p = next;
    const indices = lzwDecode(data, minCode, w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const idx = indices[j * w + i];
        if (idx === transparentIndex) continue;
        canvas.set(palette.subarray(idx * 3, idx * 3 + 3), ((y + j) * width + x + i) * 3);
      }
    }
    frames.push({ rgb: canvas.slice(), delayCs: delay });
  }
  return { width, height, frames };
}

function solid(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) px.set([...rgb, 255], i * 4);
  return px;
}

function rgbOf(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) out.set(rgba.subarray(i, i + 3), j);
  return out;
}

describe('lzwEncode', () => {
  it.each([
    ['a single pixel', Uint8Array.from([7])],
    ['a run of one colour', new Uint8Array(10000).fill(3)],
    ['pseudo-random data (fills the code table and clears it)', Uint8Array.from({ length: 60000 }, (_, i) => (i * 2654435761) % 251)],
    ['all 256 values', Uint8Array.from({ length: 5000 }, (_, i) => i % 256)],
  ])('round-trips %s', (_label, indices) => {
    const w = new ByteWriter();
    lzwEncode(indices, w);
    const { data } = readSubBlocks(w.result(), 0);
    expect(Array.from(lzwDecode(data, 8, indices.length))).toEqual(Array.from(indices));
  });
});

describe('GifEncoder', () => {
  it('encodes frames exactly when they have few colours, storing only changes', () => {
    const [w, h] = [40, 30];
    const first = solid(w, h, [255, 255, 255]);
    const second = first.slice();
    for (let y = 10; y < 15; y++) for (let x = 5; x < 20; x++) second.set([200, 30, 40, 255], (y * w + x) * 4);
    const third = second.slice();
    third.set([0, 0, 255, 255], (29 * w + 39) * 4);

    const gif = new GifEncoder(w, h);
    gif.addFrame(first, 7);
    gif.addFrame(second, 7);
    gif.addFrame(third, 150);
    const decoded = decodeGif(gif.finish());

    expect(decoded.frames).toHaveLength(3);
    expect(Array.from(decoded.frames[0].rgb)).toEqual(Array.from(rgbOf(first)));
    expect(Array.from(decoded.frames[1].rgb)).toEqual(Array.from(rgbOf(second)));
    expect(Array.from(decoded.frames[2].rgb)).toEqual(Array.from(rgbOf(third)));
    expect(decoded.frames.map((f) => f.delayCs)).toEqual([7, 7, 150]);
  });

  it('merges identical frames into a longer delay', () => {
    const frame = solid(8, 8, [10, 20, 30]);
    const gif = new GifEncoder(8, 8);
    gif.addFrame(frame, 7);
    gif.addFrame(frame.slice(), 7);
    gif.addFrame(frame.slice(), 6);
    const decoded = decodeGif(gif.finish());
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0].delayCs).toBe(20);
  });

  it('stays close to the source colours for full-colour frames', () => {
    const [w, h] = [64, 64];
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x * 4, y * 4, (x + y) * 2, 255], (y * w + x) * 4);
    const gif = new GifEncoder(w, h);
    gif.addFrame(px, 10);
    const [frame] = decodeGif(gif.finish()).frames;
    const src = rgbOf(px);
    let maxError = 0;
    for (let i = 0; i < src.length; i++) maxError = Math.max(maxError, Math.abs(src[i] - frame.rgb[i]));
    expect(maxError).toBeLessThanOrEqual(24);
  });
});

describe('changedBox', () => {
  it('finds the bounding box of changed pixels', () => {
    const a = solid(10, 10, [0, 0, 0]);
    const b = a.slice();
    b.set([1, 0, 0, 255], (2 * 10 + 3) * 4);
    b.set([1, 0, 0, 255], (6 * 10 + 8) * 4);
    expect(changedBox(a, b, 10, 10)).toEqual({ x: 3, y: 2, width: 6, height: 5 });
    expect(changedBox(a, a.slice(), 10, 10)).toBeNull();
  });
});
