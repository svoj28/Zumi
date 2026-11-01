/**
 * Manga / manhwa / comic page formats and panel layouts. Pure (no Skia): layouts produce panel
 * outlines in canvas pixels, which the renderer strokes onto a "Panels" layer.
 */

export interface Point {
  x: number;
  y: number;
}

/** A panel outline: top-left, top-right, bottom-right, bottom-left (convex). */
export type Quad = [Point, Point, Point, Point];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ComicKind = 'manga' | 'comic' | 'webtoon' | 'strip';

export interface PageFormat {
  id: string;
  label: string;
  detail: string;
  kind: ComicKind;
  /** Canvas size in pixels (trim plus bleed on every side). */
  width: number;
  height: number;
  dpi: number;
  /** Bleed beyond the trim line, pixels (0 for screen formats). */
  bleed: number;
  /** Safe-area inset inside the trim line, pixels; panels are laid out inside it. */
  safe: number;
  /** Panel layout chosen by default for this format. */
  defaultLayout: string;
}

const mm = (v: number, dpi: number) => Math.round((v / 25.4) * dpi);
const inch = (v: number, dpi: number) => Math.round(v * dpi);

function printFormat(
  id: string,
  label: string,
  detail: string,
  kind: ComicKind,
  trimW: number,
  trimH: number,
  bleed: number,
  safe: number,
  dpi: number,
  toPx: (v: number, dpi: number) => number,
  defaultLayout: string,
): PageFormat {
  const b = toPx(bleed, dpi);
  return { id, label, detail, kind, width: toPx(trimW, dpi) + 2 * b, height: toPx(trimH, dpi) + 2 * b, dpi, bleed: b, safe: toPx(safe, dpi), defaultLayout };
}

export const PAGE_FORMATS: readonly PageFormat[] = [
  printFormat('manga-b5', 'Manga (B5)', '182 × 257 mm · 350 dpi', 'manga', 182, 257, 3, 15, 350, mm, 'manga-dynamic'),
  printFormat('manga-a4', 'Manga / comic (A4)', '210 × 297 mm · 300 dpi', 'manga', 210, 297, 3, 15, 300, mm, 'manga-dynamic'),
  printFormat('us-comic', 'US comic', '6.625 × 10.25 in · 300 dpi', 'comic', 6.625, 10.25, 0.125, 0.3125, 300, inch, 'western-classic'),
  { id: 'yonkoma', label: '4-koma strip', detail: '1000 × 3800 px', kind: 'strip', width: 1000, height: 3800, dpi: 300, bleed: 0, safe: 60, defaultLayout: 'four-koma' },
  { id: 'newspaper', label: 'Newspaper strip', detail: '3600 × 1200 px', kind: 'strip', width: 3600, height: 1200, dpi: 300, bleed: 0, safe: 60, defaultLayout: 'strip-3' },
  { id: 'webtoon', label: 'Webtoon / manhwa', detail: '800 × 8000 px', kind: 'webtoon', width: 800, height: 8000, dpi: 72, bleed: 0, safe: 40, defaultLayout: 'webtoon' },
  { id: 'webtoon-hd', label: 'Webtoon HD', detail: '1600 × 8000 px', kind: 'webtoon', width: 1600, height: 8000, dpi: 144, bleed: 0, safe: 80, defaultLayout: 'webtoon' },
];

/** Unit-space panel outlines (0..1 across the panel area), before gutters. */
type UnitPanel = [number, number][];

const rect = (x0: number, y0: number, x1: number, y1: number): UnitPanel => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Rows of equal-width columns: each argument is a row's column count (row heights equal). */
function rows(...cols: number[]): UnitPanel[] {
  const out: UnitPanel[] = [];
  cols.forEach((n, r) => {
    for (let c = 0; c < n; c++) out.push(rect(c / n, r / cols.length, (c + 1) / n, (r + 1) / cols.length));
  });
  return out;
}

export interface PanelLayout {
  id: string;
  label: string;
  /** Which kinds of page it suits (shown first in the picker). */
  kinds: readonly ComicKind[];
  panels: readonly UnitPanel[];
}

