/**
 * Animated GIF encoder (pure TypeScript, no native code).
 *
 * Built for timelapses, where consecutive frames differ only where the artist painted:
 * - each frame stores only the rectangle that changed since the previous frame, and pixels
 *   inside it that did not change are transparent (shown through from the previous frame);
 * - each frame gets its own 255-colour palette (median cut over its changed pixels), so colour
 *   accuracy does not depend on one palette for the whole animation;
 * - a frame identical to the previous one only lengthens the previous frame's delay.
 *
 * Input frames are RGBA (alpha ignored: the caller renders onto an opaque background).
 */

const TRANSPARENT = 255;
const MAX_COLORS = 255;
const MIN_CODE_SIZE = 8;

interface PendingFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  palette: Uint8Array;
  indices: Uint8Array;
  transparent: boolean;
  delayCs: number;
}

export class GifEncoder {
  private readonly out = new ByteWriter();
  private previous: Uint8Array | null = null;
  private pending: PendingFrame | null = null;
  private frames = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new Error('Invalid GIF size');
    const o = this.out;
    o.ascii('GIF89a');
    o.u16(width);
    o.u16(height);
    o.byte(0); // no global colour table
    o.byte(0); // background colour index
    o.byte(0); // pixel aspect ratio
    // NETSCAPE2.0 application extension: loop forever.
    o.bytes([0x21, 0xff, 0x0b]);
    o.ascii('NETSCAPE2.0');
    o.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  }

  get frameCount(): number {
    return this.frames + (this.pending ? 1 : 0);
  }

  /** Adds a frame shown for `delayCs` hundredths of a second (at least 2, as viewers require). */
  addFrame(rgba: Uint8Array, delayCs: number): void {
    const { width, height } = this;
    if (rgba.length < width * height * 4) throw new Error('Frame is smaller than the GIF');
    const delay = Math.max(2, Math.round(delayCs));
    const prev = this.previous;
    const box = prev ? changedBox(prev, rgba, width, height) : { x: 0, y: 0, width, height };

    if (!box) {
      if (this.pending) this.pending.delayCs += delay;
      return;
    }
    this.flushPending();
    this.pending = encodeRegion(rgba, prev, width, box, delay);
    this.previous = prev ?? new Uint8Array(width * height * 4);
    this.previous.set(rgba.subarray(0, width * height * 4));
  }

  /** Shows the last frame longer; same as adding an identical frame, without comparing pixels. */
  holdLast(delayCs: number): void {
    if (this.pending) this.pending.delayCs += Math.max(0, Math.round(delayCs));
  }

  /** Ends the animation and returns the file bytes. The encoder cannot be used afterwards. */
  finish(): Uint8Array {
    this.flushPending();
    this.out.byte(0x3b);
    return this.out.result();
  }

  private flushPending(): void {
    const f = this.pending;
    if (!f) return;
    this.pending = null;
    this.frames += 1;
    const o = this.out;
    // Graphic control extension: keep the frame (disposal 1) so later frames draw over it.
    o.bytes([0x21, 0xf9, 0x04, (1 << 2) | (f.transparent ? 1 : 0)]);
    o.u16(Math.min(65535, f.delayCs));
    o.byte(f.transparent ? TRANSPARENT : 0);
    o.byte(0);
    // Image descriptor with a 256-entry local colour table.
    o.byte(0x2c);
    o.u16(f.x);
    o.u16(f.y);
    o.u16(f.width);
    o.u16(f.height);
    o.byte(0x80 | 7);
    o.bytes(f.palette);
    o.byte(MIN_CODE_SIZE);
    lzwEncode(f.indices, o);
  }
}

// ---- frame analysis --------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

const samePixel = (a: Uint8Array, b: Uint8Array, i: number) => a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2];

