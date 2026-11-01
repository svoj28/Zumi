import {
  AlphaType,
  BlendMode,
  ClipOp,
  ColorType,
  FilterMode,
  MipmapMode,
  PathOp,
  Skia,
  TileMode,
  VertexMode,
  type SkCanvas,
  type SkImage,
  type SkPath,
  type SkRect,
} from '@shopify/react-native-skia';

import type { BrushPreset } from '@/engine/brush/brushPreset';
import { buildStroke } from '@/engine/brush/strokeRenderer';
import { getClipboard, setClipboard } from '@/engine/clipboard';
import {
  AddLayerCommand,
  CanvasCommand,
  LayerPropsCommand,
  MoveLayerCommand,
  PixelRegionCommand,
  ReapplyLayerCommand,
  RemoveLayerCommand,
  ReplaceLayersCommand,
  StructureCommand,
  takeStructure,
  VectorCommand,
  type CanvasState,
  type LayerPropsPatch,
  type LayerStackState,
} from '@/engine/history/commands';
import { HistoryManager } from '@/engine/history/HistoryManager';
import { createId } from '@/engine/ids';
import {
  flipTransform,
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  mapPoint,
  transformMatrix,
  type LayerTransform,
} from '@/engine/layers/layerTransform';
import { LayerStack } from '@/engine/layers/LayerStack';
import { homography, isValidQuad, mapHomography, MESH_CORNERS, type Mesh } from '@/engine/layers/meshWarp';
import { EMPTY_VECTOR, mapVector, type VectorDoc } from '@/engine/vector/vectorModel';
import { drawMeshImage, drawTransformedImage, RasterLayer } from '@/engine/layers/RasterLayer';
import { maxLayersFor } from '@/engine/memory';
import { isTransparentColor } from '@/engine/render/checker';
import { stackItems, type StackItem } from '@/engine/layers/layerGroups';
import { createLiquifyMesh, isDeformed, liquifyIndices, toPoints } from '@/engine/layers/liquify';
import { alphaMask, floodFillMask, growMask, maskBounds, maskToRects } from '@/engine/raster/pixelOps';
import { drawAdjusted, isNeutral, type Adjustment } from '@/engine/render/adjustments';
import { drawLayerStack } from '@/engine/render/composite';
import { contentBounds } from '@/engine/render/contentBounds';
import { gradientShader, toneGradientEffect, type GradientSpec } from '@/engine/render/gradient';
import {
  DEFAULT_ANIMATION,
  type AnimationSettings,
  type LayerGroupMeta,
  type LayerMeta,
  type Rect,
  type StrokeRecipe,
  type ToolId,
} from '@/engine/types';

export interface DocumentInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Paper colour drawn beneath all layers (CSS colour string, or "transparent"). */
  background: string;
  /** Dots per inch — metadata for physical sizes and print export. */
  dpi: number;
  createdAt: number;
  updatedAt: number;
  /** Whether this artwork records a timelapse; null follows the app-wide default. */
  recordTimelapse: boolean | null;
}

export const MIN_CANVAS_SIDE = 16;
export const MAX_CANVAS_SIDE = 8192;
/** Resolution used for physical sizes (print); 72 is the screen convention. */
export const DEFAULT_DPI = 72;
const MAX_BRUSHES_USED = 24;

export function createLayerMeta(name: string, overrides: Partial<LayerMeta> = {}): LayerMeta {
  return {
    id: createId('l_'),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'srcOver',
    locked: false,
    alphaLocked: false,
    ...overrides,
  };
}

/**
 * An in-progress transform of the active layer (or of the selected pixels in it). The editor
 * previews it by drawing `base` untouched and `floating` through the pending transform, then
 * commits it with `applyTransform`. Call `endTransform` when done to release the images.
 */
export interface TransformSession {
  layerId: string;
  /** The pixels that move: the selection's content (cropped) or the whole layer. */
  floating: SkImage;
  /** Where `floating` sits before transforming, canvas coordinates. */
  origin: { x: number; y: number };
  /** Pixels that stay put (the layer minus the selection); null when the whole layer moves. */
  base: SkImage | null;
  /** Bounding box of the moving content before transforming, canvas coordinates. */
  box: Rect;
  /** The selection being transformed, or null for the whole layer. */
  selection: SkPath | null;
  /** Whether this session created (and must free) its images. */
  ownsImages: boolean;
}

/** Outcome of an edit that can be refused; `reason` is user-facing. */
export type EditResult<T = true> = { ok: true; value: T } | { ok: false; reason: string };

/** Which pixels the paint bucket and magic wand look at to find the area. */
export type FillSource = 'layer' | 'canvas' | 'reference';

export interface FillOptions {
  /** 0..1: how different a colour may be and still belong to the area. */
  tolerance: number;
  source: FillSource;
  /** Only the connected area (true) or every matching pixel (false). */
  contiguous: boolean;
  /** Pixels to grow the area by, so fills slip under anti-aliased line art. */
  expand: number;
}

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Anchor of the old canvas inside the new one, as fractions (0 = left/top, 1 = right/bottom). */
export interface CanvasAnchor {
  x: number;
  y: number;
}

