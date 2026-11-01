import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { SHAPE_KINDS, type ShapeKind } from '@/engine/brush/shapes';
import { MAX_RADIAL_SEGMENTS, MIN_RADIAL_SEGMENTS, type SymmetryMode } from '@/engine/brush/symmetry';
import type { ToolId } from '@/engine/types';
import { fileStateStorage } from '@/storage/settingsStorage';

/**
 * Active tool, colour and interaction mode. Persisted locally between sessions (except the
 * interaction mode). Brush parameters live in the brush store, palettes in the palette store.
 */

const MAX_RECENT_COLORS = 16;

/** What a one-finger touch on the canvas does. Not persisted: every session starts painting. */
export type Interaction = 'paint' | 'eyedropper' | 'transform' | 'select' | 'shape' | 'vector' | 'fill' | 'gradient' | 'liquify';
export type SelectShape = 'rect' | 'ellipse' | 'lasso' | 'wand';
export type SelectCombine = 'replace' | 'add' | 'subtract' | 'intersect';

/** Paint bucket / magic wand: how the area is found (see DrawingDocument.FillOptions). */
export interface FillSettings {
  tolerance: number;
  source: 'layer' | 'canvas' | 'reference';
  contiguous: boolean;
  expand: number;
}

export interface GradientSettings {
  kind: 'linear' | 'radial' | 'tone';
  /** End colour: transparent, or the previous colour. */
  end: 'transparent' | 'previous';
  /** Screentone gradient dot cell (px) and angle (degrees). */
  cell: number;
  angle: number;
}

export type LiquifyMode = 'push' | 'twirlRight' | 'twirlLeft' | 'pinch' | 'expand' | 'restore';

export interface LiquifySettings {
  mode: LiquifyMode;
  /** Brush radius in screen points. */
  size: number;
  /** 0..1 */
  strength: number;
}

const DEFAULT_FILL: FillSettings = { tolerance: 0.15, source: 'canvas', contiguous: true, expand: 2 };
const DEFAULT_GRADIENT: GradientSettings = { kind: 'linear', end: 'transparent', cell: 12, angle: 45 };
const DEFAULT_LIQUIFY: LiquifySettings = { mode: 'push', size: 80, strength: 0.6 };

/**
 * Symmetry settings. The axis centre is stored as a fraction of the canvas size so it stays
 * sensible across artworks of different sizes.
 */
export interface SymmetrySettings {
  mode: SymmetryMode;
  cx: number;
  cy: number;
  segments: number;
}

const DEFAULT_SYMMETRY: SymmetrySettings = { mode: 'off', cx: 0.5, cy: 0.5, segments: 6 };
const SYMMETRY_MODES: readonly SymmetryMode[] = ['off', 'vertical', 'horizontal', 'quadrant', 'radial'];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface ToolState {
  tool: ToolId;
  /** Current colour, `#rrggbb`. */
  color: string;
  /** Colour alpha 0..1 — multiplies the brush opacity. */
  alpha: number;
  /** The colour before the last deliberate change (tap to swap back). */
  previousColor: string;
  /** Colours actually painted with, most recent first. */
  recentColors: string[];
  interaction: Interaction;
  selectShape: SelectShape;
  shapeKind: ShapeKind;
  /** Square/circle/15° lines. */
  shapeConstrain: boolean;
  symmetry: SymmetrySettings;
  /** How a new selection combines with the current one. */
  selectCombine: SelectCombine;
  fill: FillSettings;
  gradient: GradientSettings;
  liquify: LiquifySettings;
  setSelectCombine: (mode: SelectCombine) => void;
  updateFill: (patch: Partial<FillSettings>) => void;
  updateGradient: (patch: Partial<GradientSettings>) => void;
  updateLiquify: (patch: Partial<LiquifySettings>) => void;
  setInteraction: (interaction: Interaction) => void;
  setSelectShape: (shape: SelectShape) => void;
  setShapeKind: (kind: ShapeKind) => void;
  setShapeConstrain: (constrain: boolean) => void;
  updateSymmetry: (patch: Partial<SymmetrySettings>) => void;
  setTool: (tool: ToolId) => void;
  /** Live colour update (e.g. while dragging on the wheel). Switches the eraser back to the brush. */
  setColor: (color: string) => void;
  setAlpha: (alpha: number) => void;
  /** Records a completed colour change: `from` becomes the previous colour. */
  commitColor: (from: string) => void;
  /** Called when a stroke is painted with `color`. */
  pushRecent: (color: string) => void;
  swapWithPrevious: () => void;
}