/** Bounding box of pixels whose colour differs, or null when the frames are identical. */
export function changedBox(prev: Uint8Array, next: Uint8Array, width: number, height: number): Box | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      if (samePixel(prev, next, i)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function encodeRegion(rgba: Uint8Array, prev: Uint8Array | null, width: number, box: Box, delayCs: number): PendingFrame {
  const count = box.width * box.height;
  const changed = new Uint8Array(count);
  let anyUnchanged = false;
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const i = ((box.y + y) * width + box.x + x) * 4;
      const isChanged = !prev || !samePixel(prev, rgba, i);
      changed[y * box.width + x] = isChanged ? 1 : 0;
      if (!isChanged) anyUnchanged = true;
    }
  }

  const palette = buildPalette(rgba, width, box, changed);
  const lookup = new NearestColor(palette.colors, palette.size);
  const indices = new Uint8Array(count);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const k = y * box.width + x;
      if (!changed[k]) {
        indices[k] = TRANSPARENT;
        continue;
      }
      const i = ((box.y + y) * width + box.x + x) * 4;
      indices[k] = lookup.find(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  }

  const table = new Uint8Array(256 * 3);
  table.set(palette.colors.subarray(0, palette.size * 3));
  return { ...box, palette: table, indices, transparent: anyUnchanged, delayCs };
}

// ---- palette (median cut over a 5-bit-per-channel histogram) ---------------------------------

interface ColorBox {
  /** Histogram bucket ids (r5 << 10 | g5 << 5 | b5) in this box. */
  buckets: number[];
  count: number;
}

/** Up to 255 representative colours of the pixels in `box` whose `include` flag is set. */
export function buildPalette(rgba: Uint8Array, width: number, box: Box, include: Uint8Array): { colors: Uint8Array; size: number } {
  const counts = new Uint32Array(32768);
  const sums = new Float64Array(32768 * 3);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      if (!include[y * box.width + x]) continue;
      const i = ((box.y + y) * width + box.x + x) * 4;
      const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      counts[key] += 1;
      sums[key * 3] += rgba[i];
      sums[key * 3 + 1] += rgba[i + 1];
      sums[key * 3 + 2] += rgba[i + 2];
    }
  }
  const used: number[] = [];
  for (let k = 0; k < 32768; k++) if (counts[k] > 0) used.push(k);

  const boxes: ColorBox[] = [{ buckets: used, count: used.reduce((n, k) => n + counts[k], 0) }];
  while (boxes.length < MAX_COLORS) {
    // Split the most populated box that still holds more than one bucket.
    let target = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].buckets.length > 1 && (target < 0 || boxes[i].count > boxes[target].count)) target = i;
    }
    if (target < 0) break;
    boxes.splice(target, 1, ...splitBox(boxes[target], counts));
  }

  const colors = new Uint8Array(MAX_COLORS * 3);
  let size = 0;
  for (const cb of boxes) {
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const k of cb.buckets) {
      n += counts[k];
      r += sums[k * 3];
      g += sums[k * 3 + 1];
      b += sums[k * 3 + 2];
    }
    if (n === 0) continue;
    colors[size * 3] = Math.round(r / n);
    colors[size * 3 + 1] = Math.round(g / n);
    colors[size * 3 + 2] = Math.round(b / n);
    size += 1;
  }
  return { colors, size: Math.max(1, size) };
}

function channel(key: number, c: number): number {
  return (key >> (10 - c * 5)) & 31;
}

/** Splits a box at the weighted median of its widest channel. */
function splitBox(box: ColorBox, counts: Uint32Array): [ColorBox, ColorBox] {
  let widest = 0;
  let widestRange = -1;
  for (let c = 0; c < 3; c++) {
    let lo = 31;
    let hi = 0;
    for (const k of box.buckets) {
      const v = channel(k, c);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > widestRange) {
      widestRange = hi - lo;
      widest = c;
    }
  }
  const sorted = [...box.buckets].sort((a, b) => channel(a, widest) - channel(b, widest));
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    acc += counts[sorted[i]];
    cut = i + 1;
    if (acc * 2 >= box.count) break;
  }
  const left = sorted.slice(0, cut);
  const right = sorted.slice(cut);
  const sum = (ks: number[]) => ks.reduce((n, k) => n + counts[k], 0);
  return [
    { buckets: left, count: sum(left) },
    { buckets: right, count: sum(right) },
  ];
}

