import { Skia, type SkPath } from '@shopify/react-native-skia';

/**
 * Drawing rulers ("drawing assist"): strokes snap to a straight edge, run parallel to it,
 * follow concentric ellipses, or radiate from a centre (manga focus/speed lines). The ruler is
 * defined by two points in canvas pixels: A (start / centre) and B (end / ellipse corner).
 * Worklets: snapping runs on the UI thread while drawing.
 */

export type RulerKind = 'off' | 'line' | 'parallel' | 'ellipse' | 'radial';

export interface RulerGeometry {
  kind: RulerKind;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface Pt {
  x: number;
  y: number;
}

function project(origin: Pt, dir: Pt, p: Pt): Pt {
  'worklet';
  const len2 = dir.x * dir.x + dir.y * dir.y;
  if (len2 < 1e-9) return origin;
  const t = ((p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y) / len2;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
}

/** Distance from p to the infinite line through A and B. */
export function distanceToLine(r: RulerGeometry, p: Pt): number {
  'worklet';
  const dx = r.bx - r.ax;
  const dy = r.by - r.ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Math.hypot(p.x - r.ax, p.y - r.ay);
  return Math.abs((p.x - r.ax) * dy - (p.y - r.ay) * dx) / len;
}

/**
 * Where a stroke point lands with the ruler on. `origin` is where the stroke started; `reach`
 * is how near (canvas px) a stroke must start to the line ruler to snap to it.
 */
export function rulerSnap(r: RulerGeometry, origin: Pt, p: Pt, reach: number): Pt {
  'worklet';
  switch (r.kind) {
    case 'line':
      // Only strokes starting near the ruler follow it; others stay free.
      return distanceToLine(r, origin) <= reach ? project({ x: r.ax, y: r.ay }, { x: r.bx - r.ax, y: r.by - r.ay }, p) : p;
    case 'parallel':
      return project(origin, { x: r.bx - r.ax, y: r.by - r.ay }, p);
    case 'radial':
      return project(origin, { x: origin.x - r.ax, y: origin.y - r.ay }, p);
    case 'ellipse': {
      const rx = Math.max(1, Math.abs(r.bx - r.ax));
      const ry = Math.max(1, Math.abs(r.by - r.ay));
      // The concentric ellipse through the stroke's start.
      const k = Math.hypot((origin.x - r.ax) / rx, (origin.y - r.ay) / ry);
      if (k < 1e-4) return origin;
      const a = Math.atan2((p.y - r.ay) / ry, (p.x - r.ax) / rx);
      return { x: r.ax + Math.cos(a) * rx * k, y: r.ay + Math.sin(a) * ry * k };
    }
    default:
      return p;
  }
}

/** Guide lines showing the ruler (canvas coordinates). */
export function rulerPath(r: RulerGeometry, width: number, height: number): SkPath {
  'worklet';
  const b = Skia.PathBuilder.Make();
  const span = Math.max(width, height) * 4;
  if (r.kind === 'line' || r.kind === 'parallel') {
    const dx = r.bx - r.ax;
    const dy = r.by - r.ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    b.moveTo(r.ax - ux * span, r.ay - uy * span).lineTo(r.ax + ux * span, r.ay + uy * span);
    if (r.kind === 'parallel') {
      // A few faint companions so the direction reads as "parallel".
      const nx = -uy;
      const ny = ux;
      const gap = Math.max(width, height) / 8;
      for (const k of [-2, -1, 1, 2]) {
        b.moveTo(r.ax + nx * gap * k - ux * span, r.ay + ny * gap * k - uy * span);
        b.lineTo(r.ax + nx * gap * k + ux * span, r.ay + ny * gap * k + uy * span);
      }
    }
  } else if (r.kind === 'radial') {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      b.moveTo(r.ax, r.ay).lineTo(r.ax + Math.cos(a) * span, r.ay + Math.sin(a) * span);
    }
  } else if (r.kind === 'ellipse') {
    const rx = Math.max(1, Math.abs(r.bx - r.ax));
    const ry = Math.max(1, Math.abs(r.by - r.ay));
    for (const k of [0.5, 1, 1.5]) b.addOval(Skia.XYWHRect(r.ax - rx * k, r.ay - ry * k, rx * 2 * k, ry * 2 * k));
  }
  return b.build();
}

/** Draggable handles of a ruler: A always, B except for radial rulers. */
export function rulerHandles(r: RulerGeometry): Pt[] {
  'worklet';
  if (r.kind === 'off') return [];
  return r.kind === 'radial' ? [{ x: r.ax, y: r.ay }] : [{ x: r.ax, y: r.ay }, { x: r.bx, y: r.by }];
}