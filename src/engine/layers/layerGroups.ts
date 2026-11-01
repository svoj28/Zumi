import type { LayerGroupMeta, LayerMeta } from '@/engine/types';

/**
 * Clipping layers and layer masks attach to the nearest ordinary layer below them (the base).
 * Compositing works on these groups: the base, then each attached layer in stack order —
 * a clipping layer is drawn only where the base has pixels, a mask hides everything drawn so
 * far in the group. A clipping layer or mask with no base below it is drawn as an ordinary
 * layer. Generic so it serves both the engine and the on-screen renderer.
 */
export interface LayerGroup<L> {
  base: L;
  /** Clipping layers and masks above the base, bottom → top. */
  attached: L[];
}

export function isAttached(meta: Pick<LayerMeta, 'clip' | 'mask'>): boolean {
  return !!meta.clip || !!meta.mask;
}

/** Groups layers (bottom → top) into bases with their attached clipping layers and masks. */
export function groupLayers<L extends { meta: Pick<LayerMeta, 'clip' | 'mask'> }>(layers: readonly L[]): LayerGroup<L>[] {
  const groups: LayerGroup<L>[] = [];
  for (const layer of layers) {
    const last = groups[groups.length - 1];
    if (last && isAttached(layer.meta)) last.attached.push(layer);
    else groups.push({ base: layer, attached: [] });
  }
  return groups;
}

/**
 * A top-level item of the layer stack: a layer group (folder) holding its own clipping/mask
 * units, or a single unit outside any folder. Folders are composited as a whole (their opacity
 * and blend mode apply to the result), and each top-level item is one animation frame.
 */
export type StackItem<L> =
  | { kind: 'folder'; group: LayerGroupMeta; units: LayerGroup<L>[]; layers: L[] }
  | { kind: 'unit'; unit: LayerGroup<L>; layers: L[] };

/**
 * Splits layers (bottom → top) into top-level items. Consecutive layers sharing a `groupId`
 * whose group exists form a folder; clipping layers and masks never attach across a folder edge.
 */
export function stackItems<L extends { meta: Pick<LayerMeta, 'clip' | 'mask' | 'groupId'> }>(
  layers: readonly L[],
  groups: ReadonlyMap<string, LayerGroupMeta>,
): StackItem<L>[] {
  const items: StackItem<L>[] = [];
  let i = 0;
  while (i < layers.length) {
    const groupId = layers[i].meta.groupId;
    const group = groupId ? groups.get(groupId) : undefined;
    if (group) {
      const members: L[] = [];
      while (i < layers.length && layers[i].meta.groupId === groupId) members.push(layers[i++]);
      items.push({ kind: 'folder', group, units: groupLayers(members), layers: members });
      continue;
    }
    // Loose layers up to the next folder.
    const loose: L[] = [];
    while (i < layers.length && !(layers[i].meta.groupId && groups.has(layers[i].meta.groupId!))) loose.push(layers[i++]);
    for (const unit of groupLayers(loose)) items.push({ kind: 'unit', unit, layers: [unit.base, ...unit.attached] });
  }
  return items;
}

/**
 * Colour matrix (Skia's 4×5, row-major) turning a mask's brightness into coverage: white keeps,
 * black hides. Mask opacity weakens it — at 0 the mask has no effect.
 */
export function maskMatrix(opacity: number): number[] {
  const o = Math.min(1, Math.max(0, opacity));
  return [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.2126 * o, 0.7152 * o, 0.0722 * o, 0, 1 - o];
}
