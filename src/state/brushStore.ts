import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mergePreset, normalizePreset, type BrushPreset, type BrushPresetPatch } from '@/engine/brush/brushPreset';
import { BASE_PRESET, DEFAULT_BRUSH_ID, DEFAULT_ERASER_ID, findBuiltIn } from '@/engine/brush/builtInBrushes';
import { createId } from '@/engine/ids';
import type { ToolId } from '@/engine/types';
import { fileStateStorage } from '@/storage/settingsStorage';

/**
 * Brush library state, persisted locally.
 *
 * - Built-in presets are immutable code; edits to them are stored as `overrides` (resettable).
 * - Custom presets ("My Brushes") are full copies that can be renamed and deleted.
 * - Each tool (brush, eraser) has a slot: which preset it uses plus its own size, opacity and
 *   optional hardness override, so the eraser keeps its own settings even when it shares a
 *   preset with the brush.
 * - The eraser can be linked to the brush ("use current brush"): it then erases with the brush
 *   preset's shape, texture and dynamics, but its own size/opacity/hardness.
 * - Favourites and recently used brushes are remembered for the library.
 */

const MAX_RECENT = 10;

export interface ToolSlot {
  presetId: string;
  size: number;
  opacity: number;
  /** Overrides the preset hardness when set (0..1). */
  hardness: number | null;
}

interface BrushState {
  custom: BrushPreset[];
  overrides: Record<string, BrushPresetPatch>;
  slots: Record<ToolId, ToolSlot>;
  favorites: string[];
  recent: string[];
  eraserUsesBrush: boolean;
  /** Lets every tool's size go up to the canvas size instead of the preset's maximum. */
  canvasSizedBrushes: boolean;
  /** Longest side of the open canvas (not persisted; set by the editor). */
  canvasSide: number;

  toggleFavorite: (id: string) => void;
  setCanvasSizedBrushes: (value: boolean) => void;
  setCanvasSide: (side: number) => void;
  setEraserUsesBrush: (value: boolean) => void;
  setHardness: (tool: ToolId, hardness: number | null) => void;
  createPreset: () => string;
  /**
   * Saves a brush made in the brush studio: replaces the custom brush with the same id, or adds
   * it as a new one. Returns its id.
   */
  savePreset: (preset: BrushPreset) => string;
  /** Adds custom presets (e.g. from a restored backup) whose ids are not in the library yet. */
  importPresets: (presets: readonly BrushPreset[]) => number;
  selectPreset: (tool: ToolId, id: string) => void;
  setSize: (tool: ToolId, size: number) => void;
  setOpacity: (tool: ToolId, opacity: number) => void;
  updatePreset: (id: string, patch: BrushPresetPatch) => void;
  resetPreset: (id: string) => void;
  duplicatePreset: (id: string) => string;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
}

/** Resolves a preset by id from built-ins (+ override) or custom presets. */
export function presetFrom(
  id: string,
  custom: readonly BrushPreset[],
  override: BrushPresetPatch | undefined,
): BrushPreset {
  const builtIn = findBuiltIn(id);
  if (builtIn) return override ? normalizePreset(mergePreset(builtIn, override), builtIn) : builtIn;
  return custom.find((p) => p.id === id) ?? findBuiltIn(DEFAULT_BRUSH_ID) ?? BASE_PRESET;
}

export function getPreset(state: Pick<BrushState, 'custom' | 'overrides'>, id: string): BrushPreset {
  return presetFrom(id, state.custom, state.overrides[id]);
}

/**
 * Largest size a tool may use: the preset's maximum, or the canvas's longest side when
 * canvas-sized brushes are on (never less than the preset's own maximum).
 */
export function sizeLimit(preset: BrushPreset, canvasSized: boolean, canvasSide: number): number {
  return canvasSized ? Math.max(preset.maxSize, canvasSide) : preset.maxSize;
}

/**
 * The brush a tool actually paints with: its preset plus the slot's size and opacity.
 * `maxSize` is the slider range; `typedCap` lets a typed size go beyond it (up to the canvas).
 */
export function resolveSlot(preset: BrushPreset, slot: ToolSlot, maxSize = preset.maxSize, typedCap = maxSize): BrushPreset {
  return {
    ...preset,
    maxSize,
    size: Math.min(Math.max(maxSize, typedCap), Math.max(preset.minSize, slot.size)),
    opacity: Math.min(1, Math.max(0.01, slot.opacity)),
    hardness: slot.hardness ?? preset.hardness,
  };
}

