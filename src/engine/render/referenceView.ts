/**
 * Geometry and filters of the floating reference window (a viewing aid, never artwork).
 * Worklets: used both by React and on the UI thread inside gestures.
 */

export type ReferenceFilter = 'none' | 'grayscale' | 'values' | 'squint' | 'invert' | 'sepia' | 'contrast';

export const REFERENCE_FILTERS: readonly { id: ReferenceFilter; label: string; hint: string }[] = [
  { id: 'none', label: 'Original', hint: 'No filter' },
  { id: 'grayscale', label: 'Grayscale', hint: 'Colour removed' },
  { id: 'values', label: 'Values', hint: 'Grayscale with extra contrast, for checking light and shadow' },
  { id: 'squint', label: 'Squint', hint: 'Blurred grayscale: shows the big shapes, like squinting' },
  { id: 'invert', label: 'Invert', hint: 'Negative image' },
  { id: 'sepia', label: 'Sepia', hint: 'Warm monochrome' },
  { id: 'contrast', label: 'High contrast', hint: 'Stronger contrast in colour' },
];

const LUMA = [0.2126, 0.7152, 0.0722];

/** Contrast around mid-grey, as a 4x5 colour matrix (offsets in 0..1). */
function contrast(c: number): number[] {
  const t = (1 - c) / 2;
  return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0];
}

function grayscale(c = 1): number[] {
  const t = (1 - c) / 2;
  const [r, g, b] = LUMA.map((v) => v * c);
  return [r, g, b, 0, t, r, g, b, 0, t, r, g, b, 0, t, 0, 0, 0, 1, 0];
}

/** Colour matrix for a filter (null: no colour filter). */
export function filterMatrix(filter: ReferenceFilter): number[] | null {
  switch (filter) {
    case 'grayscale':
    case 'squint':
      return grayscale();
    case 'values':
      return grayscale(1.6);
    case 'invert':
      return [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0];
    case 'sepia':
      return [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0];
    case 'contrast':
      return contrast(1.6);
    default:
      return null;
  }
}

/** Blur radius (window points) for a filter; 0 for none. */
export function filterBlur(filter: ReferenceFilter): number {
  return filter === 'squint' ? 6 : 0;
}

/** Image width / height as displayed after `quarter` quarter-turns. */
export function displayedAspect(aspect: number, quarter: number): number {
  'worklet';
  return quarter % 2 === 1 ? 1 / aspect : aspect;
}

/** Scale at which the (rotated) image fits inside a W x H frame. */
export function fitScale(W: number, H: number, iw: number, ih: number, quarter: number): number {
  'worklet';
  const odd = quarter % 2 === 1;
  const w = odd ? ih : iw;
  const h = odd ? iw : ih;
  return Math.min(W / Math.max(1, w), H / Math.max(1, h));
}

export interface ReferenceViewState {
  /** Frame size, window points. */
  W: number;
  H: number;
  /** Image size, pixels. */
  iw: number;
  ih: number;
  /** Quarter turns clockwise (0..3). */
  quarter: number;
  flipX: boolean;
  flipY: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Transform drawing the image (at its pixel size, origin top-left) into the frame: centred,
 * fitted, then flipped, rotated, zoomed and panned. Listed outermost first.
 */
export function referenceTransform(v: ReferenceViewState) {
  'worklet';
  const s = fitScale(v.W, v.H, v.iw, v.ih, v.quarter) * v.zoom;
  return [
    { translateX: v.W / 2 + v.panX },
    { translateY: v.H / 2 + v.panY },
    { scale: s },
    { rotate: (v.quarter * Math.PI) / 2 },
    { scaleX: v.flipX ? -1 : 1 },
    { scaleY: v.flipY ? -1 : 1 },
    { translateX: -v.iw / 2 },
    { translateY: -v.ih / 2 },
  ];
}

/** Image pixel under a point of the frame (inverse of referenceTransform); may be outside. */
export function imagePointAt(v: ReferenceViewState, tx: number, ty: number): { x: number; y: number } {
  'worklet';
  const s = fitScale(v.W, v.H, v.iw, v.ih, v.quarter) * v.zoom;
  const dx = (tx - v.W / 2 - v.panX) / s;
  const dy = (ty - v.H / 2 - v.panY) / s;
  const a = (v.quarter * Math.PI) / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  return { x: rx * (v.flipX ? -1 : 1) + v.iw / 2, y: ry * (v.flipY ? -1 : 1) + v.ih / 2 };
}

/** Largest pan (each axis) that keeps a zoomed image covering the frame; 0 when it fits. */
export function maxPan(v: ReferenceViewState): { x: number; y: number } {
  'worklet';
  const s = fitScale(v.W, v.H, v.iw, v.ih, v.quarter) * v.zoom;
  const odd = v.quarter % 2 === 1;
  const dw = (odd ? v.ih : v.iw) * s;
  const dh = (odd ? v.iw : v.ih) * s;
  return { x: Math.max(0, (dw - v.W) / 2), y: Math.max(0, (dh - v.H) / 2) };
}
