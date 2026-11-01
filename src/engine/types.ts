import type { BrushPreset } from '@/engine/brush/brushPreset';
import type { Symmetry } from '@/engine/brush/symmetry';

/**
 * Core engine types. Everything in `src/engine` is framework-agnostic TypeScript
 * (no React), so it can be unit-tested and reused from worklets where noted.
 */

export type ToolId = 'brush' | 'eraser';

export type LayerBlendMode =
  | 'srcOver'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'add'
  | 'softLight'
  | 'hardLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: LayerBlendMode;
  /** Pixels cannot be edited at all. */
  locked: boolean;
  /**
   * Transparency is preserved: painting only recolours pixels that already have coverage,
   * and the eraser is disabled (it would change coverage).
   */
  alphaLocked: boolean;
  /**
   * Clipping layer: only shows where the layer it is attached to (the nearest ordinary layer
   * below) has pixels. Optional so projects saved before it existed load unchanged.
   */
  clip?: boolean;
  /**
   * Layer mask: a greyscale layer that hides the layer it is attached to (and the clipping
   * layers below the mask) — white shows, black hides. Not drawn itself.
   */
  mask?: boolean;
  /**
   * Reference layer: the paint bucket and magic wand can use this layer's pixels (typically line
   * art) to find areas while filling another layer.
   */
  reference?: boolean;
  /** The layer group (folder) this layer belongs to; members of a group are contiguous. */
  groupId?: string;
}

/** A layer group (folder). Its layers are composited together, then onto the layers below. */
export interface LayerGroupMeta {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: LayerBlendMode;
  /** Folded in the layers panel (display only). */
  collapsed: boolean;
}

export type AnimationLoop = 'loop' | 'pingPong' | 'once';

/**
 * Frame-by-frame animation. Each top-level item of the layer stack (a layer group, or a layer
 * with its clipping layers and masks) is one frame, bottom to top.
 */
export interface AnimationSettings {
  enabled: boolean;
  /** Frames per second, 1..30. */
  fps: number;
  loop: AnimationLoop;
  /** Onion skin: how many frames before/after the current one are shown faintly. */
  onionBefore: number;
  onionAfter: number;
  /** 0..1 */
  onionOpacity: number;
  /** The bottom frame stays visible under every frame (a background). */
  background: boolean;
}

export const DEFAULT_ANIMATION: AnimationSettings = {
  enabled: false,
  fps: 8,
  loop: 'loop',
  onionBefore: 1,
  onionAfter: 1,
  onionOpacity: 0.35,
  background: false,
};

/**
 * Stroke samples are stored as a flat array, SAMPLE_STRIDE numbers per sample:
 *
 *   [x, y, pressure, t, tiltX, tiltY, x, y, pressure, t, …]
 *
 * - x, y: canvas coordinates (after smoothing)
 * - pressure: 0..1 (1 for input without pressure, unless speed-simulated)
 * - t: milliseconds since the stroke began
 * - tiltX, tiltY: stylus tilt in degrees (0 when unavailable)
 *
 * A flat array is cheap to build in a worklet and to copy across threads, unlike an array of
 * objects.
 */
export type FlatSamples = number[];
export const SAMPLE_STRIDE = 6;
export const S_X = 0;
export const S_Y = 1;
export const S_PRESSURE = 2;
export const S_TIME = 3;
export const S_TILT_X = 4;
export const S_TILT_Y = 5;

export interface StrokeRecipe {
  tool: ToolId;
  color: string;
  /** Fully resolved brush (preset + per-tool size/opacity). */
  brush: BrushPreset;
  /** PRNG seed for jitter/scatter, so replay reproduces the live preview. */
  seed: number;
  samples: FlatSamples;
  /** Mirroring applied to the stroke's dabs (live preview and commit alike). */
  symmetry?: Symmetry | null;
  /** Undo-history label; defaults to "Brush stroke"/"Erase". */
  label?: string;
}
