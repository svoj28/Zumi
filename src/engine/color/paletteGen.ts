import { hexToHsv, hsvToHex, rgbToHex } from '@/engine/color/colorMath';

/**
 * Palette generation: colour harmonies from one colour, and the main colours of an image.
 * Pure functions (no Skia), so they are cheap to test.
 */

export type HarmonyKind = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic' | 'shades';

export const HARMONIES: readonly { id: HarmonyKind; label: string }[] = [
  { id: 'complementary', label: 'Complementary' },
  { id: 'analogous', label: 'Analogous' },
  { id: 'triadic', label: 'Triadic' },
  { id: 'split', label: 'Split complementary' },
  { id: 'tetradic', label: 'Tetradic' },
  { id: 'shades', label: 'Shades & tints' },
];

const wrap = (h: number) => ((h % 360) + 360) % 360;

/**
 * Colours that go with `base` (hex). The base colour comes first; each hue gets a lighter and a
 * darker companion so the palette is usable for shading straight away.
 */
export function harmony(base: string, kind: HarmonyKind): string[] {
  const hsv = hexToHsv(base);
  const hue = (h: number, s = hsv.s, v = hsv.v) => hsvToHex({ h: wrap(h), s: Math.min(1, Math.max(0, s)), v: Math.min(1, Math.max(0, v)) });
  if (kind === 'shades') {
    // From deep shadow to light tint of the same hue.
    return dedupe(
      [0.25, 0.45, 0.65, 0.85, 1]
        .map((v) => hue(hsv.h, hsv.s, hsv.v * v))
        .concat([hue(hsv.h, hsv.s * 0.6, Math.min(1, hsv.v + 0.15)), hue(hsv.h, hsv.s * 0.3, Math.min(1, hsv.v + 0.3))]),
    );
  }
  const offsets: Record<Exclude<HarmonyKind, 'shades'>, number[]> = {
    complementary: [0, 180],
    analogous: [0, -30, 30],
    triadic: [0, 120, 240],
    split: [0, 150, 210],
    tetradic: [0, 90, 180, 270],
  };
  const out: string[] = [];
  for (const o of offsets[kind]) out.push(hue(hsv.h + o));
  // A lighter and a darker variant of each hue, after the main ones.
  for (const o of offsets[kind]) out.push(hue(hsv.h + o, hsv.s * 0.55, Math.min(1, hsv.v * 0.6 + 0.4)));
  for (const o of offsets[kind]) out.push(hue(hsv.h + o, Math.min(1, hsv.s * 1.1), hsv.v * 0.55));
  return dedupe(out);
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((c) => c.toLowerCase()))];
}

/**
 * Main colours of an image by median cut: the pixel set is split along its widest channel until
 * there are `count` boxes, and each box's average is a palette colour. Transparent pixels are
 * ignored. `rgba` is 8-bit RGBA, unpremultiplied. Sorted dark to light.
 */
export function extractPalette(rgba: Uint8Array | number[], count: number): string[] {
  const pixels: number[][] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (pixels.length === 0) return [];

  let boxes: number[][][] = [pixels];
  while (boxes.length < count) {
    // Split the box with the widest colour range, weighted by how many pixels it holds.
    let best = -1;
    let bestScore = -1;
    let bestChannel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of box) {
          if (p[c] < lo) lo = p[c];
          if (p[c] > hi) hi = p[c];
        }
        const score = (hi - lo) * Math.log2(box.length + 1);
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestChannel = c;
        }
      }
    });
    if (best < 0 || bestScore <= 0) break;
    const box = boxes[best].sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = box.length >> 1;
    boxes = [...boxes.slice(0, best), box.slice(0, mid), box.slice(mid), ...boxes.slice(best + 1)];
  }

  const colors = boxes
    .filter((box) => box.length > 0)
    .map((box) => {
      const sum = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return { r: sum[0] / box.length, g: sum[1] / box.length, b: sum[2] / box.length };
    })
    .sort((a, b) => luma(a) - luma(b))
    .map((c) => rgbToHex({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }));
  return dedupe(colors);
}

function luma(c: { r: number; g: number; b: number }): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
