import {
  BlendMode,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  PaintStyle,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkPath,
} from '@shopify/react-native-skia';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { maskMatrix, stackItems, type LayerGroup } from '@/engine/layers/layerGroups';
import type { RasterLayer } from '@/engine/layers/RasterLayer';
import type { LayerGroupMeta } from '@/engine/types';
import { toSkBlendMode } from '@/engine/render/blendModes';
import { checkerCellFor, drawChecker, isTransparentColor } from '@/engine/render/checker';

/**
 * Draws layers (bottom → top) onto `canvas` with their opacity and blend mode, skipping hidden
 * ones. The single source of compositing maths for export, thumbnails, merges and flatten, so
 * a merge produces exactly what an export of the same layers would.
 */
export function drawLayerStack(
  canvas: SkCanvas,
  layers: readonly RasterLayer[],
  /** Output size; defaults to the layers' own size (1:1). */
  dest?: { width: number; height: number },
  /** Layer groups (folders) the layers may belong to. */
  groups: ReadonlyMap<string, LayerGroupMeta> = NO_GROUPS,
): void {
  const draw = (layer: RasterLayer, paint?: SkPaint) => {
    if (!dest || (dest.width === layer.width && dest.height === layer.height)) {
      canvas.drawImage(layer.image, 0, 0, paint);
    } else {
      canvas.drawImageRectOptions(
        layer.image,
        Skia.XYWHRect(0, 0, layer.width, layer.height),
        Skia.XYWHRect(0, 0, dest.width, dest.height),
        FilterMode.Linear,
        MipmapMode.Linear,
        paint ?? null,
      );
    }
  };
  const layerPaint = (layer: RasterLayer) => {
    const paint = Skia.Paint();
    paint.setAlphaf(layer.meta.opacity);
    paint.setBlendMode(toSkBlendMode(layer.meta.blendMode));
    return paint;
  };

  const drawUnit = ({ base, attached }: LayerGroup<RasterLayer>) => {
    if (!base.meta.visible) return;
    const shown = attached.filter((l) => l.meta.visible);
    if (shown.length === 0) {
      if (base.meta.opacity > 0) draw(base, layerPaint(base));
      return;
    }
    // The group is composited on its own and lands below with the base's blend mode.
    const group = Skia.Paint();
    group.setBlendMode(toSkBlendMode(base.meta.blendMode));
    canvas.saveLayer(group);
    const own = Skia.Paint();
    own.setAlphaf(base.meta.opacity);
    draw(base, own);
    for (const layer of shown) {
      if (layer.meta.mask) {
        // Brightness → coverage (over black, so erased parts of the mask hide too).
        const mask = Skia.Paint();
        mask.setBlendMode(BlendMode.DstIn);
        mask.setColorFilter(Skia.ColorFilter.MakeMatrix(maskMatrix(layer.meta.opacity)));
        canvas.saveLayer(mask);
        canvas.drawColor(Skia.Color('black'));
        draw(layer);
        canvas.restore();
      } else {
        // Clipping layer: blended with the base, kept only where the base has pixels.
        canvas.saveLayer(layerPaint(layer));
        draw(layer);
        const keep = Skia.Paint();
        keep.setBlendMode(BlendMode.DstIn);
        draw(base, keep);
        canvas.restore();
      }
    }
    canvas.restore();
  };

  for (const item of stackItems(layers, groups)) {
    if (item.kind === 'unit') {
      drawUnit(item.unit);
      continue;
    }
    // A folder: its layers are composited together, then land with its opacity and blend mode.
    if (!item.group.visible || item.group.opacity <= 0) continue;
    const folder = Skia.Paint();
    folder.setAlphaf(item.group.opacity);
    folder.setBlendMode(toSkBlendMode(item.group.blendMode));
    canvas.saveLayer(folder);
    for (const unit of item.units) drawUnit(unit);
    canvas.restore();
  }
}

const NO_GROUPS: ReadonlyMap<string, LayerGroupMeta> = new Map();

export interface CompositeOptions {
  /** Draw the document's paper colour (default true). */
  background?: boolean;
  /**
   * What to show where the result would otherwise be transparent — needed for formats
   * without alpha (JPEG) and for previews. Drawn beneath the artwork, outside the layer
   * blend group so blend modes never interact with it.
   */
  underlay?: 'none' | 'white' | 'checker';
  /**
   * Guide lines (canvas coordinates) drawn over the artwork. Only for exports where the user
   * explicitly asked for guides; drawn after the layer group, so they never blend with it.
   */
  guides?: { path: SkPath; opacity: number } | null;
  /** Only these layers (bottom → top), e.g. one animation frame; defaults to all. */
  layers?: readonly RasterLayer[];
}

/** Guide colour, matching the on-screen overlay. */
const GUIDE_RGB = '64,170,255';

/**
 * Flattens all visible layers (plus optional paper background) into a single image at the
 * given scale. Used for thumbnails and image export. JS thread only.
 */
export function renderComposite(doc: DrawingDocument, scale = 1, options: CompositeOptions = {}): SkImage | null {
  const { width, height, background } = doc.info;
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const surface = Skia.Surface.Make(outW, outH);
  if (!surface) return null;

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  const underlay = options.underlay ?? 'none';
  if (underlay === 'white') canvas.drawColor(Skia.Color('white'));
  else if (underlay === 'checker') drawChecker(canvas, outW, outH, checkerCellFor(outW, outH));

  canvas.saveLayer();
  if (options.background !== false && !isTransparentColor(background)) {
    canvas.drawColor(Skia.Color(background));
  }

  drawLayerStack(canvas, options.layers ?? doc.layers.list, { width: outW, height: outH }, doc.groups);
  canvas.restore();

  if (options.guides) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    // Thin but visible at any export size (≈ 1 px per 800 px of the short side).
    paint.setStrokeWidth(Math.max(1, Math.round(Math.min(outW, outH) / 800)));
    paint.setColor(Skia.Color(`rgba(${GUIDE_RGB},${options.guides.opacity})`));
    const scaled = Skia.PathBuilder.MakeFromPath(options.guides.path).transform([outW / width, 0, 0, 0, outH / height, 0, 0, 0, 1]).build();
    canvas.drawPath(scaled, paint);
  }
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

export function encodeThumbnail(doc: DrawingDocument, maxSide = 512): Uint8Array | null {
  const scale = Math.min(1, maxSide / Math.max(doc.info.width, doc.info.height));
  const image = renderComposite(doc, scale, { underlay: 'checker' });
  if (!image) return null;
  const bytes = image.encodeToBytes(ImageFormat.JPEG, 85);
  image.dispose();
  return bytes;
}
