/**
 * Pure pixel algorithms on RGBA byte arrays (premultiplied, row-major, 4 bytes per pixel) and on
 * single-channel masks (one byte per pixel, 0 or 255). No Skia here, so they are unit-testable;
 * the document reads pixels with `SkImage.readPixels` and turns masks back into images or paths.
 */

export interface MaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Region-growing fill from (x, y): every pixel whose colour is within `tolerance` (0..1, the
 * largest per-channel difference including alpha) of the seed pixel. Contiguous fills grow
 * through 4-connected neighbours (scanline algorithm); non-contiguous fills take every matching
 * pixel in the image. Returns a mask (255 = filled), or null when (x, y) is outside.
 */
export function floodFillMask(
  rgba: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
  contiguous = true,
): Uint8Array | null {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const mask = new Uint8Array(width * height);
  const seed = (sy * width + sx) * 4;
  const r0 = rgba[seed];
  const g0 = rgba[seed + 1];
  const b0 = rgba[seed + 2];
  const a0 = rgba[seed + 3];
  const limit = Math.round(Math.min(1, Math.max(0, tolerance)) * 255);
  const matches = (i: number) => {
    const p = i * 4;
    return (
      Math.abs(rgba[p] - r0) <= limit &&
      Math.abs(rgba[p + 1] - g0) <= limit &&
      Math.abs(rgba[p + 2] - b0) <= limit &&
      Math.abs(rgba[p + 3] - a0) <= limit
    );
  };

  if (!contiguous) {
    for (let i = 0; i < width * height; i++) if (matches(i)) mask[i] = 255;
    return mask;
  }

  // Scanline fill: fill a whole horizontal run, then queue the runs above and below it.
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    const row = cy * width;
    if (mask[row + cx] || !matches(row + cx)) continue;
    let left = cx;
    while (left > 0 && !mask[row + left - 1] && matches(row + left - 1)) left--;
    let right = cx;
    while (right < width - 1 && !mask[row + right + 1] && matches(row + right + 1)) right++;
    for (let i = left; i <= right; i++) mask[row + i] = 255;
    for (const ny of [cy - 1, cy + 1]) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let inRun = false;
      for (let i = left; i <= right; i++) {
        const open = !mask[nrow + i] && matches(nrow + i);
        // Queue one seed per run of candidates, not one per pixel.
        if (open && !inRun) stack.push(i, ny);
        inRun = open;
      }
    }
  }
  return mask;
}

/** Mask of pixels whose alpha is above `threshold` (0..255), e.g. "select layer content". */
export function alphaMask(rgba: Uint8Array, width: number, height: number, threshold = 0): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) if (rgba[i * 4 + 3] > threshold) mask[i] = 255;
  return mask;
}

/**
 * Grows (radius > 0) or shrinks (radius < 0) a mask by a square of |radius| pixels: a separable
 * max (or min) filter. Each pass uses a sliding window, so it is O(width × height) instead of
 * scanning the radius around every pixel. Used to push bucket fills under anti-aliased
 * line art so no light fringe is left.
 */
export function growMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.round(Math.abs(radius));
  if (r === 0) return mask;
  const grow = radius > 0;
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let o = 0; o < outer; o++) {
      const deque = new Int32Array(inner);
      let head = 0;
      let tail = 0;
      const push = (index: number) => {
        while (tail > head) {
          const last = deque[tail - 1];
          const lastValue = horizontal ? src[o * width + last] : src[last * width + o];
          const nextValue = horizontal ? src[o * width + index] : src[index * width + o];
          if (grow ? lastValue >= nextValue : lastValue <= nextValue) break;
          tail--;
        }
        deque[tail++] = index;
      };
      for (let k = 0; k <= Math.min(r, inner - 1); k++) push(k);
      for (let i = 0; i < inner; i++) {
        const add = i + r;
        if (i > 0 && add < inner) push(add);

        const removeBefore = i - r;
        while (tail > head && deque[head] < removeBefore) head++;
        let v = tail > head
          ? (horizontal ? src[o * width + deque[head]] : src[deque[head] * width + o])
          : (grow ? 0 : 255);
        // Shrinking treats the image border as outside, so edges shrink inward too.
        if (!grow && (i - r < 0 || i + r > inner - 1)) v = 0;
        out[horizontal ? o * width + i : i * width + o] = v;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** Bounds of the set pixels, or null for an empty mask. */
export function maskBounds(mask: Uint8Array, width: number, height: number): MaskRect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Covers the set pixels with non-overlapping rectangles: horizontal runs, merged downwards while
 * the next row has the identical run. Good for turning a mask into a selection path.
 */
export function maskToRects(mask: Uint8Array, width: number, height: number): MaskRect[] {
  const rects: MaskRect[] = [];
  // Open rectangles by "start,end" of their run on the previous row.
  let open = new Map<string, MaskRect>();
  for (let y = 0; y < height; y++) {
    const next = new Map<string, MaskRect>();
    const row = y * width;
    let x = 0;
    while (x < width) {
      if (!mask[row + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && mask[row + x]) x++;
      const key = `${start},${x}`;
      const prev = open.get(key);
      if (prev) {
        prev.height += 1;
        next.set(key, prev);
        open.delete(key);
      } else {
        const r = { x: start, y, width: x - start, height: 1 };
        rects.push(r);
        next.set(key, r);
      }
    }
    open = next;
  }
  return rects;
}

/** Number of set pixels. */
export function maskArea(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}