function ok<T>(value: T): EditResult<T> {
  return { ok: true, value };
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * The in-memory model of an open artwork. Owns the layer stack and history and is the single
 * entry point for edits, so every mutation is recorded and observers are notified.
 *
 * React observes it through `subscribe` / `getVersion` (useSyncExternalStore): the UI only
 * re-renders when a committed change happens, never per pointer event.
 */
export class DrawingDocument {
  readonly layers = new LayerStack();
  readonly history = new HistoryManager();
  info: DocumentInfo;

  /** Bumped by every edit that changes saved content. */
  private contentVersion = 0;
  /** Bumped by every change observers should re-render for (content or UI state like selection). */
  private observedVersion = 0;
  private savedVersion = 0;
  private selectionPath: SkPath | null = null;
  private listeners = new Set<() => void>();
  private layerCounter = 0;
  /**
   * Brushes this artwork was painted with (resolved settings of each brush's latest stroke),
   * saved with the project so a restored backup still knows its custom brushes.
   */
  readonly brushesUsed = new Map<string, BrushPreset>();
  /** Layer groups (folders) by id; layers point at theirs with `meta.groupId`. */
  groups = new Map<string, LayerGroupMeta>();
  /** Frame-by-frame animation settings (saved with the artwork). */
  animation: AnimationSettings = { ...DEFAULT_ANIMATION };
  /**
   * Soft selection edge in pixels: edits inside a selection fade out over this distance. A
   * viewing/editing preference of the session, not part of the artwork or the undo history.
   */
  selectionFeather = 0;
  private groupCounter = 0;

  constructor(info: DocumentInfo) {
    this.info = info;
  }

  static createBlank(params: {
    id?: string;
    name: string;
    width: number;
    height: number;
    background: string;
    dpi?: number;
    recordTimelapse?: boolean | null;
  }): DrawingDocument {
    const now = Date.now();
    const doc = new DrawingDocument({
      id: params.id ?? createId('p_'),
      name: params.name,
      width: params.width,
      height: params.height,
      background: params.background,
      dpi: params.dpi ?? DEFAULT_DPI,
      createdAt: now,
      updatedAt: now,
      recordTimelapse: params.recordTimelapse ?? null,
    });
    const layer = RasterLayer.create(doc.nextLayerMeta(), params.width, params.height);
    doc.layers.insert(layer);
    doc.layers.activeId = layer.meta.id;
    return doc;
  }

  // ---- observation -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.observedVersion;

  getContentVersion(): number {
    return this.contentVersion;
  }

  get isDirty(): boolean {
    return this.contentVersion !== this.savedVersion;
  }

  markSaved(version: number): void {
    this.savedVersion = version;
  }

  get maxLayers(): number {
    return maxLayersFor(this.info.width, this.info.height);
  }

  // ---- painting ----------------------------------------------------------------------------

  /**
   * Rasterises a finished stroke onto the active layer, clipped to the selection if any. On an
   * alpha-locked layer the stroke is composited with src-atop, which keeps each pixel's
   * coverage and only changes its colour.
   */
  commitStroke(recipe: StrokeRecipe): boolean {
    const layer = this.editableLayer(recipe.tool);
    if (!layer) return false;
    const built = buildStroke(recipe, layer.image);
    if (!built) return false;
    let bounds = built.bounds;
    if (this.selection) bounds = intersectRects(bounds, roundOut(this.selection.getBounds())) ?? bounds;
    const area = Skia.XYWHRect(built.bounds.x, built.bounds.y, built.bounds.width, built.bounds.height);
    const render: RenderFn = layer.meta.alphaLocked
      ? (canvas) => {
          const paint = Skia.Paint();
          paint.setBlendMode(BlendMode.SrcATop);
          canvas.saveLayer(paint, area);
          built.render(canvas);
          canvas.restore();
        }
      : built.render;
    const committed = this.recordPixelEdit(layer, bounds, recipe.label ?? (recipe.tool === 'eraser' ? 'Erase' : recipe.brush.blend > 0 ? 'Blend' : 'Brush stroke'), () =>
      layer.drawWith(render, this.selection, bounds, this.selectionFeather),
    );
    if (committed) this.noteBrush(recipe.brush);
    return committed;
  }

  /** Records a brush as used (most recent last), bounded so the manifest stays small. */
  noteBrush(brush: BrushPreset): void {
    this.brushesUsed.delete(brush.id);
    this.brushesUsed.set(brush.id, brush);
    while (this.brushesUsed.size > MAX_BRUSHES_USED) {
      const oldest = this.brushesUsed.keys().next().value;
      if (oldest === undefined) break;
      this.brushesUsed.delete(oldest);
    }
  }

  /** Whether `tool` can paint on the active layer. */
  canPaintOnActiveLayer(tool: ToolId = 'brush'): boolean {
    return this.editableLayer(tool) !== null;
  }

  // ---- selection ---------------------------------------------------------------------------

  /**
   * Current selection in canvas coordinates, or null when everything is editable. Selection
   * changes are not undo steps (as in most painting apps); edits made inside one are.
   */
  get selection(): SkPath | null {
    return this.selectionPath;
  }

  setSelection(path: SkPath | null): void {
    this.selectionPath = path && !path.isEmpty() ? path : null;
    this.emit({ dirty: false });
  }

  selectAll(): void {
    this.setSelection(Skia.Path.Rect(Skia.XYWHRect(0, 0, this.info.width, this.info.height)));
  }

  invertSelection(): void {
    const all = Skia.Path.Rect(Skia.XYWHRect(0, 0, this.info.width, this.info.height));
    if (!this.selectionPath) {
      this.setSelection(null);
      return;
    }
    this.setSelection(Skia.Path.MakeFromOp(all, this.selectionPath, PathOp.Difference));
  }

  /** Erases the selected area of the active layer. */
  clearSelection(): boolean {
    const layer = this.editableLayer();
    const selection = this.selectionPath;
    if (!layer || !selection) return false;
    return this.recordPixelEdit(layer, roundOut(selection.getBounds()), 'Clear selection', () => layer.clearInside(selection));
  }

  // ---- transform ---------------------------------------------------------------------------

  /**
   * Starts transforming the active layer — only the selected pixels when there is a selection.
   * Nothing changes until `applyTransform`; cancelling is just `endTransform`.
   */
  beginTransform(): EditResult<TransformSession> {
    const layer = this.editableLayer('brush', true);
    if (!layer) return fail('Unlock and show the layer first.');
    // A vector layer always transforms all its shapes (their points move; edges stay crisp).
    const selection = layer.vector ? null : (this.selectionPath?.copy() ?? null);
    if (!selection) {
      const box = contentBounds(layer.image);
      if (!box) return fail('The layer is empty.');
      return ok({ layerId: layer.meta.id, floating: layer.image, origin: { x: 0, y: 0 }, base: null, box, selection, ownsImages: false });
    }
    const floating = extractRegion(layer, selection);
    if (!floating) return fail('The selection is outside the canvas.');
    const box = contentBounds(floating.image);
    if (!box) {
      floating.image.dispose();
      return fail('There is nothing in the selection on this layer.');
    }
    const base = renderToImage(layer.width, layer.height, (canvas) => {
      canvas.drawImage(layer.image, 0, 0);
      const erase = Skia.Paint();
      erase.setAntiAlias(true);
      erase.setBlendMode(BlendMode.Clear);
      canvas.drawPath(selection, erase);
    });
    if (!base) {
      floating.image.dispose();
      return fail('Not enough memory to transform this selection.');
    }
    return ok({
      layerId: layer.meta.id,
      floating: floating.image,
      origin: { x: floating.x, y: floating.y },
      base,
      box: { x: floating.x + box.x, y: floating.y + box.y, width: box.width, height: box.height },
      selection,
      ownsImages: true,
    });
  }

  /**
   * Commits a transform as one undoable step. With a selection, the selected pixels are lifted,
   * transformed and put back, and the selection follows them.
   */
  applyTransform(session: TransformSession, t: LayerTransform): boolean {
    const layer = this.layers.get(session.layerId);
    if (!layer || layer.meta.locked || isIdentityTransform(t)) return false;
    const transform = { ...t };
    const selection = session.selection;
    if (layer.vector) {
      return this.setVector(layer.meta.id, mapVector(layer.vector, (x, y) => mapPoint(transform, x, y), transform.scale), 'Transform shapes');
    }
    if (!selection) {
      return this.recordReapplyEdit(layer, 'Transform layer', (target) => target.applyTransform(transform));
    }
    // Re-extracting inside the edit keeps it deterministic, so redo can simply run it again.
    const done = this.recordReapplyEdit(layer, 'Transform selection', (target) => {
      const lifted = extractRegion(target, selection);
      target.clearInside(selection);
      if (lifted) {
        target.drawWith((canvas) => drawTransformedImage(canvas, lifted.image, transform, lifted.x, lifted.y));
        lifted.image.dispose();
      }
    });
    if (done) this.setSelection(Skia.PathBuilder.MakeFromPath(selection).transform(transformMatrix(transform)).build());
    return done;
  }

  /**
   * Commits a distort (perspective, by the four corners) or warp (bent edges) as one undoable
   * step. The mesh is in canvas coordinates and covers the session's content box. A distorted
   * selection follows the pixels; a warped one is cleared (it cannot follow a bend exactly).
   * Returns false for a quad that cannot be drawn (twisted or collapsed corners).
   */
  applyMesh(session: TransformSession, mode: 'distort' | 'warp', mesh: Mesh): boolean {
    const layer = this.layers.get(session.layerId);
    if (!layer || layer.meta.locked || mesh.length !== 12) return false;
    const corners = MESH_CORNERS.map((i) => mesh[i]);
    if (mode === 'distort' && !isValidQuad(corners)) return false;
    const points = mesh.map((p) => ({ ...p }));
    const box = { ...session.box };
    if (layer.vector) {
      // Shapes follow a distortion point by point; a warp needs pixels.
      if (mode === 'warp') return false;
      const m = homography(box, corners);
      return this.setVector(layer.meta.id, mapVector(layer.vector, (x, y) => mapHomography(m, x, y), 1), 'Distort shapes');
    }
    const label = mode === 'distort' ? 'Distort' : 'Warp';
    const selection = session.selection;
    if (!selection) {
      return this.recordReapplyEdit(layer, `${label} layer`, (target) =>
        target.redraw((canvas, source) => drawMeshImage(canvas, source, box, mode, points)),
      );
    }
    const done = this.recordReapplyEdit(layer, `${label} selection`, (target) => {
      const lifted = extractRegion(target, selection);
      target.clearInside(selection);
      if (lifted) {
        const src = { x: box.x - lifted.x, y: box.y - lifted.y, width: box.width, height: box.height };
        target.drawWith((canvas) => drawMeshImage(canvas, lifted.image, src, mode, points));
        lifted.image.dispose();
      }
    });
    if (done) {
      this.setSelection(mode === 'distort' ? Skia.PathBuilder.MakeFromPath(selection).transform(homography(box, corners)).build() : null);
    }
    return done;
  }

  endTransform(session: TransformSession): void {
    if (!session.ownsImages) return;
    session.floating.dispose();
    session.base?.dispose();
  }

  /**
   * Flips the active layer's content (only the selected pixels when there is a selection)
   * in place, around the centre of that content. Changes the artwork — unlike flipping the
   * view, which only mirrors the display.
   */
  flipContent(axis: 'x' | 'y'): EditResult {
    const started = this.beginTransform();
    if (!started.ok) return started;
    const session = started.value;
    const { box } = session;
    const t = flipTransform(IDENTITY_TRANSFORM, axis, box.x + box.width / 2, box.y + box.height / 2);
    const done = this.applyTransform(session, t);
    this.endTransform(session);
    return done ? ok(true) : fail('The layer can’t be flipped.');
  }

  // ---- clipboard ---------------------------------------------------------------------------

  /** Copies the selected pixels of the active layer (the whole layer without a selection). */
  copySelection(): EditResult {
    const layer = this.layers.active;
    if (!layer) return fail('There is no layer to copy from.');
    const region = extractRegion(layer, this.selectionPath);
    if (!region) return fail('The selection is outside the canvas.');
    setClipboard(region);
    return ok(true);
  }

  /**
   * Copies the selected pixels (or the whole layer) straight into a new layer above, in the
   * same place, leaving the clipboard alone.
   */
  duplicateSelection(): EditResult<RasterLayer> {
    const layer = this.layers.active;
    if (!layer) return fail('There is no layer to duplicate.');
    if (!this.selectionPath) return this.duplicateLayer(layer.meta.id);
    const region = extractRegion(layer, this.selectionPath);
    if (!region) return fail('The selection is outside the canvas.');
    const result = this.insertNewLayer(
      createLayerMeta(`${layer.meta.name} selection`),
      this.activeIndex() + 1,
      'Duplicate selection',
      (target) => target.drawWith((canvas) => canvas.drawImage(region.image, region.x, region.y)),
    );
    region.image.dispose();
    return result;
  }

  /** Copy, then erase the copied pixels, as one undoable "Cut" step. */
  cutSelection(): EditResult {
    const layer = this.layers.active;
    if (!layer) return fail('There is no layer to cut from.');
    if (layer.meta.locked) return fail('The layer is locked.');
    const copied = this.copySelection();
    if (!copied.ok) return copied;
    const selection = this.selectionPath;
    if (selection) {
      this.recordPixelEdit(layer, roundOut(selection.getBounds()), 'Cut', () => layer.clearInside(selection));
    } else {
      this.recordReapplyEdit(layer, 'Cut', (target) => target.clear());
    }
    return ok(true);
  }

  get canPaste(): boolean {
    return getClipboard() !== null;
  }

  /**
   * Pastes the clipboard into a new layer above the active one, at the position it was copied
   * from (centred if that would be off this canvas). One undoable "Paste" step.
   */
  paste(): EditResult<RasterLayer> {
    const clip = getClipboard();
    if (!clip) return fail('Nothing has been copied yet.');
    const w = clip.image.width();
    const h = clip.image.height();
    const onCanvas = clip.x < this.info.width && clip.y < this.info.height && clip.x + w > 0 && clip.y + h > 0;
    const x = onCanvas ? clip.x : Math.round((this.info.width - w) / 2);
    const y = onCanvas ? clip.y : Math.round((this.info.height - h) / 2);
    return this.insertNewLayer(createLayerMeta('Pasted'), this.activeIndex() + 1, 'Paste', (layer) =>
      layer.drawWith((canvas) => canvas.drawImage(clip.image, x, y)),
    );
  }

  // ---- vector layers -------------------------------------------------------------------------

  isVectorLayer(id: string | undefined): boolean {
    return !!(id && this.layers.get(id)?.vector);
  }

  /** Replaces a vector layer's shapes as one undoable step (re-renders its pixels). */
  setVector(layerId: string, next: VectorDoc, label: string): boolean {
    const layer = this.layers.get(layerId);
    if (!layer?.vector || layer.meta.locked) return false;
    const before = layer.vector;
    layer.setVector(next);
    this.history.push(new VectorCommand(label, this.layers, layerId, before, next));
    this.emit();
    return true;
  }

  /**
   * Re-renders a vector layer's pixels leaving one shape out (the editor draws it live while it
   * is edited), or with all shapes again (null). Not an undo step.
   */
  previewVector(layerId: string, excludeId: string | null): void {
    const layer = this.layers.get(layerId);
    if (!layer?.vector) return;
    layer.renderVector(layer.vector, excludeId);
    this.emit({ dirty: false });
  }

  /**
   * Turns a raster layer into a vector layer with `shapes` (e.g. traced from its pixels, or none
   * for a fresh vector layer). Its former pixels are kept for undo.
   */
  convertToVector(layerId: string, shapes: VectorDoc): EditResult {
    const layer = this.layers.get(layerId);
    if (!layer) return fail('There is no layer to convert.');
    if (layer.vector) return fail('This is already a vector layer.');
    if (layer.meta.locked) return fail('The layer is locked.');
    const beforePixels = layer.readRegion(fullRect(layer));
    layer.setVector(shapes);
    this.history.push(new VectorCommand('Convert to vector layer', this.layers, layerId, null, shapes, beforePixels));
    this.emit();
    return ok(true);
  }

  /** Turns a vector layer back into an ordinary pixel layer (pixels unchanged). */
  rasterizeLayer(layerId: string): EditResult {
    const layer = this.layers.get(layerId);
    if (!layer?.vector) return fail('This is not a vector layer.');
    const before = layer.vector;
    layer.vector = null;
    this.history.push(new VectorCommand('Rasterize layer', this.layers, layerId, before, null));
    this.emit();
    return ok(true);
  }

  /** Adds a new, empty vector layer above the active one. */
  addVectorLayer(): EditResult<RasterLayer> {
    return this.insertNewLayer(createLayerMeta('Vector layer'), this.activeIndex() + 1, 'Add vector layer', (layer) => {
      layer.vector = { shapes: [] };
    });
  }

  /**
   * Adds a new layer on top of the stack, drawn by `render`, as one undoable step (e.g. comic
   * panels or page guides). `meta` can lock it or lower its opacity.
   */
  addDrawnLayer(name: string, label: string, render: (canvas: SkCanvas) => void, meta: Partial<LayerMeta> = {}): EditResult<RasterLayer> {
    return this.insertNewLayer(createLayerMeta(name, meta), this.layers.count, label, (layer) => layer.drawWith(render));
  }

  /**
   * Adds a new layer containing `image`, fitted inside the canvas and centred.
   * Returns null if the layer limit is reached.
   */
  addImageLayer(image: SkImage, name = 'Imported image'): RasterLayer | null {
    const layer = this.addLayer();
    if (!layer) return null;
    const scale = Math.min(1, this.info.width / image.width(), this.info.height / image.height());
    const w = image.width() * scale;
    const h = image.height() * scale;
    layer.meta = { ...layer.meta, name };
    // Pixels drawn before any further edit belong to the AddLayer step: undo removes the
    // whole layer, redo re-inserts the same (already filled) layer object.
    layer.drawImageInto(image, { x: (this.info.width - w) / 2, y: (this.info.height - h) / 2, width: w, height: h });
    this.emit();
    return layer;
  }

  /**
   * The active layer if `tool` may paint on it: it must exist, be visible and unlocked, and the
   * eraser is refused on alpha-locked layers (erasing changes coverage).
   */
  /** The active layer if it can take pixel edits (vector layers only with `allowVector`). */
  private editableLayer(tool: ToolId = 'brush', allowVector = false): RasterLayer | null {
    const layer = this.layers.active;
    if (!layer || layer.meta.locked || !layer.meta.visible) return null;
    if (layer.vector && !allowVector) return null;
    if (tool === 'eraser' && layer.meta.alphaLocked) return null;
    return layer;
  }

  /** Whole-layer edit recorded as "before + re-apply" (see ReapplyLayerCommand). */
  private recordReapplyEdit(layer: RasterLayer, label: string, edit: (layer: RasterLayer) => void): boolean {
    const before = layer.readRegion(fullRect(layer));
    edit(layer);
    this.history.push(new ReapplyLayerCommand(label, this.layers, layer.meta.id, before, edit));
    this.emit();
    return true;
  }

  /** Runs a pixel edit restricted to `bounds` and records before/after for undo. */
  private recordPixelEdit(layer: RasterLayer, bounds: Rect, label: string, edit: () => void): boolean {
    const rect = layer.clampRect(bounds);
    if (!rect) return false;
    const before = layer.readRegion(rect);
    edit();
    const after = layer.readRegion(rect);
    this.history.push(new PixelRegionCommand(label, this.layers, layer.meta.id, rect, before, after));
    this.emit();
    return true;
  }

  // ---- layers ------------------------------------------------------------------------------

  addLayer(): RasterLayer | null {
    // A new layer joins the active layer's group, so it appears right where the user is working.
    const groupId = this.layers.active?.meta.groupId;
    const meta = { ...this.nextLayerMeta(), ...(groupId && this.groups.has(groupId) ? { groupId } : {}) };
    const result = this.insertNewLayer(meta, this.activeIndex() + 1, 'Add layer');
    return result.ok ? result.value : null;
  }

  /** Copies a layer (pixels and properties) directly above it and makes the copy active. */
  duplicateLayer(id: string): EditResult<RasterLayer> {
    const source = this.layers.get(id);
    if (!source) return fail('Layer not found.');
    const meta = { ...source.meta, id: createId('l_'), name: `${source.meta.name} copy` };
    return this.insertNewLayer(meta, this.layers.indexOf(id) + 1, 'Duplicate layer', (layer) => {
      layer.drawWith((canvas) => canvas.drawImage(source.image, 0, 0));
      if (source.vector) layer.vector = { shapes: source.vector.shapes.map((s) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n })) })) };
    });
  }

  renameLayer(id: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed) this.setLayerProps(id, { name: trimmed });
  }

  /** Erases every pixel of a layer. */
  clearLayer(id: string): EditResult {
    const layer = this.layers.get(id);
    if (!layer) return fail('Layer not found.');
    if (layer.meta.locked) return fail('The layer is locked.');
    if (layer.vector) {
      this.setVector(layer.meta.id, EMPTY_VECTOR, 'Clear layer');
      return ok(true);
    }
    this.recordReapplyEdit(layer, 'Clear layer', (target) => target.clear());
    return ok(true);
  }

  // ---- fill & pixel selection ---------------------------------------------------------------

  /** Pixels of an image as premultiplied RGBA bytes (row-major), or null if unreadable. */
  private readPixels(image: SkImage): Uint8Array | null {
    const { width, height } = this.info;
    const data = image.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Premul });
    return data instanceof Uint8Array ? data : null;
  }

  /** The pixels the bucket / magic wand look at (see FillSource). */
  private sourcePixels(source: FillSource): Uint8Array | null {
    const active = this.layers.active;
    if (source === 'layer') return active ? this.readPixels(active.image) : null;
    const references = this.layers.list.filter((l) => l.meta.reference && l.meta.visible);
    const layers = source === 'reference' && references.length > 0 ? references : this.layers.list;
    const image = renderToImage(this.info.width, this.info.height, (canvas) => drawLayerStack(canvas, layers, undefined, this.groups));
    if (!image) return null;
    const pixels = this.readPixels(image);
    image.dispose();
    return pixels;
  }

  /** The area the bucket or magic wand would take at (x, y), or null. */
  private areaAt(x: number, y: number, options: FillOptions): Uint8Array | null {
    const { width, height } = this.info;
    const pixels = this.sourcePixels(options.source);
    if (!pixels) return null;
    const mask = floodFillMask(pixels, width, height, x, y, options.tolerance, options.contiguous);
    if (!mask) return null;
    return options.expand !== 0 ? growMask(mask, width, height, options.expand) : mask;
  }

  /**
   * Paint bucket: fills the area around (x, y) on the active layer with `color`. The area comes
   * from `options.source` (this layer, the whole canvas, or the reference layers), so line art
   * on another layer can define it. Clipped to the selection; alpha lock keeps transparency.
   */
  bucketFill(x: number, y: number, color: string, options: FillOptions): EditResult {
    const layer = this.editableLayer();
    if (!layer) return fail('Unlock and show the layer first.');
    const { width, height } = this.info;
    const mask = this.areaAt(x, y, options);
    const box = mask ? maskBounds(mask, width, height) : null;
    if (!mask || !box) return fail('Tap inside the canvas.');
    const image = alphaImage(mask, width, height);
    if (!image) return fail('Not enough memory to fill.');
    const bounds = { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 };
    const alphaLocked = layer.meta.alphaLocked;
    const done = this.recordPixelEdit(layer, bounds, 'Fill', () =>
      layer.drawWith(
        (canvas) => {
          // An alpha-only image is drawn in the paint's colour.
          const paint = Skia.Paint();
          paint.setColor(Skia.Color(color));
          if (alphaLocked) paint.setBlendMode(BlendMode.SrcATop);
          canvas.drawImage(image, 0, 0, paint);
        },
        this.selection,
        bounds,
        this.selectionFeather,
      ),
    );
    image.dispose();
    return done ? ok(true) : fail('Nothing to fill there.');
  }

  /**
   * Runs the bucket after yielding to the renderer once. Pixel reads and mask construction can
   * be expensive on large canvases, so keeping them out of the tap callback prevents the canvas
   * from appearing frozen before the fill starts.
   */
  bucketFillAsync(x: number, y: number, color: string, options: FillOptions): Promise<EditResult> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.bucketFill(x, y, color, options)), 0);
    });
  }

  /** Magic wand: selects the area around (x, y) (see `bucketFill` for the options). */
  magicWand(x: number, y: number, options: FillOptions, mode: SelectionMode = 'replace'): EditResult {
    const mask = this.areaAt(x, y, options);
    if (!mask) return fail('Tap inside the canvas.');
    return this.selectMask(mask, mode);
  }

  /** Selects the painted (non-transparent) pixels of a layer. */
  selectLayerContent(id: string, mode: SelectionMode = 'replace'): EditResult {
    const layer = this.layers.get(id);
    if (!layer) return fail('Layer not found.');
    const pixels = this.readPixels(layer.image);
    if (!pixels) return fail('Could not read the layer.');
    return this.selectMask(alphaMask(pixels, this.info.width, this.info.height, 8), mode);
  }

  private selectMask(mask: Uint8Array, mode: SelectionMode): EditResult {
    const rects = maskToRects(mask, this.info.width, this.info.height);
    if (rects.length === 0) return fail('Nothing to select there.');
    const b = Skia.PathBuilder.Make();
    for (const r of rects) b.addRect(Skia.XYWHRect(r.x, r.y, r.width, r.height));
    const path = Skia.Path.Simplify(b.build()) ?? b.build();
    this.combineSelection(path, mode);
    return ok(true);
  }

  /** Applies `path` to the selection: replace it, or add, subtract or intersect. */
  combineSelection(path: SkPath, mode: SelectionMode): void {
    const current = this.selectionPath;
    if (mode === 'replace' || !current) {
      this.setSelection(mode === 'subtract' ? null : path);
      return;
    }
    const op = mode === 'add' ? PathOp.Union : mode === 'subtract' ? PathOp.Difference : PathOp.Intersect;
    this.setSelection(Skia.Path.MakeFromOp(current, path, op));
  }

  /** Grows (px > 0) or shrinks (px < 0) the selection outline. */
  resizeSelection(px: number): EditResult {
    const current = this.selectionPath;
    if (!current) return fail('Make a selection first.');
    const outline = Skia.Path.Stroke(current, { width: Math.abs(px) * 2 });
    if (!outline) return fail('Could not change the selection.');
    const next = Skia.Path.MakeFromOp(current, outline, px > 0 ? PathOp.Union : PathOp.Difference);
    if (!next || next.isEmpty()) return fail('The selection would disappear.');
    this.setSelection(next);
    return ok(true);
  }

  /** Soft selection edge (px, 0 = hard); applies to edits made inside the selection. */
  setSelectionFeather(px: number): void {
    this.selectionFeather = Math.max(0, Math.min(200, px));
    this.emit({ dirty: false });
  }

  // ---- canvas size ----------------------------------------------------------------------------

  /**
   * Changes the canvas size without scaling the artwork: the old canvas sits at `anchor` inside
   * the new one (crop when smaller, transparent margin when larger).
   */
  resizeCanvas(width: number, height: number, anchor: CanvasAnchor): EditResult {
    const dx = Math.round((width - this.info.width) * anchor.x);
    const dy = Math.round((height - this.info.height) * anchor.y);
    return this.rebuildCanvas('Resize canvas', width, height, (canvas, image) => canvas.drawImage(image, dx, dy), (x, y) => ({ x: x + dx, y: y + dy }), 1);
  }

  /** Scales the whole artwork (every layer) to a new pixel size. */
  scaleCanvas(width: number, height: number): EditResult {
    const sx = width / this.info.width;
    const sy = height / this.info.height;
    return this.rebuildCanvas(
      'Scale image',
      width,
      height,
      (canvas, image) =>
        canvas.drawImageRectOptions(
          image,
          Skia.XYWHRect(0, 0, image.width(), image.height()),
          Skia.XYWHRect(0, 0, width, height),
          FilterMode.Linear,
          MipmapMode.Linear,
          null,
        ),
      (x, y) => ({ x: x * sx, y: y * sy }),
      Math.sqrt(sx * sy),
    );
  }

  /** Crops the canvas to the selection's bounds. */
  cropToSelection(): EditResult {
    const selection = this.selectionPath;
    if (!selection) return fail('Make a selection first.');
    const area = clampToCanvas(roundOut(selection.getBounds()), this.info.width, this.info.height);
    if (!area || area.width < 1 || area.height < 1) return fail('The selection is outside the canvas.');
    const result = this.rebuildCanvas(
      'Crop',
      area.width,
      area.height,
      (canvas, image) => canvas.drawImage(image, -area.x, -area.y),
      (x, y) => ({ x: x - area.x, y: y - area.y }),
      1,
    );
    if (result.ok) this.setSelection(null);
    return result;
  }

  /** Rotates the whole canvas by quarter turns (1 = 90° clockwise, 2 = 180°, 3 = 90° counter-clockwise). */
  rotateCanvas(quarterTurns: number): EditResult {
    const q = ((quarterTurns % 4) + 4) % 4;
    if (q === 0) return ok(true);
    const { width: w, height: h } = this.info;
    const nw = q % 2 === 1 ? h : w;
    const nh = q % 2 === 1 ? w : h;
    // Point maps (old → new) for each turn.
    const map = (x: number, y: number) => (q === 1 ? { x: h - y, y: x } : q === 2 ? { x: w - x, y: h - y } : { x: y, y: w - x });
    const label = q === 2 ? 'Rotate canvas 180°' : q === 1 ? 'Rotate canvas 90° clockwise' : 'Rotate canvas 90° counter-clockwise';
    return this.rebuildCanvas(
      label,
      nw,
      nh,
      (canvas, image) => {
        canvas.save();
        if (q === 1) canvas.concat([0, -1, h, 1, 0, 0, 0, 0, 1]);
        else if (q === 2) canvas.concat([-1, 0, w, 0, -1, h, 0, 0, 1]);
        else canvas.concat([0, 1, 0, -1, 0, w, 0, 0, 1]);
        canvas.drawImage(image, 0, 0);
        canvas.restore();
      },
      map,
      1,
    );
  }

  /** Mirrors the whole canvas (every layer). */
  flipCanvas(axis: 'x' | 'y'): EditResult {
    const { width: w, height: h } = this.info;
    return this.rebuildCanvas(
      axis === 'x' ? 'Flip canvas horizontally' : 'Flip canvas vertically',
      w,
      h,
      (canvas, image) => {
        canvas.save();
        canvas.concat(axis === 'x' ? [-1, 0, w, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, h, 0, 0, 1]);
        canvas.drawImage(image, 0, 0);
        canvas.restore();
      },
      (x, y) => (axis === 'x' ? { x: w - x, y } : { x, y: h - y }),
      1,
    );
  }

  /**
   * Re-draws every layer onto a new canvas of `width` × `height` as one undoable step. Layers
   * get new ids (saved layer files are named by id and revision, so reuse could collide).
   */
  private rebuildCanvas(
    label: string,
    width: number,
    height: number,
    draw: (canvas: SkCanvas, image: SkImage) => void,
    mapPointFn: (x: number, y: number) => { x: number; y: number },
    strokeScale: number,
  ): EditResult {
    if (width < MIN_CANVAS_SIDE || height < MIN_CANVAS_SIDE || width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) {
      return fail(`The canvas must be between ${MIN_CANVAS_SIDE} and ${MAX_CANVAS_SIDE} pixels on each side.`);
    }
    if (this.layers.count > maxLayersFor(width, height)) {
      return fail(`At ${width} × ${height} this device can hold ${maxLayersFor(width, height)} layers; this artwork has ${this.layers.count}.`);
    }
    const created: RasterLayer[] = [];
    let activeId: string | null = null;
    try {
      for (const old of this.layers.list) {
        const layer = RasterLayer.create({ ...old.meta, id: createId('l_') }, width, height);
        created.push(layer);
        if (old.meta.id === this.layers.activeId) activeId = layer.meta.id;
        if (old.vector) {
          layer.setVector(mapVector(old.vector, mapPointFn, strokeScale));
        } else {
          layer.drawWith((canvas) => draw(canvas, old.image));
        }
      }
    } catch (error) {
      console.warn('[document] Canvas resize failed', error);
      for (const layer of created) layer.dispose();
      return fail('Not enough memory for that canvas size.');
    }
    const before: CanvasState = { layers: [...this.layers.list], activeId: this.layers.activeId, width: this.info.width, height: this.info.height };
    const after: CanvasState = { layers: created, activeId, width, height };
    const setSize = (w: number, h: number) => {
      this.info = { ...this.info, width: w, height: h };
      this.selectionPath = null;
    };
    this.layers.replace(after.layers, after.activeId);
    setSize(width, height);
    this.history.push(new CanvasCommand(label, this.layers, setSize, before, after));
    this.emit();
    return ok(true);
  }

  // ---- adjustments & gradient ---------------------------------------------------------------

  /** Applies an adjustment or filter to a layer (only inside the selection, if there is one). */
  applyAdjustment(id: string, adjustment: Adjustment, label: string): EditResult {
    const layer = this.layers.get(id);
    if (!layer) return fail('Layer not found.');
    if (layer.meta.locked) return fail('The layer is locked.');
    if (layer.vector) return fail('Rasterize the vector layer first.');
    if (isNeutral(adjustment)) return fail('Nothing would change with these settings.');
    const selection = this.selectionPath?.copy() ?? null;
    const feather = this.selectionFeather;
    let supported = true;
    this.recordReapplyEdit(layer, label, (target) => {
      const source = target.image;
      target.drawWith((canvas) => {
        supported = drawAdjusted(canvas, source, adjustment);
      }, selection, undefined, feather);
    });
    return supported ? ok(true) : fail('This device can’t run that adjustment.');
  }

  /** Fills the active layer (or the selection) with a gradient. */
  fillGradient(spec: GradientSpec): EditResult {
    const layer = this.editableLayer();
    if (!layer) return fail('Unlock and show the layer first.');
    const shader = gradientShader(spec, toneGradientEffect());
    if (!shader) return fail('Drag a little further to make a gradient.');
    const selection = this.selectionPath;
    const bounds = selection ? roundOut(selection.getBounds()) : fullRect(layer);
    const alphaLocked = layer.meta.alphaLocked;
    const label = spec.kind === 'tone' ? 'Tone gradient' : 'Gradient';
    const done = this.recordPixelEdit(layer, bounds, label, () =>
      layer.drawWith(
        (canvas) => {
          const paint = Skia.Paint();
          paint.setShader(shader);
          paint.setDither(true);
          if (alphaLocked) paint.setBlendMode(BlendMode.SrcATop);
          canvas.drawRect(Skia.XYWHRect(0, 0, layer.width, layer.height), paint);
        },
        selection,
        bounds,
        this.selectionFeather,
      ),
    );
    return done ? ok(true) : fail('The selection is outside the canvas.');
  }

  /**
   * Applies a liquify mesh (vertex positions over the undeformed grid, see engine/layers/liquify)
   * to the active layer as one undoable step.
   */
  applyLiquify(positions: readonly number[]): EditResult {
    const layer = this.editableLayer();
    if (!layer) return fail('Unlock and show the layer first.');
    const textures = createLiquifyMesh(this.info.width, this.info.height);
    if (positions.length !== textures.length) return fail('The liquify mesh does not match this canvas.');
    if (!isDeformed(positions, textures)) return fail('Nothing was liquified.');
    const indices = liquifyIndices();
    const pos = toPoints(positions);
    const tex = toPoints(textures);
    this.recordReapplyEdit(layer, 'Liquify', (target) =>
      target.redraw((canvas, source) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setShader(source.makeShaderOptions(TileMode.Decal, TileMode.Decal, FilterMode.Linear, MipmapMode.None));
        canvas.drawVertices(Skia.MakeVertices(VertexMode.Triangles, pos, tex, undefined, indices), BlendMode.Dst, paint);
      }),
    );
    return ok(true);
  }

  // ---- history jumps ------------------------------------------------------------------------

  /** Undoes `steps` steps at once (history panel). */
  undoSteps(steps: number): void {
    let changed = false;
    for (let i = 0; i < steps; i++) changed = !!this.history.undo() || changed;
    if (changed) this.emit();
  }

  /** Redoes `steps` steps at once (history panel). */
  redoSteps(steps: number): void {
    let changed = false;
    for (let i = 0; i < steps; i++) changed = !!this.history.redo() || changed;
    if (changed) this.emit();
  }

  // ---- layer groups (folders) --------------------------------------------------------------

  /** Records a structural edit made by `edit` (group changes) as one undo step. */
  private recordStructure(label: string, edit: () => void): void {
    const before = takeStructure(this.layers, this.groups);
    edit();
    const after = takeStructure(this.layers, this.groups);
    this.history.push(new StructureCommand(label, this.layers, (groups) => (this.groups = groups), before, after));
    this.emit();
  }

  /**
   * Puts layers into a new group (folder). They are gathered, in stack order, where the top-most
   * of them is; layers already in other groups leave those groups.
   */
  groupLayers(ids: readonly string[]): EditResult<string> {
    const chosen = this.layers.list.filter((l) => ids.includes(l.meta.id));
    if (chosen.length === 0) return fail('Choose layers to group.');
    this.groupCounter += 1;
    const group: LayerGroupMeta = {
      id: createId('g_'),
      name: `Group ${this.groupCounter}`,
      visible: true,
      opacity: 1,
      blendMode: 'srcOver',
      collapsed: false,
    };
    this.recordStructure('Group layers', () => {
      const top = chosen[chosen.length - 1];
      const rest = this.layers.list.filter((l) => !chosen.includes(l));
      // Insert the group right below whatever was above its top-most layer.
      const above = this.layers.list.slice(this.layers.indexOf(top.meta.id) + 1).find((l) => !chosen.includes(l));
      const at = above ? rest.indexOf(above) : rest.length;
      const order = [...rest.slice(0, at), ...chosen, ...rest.slice(at)];
      for (const layer of chosen) layer.meta = { ...layer.meta, groupId: group.id };
      this.groups.set(group.id, group);
      this.layers.replace(order, this.layers.activeId);
    });
    return ok(group.id);
  }

  /** Releases a group's layers back into the stack and removes the group. */
  ungroup(groupId: string): EditResult {
    if (!this.groups.has(groupId)) return fail('Group not found.');
    this.recordStructure('Ungroup', () => {
      for (const layer of this.layers.list) {
        if (layer.meta.groupId === groupId) layer.meta = { ...layer.meta, groupId: undefined };
      }
      this.groups.delete(groupId);
    });
    return ok(true);
  }

  /** Changes a group's name, visibility, opacity, blend mode or folding. */
  setGroupProps(
    groupId: string,
    patch: Partial<Omit<LayerGroupMeta, 'id'>>,
    options: { transient?: boolean } = {},
  ): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    // Folding is display only; slider drags record once, on release.
    if (options.transient || (Object.keys(patch).length === 1 && patch.collapsed !== undefined)) {
      this.groups.set(groupId, { ...group, ...patch });
      this.emit({ dirty: patch.collapsed === undefined });
      return;
    }
    this.recordStructure('Group properties', () => this.groups.set(groupId, { ...group, ...patch }));
  }

  /** Records a finished group opacity drag (`before` = the value when the drag started). */
  commitGroupOpacity(groupId: string, before: number): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    const after = group.opacity;
    this.groups.set(groupId, { ...group, opacity: before });
    this.recordStructure('Group opacity', () => this.groups.set(groupId, { ...group, opacity: after }));
  }

  /** Merges a group's visible layers into one layer (with the group's opacity and blend mode). */
  mergeGroup(groupId: string): EditResult<RasterLayer> {
    const group = this.groups.get(groupId);
    if (!group) return fail('Group not found.');
    const members = this.layers.list.filter((l) => l.meta.groupId === groupId);
    if (members.length === 0) return fail('The group is empty.');
    if (members.some((l) => l.meta.locked)) return fail('Unlock the group’s layers to merge them.');
    const visible = members.filter((l) => l.meta.visible);
    const top = members[members.length - 1];
    const keep = this.layers.list.filter((l) => l === top || !members.includes(l));
    const meta = createLayerMeta(group.name, { opacity: group.opacity, blendMode: group.blendMode, visible: group.visible });
    const result = this.replaceLayers('Merge group', meta, keep, top, (canvas) => drawLayerStack(canvas, visible));
    if (result.ok) this.groups.delete(groupId);
    return result;
  }

  /** Deletes a group and all its layers. */
  deleteGroup(groupId: string): EditResult {
    const members = this.layers.list.filter((l) => l.meta.groupId === groupId);
    if (members.length >= this.layers.count) return fail('An artwork needs at least one layer outside the group.');
    const before: LayerStackState = { layers: [...this.layers.list], activeId: this.layers.activeId };
    const remaining = this.layers.list.filter((l) => !members.includes(l));
    const after: LayerStackState = { layers: remaining, activeId: remaining[remaining.length - 1]?.meta.id ?? null };
    this.layers.replace(after.layers, after.activeId);
    this.history.push(new ReplaceLayersCommand('Delete group', this.layers, before, after));
    this.emit();
    return ok(true);
  }

  /** Group of the active layer, if any. */
  get activeGroup(): LayerGroupMeta | null {
    const id = this.layers.active?.meta.groupId;
    return id ? (this.groups.get(id) ?? null) : null;
  }

  // ---- animation ----------------------------------------------------------------------------

  /** Top-level items of the stack: with animation on, each one is a frame (bottom → top). */
  get frames(): StackItem<RasterLayer>[] {
    return stackItems(this.layers.list, this.groups);
  }

  /** Index of the frame holding the active layer (-1 if none). */
  get activeFrameIndex(): number {
    const id = this.layers.activeId;
    return this.frames.findIndex((f) => f.layers.some((l) => l.meta.id === id));
  }

  setAnimation(patch: Partial<AnimationSettings>): void {
    this.animation = sanitizeAnimation({ ...this.animation, ...patch });
    this.emit();
  }

  /** Adds an empty frame (a new layer) right after the current frame and selects it. */
  addFrame(): EditResult<RasterLayer> {
    const frames = this.frames;
    const current = frames[this.activeFrameIndex] ?? frames[frames.length - 1];
    const last = current?.layers[current.layers.length - 1];
    const index = last ? this.layers.indexOf(last.meta.id) + 1 : this.layers.count;
    this.layerCounter += 1;
    return this.insertNewLayer(createLayerMeta(`Frame ${frames.length + 1}`), index, 'Add frame');
  }

  /** Copies the current frame (all its layers) right after it, as a single new layer. */
  duplicateFrame(): EditResult<RasterLayer> {
    const frames = this.frames;
    const current = frames[this.activeFrameIndex];
    if (!current) return fail('Select a frame first.');
    const last = current.layers[current.layers.length - 1];
    const sources = current.layers;
    return this.insertNewLayer(
      createLayerMeta(`Frame ${frames.length + 1}`),
      this.layers.indexOf(last.meta.id) + 1,
      'Duplicate frame',
      (layer) => layer.drawWith((canvas) => drawLayerStack(canvas, sources, undefined, this.groups)),
    );
  }

  /** Makes the frame at `index` current (selects its top layer). */
  selectFrame(index: number): void {
    const frame = this.frames[index];
    if (!frame) return;
    const top = frame.layers[frame.layers.length - 1];
    this.setActiveLayer(top.meta.id);
  }

  // ---- clipping & masks --------------------------------------------------------------------

  /** Clips a layer to the layer below it (it then only shows where that layer has pixels). */
  setClipping(id: string, clip: boolean): EditResult {
    const layer = this.layers.get(id);
    if (!layer) return fail('Layer not found.');
    if (layer.meta.mask) return fail('A mask can’t be a clipping layer.');
    if (clip && this.layers.indexOf(id) === 0) return fail('A clipping layer needs a layer below it.');
    this.setLayerProps(id, { clip });
    return ok(true);
  }

  /**
   * Adds a layer mask directly above layer `id`. It starts white (everything shows), or with a
   * selection, white only inside it. Painting black on the mask hides, white reveals.
   */
  addMask(id: string): EditResult<RasterLayer> {
    const layer = this.layers.get(id);
    if (!layer) return fail('Layer not found.');
    if (layer.meta.mask) return fail('This layer is already a mask.');
    const selection = this.selectionPath;
    const meta = createLayerMeta(`${layer.meta.name} mask`, { mask: true });
    return this.insertNewLayer(meta, this.layers.indexOf(id) + 1, 'Add mask', (mask) =>
      mask.drawWith((canvas) => {
        if (!selection) {
          canvas.drawColor(Skia.Color('white'));
          return;
        }
        canvas.drawColor(Skia.Color('black'));
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setColor(Skia.Color('white'));
        canvas.drawPath(selection, paint);
      }),
    );
  }

  /** Swaps what a mask shows and hides. */
  invertMask(id: string): EditResult {
    const layer = this.layers.get(id);
    if (!layer?.meta.mask) return fail('Select a mask layer first.');
    if (layer.meta.locked) return fail('The mask is locked.');
    this.recordReapplyEdit(layer, 'Invert mask', (target) => {
      const source = target.image;
      target.drawWith((canvas) => {
        // Over black first, so erased (transparent) parts count as hidden and become shown.
        const invert = Skia.Paint();
        invert.setColorFilter(Skia.ColorFilter.MakeMatrix([-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0]));
        canvas.saveLayer(invert);
        canvas.drawColor(Skia.Color('black'));
        canvas.drawImage(source, 0, 0);
        canvas.restore();
      });
    });
    return ok(true);
  }

  /** Bakes a mask into its layer (the hidden parts are erased) and removes the mask. */
  applyMask(id: string): EditResult<RasterLayer> {
    const layer = this.layers.get(id);
    if (!layer?.meta.mask) return fail('Select a mask layer first.');
    return this.mergeDown(id);
  }

  /** Fills the layer (or the selection on it) with `color`; alpha lock keeps transparency. */
  fillLayer(id: string, color: string): EditResult {
    const layer = this.layers.get(id);
    if (!layer) return fail('Layer not found.');
    if (layer.meta.locked) return fail('The layer is locked.');
    if (layer.vector) return fail('Rasterize the vector layer first.');
    const selection = this.selectionPath;
    const bounds = selection ? roundOut(selection.getBounds()) : fullRect(layer);
    const alphaLocked = layer.meta.alphaLocked;
    const done = this.recordPixelEdit(layer, bounds, 'Fill layer', () =>
      layer.drawWith(
        (canvas) => {
          const paint = Skia.Paint();
          paint.setColor(Skia.Color(color));
          if (alphaLocked) paint.setBlendMode(BlendMode.SrcATop);
          canvas.drawPaint(paint);
        },
        selection,
        bounds,
      ),
    );
    return done ? ok(true) : fail('The selection is outside the canvas.');
  }

  /** Why `id` cannot be merged into the layer below, or null if it can. */
  mergeDownBlocker(id: string): string | null {
    const index = this.layers.indexOf(id);
    const upper = this.layers.list[index];
    const lower = this.layers.list[index - 1];
    if (!upper || !lower) return 'There is no layer below to merge into.';
    if (upper.meta.locked || lower.meta.locked) return 'Unlock both layers to merge them.';
    if (!upper.meta.visible || !lower.meta.visible) return 'Show both layers to merge them.';
    return null;
  }

  /**
   * Merges a layer into the one below. The result keeps the lower layer's name, blend mode and
   * locks; both opacities are baked into the pixels. As in other painting apps the pair is
   * composited in isolation, so a non-Normal upper layer that was blending with layers further
   * down can look different afterwards.
   */
  mergeDown(id: string): EditResult<RasterLayer> {
    const blocker = this.mergeDownBlocker(id);
    if (blocker) return fail(blocker);
    const index = this.layers.indexOf(id);
    const lower = this.layers.list[index - 1];
    const upper = this.layers.list[index];
    // A fresh id: saves name layer files by id + revision, so reusing one could collide.
    const meta = { ...lower.meta, id: createId('l_'), opacity: 1 };
    return this.replaceWithMerged('Merge down', [lower, upper], meta, upper);
  }

  /**
   * Merges several layers into one, placed where the top-most of them was. Hidden layers in
   * `ids` are left untouched, matching what is on screen.
   */
  mergeLayers(ids: readonly string[]): EditResult<RasterLayer> {
    const chosen = this.layers.list.filter((l) => ids.includes(l.meta.id) && l.meta.visible);
    if (chosen.length < 2) return fail('Select at least two visible layers to merge.');
    if (chosen.some((l) => l.meta.locked)) return fail('Unlock the selected layers to merge them.');
    const top = chosen[chosen.length - 1];
    return this.replaceWithMerged('Merge layers', chosen, createLayerMeta(top.meta.name), top);
  }

  /**
   * Flattens the artwork into a single layer. Hidden layers are discarded (undo restores
   * them). The paper colour normally stays separate, but it is baked in when a visible layer
   * uses a non-Normal blend mode — such layers blend with the paper, and leaving it out would
   * change how the artwork looks.
   */
  flatten(): EditResult<RasterLayer> {
    if (this.layers.count < 2) return fail('There is only one layer.');
    const visible = this.layers.list.filter((l) => l.meta.visible);
    if (visible.some((l) => l.meta.locked)) return fail('Unlock all visible layers to flatten.');
    const bakePaper = !isTransparentColor(this.info.background) && visible.some((l) => l.meta.blendMode !== 'srcOver');
    const background = this.info.background;
    return this.replaceLayers('Flatten', createLayerMeta('Flattened'), [], null, (canvas) => {
      if (bakePaper) canvas.drawColor(Skia.Color(background));
      drawLayerStack(canvas, visible, undefined, this.groups);
    });
  }

  removeLayer(id: string): boolean {
    if (this.layers.count <= 1) return false;
    const wasActive = this.layers.activeId === id;
    const removed = this.layers.remove(id);
    if (!removed) return false;
    this.history.push(new RemoveLayerCommand(this.layers, removed.layer, removed.index, wasActive));
    this.emit();
    return true;
  }

  moveLayer(id: string, toIndex: number): boolean {
    const layer = this.layers.get(id);
    if (!layer) return false;
    const groupId = layer.meta.groupId;
    // Moving past a group's edge takes the layer out of it; moving into the middle of a group
    // (between two of its layers) puts it in. Both are structure changes.
    const others = this.layers.list.filter((l) => l !== layer);
    const target = Math.max(0, Math.min(toIndex, others.length));
    const below = others[target - 1];
    const above = others[target];
    const joins = below?.meta.groupId && below.meta.groupId === above?.meta.groupId ? below.meta.groupId : undefined;
    const stays = groupId && (below?.meta.groupId === groupId || above?.meta.groupId === groupId) ? groupId : undefined;
    const nextGroup = joins ?? stays;
    if (nextGroup !== groupId) {
      this.recordStructure('Move layer', () => {
        this.layers.move(id, toIndex);
        layer.meta = { ...layer.meta, groupId: nextGroup };
      });
      return true;
    }
    const from = this.layers.indexOf(id);
    if (!this.layers.move(id, toIndex)) return false;
    this.history.push(new MoveLayerCommand(this.layers, id, from, this.layers.indexOf(id)));
    this.emit();
    return true;
  }

  setActiveLayer(id: string): void {
    if (this.layers.activeId === id || !this.layers.get(id)) return;
    this.layers.activeId = id;
    this.emit();
  }

  /**
   * Updates layer properties. Pass `transient: true` for continuous changes (slider drags) and
   * then a final call with `before` set to the values captured when the drag started, so the
   * whole drag becomes a single undo step.
   */
  setLayerProps(
    id: string,
    patch: LayerPropsPatch,
    options: { transient?: boolean; before?: LayerPropsPatch } = {},
  ): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    const before: LayerPropsPatch = options.before ?? pick(layer.meta, patch);
    layer.meta = { ...layer.meta, ...patch };
    if (!options.transient && !samePatch(before, patch)) {
      this.history.push(new LayerPropsCommand(this.layers, id, before, patch, propsLabel(patch)));
    }
    this.emit();
  }

  // ---- history -----------------------------------------------------------------------------

  /** Undoes the last step; returns its label (for feedback), or null if there was none. */
  undo(): string | null {
    const command = this.history.undo();
    if (command) this.emit();
    return command?.label ?? null;
  }

  redo(): string | null {
    const command = this.history.redo();
    if (command) this.emit();
    return command?.label ?? null;
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  rename(name: string): void {
    this.info = { ...this.info, name };
    this.emit();
  }

  /** Turns timelapse recording for this artwork on or off (saved with the artwork). */
  setRecordTimelapse(recordTimelapse: boolean): void {
    if (this.info.recordTimelapse === recordTimelapse) return;
    this.info = { ...this.info, recordTimelapse };
    this.emit();
  }

  /** Used by the deserializer to restore layer groups and animation settings. */
  restoreStructure(groups: readonly LayerGroupMeta[], animation: AnimationSettings | null): void {
    this.groups = new Map(groups.map((g) => [g.id, { ...g }]));
    this.groupCounter = groups.length;
    if (animation) this.animation = sanitizeAnimation(animation);
  }

  /** Used by the deserializer to register a loaded layer without creating history. */
  restoreLayer(layer: RasterLayer): void {
    this.layers.insert(layer);
    this.layerCounter += 1;
  }

  dispose(): void {
    this.history.clear();
    this.layers.disposeAll();
    this.listeners.clear();
  }

  private activeIndex(): number {
    return this.layers.active ? this.layers.indexOf(this.layers.active.meta.id) : -1;
  }

  /** Creates a layer, optionally fills it, inserts it at `index` and records one undo step. */
  private insertNewLayer(
    meta: LayerMeta,
    index: number,
    label: string,
    fill?: (layer: RasterLayer) => void,
  ): EditResult<RasterLayer> {
    if (this.layers.count >= this.maxLayers) {
      return fail(`This canvas size supports up to ${this.maxLayers} layers on this device.`);
    }
    const layer = this.tryCreateLayer(meta);
    if (!layer) return fail('Not enough memory for another layer.');
    // Pixels drawn before the push belong to the AddLayer step (redo re-inserts this object).
    fill?.(layer);
    const previousActiveId = this.layers.activeId;
    this.layers.insert(layer, index);
    this.layers.activeId = layer.meta.id;
    this.history.push(new AddLayerCommand(this.layers, layer, index, previousActiveId, label));
    this.emit();
    return ok(layer);
  }

  /** Composites `sources` into a new layer that takes the place of `placeholder`. */
  private replaceWithMerged(
    label: string,
    sources: readonly RasterLayer[],
    meta: LayerMeta,
    placeholder: RasterLayer,
  ): EditResult<RasterLayer> {
    const keep = this.layers.list.filter((l) => l === placeholder || !sources.includes(l));
    return this.replaceLayers(label, meta, keep, placeholder, (canvas) => drawLayerStack(canvas, sources));
  }

  /**
   * Renders a new layer, then swaps the stack for `keep` with the new layer standing in for
   * `placeholder` (or as the only layer when `placeholder` is null). One undo step.
   */
  private replaceLayers(
    label: string,
    meta: LayerMeta,
    keep: readonly RasterLayer[],
    placeholder: RasterLayer | null,
    render: RenderFn,
  ): EditResult<RasterLayer> {
    const merged = this.tryCreateLayer(meta);
    if (!merged) return fail('Not enough memory to merge these layers.');
    merged.drawWith(render);
    const before: LayerStackState = { layers: [...this.layers.list], activeId: this.layers.activeId };
    const after: LayerStackState = {
      layers: placeholder ? keep.map((l) => (l === placeholder ? merged : l)) : [merged],
      activeId: merged.meta.id,
    };
    this.layers.replace(after.layers, after.activeId);
    this.history.push(new ReplaceLayersCommand(label, this.layers, before, after));
    this.emit();
    return ok(merged);
  }

  private tryCreateLayer(meta: LayerMeta): RasterLayer | null {
    try {
      return RasterLayer.create(meta, this.info.width, this.info.height);
    } catch (error) {
      console.warn('[document] Layer allocation failed', error);
      return null;
    }
  }

  private nextLayerMeta(): LayerMeta {
    this.layerCounter += 1;
    return createLayerMeta(`Layer ${this.layerCounter}`);
  }

  private emit({ dirty = true }: { dirty?: boolean } = {}): void {
    if (dirty) {
      this.contentVersion += 1;
      this.info = { ...this.info, updatedAt: Date.now() };
    }
    this.observedVersion += 1;
    for (const listener of this.listeners) listener();
  }
}