export const useToolStore = create<ToolState>()(
  persist(
    (set) => ({
      tool: 'brush',
      color: '#1b1b1f',
      alpha: 1,
      previousColor: '#ffffff',
      recentColors: [],
      interaction: 'paint',
      selectShape: 'rect',
      shapeKind: 'line',
      shapeConstrain: false,
      symmetry: DEFAULT_SYMMETRY,
      selectCombine: 'replace',
      fill: DEFAULT_FILL,
      gradient: DEFAULT_GRADIENT,
      liquify: DEFAULT_LIQUIFY,
      setSelectCombine: (selectCombine) => set({ selectCombine }),
      updateFill: (patch) => set((s) => ({ fill: parseFill({ ...s.fill, ...patch }) })),
      updateGradient: (patch) => set((s) => ({ gradient: parseGradient({ ...s.gradient, ...patch }) })),
      updateLiquify: (patch) => set((s) => ({ liquify: parseLiquify({ ...s.liquify, ...patch }) })),
      setInteraction: (interaction) => set({ interaction }),
      setSelectShape: (selectShape) => set({ selectShape }),
      setShapeKind: (shapeKind) => set({ shapeKind }),
      setShapeConstrain: (shapeConstrain) => set({ shapeConstrain }),
      updateSymmetry: (patch) =>
        set((s) => {
          const next = { ...s.symmetry, ...patch };
          return {
            symmetry: {
              ...next,
              cx: clamp01(next.cx),
              cy: clamp01(next.cy),
              segments: Math.round(Math.min(MAX_RADIAL_SEGMENTS, Math.max(MIN_RADIAL_SEGMENTS, next.segments))),
            },
          };
        }),
      setTool: (tool) => set({ tool, interaction: 'paint' }),
      setColor: (color) => set((s) => ({ color, tool: s.tool === 'eraser' ? 'brush' : s.tool })),
      setAlpha: (alpha) => set({ alpha: Math.min(1, Math.max(0.01, alpha)) }),
      commitColor: (from) => set((s) => (from !== s.color ? { previousColor: from } : {})),
      pushRecent: (color) =>
        set((s) =>
          s.recentColors[0] === color
            ? {}
            : { recentColors: [color, ...s.recentColors.filter((c) => c !== color)].slice(0, MAX_RECENT_COLORS) },
        ),
      swapWithPrevious: () => set((s) => ({ color: s.previousColor, previousColor: s.color })),
    }),
    {
      name: 'zumi.tools',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: ({ tool, color, alpha, previousColor, recentColors, shapeKind, shapeConstrain, symmetry, fill, gradient, liquify }) => ({
        tool,
        color,
        alpha,
        previousColor,
        recentColors,
        shapeKind,
        shapeConstrain,
        symmetry,
        fill,
        gradient,
        liquify,
      }),
      merge: (persisted, current) => {
        // Older versions also persisted brush settings; only the fields we still own are kept.
        const p = (persisted ?? {}) as Partial<ToolState>;
        const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
        return {
          ...current,
          tool: p.tool === 'eraser' ? 'eraser' : 'brush',
          color: isHex(p.color) ? p.color : current.color,
          alpha: typeof p.alpha === 'number' ? Math.min(1, Math.max(0.01, p.alpha)) : 1,
          previousColor: isHex(p.previousColor) ? p.previousColor : current.previousColor,
          recentColors: Array.isArray(p.recentColors) ? p.recentColors.filter(isHex).slice(0, MAX_RECENT_COLORS) : [],
          shapeKind: SHAPE_KINDS.includes(p.shapeKind as ShapeKind) ? (p.shapeKind as ShapeKind) : 'line',
          shapeConstrain: p.shapeConstrain === true,
          symmetry: parseSymmetry(p.symmetry),
          fill: parseFill(p.fill),
          gradient: parseGradient(p.gradient),
          liquify: parseLiquify(p.liquify),
        };
      },
    },
  ),
);

function parseSymmetry(raw: unknown): SymmetrySettings {
  const p = (raw ?? {}) as Partial<SymmetrySettings>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    mode: SYMMETRY_MODES.includes(p.mode as SymmetryMode) ? (p.mode as SymmetryMode) : 'off',
    cx: clamp01(num(p.cx, 0.5)),
    cy: clamp01(num(p.cy, 0.5)),
    segments: Math.round(Math.min(MAX_RADIAL_SEGMENTS, Math.max(MIN_RADIAL_SEGMENTS, num(p.segments, 6)))),
  };
}

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function parseFill(raw: unknown): FillSettings {
  const p = (raw ?? {}) as Partial<FillSettings>;
  return {
    tolerance: num(p.tolerance, DEFAULT_FILL.tolerance, 0, 1),
    source: p.source === 'layer' || p.source === 'reference' ? p.source : 'canvas',
    contiguous: p.contiguous !== false,
    expand: Math.round(num(p.expand, DEFAULT_FILL.expand, 0, 8)),
  };
}

function parseGradient(raw: unknown): GradientSettings {
  const p = (raw ?? {}) as Partial<GradientSettings>;
  return {
    kind: p.kind === 'radial' || p.kind === 'tone' ? p.kind : 'linear',
    end: p.end === 'previous' ? 'previous' : 'transparent',
    cell: num(p.cell, DEFAULT_GRADIENT.cell, 4, 64),
    angle: num(p.angle, DEFAULT_GRADIENT.angle, -90, 90),
  };
}

const LIQUIFY_MODES: readonly LiquifyMode[] = ['push', 'twirlRight', 'twirlLeft', 'pinch', 'expand', 'restore'];

function parseLiquify(raw: unknown): LiquifySettings {
  const p = (raw ?? {}) as Partial<LiquifySettings>;
  return {
    mode: LIQUIFY_MODES.includes(p.mode as LiquifyMode) ? (p.mode as LiquifyMode) : 'push',
    size: num(p.size, DEFAULT_LIQUIFY.size, 10, 400),
    strength: num(p.strength, DEFAULT_LIQUIFY.strength, 0.05, 1),
  };
}
