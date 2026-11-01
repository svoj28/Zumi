import { mergePreset, type BrushPreset, type BrushPresetPatch } from '@/engine/brush/brushPreset';

/** Neutral starting point every built-in preset is derived from. */
export const BASE_PRESET: BrushPreset = {
  id: 'base',
  name: 'Brush',
  category: 'custom',
  builtIn: false,
  size: 12,
  minSize: 1,
  maxSize: 200,
  opacity: 1,
  flow: 1,
  hardness: 0.9,
  spacing: 0.08,
  smoothing: 0.3,
  blend: 0,
  smudge: 0,
  shape: { tip: 'round', roundness: 1 },
  texture: { kind: 'none', strength: 0, scale: 1, angle: 0, variation: 0 },
  rotation: { angle: 0, followStroke: false },
  scatter: 0,
  jitter: { size: 0, opacity: 0, rotation: 0 },
  pressure: { size: 0.5, opacity: 0, curve: 1 },
  tilt: { mode: 'none', amount: 0 },
  speedPressure: false,
};

function preset(id: string, name: string, category: BrushPreset['category'], patch: BrushPresetPatch): BrushPreset {
  return mergePreset({ ...BASE_PRESET, id, name, category, builtIn: true }, patch);
}

/** A hard-edged screentone brush with the given pattern. */
function tone(id: string, name: string, texture: BrushPresetPatch['texture']): BrushPreset {
  return preset(id, name, 'tone', {
    size: 100, minSize: 4, maxSize: 600, hardness: 1, spacing: 0.05, smoothing: 0.2,
    texture, pressure: { size: 0, opacity: 0 },
  });
}

/**
 * Built-in library. Values are tuned for a stable first implementation: effects come from tip
 * shape, flow build-up, jitter and paper grain — no wet-media simulation. Blending brushes mix
 * the layer's existing colours (see `BrushPreset.blend`).
 */
