import type { SkImage } from '@shopify/react-native-skia';

import type { HistoryCommand, HistoryStack } from '@/engine/history/HistoryManager';
import type { LayerStack } from '@/engine/layers/LayerStack';
import type { RasterLayer } from '@/engine/layers/RasterLayer';
import type { LayerGroupMeta, LayerMeta, Rect } from '@/engine/types';
import type { VectorDoc } from '@/engine/vector/vectorModel';

/**
 * Pixel edit restricted to a dirty rectangle. Only the affected region is stored (before and
 * after), which keeps undo memory proportional to stroke size rather than canvas size.
 */
export class PixelRegionCommand implements HistoryCommand {
  readonly byteSize: number;

  constructor(
    readonly label: string,
    private layers: LayerStack,
    private layerId: string,
    private rect: Rect,
    private before: SkImage,
    private after: SkImage,
  ) {
    this.byteSize = rect.width * rect.height * 4 * 2;
  }

  undo(): void {
    this.layers.get(this.layerId)?.writeRegion(this.before, this.rect);
  }

  redo(): void {
    this.layers.get(this.layerId)?.writeRegion(this.after, this.rect);
  }

  dispose(): void {
    this.before.dispose();
    this.after.dispose();
  }
}

export class AddLayerCommand implements HistoryCommand {
  readonly byteSize = 0;

  constructor(
    private layers: LayerStack,
    private layer: RasterLayer,
    private index: number,
    private previousActiveId: string | null,
    readonly label = 'Add layer',
  ) {}

  undo(): void {
    this.layers.remove(this.layer.meta.id);
    this.layers.activeId = this.previousActiveId;
  }

  redo(): void {
    this.layers.insert(this.layer, this.index);
    this.layers.activeId = this.layer.meta.id;
  }

  dispose(from: HistoryStack): void {
    // On the redo stack the layer is detached and nothing else references it.
    if (from === 'redo') this.layer.dispose();
  }
}

export class RemoveLayerCommand implements HistoryCommand {
  readonly label = 'Delete layer';
  readonly byteSize: number;

  constructor(
    private layers: LayerStack,
    private layer: RasterLayer,
    private index: number,
    private wasActive: boolean,
  ) {
    // The detached layer's surface is kept alive by this command.
    this.byteSize = layer.bytes;
  }

  undo(): void {
    this.layers.insert(this.layer, this.index);
    if (this.wasActive) this.layers.activeId = this.layer.meta.id;
  }

  redo(): void {
    this.layers.remove(this.layer.meta.id);
  }

  dispose(from: HistoryStack): void {
    if (from === 'undo') this.layer.dispose();
  }
}

export class MoveLayerCommand implements HistoryCommand {
  readonly label = 'Move layer';
  readonly byteSize = 0;

  constructor(
    private layers: LayerStack,
    private layerId: string,
    private from: number,
    private to: number,
  ) {}

  undo(): void {
    this.layers.move(this.layerId, this.from);
  }

  redo(): void {
    this.layers.move(this.layerId, this.to);
  }

  dispose(): void {}
}

export type LayerPropsPatch = Partial<Omit<LayerMeta, 'id'>>;

export class LayerPropsCommand implements HistoryCommand {
  readonly byteSize = 0;

  constructor(
    private layers: LayerStack,
    private layerId: string,
    private before: LayerPropsPatch,
    private after: LayerPropsPatch,
    readonly label = 'Layer properties',
  ) {}

  undo(): void {
    this.apply(this.before);
  }

  redo(): void {
    this.apply(this.after);
  }

  dispose(): void {}

  private apply(patch: LayerPropsPatch): void {
    const layer = this.layers.get(this.layerId);
    if (layer) layer.meta = { ...layer.meta, ...patch };
  }
}

/**
 * Whole-layer edit that can be re-applied deterministically (clear, transform). Only the
 * pixels from *before* the edit are kept; redo simply runs the edit again on them. This halves
 * the memory of a full-layer before/after pair, which matters on large canvases.
 */
/**
 * A change to a layer's vector shapes. Converting a raster layer to vector also stores its
 * former pixels (`beforePixels`) so undo can bring them back.
 */
export class VectorCommand implements HistoryCommand {
  readonly byteSize: number;

  constructor(
    readonly label: string,
    private layers: LayerStack,
    private layerId: string,
    private before: VectorDoc | null,
    private after: VectorDoc | null,
    private beforePixels: SkImage | null = null,
  ) {
    this.byteSize =
      (beforePixels ? beforePixels.width() * beforePixels.height() * 4 : 0) +
      64 * ((before?.shapes.length ?? 0) + (after?.shapes.length ?? 0));
  }

  undo(): void {
    const layer = this.layers.get(this.layerId);
    if (!layer) return;
    if (this.before) {
      layer.setVector(this.before);
    } else {
      layer.vector = null;
      if (this.beforePixels) layer.writeRegion(this.beforePixels, { x: 0, y: 0, width: layer.width, height: layer.height });
    }
  }

