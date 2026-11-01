import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { normalizeHex } from '@/engine/color/colorMath';
import { createId } from '@/engine/ids';
import { fileStateStorage } from '@/storage/settingsStorage';

/** Saved colours and custom palettes. Persisted locally in `settings/zumi.colors.json`. */

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

const MAX_SAVED = 48;
const MAX_PALETTE_COLORS = 64;

const DEFAULT_PALETTE: Palette = {
  id: 'pal_default',
  name: 'Essentials',
  colors: [
    '#1b1b1f', '#4a4a52', '#8a8a93', '#ffffff',
    '#5b3a29', '#a0522d', '#e63946', '#ff8a4c',
    '#ffd23f', '#8ac926', '#2a9d8f', '#1982c4',
    '#3a0ca3', '#6a4c93', '#f28dc4', '#ffc8dd',
  ],
};

interface PaletteState {
  savedColors: string[];
  palettes: Palette[];
  activePaletteId: string;
  saveColor: (color: string) => void;
  removeSavedColor: (color: string) => void;
  createPalette: (name: string) => string;
  /** Saves a ready-made palette (e.g. a generated one) and makes it the active palette. */
  createPaletteWithColors: (name: string, colors: string[]) => string;
  renamePalette: (id: string, name: string) => void;
  deletePalette: (id: string) => void;
  setActivePalette: (id: string) => void;
  addToPalette: (id: string, color: string) => void;
  removeFromPalette: (id: string, index: number) => void;
}

export const usePaletteStore = create<PaletteState>()(
  persist(
    (set) => ({
      savedColors: [],
      palettes: [DEFAULT_PALETTE],
      activePaletteId: DEFAULT_PALETTE.id,
      saveColor: (color) =>
        set((s) => (s.savedColors.includes(color) ? {} : { savedColors: [color, ...s.savedColors].slice(0, MAX_SAVED) })),
      removeSavedColor: (color) => set((s) => ({ savedColors: s.savedColors.filter((c) => c !== color) })),
      createPalette: (name) => {
        const palette: Palette = { id: createId('pal_'), name: name.slice(0, 40), colors: [] };
        set((s) => ({ palettes: [...s.palettes, palette], activePaletteId: palette.id }));
        return palette.id;
      },
      createPaletteWithColors: (name, list) => {
        const hexes = list.map((c) => normalizeHex(c)).filter((c): c is string => !!c);
        const palette: Palette = { id: createId('pal_'), name: name.slice(0, 40), colors: [...new Set(hexes)].slice(0, MAX_PALETTE_COLORS) };
        set((s) => ({ palettes: [...s.palettes, palette], activePaletteId: palette.id }));
        return palette.id;
      },
      renamePalette: (id, name) =>
        set((s) => ({ palettes: s.palettes.map((p) => (p.id === id ? { ...p, name: name.slice(0, 40) } : p)) })),
      deletePalette: (id) =>
        set((s) => {
          const palettes = s.palettes.filter((p) => p.id !== id);
          const safe = palettes.length > 0 ? palettes : [DEFAULT_PALETTE];
          return { palettes: safe, activePaletteId: s.activePaletteId === id ? safe[0].id : s.activePaletteId };
        }),
      setActivePalette: (activePaletteId) => set({ activePaletteId }),
      addToPalette: (id, color) =>
        set((s) => ({
          palettes: s.palettes.map((p) =>
            p.id === id && p.colors.length < MAX_PALETTE_COLORS ? { ...p, colors: [...p.colors, color] } : p,
          ),
        })),
      removeFromPalette: (id, index) =>
        set((s) => ({
          palettes: s.palettes.map((p) => (p.id === id ? { ...p, colors: p.colors.filter((_, i) => i !== index) } : p)),
        })),
    }),
    {
      name: 'zumi.colors',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: ({ savedColors, palettes, activePaletteId }) => ({ savedColors, palettes, activePaletteId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PaletteState>;
        const hexes = (list: unknown): string[] =>
          Array.isArray(list) ? list.map((c) => (typeof c === 'string' ? normalizeHex(c) : null)).filter((c): c is string => !!c) : [];
        const palettes = Array.isArray(p.palettes)
          ? p.palettes
              .filter((x) => x && typeof x.id === 'string')
              .map((x) => ({ id: x.id, name: typeof x.name === 'string' ? x.name : 'Palette', colors: hexes(x.colors).slice(0, MAX_PALETTE_COLORS) }))
          : [];
        const safe = palettes.length > 0 ? palettes : [DEFAULT_PALETTE];
        return {
          ...current,
          savedColors: hexes(p.savedColors).slice(0, MAX_SAVED),
          palettes: safe,
          activePaletteId: safe.some((x) => x.id === p.activePaletteId) ? (p.activePaletteId as string) : safe[0].id,
        };
      },
    },
  ),
);
