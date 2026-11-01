/**
 * Minimal Adobe Photoshop (PSD, version 1) writer: 8-bit RGB with transparency, one record per
 * layer with its name, opacity, visibility, blend mode and clipping, optional layer masks, and
 * layer groups (section dividers). Channel data is RLE (PackBits) compressed. Pure, so it is
 * unit-tested; the export collects pixels from the document (see storage/psdExport).
 *
 * Reference: Adobe Photoshop File Formats Specification (Layer and Mask Information section).
 */

export interface PsdMask {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Grey levels (bottom − top) × (right − left): 255 shows, 0 hides. */
  data: Uint8Array;
  /** Value outside the rectangle. */
  defaultColor: 0 | 255;
}

export interface PsdLayer {
  name: string;
  /** Pixel rectangle in the canvas (may be empty: top === bottom). */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Un-premultiplied RGBA for the rectangle (width × height × 4). */
  rgba: Uint8Array;
  /** 0..255 */
  opacity: number;
  visible: boolean;
  /** Four-character blend key, e.g. 'norm', 'mul '. */
  blendKey: string;
  /** Clipped to the layer below. */
  clipping: boolean;
  mask?: PsdMask;
  /** Group markers: 'open'/'closed' folder (top of a group), 'divider' (bottom of a group). */
  section?: 'open' | 'closed' | 'divider';
}

/** Our blend modes → Photoshop blend keys. */
export const PSD_BLEND_KEYS: Record<string, string> = {
  srcOver: 'norm',
  multiply: 'mul ',
  screen: 'scrn',
  overlay: 'over',
  darken: 'dark',
  lighten: 'lite',
  colorDodge: 'div ',
  colorBurn: 'idiv',
  add: 'lddg',
  softLight: 'sLit',
  hardLight: 'hLit',
  difference: 'diff',
  exclusion: 'smud',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
};

/** Growable big-endian byte buffer. */
class Writer {
  private buf = new Uint8Array(1 << 16);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 255;
  }

  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }

  i16(v: number): void {
    this.u16(v < 0 ? v + 0x10000 : v);
  }

  u32(v: number): void {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }

  i32(v: number): void {
    this.u32(v < 0 ? v + 0x100000000 : v);
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  /** Overwrites a 32-bit length written earlier at `at`. */
  patch32(at: number, v: number): void {
    this.buf[at] = (v >>> 24) & 255;
    this.buf[at + 1] = (v >>> 16) & 255;
    this.buf[at + 2] = (v >>> 8) & 255;
    this.buf[at + 3] = v & 255;
  }

  pad(multiple: number, from = 0): void {
    while ((this.length - from) % multiple !== 0) this.u8(0);
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** PackBits-compresses one row. */
export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    // A run of identical bytes (2..128).
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run > 1) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    // Literal bytes until the next run of 2+ (or 128 bytes).
    const start = i;
    while (i < n && i - start < 128 && !(i + 1 < n && row[i] === row[i + 1])) i++;
    out.push(i - start - 1);
    for (let k = start; k < i; k++) out.push(row[k]);
  }
  return Uint8Array.from(out);
}

/** RLE channel data (row byte counts, then rows) for one channel of an interleaved buffer. */
function rleChannel(src: Uint8Array, width: number, height: number, stride: number, offset: number): { counts: number[]; rows: Uint8Array[] } {
  const counts: number[] = [];
  const rows: Uint8Array[] = [];
  const row = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = src[(y * width + x) * stride + offset];
    const packed = packBits(row);
    counts.push(packed.length);
    rows.push(packed);
  }
  return { counts, rows };
}

interface ChannelData {
  id: number;
  data: Uint8Array;
}

/** Compression + data for every channel of a layer, in PSD order (alpha, R, G, B, mask). */
function layerChannels(layer: PsdLayer): ChannelData[] {
  const width = layer.right - layer.left;
  const height = layer.bottom - layer.top;
  const encode = (src: Uint8Array, w: number, h: number, stride: number, offset: number): Uint8Array => {
    const out = new Writer();
    if (w <= 0 || h <= 0) {
      out.u16(0);
      return out.result();
    }
    out.u16(1);
    const { counts, rows } = rleChannel(src, w, h, stride, offset);
    for (const c of counts) out.u16(c);
    for (const r of rows) out.bytes(r);
    return out.result();
  };
  const channels: ChannelData[] = [
    { id: -1, data: encode(layer.rgba, width, height, 4, 3) },
    { id: 0, data: encode(layer.rgba, width, height, 4, 0) },
    { id: 1, data: encode(layer.rgba, width, height, 4, 1) },
    { id: 2, data: encode(layer.rgba, width, height, 4, 2) },
  ];
  if (layer.mask) {
    const m = layer.mask;
    channels.push({ id: -2, data: encode(m.data, m.right - m.left, m.bottom - m.top, 1, 0) });
  }
  return channels;
}

