import { AlphaType, BlendMode, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { PSD_BLEND_KEYS, writePsd, type PsdLayer, type PsdMask } from '@/engine/export/psdWriter';
import { stackItems, type LayerGroup } from '@/engine/layers/layerGroups';
import type { RasterLayer } from '@/engine/layers/RasterLayer';
import { renderComposite } from '@/engine/render/composite';
import { contentBounds } from '@/engine/render/contentBounds';
import { exportsDir, safeFileName, type ShareType } from '@/storage/exportService';

/**
 * Layered Photoshop export: every layer keeps its pixels, name, opacity, visibility and blend
 * mode; clipping layers stay clipped, layer masks become the base layer's mask and layer groups
 * become PSD groups. Photoshop, Clip Studio Paint, Krita, Affinity and Procreate can open it.
 */

export const PSD_FILE_TYPE: ShareType & { ext: string } = { mime: 'image/vnd.adobe.photoshop', uti: 'com.adobe.photoshop-image', ext: 'psd' };

function readRgba(image: SkImage, x: number, y: number, width: number, height: number): Uint8Array {
  const px = image.readPixels(x, y, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!px) throw new Error('Not enough memory to export this artwork.');
  return px instanceof Uint8Array ? px : Uint8Array.from(px, (v) => Math.round(v * 255));
}

/** A layer's pixels cropped to its content (empty layers get an empty rectangle). */
function pixelLayer(layer: RasterLayer, clipping: boolean, mask?: PsdMask): PsdLayer {
  const box = contentBounds(layer.image);
  const base = {
    name: layer.meta.name,
    opacity: layer.meta.opacity * 255,
    visible: layer.meta.visible,
    blendKey: PSD_BLEND_KEYS[layer.meta.blendMode] ?? 'norm',
    clipping,
    mask,
  };
  if (!box) return { ...base, top: 0, left: 0, bottom: 0, right: 0, rgba: new Uint8Array(0) };
  return {
    ...base,
    top: box.y,
    left: box.x,
    bottom: box.y + box.height,
    right: box.x + box.width,
    rgba: readRgba(layer.image, box.x, box.y, box.width, box.height),
  };
}

/** The unit's masks merged into one grey mask (white shows), or undefined without masks. */
function unitMask(doc: DrawingDocument, masks: RasterLayer[]): PsdMask | undefined {
  const visible = masks.filter((m) => m.meta.visible);
  if (visible.length === 0) return undefined;
  const { width, height } = doc.info;
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error('Not enough memory to export this artwork.');
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('white'));
  for (const m of visible) {
    // Each mask: brightness over black, weakened by its opacity, multiplied into the result.
    const paint = Skia.Paint();
    paint.setBlendMode(BlendMode.Multiply);
    canvas.saveLayer(paint);
    canvas.drawColor(Skia.Color('black'));
    canvas.drawImage(m.image, 0, 0);
    const weaken = Skia.Paint();
    weaken.setColor(Skia.Color('white'));
    weaken.setAlphaf(1 - m.meta.opacity);
    canvas.drawRect(Skia.XYWHRect(0, 0, width, height), weaken);
    canvas.restore();
  }
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  const rgba = readRgba(image, 0, 0, width, height);
  image.dispose();
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return { top: 0, left: 0, bottom: height, right: width, data, defaultColor: 255 };
}

function unitLayers(doc: DrawingDocument, unit: LayerGroup<RasterLayer>): PsdLayer[] {
  const masks = unit.attached.filter((l) => l.meta.mask);
  const clips = unit.attached.filter((l) => !l.meta.mask);
  return [pixelLayer(unit.base, false, unitMask(doc, masks)), ...clips.map((l) => pixelLayer(l, true))];
}

/** Renders the artwork as a layered PSD file in the app cache and returns it. */
export function renderPsd(doc: DrawingDocument): File {
  const { width, height } = doc.info;
  const layers: PsdLayer[] = [];
  for (const item of stackItems(doc.layers.list, doc.groups)) {
    if (item.kind === 'unit') {
      layers.push(...unitLayers(doc, item.unit));
      continue;
    }
    const g = item.group;
    const marker = { top: 0, left: 0, bottom: 0, right: 0, rgba: new Uint8Array(0), clipping: false };
    layers.push({ ...marker, name: '</Layer group>', opacity: 255, visible: true, blendKey: 'norm', section: 'divider' });
    for (const unit of item.units) layers.push(...unitLayers(doc, unit));
    layers.push({
      ...marker,
      name: g.name,
      opacity: g.opacity * 255,
      visible: g.visible,
      blendKey: PSD_BLEND_KEYS[g.blendMode] ?? 'norm',
      section: g.collapsed ? 'closed' : 'open',
    });
  }
  const flat = renderComposite(doc, 1, { background: true });
  if (!flat) throw new Error('Not enough memory to export this artwork.');
  const composite = readRgba(flat, 0, 0, width, height);
  flat.dispose();
  const bytes = writePsd(width, height, layers, composite);
  const file = new File(exportsDir(), `${safeFileName(doc.info.name)}.psd`);
  file.create({ overwrite: true });
  file.writeSync(bytes);
  return file;
}