export const BUILT_IN_BRUSHES: readonly BrushPreset[] = [
  // ---- Sketching -------------------------------------------------------------------------------
  preset('pencil', 'Pencil', 'sketching', {
    size: 6, minSize: 1, maxSize: 40, opacity: 0.9, flow: 0.55, hardness: 0.8, spacing: 0.12, smoothing: 0.25,
    shape: { tip: 'pencil' }, texture: { kind: 'paper', strength: 0.5 },
    jitter: { opacity: 0.2, rotation: 1 }, pressure: { size: 0.6, opacity: 0.7, curve: 1.2 },
    tilt: { mode: 'size', amount: 0.6 },
  }),
  preset('soft-pencil', 'Soft Pencil', 'sketching', {
    size: 10, minSize: 2, maxSize: 60, opacity: 0.85, flow: 0.35, hardness: 0.5, spacing: 0.12, smoothing: 0.25,
    shape: { tip: 'pencil' }, texture: { kind: 'paper', strength: 0.65 },
    jitter: { opacity: 0.25, rotation: 1 }, pressure: { size: 0.5, opacity: 0.9, curve: 1.1 },
    tilt: { mode: 'size', amount: 0.8 },
  }),
  preset('mechanical-pencil', 'Mechanical Pencil', 'sketching', {
    size: 3, minSize: 1, maxSize: 12, opacity: 0.95, flow: 0.7, hardness: 0.95, spacing: 0.1, smoothing: 0.3,
    shape: { tip: 'pencil' }, texture: { kind: 'paper', strength: 0.3 },
    jitter: { rotation: 1 }, pressure: { size: 0.2, opacity: 0.6 },
  }),
  preset('hb-pencil', 'HB Pencil', 'sketching', {
    size: 5, minSize: 1, maxSize: 30, opacity: 0.75, flow: 0.45, hardness: 0.85, spacing: 0.1, smoothing: 0.2,
    shape: { tip: 'pencil' }, texture: { kind: 'paper', strength: 0.55 },
    jitter: { opacity: 0.15, rotation: 1 }, pressure: { size: 0.4, opacity: 0.8, curve: 1.2 },
    tilt: { mode: 'size', amount: 0.5 },
  }),
  preset('6b-pencil', '6B Pencil', 'sketching', {
    size: 14, minSize: 3, maxSize: 80, opacity: 0.95, flow: 0.6, hardness: 0.55, spacing: 0.1, smoothing: 0.2,
    shape: { tip: 'pencil' }, texture: { kind: 'paper', strength: 0.75 },
    jitter: { opacity: 0.25, rotation: 1 }, pressure: { size: 0.6, opacity: 0.9, curve: 0.9 },
    tilt: { mode: 'size', amount: 1 },
  }),
  preset('colored-pencil', 'Coloured Pencil', 'sketching', {
    size: 9, minSize: 2, maxSize: 50, opacity: 0.9, flow: 0.5, hardness: 0.7, spacing: 0.1, smoothing: 0.25,
    shape: { tip: 'chalk' }, texture: { kind: 'paper', strength: 0.8, scale: 0.7 },
    jitter: { opacity: 0.2, rotation: 1 }, pressure: { size: 0.4, opacity: 0.8 },
    tilt: { mode: 'size', amount: 0.7 },
  }),
  preset('sketch-liner', 'Sketch Liner', 'sketching', {
    size: 4, minSize: 1, maxSize: 20, opacity: 0.8, flow: 0.8, hardness: 0.9, spacing: 0.06, smoothing: 0.15,
    pressure: { size: 0.5, opacity: 0.5 }, speedPressure: true,
  }),

  // ---- Inking ----------------------------------------------------------------------------------
  preset('technical-pen', 'Technical Pen', 'inking', {
    size: 4, minSize: 1, maxSize: 30, hardness: 1, spacing: 0.05, smoothing: 0.5,
    pressure: { size: 0, opacity: 0 },
  }),
  preset('studio-pen', 'Studio Pen', 'inking', {
    size: 8, minSize: 1, maxSize: 60, hardness: 1, spacing: 0.05, smoothing: 0.45,
    pressure: { size: 0.85, curve: 1.4 }, speedPressure: true,
  }),
  preset('brush-pen', 'Brush Pen', 'inking', {
    size: 14, minSize: 1, maxSize: 80, hardness: 0.95, spacing: 0.04, smoothing: 0.4,
    shape: { roundness: 0.65 }, rotation: { angle: 35 },
    pressure: { size: 0.95, curve: 1.8 }, tilt: { mode: 'angle', amount: 1 }, speedPressure: true,
  }),

  preset('g-pen', 'G-Pen (manga)', 'inking', {
    size: 10, minSize: 0.5, maxSize: 60, hardness: 1, spacing: 0.04, smoothing: 0.5,
    pressure: { size: 1, curve: 1.6 }, speedPressure: true,
  }),
  preset('maru-pen', 'Maru Pen (fine)', 'inking', {
    size: 4, minSize: 0.5, maxSize: 20, hardness: 1, spacing: 0.04, smoothing: 0.55,
    pressure: { size: 0.9, curve: 1.3 }, speedPressure: true,
  }),
  preset('fineliner', 'Fineliner', 'inking', {
    size: 3, minSize: 1, maxSize: 16, hardness: 1, spacing: 0.04, smoothing: 0.5,
    pressure: { size: 0.1, opacity: 0 },
  }),
  preset('calligraphy', 'Calligraphy', 'inking', {
    size: 22, minSize: 2, maxSize: 120, hardness: 1, spacing: 0.03, smoothing: 0.45,
    shape: { tip: 'flat', roundness: 0.18 }, rotation: { angle: 45 },
    pressure: { size: 0.6, curve: 1.2 },
  }),
  preset('kabura-pen', 'Kabura Pen', 'inking', {
    size: 6, minSize: 0.5, maxSize: 40, hardness: 1, spacing: 0.04, smoothing: 0.5,
    pressure: { size: 0.6, curve: 1.2 }, speedPressure: true,
  }),
  preset('dry-ink', 'Dry Ink', 'inking', {
    size: 12, minSize: 1, maxSize: 80, hardness: 0.95, spacing: 0.05, smoothing: 0.4,
    shape: { tip: 'chalk', roundness: 0.85 }, texture: { kind: 'paper', strength: 0.45 },
    jitter: { rotation: 1 }, pressure: { size: 0.8, curve: 1.4 },
  }),
  preset('marker', 'Marker', 'inking', {
    size: 24, minSize: 4, maxSize: 120, opacity: 0.6, flow: 1, hardness: 0.92, spacing: 0.05, smoothing: 0.35,
    shape: { tip: 'flat', roundness: 0.55 }, rotation: { angle: 30 },
    pressure: { size: 0.1, opacity: 0 },
  }),

  // ---- Painting --------------------------------------------------------------------------------
  preset('round-brush', 'Round Brush', 'painting', {
    size: 30, minSize: 2, maxSize: 300, flow: 0.8, hardness: 0.85, spacing: 0.06, smoothing: 0.3,
    pressure: { size: 0.4, opacity: 0.3 },
  }),
  preset('flat-brush', 'Flat Brush', 'painting', {
    size: 40, minSize: 4, maxSize: 300, flow: 0.7, hardness: 0.9, spacing: 0.04, smoothing: 0.3,
    shape: { tip: 'flat', roundness: 0.25 }, rotation: { angle: 90, followStroke: true },
    pressure: { size: 0.3, opacity: 0.2 },
  }),
  preset('soft-paint', 'Soft Paint Brush', 'painting', {
    size: 50, minSize: 4, maxSize: 400, flow: 0.35, hardness: 0.3, spacing: 0.08, smoothing: 0.3,
    pressure: { size: 0.3, opacity: 0.5 },
  }),

  preset('gouache', 'Gouache', 'painting', {
    size: 36, minSize: 4, maxSize: 300, flow: 0.9, hardness: 0.75, spacing: 0.05, smoothing: 0.3,
    shape: { roundness: 0.8 }, texture: { kind: 'canvas', strength: 0.25 },
    pressure: { size: 0.4, opacity: 0.25 },
  }),
  preset('oil-brush', 'Oil Brush', 'painting', {
    size: 44, minSize: 6, maxSize: 300, flow: 0.85, hardness: 0.8, spacing: 0.04, smoothing: 0.3,
    shape: { tip: 'flat', roundness: 0.35 }, rotation: { angle: 90, followStroke: true },
    texture: { kind: 'canvas', strength: 0.45 }, jitter: { opacity: 0.1 },
    pressure: { size: 0.35, opacity: 0.3 },
  }),
  preset('watercolor', 'Watercolour', 'painting', {
    size: 60, minSize: 6, maxSize: 400, opacity: 0.8, flow: 0.18, hardness: 0.25, spacing: 0.08, smoothing: 0.3,
    texture: { kind: 'paper', strength: 0.45, scale: 1.4 }, jitter: { size: 0.15, opacity: 0.2 },
    pressure: { size: 0.3, opacity: 0.6 },
  }),
  preset('dry-brush', 'Dry Brush', 'painting', {
    size: 40, minSize: 4, maxSize: 300, flow: 0.8, hardness: 0.6, spacing: 0.06, smoothing: 0.25,
    shape: { tip: 'grain', roundness: 0.5 }, rotation: { angle: 90, followStroke: true },
    texture: { kind: 'canvas', strength: 0.6 }, pressure: { size: 0.3, opacity: 0.4 },
  }),

  preset('acrylic', 'Acrylic', 'painting', {
    size: 40, minSize: 4, maxSize: 300, flow: 0.95, hardness: 0.85, spacing: 0.04, smoothing: 0.3,
    shape: { tip: 'flat', roundness: 0.5 }, rotation: { angle: 90, followStroke: true },
    texture: { kind: 'canvas', strength: 0.3 }, pressure: { size: 0.3, opacity: 0.2 },
  }),
  preset('wet-wash', 'Wet Wash', 'painting', {
    size: 90, minSize: 8, maxSize: 500, opacity: 0.6, flow: 0.12, hardness: 0.1, spacing: 0.08, smoothing: 0.35,
    texture: { kind: 'paper', strength: 0.3, scale: 1.8 }, jitter: { size: 0.1 },
    pressure: { size: 0.2, opacity: 0.6 },
  }),

  // ---- Blending: mix the colours already on the layer instead of painting -------------------
  preset('blender', 'Blender', 'blending', {
    size: 40, minSize: 2, maxSize: 300, flow: 0.6, hardness: 0.5, spacing: 0.06, smoothing: 0.3, blend: 0.5,
    pressure: { size: 0.3, opacity: 0.6 },
  }),
  preset('soft-blender', 'Soft Blender', 'blending', {
    size: 80, minSize: 4, maxSize: 500, flow: 0.35, hardness: 0.1, spacing: 0.08, smoothing: 0.35, blend: 0.8,
    pressure: { size: 0.2, opacity: 0.7 },
  }),
  preset('detail-blender', 'Detail Blender', 'blending', {
    size: 12, minSize: 1, maxSize: 60, flow: 0.7, hardness: 0.6, spacing: 0.06, smoothing: 0.3, blend: 0.6,
    pressure: { size: 0.4, opacity: 0.5 },
  }),
  preset('textured-blender', 'Textured Blender', 'blending', {
    size: 36, minSize: 3, maxSize: 200, flow: 0.6, hardness: 0.6, spacing: 0.1, smoothing: 0.25, blend: 0.45,
    shape: { tip: 'chalk' }, texture: { kind: 'paper', strength: 0.5 },
    jitter: { rotation: 1 }, pressure: { size: 0.3, opacity: 0.6 },
  }),
  preset('smudge', 'Smudge', 'blending', {
    size: 30, minSize: 2, maxSize: 200, flow: 1, hardness: 0.6, spacing: 0.06, smoothing: 0.3, smudge: 0.75,
    pressure: { size: 0.3, opacity: 0.5 },
  }),
  preset('soft-smudge', 'Soft Smudge', 'blending', {
    size: 60, minSize: 4, maxSize: 300, flow: 1, hardness: 0.15, spacing: 0.06, smoothing: 0.35, smudge: 0.55,
    pressure: { size: 0.2, opacity: 0.6 },
  }),
  preset('finger', 'Finger Blend', 'blending', {
    size: 22, minSize: 2, maxSize: 120, flow: 1, hardness: 0.4, spacing: 0.05, smoothing: 0.3, smudge: 0.9,
    shape: { roundness: 0.8 }, pressure: { size: 0.5, opacity: 0.4 },
  }),
  preset('blur', 'Blur', 'blending', {
    size: 60, minSize: 4, maxSize: 400, flow: 0.5, hardness: 0.3, spacing: 0.08, smoothing: 0.3, blend: 1,
    pressure: { size: 0, opacity: 0.5 },
  }),

  // ---- Airbrush --------------------------------------------------------------------------------
  preset('soft-airbrush', 'Soft Airbrush', 'airbrush', {
    size: 120, minSize: 4, maxSize: 600, flow: 0.06, hardness: 0, spacing: 0.06, smoothing: 0.35,
    pressure: { size: 0, opacity: 0.9 },
  }),
  preset('hard-airbrush', 'Hard Airbrush', 'airbrush', {
    size: 60, minSize: 2, maxSize: 400, flow: 0.12, hardness: 0.7, spacing: 0.05, smoothing: 0.35,
    pressure: { size: 0, opacity: 0.8 },
  }),

  preset('airbrush', 'Airbrush', 'airbrush', {
    size: 80, minSize: 4, maxSize: 500, flow: 0.08, hardness: 0.35, spacing: 0.05, smoothing: 0.35,
    pressure: { size: 0.3, opacity: 0.9 }, tilt: { mode: 'size', amount: 0.5 },
  }),
  preset('fine-airbrush', 'Fine Airbrush', 'airbrush', {
    size: 16, minSize: 1, maxSize: 80, flow: 0.15, hardness: 0.4, spacing: 0.05, smoothing: 0.4,
    pressure: { size: 0.4, opacity: 0.8 },
  }),
  preset('mist', 'Mist', 'airbrush', {
    size: 260, minSize: 10, maxSize: 1000, flow: 0.03, hardness: 0, spacing: 0.08, smoothing: 0.4,
    pressure: { size: 0, opacity: 0.8 },
  }),
  preset('splatter', 'Splatter', 'airbrush', {
    size: 40, minSize: 4, maxSize: 300, flow: 1, hardness: 1, spacing: 0.45, smoothing: 0.2,
    scatter: 1.2, jitter: { size: 0.9, opacity: 0.3 }, pressure: { size: 0.4, opacity: 0.3 },
  }),
  preset('stipple', 'Stipple Spray', 'airbrush', {
    size: 30, minSize: 3, maxSize: 200, flow: 0.9, hardness: 0.9, spacing: 0.25, smoothing: 0.25,
    scatter: 0.8, jitter: { size: 0.7, opacity: 0.4 }, pressure: { size: 0.3, opacity: 0.5 },
  }),
  preset('spray', 'Spray Paint', 'airbrush', {
    size: 80, minSize: 6, maxSize: 400, flow: 0.5, hardness: 0.9, spacing: 0.04, smoothing: 0.3,
    shape: { tip: 'grain' }, scatter: 0.35, jitter: { size: 0.4, opacity: 0.5, rotation: 1 },
    pressure: { size: 0.2, opacity: 0.7 },
  }),

  // ---- Texture ---------------------------------------------------------------------------------
  preset('crayon', 'Crayon', 'texture', {
    size: 22, minSize: 3, maxSize: 120, flow: 0.8, hardness: 0.75, spacing: 0.1, smoothing: 0.25,
    shape: { tip: 'chalk', roundness: 0.8 }, texture: { kind: 'paper', strength: 0.85, scale: 1.2 },
    jitter: { rotation: 1 }, pressure: { size: 0.3, opacity: 0.6 },
  }),
  preset('pastel', 'Soft Pastel', 'texture', {
    size: 36, minSize: 4, maxSize: 200, flow: 0.45, hardness: 0.5, spacing: 0.1, smoothing: 0.25,
    shape: { tip: 'chalk' }, texture: { kind: 'canvas', strength: 0.55, scale: 1.3 },
    jitter: { opacity: 0.2, rotation: 1 }, pressure: { size: 0.3, opacity: 0.7 },
  }),
  preset('chalk', 'Chalk', 'texture', {
    size: 28, minSize: 3, maxSize: 200, flow: 0.7, hardness: 0.7, spacing: 0.12, smoothing: 0.25,
    shape: { tip: 'chalk' }, texture: { kind: 'paper', strength: 0.6 },
    scatter: 0.05, jitter: { size: 0.1, rotation: 1 }, pressure: { size: 0.3, opacity: 0.5 },
    tilt: { mode: 'size', amount: 0.5 },
  }),
  preset('charcoal', 'Charcoal', 'texture', {
    size: 24, minSize: 3, maxSize: 200, flow: 0.6, hardness: 0.6, spacing: 0.1, smoothing: 0.25,
    shape: { tip: 'charcoal' }, texture: { kind: 'canvas', strength: 0.5 },
    jitter: { opacity: 0.3, rotation: 1 }, pressure: { size: 0.3, opacity: 0.6 },
    tilt: { mode: 'size', amount: 0.6 },
  }),
  preset('sponge', 'Sponge', 'texture', {
    size: 50, minSize: 4, maxSize: 300, flow: 0.6, hardness: 0.7, spacing: 0.2, smoothing: 0.2,
    shape: { tip: 'charcoal' }, texture: { kind: 'grain', strength: 0.5, scale: 1.5 },
    jitter: { size: 0.2, opacity: 0.3, rotation: 1 }, pressure: { size: 0.2, opacity: 0.6 },
  }),
  preset('grain', 'Grain', 'texture', {
    size: 40, minSize: 4, maxSize: 300, flow: 0.5, hardness: 0.5, spacing: 0.15, smoothing: 0.25,
    shape: { tip: 'grain' }, texture: { kind: 'grain', strength: 0.4 },
    scatter: 0.2, jitter: { size: 0.3, opacity: 0.4, rotation: 1 }, pressure: { size: 0.2, opacity: 0.5 },
  }),

  // ---- Screentone: fill areas with halftone; dot size and density are per brush ---------------
  preset('tone-fine', 'Tone · Fine dots', 'tone', {
    size: 80, minSize: 4, maxSize: 600, hardness: 1, spacing: 0.05, smoothing: 0.2,
    texture: { kind: 'tone-dots', strength: 0.3, scale: 0.35 }, pressure: { size: 0, opacity: 0 },
  }),
  preset('tone-medium', 'Tone · Medium dots', 'tone', {
    size: 100, minSize: 4, maxSize: 600, hardness: 1, spacing: 0.05, smoothing: 0.2,
    texture: { kind: 'tone-dots', strength: 0.45, scale: 0.6 }, pressure: { size: 0, opacity: 0 },
  }),
  preset('tone-coarse', 'Tone · Coarse dots', 'tone', {
    size: 120, minSize: 4, maxSize: 600, hardness: 1, spacing: 0.05, smoothing: 0.2,
    texture: { kind: 'tone-dots', strength: 0.5, scale: 1.2 }, pressure: { size: 0, opacity: 0 },
  }),
  preset('tone-dense', 'Tone · Dark (dense)', 'tone', {
    size: 100, minSize: 4, maxSize: 600, hardness: 1, spacing: 0.05, smoothing: 0.2,
    texture: { kind: 'tone-dots', strength: 0.85, scale: 0.5 }, pressure: { size: 0, opacity: 0 },
  }),
  preset('tone-soft', 'Tone · Soft edge', 'tone', {
    size: 140, minSize: 4, maxSize: 600, hardness: 0.2, spacing: 0.05, smoothing: 0.2,
    texture: { kind: 'tone-dots', strength: 0.45, scale: 0.5 }, pressure: { size: 0, opacity: 0.6 },
  }),
  tone('tone-tiny', 'Tone · Tiny dots', { kind: 'tone-dots', strength: 0.35, scale: 0.25 }),
  tone('tone-large', 'Tone · Large dots', { kind: 'tone-dots', strength: 0.45, scale: 2 }),
  tone('tone-huge', 'Tone · Huge dots', { kind: 'tone-dots', strength: 0.45, scale: 3.5 }),
  tone('tone-dots-45', 'Tone · Dots 45°', { kind: 'tone-dots', strength: 0.45, scale: 0.6, angle: 45 }),
  // Circles of different sizes.
  tone('tone-mixed', 'Tone · Mixed-size dots', { kind: 'tone-dots', strength: 0.55, scale: 0.9, variation: 0.6 }),
  tone('tone-scattered', 'Tone · Scattered circles', { kind: 'tone-dots', strength: 0.6, scale: 1.6, variation: 0.9, angle: 20 }),
  tone('tone-rings', 'Tone · Rings', { kind: 'tone-rings', strength: 0.4, scale: 1 }),
  tone('tone-bubbles', 'Tone · Bubbles', { kind: 'tone-rings', strength: 0.35, scale: 1.8, variation: 0.75 }),
  tone('tone-stipple', 'Tone · Sand (stipple)', { kind: 'tone-stipple', strength: 0.5, scale: 0.6, variation: 0.5 }),
  // Lines, straight and diagonal.
  preset('tone-lines', 'Tone · Lines', 'tone', {
    size: 100, minSize: 4, maxSize: 600, hardness: 1, spacing: 0.05, smoothing: 0.2,
    texture: { kind: 'tone-lines', strength: 0.35, scale: 0.4 }, pressure: { size: 0, opacity: 0 },
  }),
  tone('tone-vertical', 'Tone · Vertical lines', { kind: 'tone-lines', strength: 0.35, scale: 0.4, angle: 90 }),
  tone('tone-diagonal', 'Tone · Diagonal lines', { kind: 'tone-lines', strength: 0.35, scale: 0.4, angle: 45 }),
  tone('tone-diagonal-reverse', 'Tone · Diagonal lines (reverse)', { kind: 'tone-lines', strength: 0.35, scale: 0.4, angle: -45 }),
  tone('tone-diagonal-fine', 'Tone · Fine diagonal', { kind: 'tone-lines', strength: 0.3, scale: 0.25, angle: 45 }),
  tone('tone-diagonal-bold', 'Tone · Bold diagonal', { kind: 'tone-lines', strength: 0.55, scale: 0.9, angle: 45 }),
  tone('tone-crosshatch', 'Tone · Crosshatch', { kind: 'tone-crosshatch', strength: 0.35, scale: 0.45 }),
  tone('tone-crosshatch-45', 'Tone · Diagonal crosshatch', { kind: 'tone-crosshatch', strength: 0.35, scale: 0.45, angle: 45 }),
];

export const DEFAULT_BRUSH_ID = 'studio-pen';
export const DEFAULT_ERASER_ID = 'round-brush';

export function findBuiltIn(id: string): BrushPreset | undefined {
  return BUILT_IN_BRUSHES.find((b) => b.id === id);
}
