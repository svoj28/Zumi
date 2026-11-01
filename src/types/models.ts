import type { BrushPreset } from '@/engine/brush/brushPreset';
import type { Symmetry } from '@/engine/brush/symmetry';
import type { RGB } from '@/engine/color/colorMath';
import type { DocumentInfo } from '@/engine/document/DrawingDocument';
import type { ProjectManifest } from '@/engine/document/projectFormat';
import type { HistoryCommand } from '@/engine/history/HistoryManager';
import type { LayerTransform } from '@/engine/layers/layerTransform';
import type { LayerMeta, Rect, StrokeRecipe } from '@/engine/types';
import type { Palette } from '@/state/paletteStore';
import type { useSettingsStore } from '@/state/settingsStore';
import type { ProjectSummary } from '@/storage/projectRepository';

/**
 * The app's domain vocabulary in one place. Most models are owned by the module that works with
 * them (the engine, a store or the storage layer) and are re-exported here under their domain
 * name, so there is a single definition of each; the rest describe concepts that only exist as
 * plain data. Import from here when code spans several modules.
 */

// ---- colour --------------------------------------------------------------------------------

/** '#rrggbb' (lower-case). Every colour the engine paints with or stores is in this form. */
export type HexColor = string;

/** A colour with its own opacity, for UI that edits both (brush colour + brush opacity). */
export interface Color {
  hex: HexColor;
  /** 0..1 */
  alpha: number;
}

export type { RGB, Palette };

// ---- projects & documents ------------------------------------------------------------------

/** Name, size and timestamps of an open document. */
export type ProjectMetadata = DocumentInfo;

/** A gallery entry: what is known about an artwork without decoding its layers. */
export type ArtworkProject = ProjectSummary;

/** The serialized document as stored on disk (`project.json`); layers are separate PNG files. */
export type CanvasDocument = ProjectManifest;

// ---- layers --------------------------------------------------------------------------------

/** Properties of a raster layer; its pixels live in `RasterLayer`. */
export type Layer = LayerMeta;

/**
 * A folder in the layers panel. Not used by the engine yet: the layer stack is flat. Defined
 * so the project format can grow groups without changing the vocabulary of other modules.
 */
export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1, multiplied into every child. */
  opacity: number;
  collapsed: boolean;
  /** Child layer or group ids, bottom → top. */
  children: string[];
}

// ---- painting ------------------------------------------------------------------------------

export type { BrushPreset, Symmetry };

/**
 * One input sample of a stroke. Strokes keep samples as a flat number array (see
 * `FlatSamples` / `SAMPLE_STRIDE`) for speed; this is the readable shape of one entry.
 */
export interface StrokePoint {
  x: number;
  y: number;
  /** 0..1 */
  pressure: number;
  /** Milliseconds since the stroke began. */
  t: number;
  /** Stylus tilt in degrees, 0 when unavailable. */
  tiltX: number;
  tiltY: number;
}

/** Everything needed to replay a stroke exactly: tool, colour, resolved brush, seed, samples. */
export type BrushStroke = StrokeRecipe;

// ---- selection & transform -----------------------------------------------------------------

/** The current selection. The pixels covered are a Skia path; this is its plain description. */
export interface Selection {
  /** Bounding box in canvas pixels, or null when nothing is selected (the whole layer is active). */
  bounds: Rect | null;
  /** SVG path data of the selected area, for persistence or display outside Skia. */
  svgPath: string | null;
}

/** A pending move / scale / rotate / flip of a layer or selection. */
export type Transform = LayerTransform;

// ---- history -------------------------------------------------------------------------------

export type { HistoryCommand };

// ---- settings ------------------------------------------------------------------------------

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

/** The persisted app preferences (the settings store without its setter functions). */
export type AppSettings = {
  [K in keyof SettingsState as SettingsState[K] extends (...args: never[]) => unknown ? never : K]: SettingsState[K];
};
