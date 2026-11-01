import type { RasterLayer } from '@/engine/layers/RasterLayer';

/**
 * Ordered collection of layers (index 0 = bottom). Pure bookkeeping — pixel work lives in
 * RasterLayer and change notification lives in DrawingDocument.
 */
export class LayerStack {
  private items: RasterLayer[] = [];
  activeId: string | null = null;

  /** Bottom → top. Do not mutate the returned array. */
  get list(): readonly RasterLayer[] {
    return this.items;
  }

  get count(): number {
    return this.items.length;
  }

  get active(): RasterLayer | undefined {
    return this.items.find((l) => l.meta.id === this.activeId) ?? this.items[this.items.length - 1];
  }

  get(id: string): RasterLayer | undefined {
    return this.items.find((l) => l.meta.id === id);
  }

  indexOf(id: string): number {
    return this.items.findIndex((l) => l.meta.id === id);
  }

  insert(layer: RasterLayer, index = this.items.length): void {
    const i = Math.max(0, Math.min(index, this.items.length));
    this.items.splice(i, 0, layer);
  }

  /** Removes a layer without disposing it (history may still own it). */
  remove(id: string): { layer: RasterLayer; index: number } | null {
    const index = this.indexOf(id);
    if (index < 0) return null;
    const [layer] = this.items.splice(index, 1);
    if (this.activeId === id) {
      const next = this.items[Math.min(index, this.items.length - 1)];
      this.activeId = next?.meta.id ?? null;
    }
    return { layer, index };
  }

  move(id: string, toIndex: number): boolean {
    const from = this.indexOf(id);
    if (from < 0) return false;
    const to = Math.max(0, Math.min(toIndex, this.items.length - 1));
    if (from === to) return false;
    const [layer] = this.items.splice(from, 1);
    this.items.splice(to, 0, layer);
    return true;
  }

  /** Swaps in a whole new ordering at once (merge/flatten and their undo). Does not dispose. */
  replace(layers: readonly RasterLayer[], activeId: string | null): void {
    this.items = [...layers];
    this.activeId = activeId && this.get(activeId) ? activeId : (this.items[this.items.length - 1]?.meta.id ?? null);
  }

  disposeAll(): void {
    for (const layer of this.items) layer.dispose();
    this.items = [];
    this.activeId = null;
  }
}
