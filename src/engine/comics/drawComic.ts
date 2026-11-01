import { PaintStyle, PathOp, Skia, StrokeJoin, type SkCanvas } from '@shopify/react-native-skia';

import { findLayout, GUTTER_SHARE, layoutPanels, panelArea, type Quad } from '@/engine/comics/comicLayouts';

/** Strokes panel borders with sharp corners, like inked frames. */
export function drawPanels(canvas: SkCanvas, panels: readonly Quad[], border: number, color = '#111111'): void {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(border);
  paint.setStrokeJoin(StrokeJoin.Miter);
  paint.setColor(Skia.Color(color));
  for (const q of panels) {
    const path = Skia.PathBuilder.Make().moveTo(q[0].x, q[0].y).lineTo(q[1].x, q[1].y).lineTo(q[2].x, q[2].y).lineTo(q[3].x, q[3].y).close().build();
    canvas.drawPath(path, paint);
  }
}

/**
 * Page guides for print: the bleed (tinted, outside the trim line), the trim line and the safe
 * area (dashed). Meant for their own locked layer, hidden before export.
 */
export function drawPageGuides(canvas: SkCanvas, width: number, height: number, bleed: number, safe: number): void {
  const line = Math.max(2, Math.round(Math.min(width, height) / 900));
  const stroke = (color: string) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(line);
    p.setColor(Skia.Color(color));
    return p;
  };
  if (bleed > 0) {
    const page = Skia.XYWHRect(0, 0, width, height);
    const trim = Skia.XYWHRect(bleed, bleed, width - 2 * bleed, height - 2 * bleed);
    const outside = Skia.Path.MakeFromOp(Skia.Path.Rect(page), Skia.Path.Rect(trim), PathOp.Difference);
    if (outside) {
      const tint = Skia.Paint();
      tint.setColor(Skia.Color('rgba(230,57,70,0.14)'));
      canvas.drawPath(outside, tint);
    }
    canvas.drawRect(trim, stroke('rgba(25,130,196,0.95)'));
  }
  if (safe > 0) {
    const inset = bleed + safe;
    const safePaint = stroke('rgba(42,157,143,0.9)');
    safePaint.setPathEffect(Skia.PathEffect.MakeDash([line * 6, line * 6], 0));
    canvas.drawRect(Skia.XYWHRect(inset, inset, width - 2 * inset, height - 2 * inset), safePaint);
  }
}

/** Panel outlines for a layout on a canvas, with the standard gutter. */
export function comicPanels(layoutId: string, width: number, height: number, bleed: number, safe: number): Quad[] {
  const layout = findLayout(layoutId);
  if (!layout || layout.panels.length === 0) return [];
  const area = panelArea(width, height, bleed, safe);
  return layoutPanels(layout, area, Math.round(Math.min(area.width, area.height) * GUTTER_SHARE));
}
