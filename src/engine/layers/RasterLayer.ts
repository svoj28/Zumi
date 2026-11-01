import {
  BlendMode,
  BlurStyle,
  ClipOp,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
  type SkCanvas,
  type SkPath,
  type SkSurface,
} from '@shopify/react-native-skia';

import { transformMatrix, type LayerTransform } from '@/engine/layers/layerTransform';
import { homography, MESH_CORNERS, type Mesh } from '@/engine/layers/meshWarp';
import type { LayerMeta, Rect } from '@/engine/types';
import type { VectorDoc } from '@/engine/vector/vectorModel';
import { drawVector } from '@/engine/vector/vectorRender';

/** Cubic resampler used when enlarging (Mitchell–Netravali: sharp without ringing). */
const CUBIC_B = 1 / 3;
const CUBIC_C = 1 / 3;

/**
 * Draws `image` at (x, y) through `t`, picking the resampler by magnification: bicubic when
 * enlarging (keeps edges crisp), trilinear/mipmapped when shrinking (avoids aliasing).
 */
export function drawTransformedImage(canvas: SkCanvas, image: SkImage, t: LayerTransform, x = 0, y = 0): void {
  const src = Skia.XYWHRect(0, 0, image.width(), image.height());
  const dst = Skia.XYWHRect(x, y, image.width(), image.height());
  canvas.save();
  canvas.concat(transformMatrix(t));
  if (t.scale > 1.001) canvas.drawImageRectCubic(image, src, dst, CUBIC_B, CUBIC_C, null);
  else canvas.drawImageRectOptions(image, src, dst, FilterMode.Linear, MipmapMode.Linear, null);
  canvas.restore();
}

/**
 * Draws the `src` region of `image` (image pixels) onto the mesh (canvas coordinates):
 * 'distort' maps it through the perspective transform of the four corners (pixels stay sharp);
 * 'warp' textures it onto the Coons patch, bending the edges.
 */
export function drawMeshImage(canvas: SkCanvas, image: SkImage, src: Rect, mode: 'distort' | 'warp', mesh: Mesh): void {
  const rect = Skia.XYWHRect(src.x, src.y, src.width, src.height);
  if (mode === 'distort') {
    canvas.save();
    canvas.concat(homography(src, MESH_CORNERS.map((i) => mesh[i])));
    canvas.drawImageRectOptions(image, rect, rect, FilterMode.Linear, MipmapMode.Linear, null);
    canvas.restore();
    return;
  }
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setShader(image.makeShaderOptions(TileMode.Decal, TileMode.Decal, FilterMode.Linear, MipmapMode.Linear));
  const texs = [
    { x: src.x, y: src.y },
    { x: src.x + src.width, y: src.y },
    { x: src.x + src.width, y: src.y + src.height },
    { x: src.x, y: src.y + src.height },
  ];
  canvas.drawPatch(mesh, null, texs, null, paint);
}

/**
 * A single bitmap layer backed by a CPU raster Skia surface.
 *
 * CPU surfaces are used (rather than GPU offscreen surfaces) because their snapshots are plain
 * pixel images that can be handed to the UI-thread renderer without a GPU readback, and
 * snapshots are copy-on-write so an unchanged layer costs nothing to re-display.
 */
export class RasterLayer {
  meta: LayerMeta;
  readonly width: number;
  readonly height: number;
  /** Increments whenever pixels change; used for dirty tracking and incremental saves. */
  revision: number;
  /**
   * Vector layers keep their shapes here and their pixels are a rendering of them; null for
   * ordinary (raster) layers.
   */
  vector: VectorDoc | null = null;

  private surface: SkSurface;
  private snapshot: SkImage;
  /**
   * Area changed since the last `takeDirty()`, layer pixels. Only the timelapse recorder reads
   * it, so it can store just the changed region instead of the whole layer.
   */
  private dirty: Rect | null = null;

  private constructor(meta: LayerMeta, surface: SkSurface, revision: number) {
    this.meta = meta;
    this.surface = surface;
    this.width = surface.width();
    this.height = surface.height();
    this.revision = revision;
    this.snapshot = surface.makeImageSnapshot();
  }

  static create(meta: LayerMeta, width: number, height: number, revision = 0): RasterLayer {
    const surface = Skia.Surface.Make(width, height);
    if (!surface) {
      throw new Error(`Unable to allocate a ${width}×${height} layer (out of memory?)`);
    }
    surface.getCanvas().clear(Skia.Color('transparent'));
    return new RasterLayer(meta, surface, revision);
  }

  /** Immutable image of the current pixels, used for on-screen compositing. */
  get image(): SkImage {
    return this.snapshot;
  }

  get bytes(): number {
    return this.width * this.height * 4;
  }

  /** Clamps a rect to the layer bounds; returns null when there is no overlap. */
  clampRect(rect: Rect): Rect | null {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(this.width, Math.ceil(rect.x + rect.width));
    const y1 = Math.min(this.height, Math.ceil(rect.y + rect.height));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /** Copies a region of pixels (for undo). */
  readRegion(rect: Rect): SkImage {
    return this.surface.makeImageSnapshot(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height));
  }