  redo(): void {
    const layer = this.layers.get(this.layerId);
    if (!layer) return;
    if (this.after) layer.setVector(this.after);
    else layer.vector = null;
  }

  dispose(): void {
    this.beforePixels?.dispose();
  }
}

export class ReapplyLayerCommand implements HistoryCommand {
  readonly byteSize: number;

  constructor(
    readonly label: string,
    private layers: LayerStack,
    private layerId: string,
    private before: SkImage,
    private reapply: (layer: RasterLayer) => void,
  ) {
    this.byteSize = before.width() * before.height() * 4;
  }

  undo(): void {
    const layer = this.layers.get(this.layerId);
    layer?.writeRegion(this.before, { x: 0, y: 0, width: layer.width, height: layer.height });
  }

  redo(): void {
    const layer = this.layers.get(this.layerId);
    if (layer) this.reapply(layer);
  }

  dispose(): void {
    this.before.dispose();
  }
}

export interface LayerStackState {
  layers: readonly RasterLayer[];
  activeId: string | null;
}

/**
 * The layer structure without pixels: order, every layer's properties and the layer groups.
 * Structural edits (grouping, ungrouping, folder properties) record one before and one after
 * snapshot; the layer objects themselves never change, so nothing needs to be disposed.
 */
export interface StructureSnapshot {
  layers: readonly RasterLayer[];
  metas: ReadonlyMap<string, LayerMeta>;
  groups: ReadonlyMap<string, LayerGroupMeta>;
  activeId: string | null;
}

export function takeStructure(layers: LayerStack, groups: ReadonlyMap<string, LayerGroupMeta>): StructureSnapshot {
  return {
    layers: [...layers.list],
    metas: new Map(layers.list.map((l) => [l.meta.id, { ...l.meta }])),
    groups: new Map([...groups].map(([id, g]) => [id, { ...g }])),
    activeId: layers.activeId,
  };
}

export class StructureCommand implements HistoryCommand {
  readonly byteSize = 0;

  constructor(
    readonly label: string,
    private layers: LayerStack,
    private setGroups: (groups: Map<string, LayerGroupMeta>) => void,
    private before: StructureSnapshot,
    private after: StructureSnapshot,
  ) {}

  undo(): void {
    this.apply(this.before);
  }

  redo(): void {
    this.apply(this.after);
  }

  dispose(): void {}

  private apply(s: StructureSnapshot): void {
    this.layers.replace(s.layers, s.activeId);
    for (const layer of s.layers) {
      const meta = s.metas.get(layer.meta.id);
      if (meta) layer.meta = { ...meta };
    }
    this.setGroups(new Map([...s.groups].map(([id, g]) => [id, { ...g }])));
  }
}

/** Canvas size plus the layers drawn at that size (resize, crop, rotate, flip canvas). */
export interface CanvasState extends LayerStackState {
  width: number;
  height: number;
}

/**
 * Replaces every layer with a re-drawn copy at a (possibly) new canvas size. Like
 * ReplaceLayersCommand, the side that is not in effect owns its layers.
 */
export class CanvasCommand implements HistoryCommand {
  readonly byteSize: number;

  constructor(
    readonly label: string,
    private layers: LayerStack,
    private setSize: (width: number, height: number) => void,
    private before: CanvasState,
    private after: CanvasState,
  ) {
    this.byteSize = before.layers.reduce((sum, l) => sum + l.bytes, 0);
  }

  undo(): void {
    this.layers.replace(this.before.layers, this.before.activeId);
    this.setSize(this.before.width, this.before.height);
  }

  redo(): void {
    this.layers.replace(this.after.layers, this.after.activeId);
    this.setSize(this.after.width, this.after.height);
  }

  dispose(from: HistoryStack): void {
    for (const layer of from === 'undo' ? this.before.layers : this.after.layers) layer.dispose();
  }
}

/**
 * Replaces the layer list wholesale (merge down, merge selected, flatten). Layers that exist
 * only in `before` are owned by this command while it is on the undo stack; layers that exist
 * only in `after` are owned while it is on the redo stack.
 */
export class ReplaceLayersCommand implements HistoryCommand {
  readonly byteSize: number;
  private removed: RasterLayer[];
  private added: RasterLayer[];

  constructor(
    readonly label: string,
    private layers: LayerStack,
    private before: LayerStackState,
    private after: LayerStackState,
  ) {
    this.removed = before.layers.filter((l) => !after.layers.includes(l));
    this.added = after.layers.filter((l) => !before.layers.includes(l));
    this.byteSize = this.removed.reduce((sum, l) => sum + l.bytes, 0);
  }

  undo(): void {
    this.layers.replace(this.before.layers, this.before.activeId);
  }

  redo(): void {
    this.layers.replace(this.after.layers, this.after.activeId);
  }

  dispose(from: HistoryStack): void {
    for (const layer of from === 'undo' ? this.removed : this.added) layer.dispose();
  }
}