/** Nearest palette entry, cached per 6-bit-per-channel colour. */
class NearestColor {
  private cache = new Int16Array(1 << 18).fill(-1);

  constructor(
    private colors: Uint8Array,
    private size: number,
  ) {}

  find(r: number, g: number, b: number): number {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = this.cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.size; i++) {
      const dr = this.colors[i * 3] - r;
      const dg = this.colors[i * 3 + 1] - g;
      const db = this.colors[i * 3 + 2] - b;
      // Weighted for perceived brightness (green matters most, blue least).
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    this.cache[key] = best;
    return best;
  }
}

// ---- LZW -------------------------------------------------------------------------------------

const MAX_BITS = 12;
const TABLE_LIMIT = 1 << MAX_BITS;

/**
 * GIF-flavoured LZW in 255-byte sub-blocks. The code-size bookkeeping follows the classic
 * encoder (Jef Poskanzer's GIFEncoder, as used by gif.js): after writing a code, grow the code
 * size once the next free code no longer fits; reset it after a clear code.
 */
export function lzwEncode(indices: Uint8Array, out: ByteWriter): void {
  const clearCode = 1 << MIN_CODE_SIZE;
  const eofCode = clearCode + 1;
  const initBits = MIN_CODE_SIZE + 1;
  const blocks = new SubBlockWriter(out);

  let nBits = initBits;
  let maxCode = (1 << nBits) - 1;
  let freeEnt = clearCode + 2;
  let clearFlag = false;
  let table = new Map<number, number>();
  let acc = 0;
  let accBits = 0;

  const output = (code: number) => {
    acc |= code << accBits;
    accBits += nBits;
    while (accBits >= 8) {
      blocks.byte(acc & 0xff);
      acc >>>= 8;
      accBits -= 8;
    }
    if (freeEnt > maxCode || clearFlag) {
      if (clearFlag) {
        nBits = initBits;
        maxCode = (1 << nBits) - 1;
        clearFlag = false;
      } else {
        nBits += 1;
        maxCode = nBits === MAX_BITS ? TABLE_LIMIT : (1 << nBits) - 1;
      }
    }
  };

  output(clearCode);
  if (indices.length > 0) {
    let ent = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const c = indices[i];
      const key = (ent << 8) | c;
      const found = table.get(key);
      if (found !== undefined) {
        ent = found;
        continue;
      }
      output(ent);
      ent = c;
      if (freeEnt < TABLE_LIMIT) {
        table.set(key, freeEnt++);
      } else {
        table = new Map();
        freeEnt = clearCode + 2;
        clearFlag = true;
        output(clearCode);
      }
    }
    output(ent);
  }
  output(eofCode);
  if (accBits > 0) blocks.byte(acc & 0xff);
  blocks.finish();
}

class SubBlockWriter {
  private block = new Uint8Array(255);
  private length = 0;

  constructor(private out: ByteWriter) {}

  byte(b: number): void {
    this.block[this.length++] = b;
    if (this.length === 255) this.flush();
  }

  finish(): void {
    this.flush();
    this.out.byte(0);
  }

  private flush(): void {
    if (this.length === 0) return;
    this.out.byte(this.length);
    this.out.bytes(this.block.subarray(0, this.length));
    this.length = 0;
  }
}

/** Growable byte buffer. */
export class ByteWriter {
  private buffer = new Uint8Array(64 * 1024);
  private length = 0;

  byte(b: number): void {
    this.ensure(1);
    this.buffer[this.length++] = b;
  }

  bytes(data: ArrayLike<number>): void {
    this.ensure(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  u16(v: number): void {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }
}
