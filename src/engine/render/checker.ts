import { FilterMode, MipmapMode, Skia, TileMode, type SkCanvas, type SkImage } from '@shopify/react-native-skia';

/** Transparency checkerboard shared by the canvas view, thumbnails and layer previews. */

const CELL = 8;
const LIGHT = '#ffffff';
const DARK = '#d6d6dc';

let cached: SkImage | null = null;

/** A 2×2-cell tile (16×16 px) meant to be repeated. */
export function getCheckerTile(): SkImage {
  if (cached) return cached;
  const surface = Skia.Surface.Make(CELL * 2, CELL * 2);
  if (!surface) throw new Error('Unable to allocate checkerboard tile');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color(LIGHT));
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(DARK));
  canvas.drawRect(Skia.XYWHRect(CELL, 0, CELL, CELL), paint);
  canvas.drawRect(Skia.XYWHRect(0, CELL, CELL, CELL), paint);
  cached = surface.makeImageSnapshot();
  return cached;
}

/** Cell size (canvas px) that gives roughly 48 cells across the longest side. */
export function checkerCellFor(width: number, height: number): number {
  return Math.max(CELL, Math.round(Math.max(width, height) / 48));
}

export function drawChecker(canvas: SkCanvas, width: number, height: number, cell: number): void {
  const tile = getCheckerTile();
  const s = cell / CELL;
  const shader = tile.makeShaderOptions(
    TileMode.Repeat,
    TileMode.Repeat,
    FilterMode.Nearest,
    MipmapMode.None,
    Skia.Matrix().scale(s, s),
  );
  const paint = Skia.Paint();
  paint.setShader(shader);
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paint);
}

export function isTransparentColor(color: string): boolean {
  if (color.trim().toLowerCase() === 'transparent') return true;
  return Skia.Color(color)[3] === 0;
}