function pick(meta: LayerMeta, patch: LayerPropsPatch): LayerPropsPatch {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof LayerPropsPatch)[]) {
    out[key] = meta[key];
  }
  return out as LayerPropsPatch;
}

type RenderFn = Parameters<RasterLayer['drawWith']>[0];

/** Renders into a fresh transparent image, or null if memory runs out. */
function renderToImage(width: number, height: number, render: RenderFn): SkImage | null {
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  render(canvas);
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}

/**
 * The layer's pixels inside `selection` (anti-aliased edge), cropped to the selection bounds;
 * the whole layer when `selection` is null. Null when the selection misses the canvas.
 */
function extractRegion(layer: RasterLayer, selection: SkPath | null): { image: SkImage; x: number; y: number } | null {
  const area = layer.clampRect(selection ? roundOut(selection.getBounds()) : fullRect(layer));
  if (!area) return null;
  const image = renderToImage(area.width, area.height, (canvas) => {
    canvas.translate(-area.x, -area.y);
    if (selection) canvas.clipPath(selection, ClipOp.Intersect, true);
    canvas.drawImage(layer.image, 0, 0);
  });
  return image ? { image, x: area.x, y: area.y } : null;
}

function samePatch(a: LayerPropsPatch, b: LayerPropsPatch): boolean {
  return (Object.keys(b) as (keyof LayerPropsPatch)[]).every((key) => a[key] === b[key]);
}

