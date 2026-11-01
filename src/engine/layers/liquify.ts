/**
 * Liquify: the layer is drawn on a grid mesh whose vertices the brush pushes around (push,
 * twirl, pinch, expand, restore). Vertex positions and texture coordinates are flat
 * [x, y, x, y, ...] arrays in canvas pixels; the texture coordinates never change. Worklets
 * (the brush runs on the UI thread) and pure (unit-tested).
 */

export type LiquifyMode = 'push' | 'twirlRight' | 'twirlLeft' | 'pinch' | 'expand' | 'restore';

/** Cells per side; (GRID + 1)² vertices. Fine enough for smooth pushes, cheap enough per event. */
export const LIQUIFY_GRID = 40;

/** Undeformed mesh: positions equal the texture coordinates. */
export function createLiquifyMesh(width: number, height: number, grid = LIQUIFY_GRID): number[] {
  'worklet';
  const out: number[] = [];
  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) out.push((i / grid) * width, (j / grid) * height);
  }
  return out;
}

/** Triangle indices for the mesh (two triangles per cell). */
export function liquifyIndices(grid = LIQUIFY_GRID): number[] {
  const out: number[] = [];
  const row = grid + 1;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * row + i;
      out.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return out;
}

/**
 * One brush step at (cx, cy) moving by (dx, dy), radius and strength (0..1), on a copy of
 * `positions`. Falloff is smooth ((1 − d²/r²)²), so edges of the brush never tear the mesh.
 */
export function liquifyStep(
  positions: readonly number[],
  textures: readonly number[],
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  radius: number,
  strength: number,
  mode: LiquifyMode,
): number[] {
  'worklet';
  const out = positions.slice();
  const r2 = radius * radius;
  for (let i = 0; i < out.length; i += 2) {
    const x = out[i];
    const y = out[i + 1];
    const ox = x - cx;
    const oy = y - cy;
    const d2 = ox * ox + oy * oy;
    if (d2 >= r2) continue;
    const f = 1 - d2 / r2;
    const w = f * f * strength;
    switch (mode) {
      case 'push':
        out[i] = x + dx * w;
        out[i + 1] = y + dy * w;
        break;
      case 'twirlRight':
      case 'twirlLeft': {
        const a = (mode === 'twirlRight' ? 1 : -1) * 0.12 * w;
        const c = Math.cos(a);
        const s = Math.sin(a);
        out[i] = cx + ox * c - oy * s;
        out[i + 1] = cy + ox * s + oy * c;
        break;
      }
      case 'pinch':
      case 'expand': {
        const k = (mode === 'expand' ? 1 : -1) * 0.06 * w;
        out[i] = x + ox * k;
        out[i + 1] = y + oy * k;
        break;
      }
      case 'restore':
        out[i] = x + (textures[i] - x) * 0.2 * w;
        out[i + 1] = y + (textures[i + 1] - y) * 0.2 * w;
        break;
    }
  }
  return out;
}

/** True when the mesh has been deformed (anything to apply). */
export function isDeformed(positions: readonly number[], textures: readonly number[]): boolean {
  'worklet';
  for (let i = 0; i < positions.length; i++) if (Math.abs(positions[i] - textures[i]) > 0.01) return true;
  return false;
}

/** Flat [x, y, …] → points. */
export function toPoints(flat: readonly number[]): { x: number; y: number }[] {
  'worklet';
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}