function writeUnicodeName(w: Writer, name: string): void {
  w.ascii('8BIM');
  w.ascii('luni');
  const lenAt = w.length;
  w.u32(0);
  const start = w.length;
  w.u32(name.length);
  for (let i = 0; i < name.length; i++) w.u16(name.charCodeAt(i));
  w.pad(4, start);
  w.patch32(lenAt, w.length - start);
}

/**
 * Builds the PSD file. `layers` are bottom → top; `composite` is the flattened image
 * (un-premultiplied RGBA, width × height × 4) that readers without layer support show.
 */
export function writePsd(width: number, height: number, layers: readonly PsdLayer[], composite: Uint8Array): Uint8Array {
  const w = new Writer();

  // ---- header ----
  w.ascii('8BPS');
  w.u16(1); // version
  for (let i = 0; i < 6; i++) w.u8(0);
  w.u16(4); // channels: RGB + alpha
  w.u32(height);
  w.u32(width);
  w.u16(8); // bits per channel
  w.u16(3); // RGB

  // ---- colour mode data, image resources ----
  w.u32(0);
  w.u32(0);

  // ---- layer and mask information ----
  const layerMaskAt = w.length;
  w.u32(0);
  const layerMaskStart = w.length;
  const layerInfoAt = w.length;
  w.u32(0);
  const layerInfoStart = w.length;
  // Negative count: the first alpha channel holds the merged image's transparency.
  w.i16(-layers.length);

  const allChannels = layers.map(layerChannels);
  layers.forEach((layer, index) => {
    const channels = allChannels[index];
    w.i32(layer.top);
    w.i32(layer.left);
    w.i32(layer.bottom);
    w.i32(layer.right);
    w.u16(channels.length);
    for (const c of channels) {
      w.i16(c.id);
      w.u32(c.data.length);
    }
    w.ascii('8BIM');
    w.ascii(layer.blendKey.padEnd(4, ' ').slice(0, 4));
    w.u8(Math.max(0, Math.min(255, Math.round(layer.opacity))));
    w.u8(layer.clipping ? 1 : 0);
    // Flags: bit 1 = hidden; bits 3+4 = "pixel data irrelevant" (group dividers).
    let flags = layer.visible ? 0 : 2;
    if (layer.section) flags |= 0x18;
    w.u8(flags);
    w.u8(0); // filler

    const extraAt = w.length;
    w.u32(0);
    const extraStart = w.length;
    // Layer mask data.
    if (layer.mask) {
      w.u32(20);
      w.i32(layer.mask.top);
      w.i32(layer.mask.left);
      w.i32(layer.mask.bottom);
      w.i32(layer.mask.right);
      w.u8(layer.mask.defaultColor);
      w.u8(0); // flags
      w.u16(0); // padding
    } else {
      w.u32(0);
    }
    w.u32(0); // blending ranges
    // Pascal name, padded to a multiple of 4 (including the length byte).
    const name = layer.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255);
    const nameStart = w.length;
    w.u8(name.length);
    w.ascii(name);
    w.pad(4, nameStart);
    writeUnicodeName(w, layer.name);
    if (layer.section) {
      w.ascii('8BIM');
      w.ascii('lsct');
      w.u32(12);
      w.u32(layer.section === 'open' ? 1 : layer.section === 'closed' ? 2 : 3);
      w.ascii('8BIM');
      w.ascii(layer.blendKey.padEnd(4, ' ').slice(0, 4));
    }
    w.patch32(extraAt, w.length - extraStart);
  });

  for (const channels of allChannels) for (const c of channels) w.bytes(c.data);
  w.pad(2, layerInfoStart);
  w.patch32(layerInfoAt, w.length - layerInfoStart);
  w.u32(0); // global layer mask info
  w.pad(4, layerMaskStart);
  w.patch32(layerMaskAt, w.length - layerMaskStart);

  // ---- merged image (RLE: all row counts first, then all rows; R, G, B, A) ----
  w.u16(1);
  const merged = [0, 1, 2, 3].map((offset) => rleChannel(composite, width, height, 4, offset));
  for (const m of merged) for (const c of m.counts) w.u16(c);
  for (const m of merged) for (const r of m.rows) w.bytes(r);
  return w.result();
}