export const PANEL_LAYOUTS: readonly PanelLayout[] = [
  { id: 'none', label: 'No panels', kinds: ['manga', 'comic', 'webtoon', 'strip'], panels: [] },
  { id: 'splash', label: 'Splash page', kinds: ['manga', 'comic'], panels: [rect(0, 0, 1, 1)] },
  {
    id: 'manga-dynamic',
    label: 'Manga (dynamic)',
    kinds: ['manga'],
    panels: [
      [[0, 0], [0.6, 0], [0.55, 0.33], [0, 0.33]],
      [[0.6, 0], [1, 0], [1, 0.33], [0.55, 0.33]],
      [[0, 0.33], [1, 0.33], [1, 0.7], [0, 0.76]],
      [[0, 0.76], [0.42, 0.7348], [0.36, 1], [0, 1]],
      [[0.42, 0.7348], [1, 0.7], [1, 1], [0.36, 1]],
    ],
  },
  {
    id: 'manga-action',
    label: 'Manga (action)',
    kinds: ['manga', 'comic'],
    panels: [rect(0, 0, 1, 0.22), [[0, 0.22], [1, 0.22], [1, 0.5], [0, 0.72]], [[0, 0.72], [1, 0.5], [1, 1], [0, 1]]],
  },
  { id: 'two-tier', label: 'Two tiers', kinds: ['manga', 'comic'], panels: rows(1, 1) },
  { id: 'three-tier', label: 'Three tiers', kinds: ['manga', 'comic'], panels: rows(1, 1, 1) },
  { id: 'western-classic', label: 'Classic comic', kinds: ['comic', 'manga'], panels: rows(2, 1, 3) },
  { id: 'grid-6', label: 'Six-panel grid', kinds: ['comic', 'manga'], panels: rows(2, 2, 2) },
  { id: 'grid-9', label: 'Nine-panel grid', kinds: ['comic'], panels: rows(3, 3, 3) },
  { id: 'four-koma', label: '4-koma', kinds: ['strip', 'manga'], panels: rows(1, 1, 1, 1) },
  { id: 'strip-3', label: 'Strip (3 panels)', kinds: ['strip'], panels: [rect(0, 0, 1 / 3, 1), rect(1 / 3, 0, 2 / 3, 1), rect(2 / 3, 0, 1, 1)] },
  { id: 'strip-4', label: 'Strip (4 panels)', kinds: ['strip'], panels: [0, 1, 2, 3].map((i) => rect(i / 4, 0, (i + 1) / 4, 1)) },
  {
    id: 'webtoon',
    label: 'Webtoon scroll',
    kinds: ['webtoon'],
    panels: [rect(0, 0.02, 1, 0.16), rect(0, 0.22, 1, 0.3), rect(0, 0.38, 1, 0.58), rect(0, 0.66, 1, 0.74), rect(0, 0.8, 1, 0.97)],
  },
];

/** Gutter between panels, as a share of the panel area's shorter side. */
export const GUTTER_SHARE = 0.025;

/** The area panels are laid out in: the canvas inset by bleed and safe margin. */
export function panelArea(width: number, height: number, bleed: number, safe: number): Rect {
  const inset = bleed + safe;
  return { x: inset, y: inset, width: Math.max(1, width - 2 * inset), height: Math.max(1, height - 2 * inset) };
}

const onBorder = (v: number) => v < 1e-6 || v > 1 - 1e-6;

/**
 * Panel outlines in pixels: unit panels fitted to `area`, with every edge shared with another
 * panel moved inward by half the gutter (edges on the area border stay put, so outer panels
 * reach the area edge exactly).
 */
export function layoutPanels(layout: PanelLayout, area: Rect, gutter: number): Quad[] {
  return layout.panels.map((unit) => {
    const pts = unit.map(([u, v]) => ({ x: area.x + u * area.width, y: area.y + v * area.height }));
    // Each edge's inward offset: none along the area border.
    const offsets = unit.map(([u0, v0], i) => {
      const [u1, v1] = unit[(i + 1) % unit.length];
      const border = (onBorder(u0) && u0 === u1) || (onBorder(v0) && v0 === v1);
      return border ? 0 : gutter / 2;
    });
    return insetPolygon(pts, offsets) as Quad;
  });
}

/** Moves each edge of a convex, clockwise (on screen) polygon inward by its own distance. */
export function insetPolygon(pts: Point[], offsets: number[]): Point[] {
  const n = pts.length;
  // Offset lines: point + direction.
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Inward normal for clockwise screen order (y down) is (-dy, dx)/len.
    const nx = -dy / len;
    const ny = dx / len;
    return { x: a.x + nx * offsets[i], y: a.y + ny * offsets[i], dx, dy };
  });
  return pts.map((p, i) => {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(det) < 1e-9) return { x: l2.x, y: l2.y };
    const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / det;
    return { x: l1.x + l1.dx * t, y: l1.y + l1.dy * t };
  });
}

/** Panel border width for a page: thin on screen formats, ~0.5 mm on print pages. */
export function defaultBorderWidth(format: Pick<PageFormat, 'dpi' | 'width' | 'kind'>): number {
  if (format.kind === 'webtoon') return Math.max(3, Math.round(format.width / 200));
  return Math.max(3, Math.round((0.5 / 25.4) * format.dpi));
}

export function findLayout(id: string): PanelLayout | undefined {
  return PANEL_LAYOUTS.find((l) => l.id === id);
}
