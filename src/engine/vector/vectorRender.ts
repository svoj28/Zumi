import { PaintStyle, Skia, StrokeCap, StrokeJoin, type SkCanvas, type SkPath } from '@shopify/react-native-skia';

import type { VectorDoc, VShape } from '@/engine/vector/vectorModel';

/** The shape as a Skia path (cubic segments; straight where both handles are zero). */
export function shapePath(s: VShape): SkPath {
  const b = Skia.PathBuilder.Make();
  const n = s.nodes.length;
  if (n === 0) return b.build();
  b.moveTo(s.nodes[0].x, s.nodes[0].y);
  const segs = s.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = s.nodes[i];
    const c = s.nodes[(i + 1) % n];
    if (!a.outX && !a.outY && !c.inX && !c.inY) b.lineTo(c.x, c.y);
    else b.cubicTo(a.x + a.outX, a.y + a.outY, c.x + c.inX, c.y + c.inY, c.x, c.y);
  }
  if (s.closed) b.close();
  return b.build();
}

/** Draws one shape: fill, then stroke on top (round joins, like most vector apps). */
export function drawShape(canvas: SkCanvas, s: VShape): void {
  const path = shapePath(s);
  if (s.fill && s.closed) {
    const fill = Skia.Paint();
    fill.setAntiAlias(true);
    fill.setColor(Skia.Color(s.fill));
    canvas.drawPath(path, fill);
  }
  if (s.stroke && s.strokeWidth > 0) {
    const stroke = Skia.Paint();
    stroke.setAntiAlias(true);
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeWidth(s.strokeWidth);
    stroke.setStrokeJoin(StrokeJoin.Round);
    stroke.setStrokeCap(StrokeCap.Round);
    stroke.setColor(Skia.Color(s.stroke));
    canvas.drawPath(path, stroke);
  }
}

/** Draws every shape bottom to top, optionally leaving one out (the shape being edited). */
export function drawVector(canvas: SkCanvas, doc: VectorDoc, excludeId: string | null = null): void {
  for (const s of doc.shapes) if (s.id !== excludeId) drawShape(canvas, s);
}
