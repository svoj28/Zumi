import { PaintStyle, PathOp, Skia, StrokeCap, StrokeJoin, type SkCanvas, type SkPath } from '@shopify/react-native-skia';

import type { FigureGeometry, JointName, P2, Prim } from '@/engine/figure/mannequin';

export interface FigureStyle {
  /** Draw the shaded body volumes. */
  body: boolean;
  /** Body fill opacity (lower for a faint sketch base). */
  bodyOpacity: number;
  construction: boolean;
  centerLine: boolean;
  proportions: boolean;
  actionLine: boolean;
  joints: boolean;
  selected: JointName | null;
  /** Multiplies line widths and dot sizes (1 = window size). */
  lineScale: number;
}

const BODY_RGB = [216, 210, 200];
const OUTLINE = 'rgba(55,55,62,0.9)';
const COLORS = {
  construction: 'rgba(25,130,196,0.9)',
  center: 'rgba(230,57,70,0.95)',
  tilt: 'rgba(42,157,143,0.95)',
  ruler: 'rgba(106,76,147,0.95)',
  action: 'rgba(255,138,76,0.95)',
};

function strokePaint(color: string, width: number, dash?: number) {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  p.setColor(Skia.Color(color));
  if (dash) p.setPathEffect(Skia.PathEffect.MakeDash([dash, dash], 0));
  return p;
}

function fillPaint(rgb: number[], shade: number, alpha: number) {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const [r, g, b] = rgb.map((c) => Math.round(Math.min(255, c * shade)));
  p.setColor(Skia.Color(`rgba(${r},${g},${b},${alpha})`));
  return p;
}

function polyline(pts: readonly P2[], close = false): SkPath {
  const b = Skia.PathBuilder.Make();
  pts.forEach((p, i) => (i === 0 ? b.moveTo(p.x, p.y) : b.lineTo(p.x, p.y)));
  if (close) b.close();
  return b.build();
}

/** Outline of a tapered capsule: two end circles joined by straight sides. */
function capsulePath(a: P2, b: P2, ra: number, rb: number): SkPath {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const start = Skia.PathBuilder.Make().addCircle(a.x, a.y, ra).build();
  const end = Skia.PathBuilder.Make().addCircle(b.x, b.y, rb).build();
  let shape = Skia.Path.MakeFromOp(start, end, PathOp.Union) ?? start;
  if (len > 1e-3) {
    const nx = -dy / len;
    const ny = dx / len;
    const side = polyline(
      [
        { x: a.x + nx * ra, y: a.y + ny * ra },
        { x: b.x + nx * rb, y: b.y + ny * rb },
        { x: b.x - nx * rb, y: b.y - ny * rb },
        { x: a.x - nx * ra, y: a.y - ny * ra },
      ],
      true,
    );
    shape = Skia.Path.MakeFromOp(shape, side, PathOp.Union) ?? shape;
  }
  return shape;
}

function drawPrim(canvas: SkCanvas, prim: Prim, alpha: number, outline: ReturnType<typeof strokePaint>) {
  if (prim.kind === 'sphere') {
    canvas.drawCircle(prim.c.x, prim.c.y, prim.r, fillPaint(BODY_RGB, 1, alpha));
    canvas.drawCircle(prim.c.x, prim.c.y, prim.r, outline);
  } else if (prim.kind === 'capsule') {
    const path = capsulePath(prim.a, prim.b, prim.ra, prim.rb);
    canvas.drawPath(path, fillPaint(BODY_RGB, 0.94, alpha));
    canvas.drawPath(path, outline);
  } else {
    for (const face of prim.faces) {
      const path = polyline(face.pts, true);
      canvas.drawPath(path, fillPaint(BODY_RGB, face.shade, alpha));
      canvas.drawPath(path, outline);
    }
  }
}

/**
 * Draws the mannequin and its construction guides in screen space: shaded volumes back to front,
 * then the guidelines on top (construction boxes, centre line and head cross, shoulder/hip tilt,
 * head-unit ruler, action line, joints).
 */
export function drawFigure(canvas: SkCanvas, geo: FigureGeometry, style: FigureStyle): void {
  const k = style.lineScale;
  const g = geo.guides;
  if (style.body) {
    const outline = strokePaint(OUTLINE, 1.1 * k);
    for (const prim of geo.prims) drawPrim(canvas, prim, style.bodyOpacity, outline);
  }

  if (style.construction) {
    const p = strokePaint(COLORS.construction, 1.2 * k);
    for (const [a, b] of g.boxes) canvas.drawLine(a.x, a.y, b.x, b.y, p);
    const tilt = strokePaint(COLORS.tilt, 1.5 * k);
    canvas.drawLine(g.shoulderLine[0].x, g.shoulderLine[0].y, g.shoulderLine[1].x, g.shoulderLine[1].y, tilt);
    canvas.drawLine(g.hipLine[0].x, g.hipLine[0].y, g.hipLine[1].x, g.hipLine[1].y, tilt);
  }
  if (style.centerLine) {
    const front = strokePaint(COLORS.center, 1.6 * k);
    canvas.drawPath(polyline(g.centerLine), front);
    for (const run of g.headFront) canvas.drawPath(polyline(run), front);
    const back = strokePaint('rgba(230,57,70,0.35)', 1.2 * k, 3 * k);
    for (const run of g.headBack) canvas.drawPath(polyline(run), back);
  }
  if (style.proportions) {
    // Alternate head units shaded, so they can be counted at a glance.
    const band = Skia.Paint();
    band.setColor(Skia.Color('rgba(106,76,147,0.18)'));
    for (let i = 0; i + 1 < g.ruler.ticks.length; i += 2) {
      const [a0, a1] = g.ruler.ticks[i];
      const [b0, b1] = g.ruler.ticks[i + 1];
      canvas.drawPath(polyline([a0, a1, b1, b0], true), band);
    }
    canvas.drawLine(g.ruler.axis[0].x, g.ruler.axis[0].y, g.ruler.axis[1].x, g.ruler.axis[1].y, strokePaint(COLORS.ruler, 1.4 * k));
    const tick = strokePaint(COLORS.ruler, 2 * k);
    for (const [a, b] of g.ruler.ticks) canvas.drawLine(a.x, a.y, b.x, b.y, tick);
  }
  if (style.actionLine) canvas.drawPath(polyline(g.actionLine), strokePaint(COLORS.action, 2.4 * k));
  if (style.joints) {
    const dot = Skia.Paint();
    dot.setAntiAlias(true);
    dot.setColor(Skia.Color('rgba(255,255,255,0.95)'));
    const ring = strokePaint(OUTLINE, 1.2 * k);
    const sel = strokePaint('rgba(255,138,76,1)', 2.5 * k);
    for (const j of g.joints) {
      const isSel = j.name === style.selected;
      const r = (isSel ? 6 : 3.5) * k;
      canvas.drawCircle(j.p.x, j.p.y, r, dot);
      canvas.drawCircle(j.p.x, j.p.y, r, isSel ? sel : ring);
    }
  }
}
