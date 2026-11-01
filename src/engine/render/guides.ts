import { Skia, type SkPath } from '@shopify/react-native-skia';

export interface GuideOptions {
  grid: boolean;
  gridSize: number;
  thirds: boolean;
  center: boolean;
  /** Fractions of the height. */
  horizontal: readonly number[];
  /** Fractions of the width. */
  vertical: readonly number[];
}

/**
 * Builds all enabled guide lines as one path in canvas coordinates (drawn as a hairline
 * overlay; never rasterised into the artwork). Returns null when no guide is enabled.
 */
export function buildGuidesPath(width: number, height: number, options: GuideOptions): SkPath | null {
  const b = Skia.PathBuilder.Make();
  const vLine = (x: number) => b.moveTo(x, 0).lineTo(x, height);
  const hLine = (y: number) => b.moveTo(0, y).lineTo(width, y);

  if (options.grid && options.gridSize > 0) {
    // Cap the line count so a tiny grid on a huge canvas cannot stall rendering.
    const step = Math.max(options.gridSize, Math.max(width, height) / 256);
    for (let x = step; x < width; x += step) vLine(x);
    for (let y = step; y < height; y += step) hLine(y);
  }
  if (options.thirds) {
    vLine(width / 3);
    vLine((width * 2) / 3);
    hLine(height / 3);
    hLine((height * 2) / 3);
  }
  if (options.center) {
    vLine(width / 2);
    hLine(height / 2);
  }
  for (const f of options.vertical) vLine(f * width);
  for (const f of options.horizontal) hLine(f * height);
  return b.isEmpty() ? null : b.detach();
}

/** Rays drawn from each vanishing point. */
const PERSPECTIVE_RAYS = 36;

/**
 * Perspective guide: rays fanning out from each vanishing point, plus the horizon (through the
 * first point in 1-point perspective, through the first two otherwise). Canvas coordinates;
 * long enough to cross the canvas from vanishing points far outside it. Null when off.
 */
export function buildPerspectivePath(width: number, height: number, vps: readonly { x: number; y: number }[]): SkPath | null {
  'worklet';
  if (vps.length === 0) return null;
  const b = Skia.PathBuilder.Make();
  const span = Math.max(width, height);
  for (const vp of vps) {
    // Long enough to reach every canvas corner from wherever the point is.
    const reach = Math.hypot(Math.max(Math.abs(vp.x), Math.abs(vp.x - width)), Math.max(Math.abs(vp.y), Math.abs(vp.y - height))) + span;
    for (let i = 0; i < PERSPECTIVE_RAYS; i++) {
      const a = (i / PERSPECTIVE_RAYS) * Math.PI * 2;
      b.moveTo(vp.x, vp.y).lineTo(vp.x + Math.cos(a) * reach, vp.y + Math.sin(a) * reach);
    }
  }
  // Horizon line.
  const a = vps[0];
  const c = vps.length > 1 ? vps[1] : { x: a.x + 1, y: a.y };
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const far = span * 8;
  b.moveTo(a.x - (dx / len) * far, a.y - (dy / len) * far).lineTo(a.x + (dx / len) * far, a.y + (dy / len) * far);
  return b.detach();
}