function propsLabel(patch: LayerPropsPatch): string {
  if (patch.name !== undefined) return 'Rename layer';
  if (patch.opacity !== undefined) return 'Layer opacity';
  if (patch.blendMode !== undefined) return 'Blend mode';
  if (patch.visible !== undefined) return patch.visible ? 'Show layer' : 'Hide layer';
  if (patch.locked !== undefined) return patch.locked ? 'Lock layer' : 'Unlock layer';
  if (patch.alphaLocked !== undefined) return patch.alphaLocked ? 'Alpha lock' : 'Alpha unlock';
  if (patch.clip !== undefined) return patch.clip ? 'Clipping mask' : 'Release clipping mask';
  if (patch.reference !== undefined) return patch.reference ? 'Reference layer' : 'Not a reference layer';
  return 'Layer properties';
}

/** An alpha-only (A8) image of a mask; drawn with a paint, it takes the paint's colour. */
function alphaImage(mask: Uint8Array, width: number, height: number): SkImage | null {
  return Skia.Image.MakeImage(
    { width, height, colorType: ColorType.Alpha_8, alphaType: AlphaType.Premul },
    Skia.Data.fromBytes(mask),
    width,
  );
}

function clampToCanvas(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.width);
  const y1 = Math.min(height, r.y + r.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Keeps animation settings within their ranges (also for data from files). */
export function sanitizeAnimation(a: Partial<AnimationSettings>): AnimationSettings {
  const n = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    enabled: a.enabled === true,
    fps: Math.round(n(a.fps, DEFAULT_ANIMATION.fps, 1, 30)),
    loop: a.loop === 'pingPong' || a.loop === 'once' ? a.loop : 'loop',
    onionBefore: Math.round(n(a.onionBefore, DEFAULT_ANIMATION.onionBefore, 0, 5)),
    onionAfter: Math.round(n(a.onionAfter, DEFAULT_ANIMATION.onionAfter, 0, 5)),
    onionOpacity: n(a.onionOpacity, DEFAULT_ANIMATION.onionOpacity, 0.05, 1),
    background: a.background === true,
  };
}

function fullRect(layer: RasterLayer): Rect {
  return { x: 0, y: 0, width: layer.width, height: layer.height };
}

function roundOut(r: SkRect): Rect {
  const x = Math.floor(r.x) - 1;
  const y = Math.floor(r.y) - 1;
  return { x, y, width: Math.ceil(r.x + r.width) + 1 - x, height: Math.ceil(r.y + r.height) + 1 - y };
}

function intersectRects(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