/** Which preset a tool paints with (the eraser may borrow the brush's preset). */
export function slotPresetId(state: Pick<BrushState, 'slots' | 'eraserUsesBrush'>, tool: ToolId): string {
  return tool === 'eraser' && state.eraserUsesBrush ? state.slots.brush.presetId : state.slots[tool].presetId;
}

function slotFor(preset: BrushPreset): ToolSlot {
  return { presetId: preset.id, size: preset.size, opacity: preset.opacity, hardness: null };
}

function pushRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT);
}

const defaultSlots = (): Record<ToolId, ToolSlot> => ({
  brush: slotFor(findBuiltIn(DEFAULT_BRUSH_ID) ?? BASE_PRESET),
  eraser: slotFor(findBuiltIn(DEFAULT_ERASER_ID) ?? BASE_PRESET),
});

function mergePatch(a: BrushPresetPatch, b: BrushPresetPatch): BrushPresetPatch {
  const out: Record<string, unknown> = { ...a, ...b };
  for (const key of ['shape', 'texture', 'rotation', 'jitter', 'pressure', 'tilt'] as const) {
    if (a[key] || b[key]) out[key] = { ...a[key], ...b[key] };
  }
  return out as BrushPresetPatch;
}

export const useBrushStore = create<BrushState>()(
  persist(
    (set, get) => ({
      custom: [],
      overrides: {},
      slots: defaultSlots(),
      favorites: [],
      recent: [],
      eraserUsesBrush: false,
      canvasSizedBrushes: false,
      canvasSide: 0,

      setCanvasSizedBrushes: (canvasSizedBrushes) =>
        set((s) => {
          if (canvasSizedBrushes) return { canvasSizedBrushes };
          // Turning it off brings oversized tools back within their preset's range.
          const slots = { ...s.slots };
          for (const tool of Object.keys(slots) as ToolId[]) {
            const max = getPreset(s, slotPresetId(s, tool)).maxSize;
            if (slots[tool].size > max) slots[tool] = { ...slots[tool], size: max };
          }
          return { canvasSizedBrushes, slots };
        }),
      setCanvasSide: (canvasSide) => set({ canvasSide }),
      toggleFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
      setEraserUsesBrush: (eraserUsesBrush) => set({ eraserUsesBrush }),
      setHardness: (tool, hardness) => set((s) => ({ slots: { ...s.slots, [tool]: { ...s.slots[tool], hardness } } })),
      createPreset: () => {
        const preset: BrushPreset = { ...BASE_PRESET, id: createId('u_'), name: 'New Brush', category: 'custom', builtIn: false };
        set((s) => ({ custom: [...s.custom, preset] }));
        return preset.id;
      },
      savePreset: (preset) => {
        const exists = get().custom.some((p) => p.id === preset.id);
        const id = exists ? preset.id : createId('u_');
        const saved = normalizePreset({ ...preset, id, category: 'custom', builtIn: false }, { ...BASE_PRESET, category: 'custom' });
        set((s) => ({ custom: exists ? s.custom.map((p) => (p.id === id ? saved : p)) : [...s.custom, saved] }));
        return id;
      },
      importPresets: (presets) => {
        const known = new Set(get().custom.map((p) => p.id));
        const added = presets
          .filter((p) => !p.builtIn && !findBuiltIn(p.id) && !known.has(p.id))
          .map((p) => normalizePreset({ ...p, builtIn: false, category: 'custom' }, { ...BASE_PRESET, category: 'custom' }));
        if (added.length > 0) set((s) => ({ custom: [...s.custom, ...added] }));
        return added.length;
      },
      selectPreset: (tool, id) =>
        set((s) => ({
          slots: { ...s.slots, [tool]: { ...slotFor(getPreset(s, id)), hardness: s.slots[tool].hardness } },
          recent: pushRecent(s.recent, id),
          // Picking an eraser preset explicitly unlinks it from the brush.
          eraserUsesBrush: tool === 'eraser' ? false : s.eraserUsesBrush,
        })),
      setSize: (tool, size) => set((s) => ({ slots: { ...s.slots, [tool]: { ...s.slots[tool], size } } })),
      setOpacity: (tool, opacity) => set((s) => ({ slots: { ...s.slots, [tool]: { ...s.slots[tool], opacity } } })),

      updatePreset: (id, patch) =>
        set((s) => {
          if (findBuiltIn(id)) {
            return { overrides: { ...s.overrides, [id]: mergePatch(s.overrides[id] ?? {}, patch) } };
          }
          return { custom: s.custom.map((p) => (p.id === id ? normalizePreset(mergePreset(p, patch), p) : p)) };
        }),

      resetPreset: (id) =>
        set((s) => {
          const overrides = { ...s.overrides };
          delete overrides[id];
          const builtIn = findBuiltIn(id);
          // Slots using this preset snap back to its default size/opacity.
          const slots = { ...s.slots };
          if (builtIn) {
            for (const tool of Object.keys(slots) as ToolId[]) {
              if (slots[tool].presetId === id) slots[tool] = slotFor(builtIn);
            }
          }
          return { overrides, slots };
        }),

      duplicatePreset: (id) => {
        const source = getPreset(get(), id);
        const copy: BrushPreset = { ...source, id: createId('u_'), name: `${source.name} copy`, category: 'custom', builtIn: false };
        set((s) => ({ custom: [...s.custom, copy] }));
        return copy.id;
      },

      renamePreset: (id, name) =>
        set((s) => ({ custom: s.custom.map((p) => (p.id === id ? { ...p, name: name.slice(0, 60) } : p)) })),

      deletePreset: (id) =>
        set((s) => {
          if (findBuiltIn(id)) return {};
          const slots = { ...s.slots };
          const fallback = defaultSlots();
          for (const tool of Object.keys(slots) as ToolId[]) {
            if (slots[tool].presetId === id) slots[tool] = fallback[tool];
          }
          return {
            custom: s.custom.filter((p) => p.id !== id),
            slots,
            favorites: s.favorites.filter((x) => x !== id),
            recent: s.recent.filter((x) => x !== id),
          };
        }),
    }),
    {
      name: 'zumi.brushes',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: ({ custom, overrides, slots, favorites, recent, eraserUsesBrush, canvasSizedBrushes }) => ({
        custom,
        overrides,
        slots,
        favorites,
        recent,
        eraserUsesBrush,
        canvasSizedBrushes,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BrushState>;
        const custom = Array.isArray(p.custom)
          ? p.custom.map((raw) => normalizePreset({ ...(raw as object), builtIn: false }, { ...BASE_PRESET, category: 'custom' }))
          : [];
        const overrides = p.overrides && typeof p.overrides === 'object' ? p.overrides : {};
        const exists = (id: unknown) => typeof id === 'string' && (!!findBuiltIn(id) || custom.some((c) => c.id === id));
        const fallback = defaultSlots();
        const slots = { ...fallback };
        for (const tool of Object.keys(fallback) as ToolId[]) {
          const raw = p.slots?.[tool];
          if (raw && exists(raw.presetId) && typeof raw.size === 'number' && typeof raw.opacity === 'number') {
            const hardness = typeof raw.hardness === 'number' ? Math.min(1, Math.max(0, raw.hardness)) : null;
            slots[tool] = { presetId: raw.presetId, size: raw.size, opacity: raw.opacity, hardness };
          }
        }
        const ids = (list: unknown) => (Array.isArray(list) ? list.filter(exists) as string[] : []);
        return {
          ...current,
          custom,
          overrides,
          slots,
          favorites: ids(p.favorites),
          recent: ids(p.recent).slice(0, MAX_RECENT),
          eraserUsesBrush: p.eraserUsesBrush === true,
          canvasSizedBrushes: p.canvasSizedBrushes === true,
        };
      },
    },
  ),
);

/** The preset a tool paints with (without slot size/opacity/hardness applied). */
export function useSlotPreset(tool: ToolId): BrushPreset {
  const presetId = useBrushStore((s) => slotPresetId(s, tool));
  const custom = useBrushStore((s) => s.custom);
  const override = useBrushStore((s) => s.overrides[presetId]);
  return useMemo(() => presetFrom(presetId, custom, override), [presetId, custom, override]);
}

/** Largest size that may be typed for a brush: up to the open canvas, beyond the slider range. */
export function useTypedSizeMax(brush: BrushPreset): number {
  const canvasSide = useBrushStore((s) => s.canvasSide);
  return Math.max(brush.maxSize, canvasSide);
}

/** The fully resolved brush a tool paints with. */
export function useToolBrush(tool: ToolId): BrushPreset {
  const preset = useSlotPreset(tool);
  const slot = useBrushStore((s) => s.slots[tool]);
  const canvasSized = useBrushStore((s) => s.canvasSizedBrushes);
  const canvasSide = useBrushStore((s) => s.canvasSide);
  return useMemo(
    () => resolveSlot(preset, slot, sizeLimit(preset, canvasSized, canvasSide), canvasSide),
    [preset, slot, canvasSized, canvasSide],
  );
}