  /** Replaces a region of pixels with `image` (for undo/redo). */
  writeRegion(image: SkImage, rect: Rect): void {
    const canvas = this.surface.getCanvas();
    const paint = Skia.Paint();
    paint.setBlendMode(BlendMode.Src);
    canvas.save();
    canvas.clipRect(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height), ClipOp.Intersect, false);
    canvas.drawImage(image, rect.x, rect.y, paint);
    canvas.restore();
    this.touch(rect);
  }

  /**
   * Runs arbitrary drawing on the layer, optionally restricted to `clip` (the selection).
   * `bounds`, when known, is the most the drawing can change (for change tracking).
   */
  drawWith(render: (canvas: SkCanvas) => void, clip?: SkPath | null, bounds?: Rect, feather = 0): void {
    const canvas = this.surface.getCanvas();
    if (clip && feather > 0) {
      this.drawFeathered(canvas, render, clip, bounds, feather);
      this.touch(bounds);
      return;
    }
    canvas.save();
    if (clip) canvas.clipPath(clip, ClipOp.Intersect, true);
    render(canvas);
    canvas.restore();
    this.touch(bounds ?? (clip ? pathBounds(clip) : undefined));
  }

  /**
   * Draws through a soft-edged selection: the drawing is made in a layer, then kept only by a
   * blurred image of the selection (an image covers its whole rect, so everything outside the
   * selection is removed too). Work is limited to `bounds` when known.
   */
  private drawFeathered(canvas: SkCanvas, render: (canvas: SkCanvas) => void, clip: SkPath, bounds: Rect | undefined, feather: number): void {
    const area = this.clampRect(bounds ?? { x: 0, y: 0, width: this.width, height: this.height });
    if (!area) return;
    const surface = Skia.Surface.Make(area.width, area.height);
    if (!surface) return;
    const maskCanvas = surface.getCanvas();
    maskCanvas.clear(Skia.Color('transparent'));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color('white'));
    paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, feather / 2, true));
    maskCanvas.translate(-area.x, -area.y);
    maskCanvas.drawPath(clip, paint);
    surface.flush();
    const mask = surface.makeImageSnapshot();
    surface.dispose();

    const rect = Skia.XYWHRect(area.x, area.y, area.width, area.height);
    canvas.save();
    canvas.clipRect(rect, ClipOp.Intersect, false);
    canvas.saveLayer(undefined, rect);
    render(canvas);
    const keep = Skia.Paint();
    keep.setBlendMode(BlendMode.DstIn);
    canvas.drawImage(mask, area.x, area.y, keep);
    canvas.restore();
    canvas.restore();
    mask.dispose();
  }

  /** Erases everything inside `path`. */
  clearInside(path: SkPath): void {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setBlendMode(BlendMode.Clear);
    this.surface.getCanvas().drawPath(path, paint);
    this.touch(pathBounds(path));
  }

  /** Redraws the layer's current pixels through an affine transform (see LayerTransform). */
  applyTransform(t: LayerTransform): void {
    const source = this.snapshot;
    const canvas = this.surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    drawTransformedImage(canvas, source, t);
    this.touch();
  }

  /** Redraws the pixels from vector shapes (optionally without one shape, while it is edited). */
  renderVector(doc: VectorDoc, excludeId: string | null = null): void {
    const canvas = this.surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    drawVector(canvas, doc, excludeId);
    this.touch();
  }

  /** Makes this a vector layer with these shapes (or a raster layer again with null, keeping pixels). */
  setVector(doc: VectorDoc | null): void {
    this.vector = doc;
    if (doc) this.renderVector(doc);
  }

  /** Replaces the layer with a drawing made from its current pixels (`source`). */
  redraw(render: (canvas: SkCanvas, source: SkImage) => void): void {
    const source = this.snapshot;
    const canvas = this.surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    render(canvas, source);
    this.touch();
  }

  /** Draws an image into the layer at a destination rect (used for importing images). */
  drawImageInto(image: SkImage, dest: Rect): void {
    this.surface.getCanvas().drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(dest.x, dest.y, dest.width, dest.height),
      FilterMode.Linear,
      MipmapMode.Linear,
      null,
    );
    this.touch(dest);
  }

  /**
   * Replaces the whole layer with an image, scaled to fill the layer (used when loading a
   * project and when importing a photo whose size differs from the canvas).
   */
  loadImage(image: SkImage): void {
    const canvas = this.surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    if (image.width() === this.width && image.height() === this.height) {
      canvas.drawImage(image, 0, 0);
    } else {
      canvas.drawImageRectOptions(
        image,
        Skia.XYWHRect(0, 0, image.width(), image.height()),
        Skia.XYWHRect(0, 0, this.width, this.height),
        FilterMode.Linear,
        MipmapMode.Linear,
        null,
      );
    }
    this.surface.flush();
    this.snapshot = this.surface.makeImageSnapshot();
  }

  clear(): void {
    this.surface.getCanvas().clear(Skia.Color('transparent'));
    this.touch();
  }

  encodePng(): Uint8Array {
    return this.snapshot.encodeToBytes(ImageFormat.PNG, 100);
  }

  dispose(): void {
    this.snapshot.dispose();
    this.surface.dispose();
  }

  /** Returns the area changed since the previous call (null if none) and starts tracking anew. */
  takeDirty(): Rect | null {
    const dirty = this.dirty;
    this.dirty = null;
    return dirty;
  }

  /** `changed` defaults to the whole layer. */
  private touch(changed?: Rect): void {
    this.surface.flush();
    this.snapshot = this.surface.makeImageSnapshot();
    this.revision += 1;
    const rect = this.clampRect(changed ?? { x: 0, y: 0, width: this.width, height: this.height });
    if (rect) this.dirty = this.dirty ? unionRects(this.dirty, rect) : rect;
  }
}

function pathBounds(path: SkPath): Rect {
  const b = path.getBounds();
  // One pixel of slack for anti-aliased edges.
  return { x: b.x - 1, y: b.y - 1, width: b.width + 2, height: b.height + 2 };
}

function unionRects(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
