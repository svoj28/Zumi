/**
 * Brush presets: every drawing tool is data interpreted by one engine (dab emitter + stamp
 * renderer), not code. Presets are plain JSON-safe objects so they can be persisted, edited,
 * duplicated and passed into UI-thread worklets.
 */

export type BrushCategory = 'sketching' | 'inking' | 'painting' | 'blending' | 'airbrush' | 'texture' | 'tone' | 'custom';

export const BRUSH_CATEGORIES: { id: BrushCategory; label: string }[] = [
  { id: 'sketching', label: 'Sketching' },
  { id: 'inking', label: 'Inking' },
  { id: 'painting', label: 'Painting' },
  { id: 'blending', label: 'Blending' },
  { id: 'airbrush', label: 'Airbrush' },
  { id: 'texture', label: 'Texture' },
  { id: 'tone', label: 'Screentone' },
  { id: 'custom', label: 'My Brushes' },
];

/**
 * Stamp (tip) shapes; each is generated procedurally as an alpha mask. The shape tips (square
 * onwards) are outlines stamped along the stroke, for decorative and custom brushes.
 */
export type BrushTip =
  | 'round'
  | 'flat'
  | 'pencil'
  | 'chalk'
  | 'charcoal'
  | 'grain'
  | 'square'
  | 'triangle'
  | 'star'
  | 'heart'
  | 'leaf'
  | 'splat'
  | 'image';
/**
 * Paper-space grain applied to the whole stroke (stays fixed to the canvas). The tone kinds are
 * manga screentones: a halftone pattern (dots, rings, lines, crosshatch or random stipple), so
 * the stroke only colours the pattern. For them, `scale` sets the cell size, `strength` the
 * density, `angle` turns the pattern (45° gives diagonal tone) and `variation` mixes circle sizes.
 */
export type BrushTexture =
  | 'none'
  | 'paper'
  | 'canvas'
  | 'grain'
  | 'tone-dots'
  | 'tone-rings'
  | 'tone-lines'
  | 'tone-crosshatch'
  | 'tone-stipple';

export const TONE_TEXTURES: readonly BrushTexture[] = ['tone-dots', 'tone-rings', 'tone-lines', 'tone-crosshatch', 'tone-stipple'];

export function isToneTexture(kind: BrushTexture): boolean {
  return TONE_TEXTURES.includes(kind);
}

/** Tone patterns made of circles, which can mix circle sizes (`texture.variation`). */
export function isCircleTone(kind: BrushTexture): boolean {
  return kind === 'tone-dots' || kind === 'tone-rings' || kind === 'tone-stipple';
}
export type TiltMode = 'none' | 'size' | 'opacity' | 'angle';

export interface BrushPreset {
  id: string;
  name: string;
  category: BrushCategory;
  builtIn: boolean;

  /** Diameter in canvas px. */
  size: number;
  /** Smallest diameter the brush produces (floor for pressure/jitter), px. */
  minSize: number;
  /** Upper bound of the size slider for this brush, px. */
  maxSize: number;
  /** Stroke opacity cap, 0..1 — overlapping dabs within a stroke never exceed it. */
  opacity: number;
  /** Per-dab opacity, 0..1 — low flow builds up gradually (airbrush). */
  flow: number;
  /** Tip edge: 0 = fully soft, 1 = hard edge. */
  hardness: number;
  /** Dab distance as a fraction of the diameter. */
  spacing: number;
  /** Input stabiliser, 0..1. */
  smoothing: number;
  /**
   * Blending, 0..1: above 0 the brush lays down no colour and instead mixes the pixels already
   * on the layer under the stroke; the value sets how far colours are pulled together (as a
   * fraction of the brush size).
   */
  blend: number;
  /**
   * Smudge, 0..1: above 0 the brush drags the colours under it along the stroke (like a finger
   * in wet paint) instead of painting; the value is how much colour is carried.
   */
  smudge: number;

  shape: {
    tip: BrushTip;
    /** Tip aspect: 1 = circular, lower = flatter ellipse. */
    roundness: number;
    /** Image tips: id of the stored tip image (see storage/brushTips). */
    image?: string;
  };
  texture: {
    kind: BrushTexture;
    /** 0..1: how strongly the grain cuts into the stroke. */
    strength: number;
    /** Grain scale multiplier (1 = default). */
    scale: number;
    /** Pattern angle, degrees (screentones). */
    angle: number;
    /** 0..1: how much circle sizes vary from cell to cell (circle screentones). */
    variation: number;
  };
  rotation: {
    /** Base tip angle, degrees. */
    angle: number;
    /** Rotate the tip with the stroke direction (flat brushes, calligraphy). */
    followStroke: boolean;
  };
  /** Random positional offset as a fraction of the diameter. */
  scatter: number;
  jitter: {
    /** Random size variation, 0..1. */
    size: number;
    /** Random opacity variation, 0..1. */
    opacity: number;
    /** Random rotation, 0..1 of ±180°. */
    rotation: number;
  };
  pressure: {
    /** How much pressure reduces size at light touch, 0..1. */
    size: number;
    /** How much pressure reduces opacity at light touch, 0..1. */
    opacity: number;
    /** Response curve exponent: >1 needs more force, <1 is more sensitive. */
    curve: number;
  };
  tilt: {
    mode: TiltMode;
    amount: number;
  };
  /** Finger / capacitive stylus: simulate pressure from speed. */
  speedPressure: boolean;
}

export type BrushPresetPatch = Partial<Omit<BrushPreset, 'shape' | 'texture' | 'rotation' | 'jitter' | 'pressure' | 'tilt'>> & {
  shape?: Partial<BrushPreset['shape']>;
  texture?: Partial<BrushPreset['texture']>;
  rotation?: Partial<BrushPreset['rotation']>;
  jitter?: Partial<BrushPreset['jitter']>;
  pressure?: Partial<BrushPreset['pressure']>;
  tilt?: Partial<BrushPreset['tilt']>;
};

const NESTED = ['shape', 'texture', 'rotation', 'jitter', 'pressure', 'tilt'] as const;

/** Applies a (possibly nested) partial update. Pure. */
export function mergePreset(base: BrushPreset, patch: BrushPresetPatch | undefined): BrushPreset {
  if (!patch) return base;
  const out = { ...base, ...patch } as BrushPreset;
  for (const key of NESTED) {
    if (patch[key]) (out as unknown as Record<string, unknown>)[key] = { ...base[key], ...patch[key] };
  }
  return out;
}

export const BRUSH_LIMITS = { minDiameter: 0.5, maxDiameter: 1000 } as const;

const TIPS: readonly BrushTip[] = ['round', 'flat', 'pencil', 'chalk', 'charcoal', 'grain', 'square', 'triangle', 'star', 'heart', 'leaf', 'splat', 'image'];
const TEXTURES: readonly BrushTexture[] = ['none', 'paper', 'canvas', 'grain', ...TONE_TEXTURES];
const TILT_MODES: readonly TiltMode[] = ['none', 'size', 'opacity', 'angle'];
const CATEGORIES: readonly BrushCategory[] = BRUSH_CATEGORIES.map((c) => c.id);

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** A valid tip image id (letters, digits, - and _), or nothing. */
function imageField(v: unknown, fallback: string | undefined): { image?: string } {
  const id = typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : fallback;
  return id ? { image: id } : {};
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Validates untrusted (persisted) data into a complete preset, filling gaps from `fallback`. */
export function normalizePreset(raw: unknown, fallback: BrushPreset): BrushPreset {
  const r = (raw ?? {}) as Partial<Record<keyof BrushPreset, unknown>> & Record<string, unknown>;
  const sub = (key: (typeof NESTED)[number]) => (r[key] ?? {}) as Record<string, unknown>;
  const maxSize = num(r.maxSize, fallback.maxSize, 1, BRUSH_LIMITS.maxDiameter);
  const minSize = num(r.minSize, fallback.minSize, BRUSH_LIMITS.minDiameter, maxSize);
  return {
    id: typeof r.id === 'string' && r.id ? r.id : fallback.id,
    name: typeof r.name === 'string' && r.name ? r.name.slice(0, 60) : fallback.name,
    category: pick(r.category, CATEGORIES, fallback.category),
    builtIn: r.builtIn === true,
    size: num(r.size, fallback.size, minSize, maxSize),
    minSize,
    maxSize,
    opacity: num(r.opacity, fallback.opacity, 0.01, 1),
    flow: num(r.flow, fallback.flow, 0.01, 1),
    hardness: num(r.hardness, fallback.hardness, 0, 1),
    spacing: num(r.spacing, fallback.spacing, 0.01, 2),
    smoothing: num(r.smoothing, fallback.smoothing, 0, 1),
    blend: num(r.blend, fallback.blend, 0, 1),
    smudge: num(r.smudge, fallback.smudge ?? 0, 0, 1),
    shape: {
      tip: pick(sub('shape').tip, TIPS, fallback.shape.tip),
      roundness: num(sub('shape').roundness, fallback.shape.roundness, 0.05, 1),
      ...imageField(sub('shape').image, fallback.shape.image),
    },
    texture: {
      kind: pick(sub('texture').kind, TEXTURES, fallback.texture.kind),
      strength: num(sub('texture').strength, fallback.texture.strength, 0, 1),
      scale: num(sub('texture').scale, fallback.texture.scale, 0.25, 4),
      angle: num(sub('texture').angle, fallback.texture.angle, -180, 180),
      variation: num(sub('texture').variation, fallback.texture.variation, 0, 1),
    },
    rotation: {
      angle: num(sub('rotation').angle, fallback.rotation.angle, -360, 360),
      followStroke: typeof sub('rotation').followStroke === 'boolean' ? (sub('rotation').followStroke as boolean) : fallback.rotation.followStroke,
    },
    scatter: num(r.scatter, fallback.scatter, 0, 2),
    jitter: {
      size: num(sub('jitter').size, fallback.jitter.size, 0, 1),
      opacity: num(sub('jitter').opacity, fallback.jitter.opacity, 0, 1),
      rotation: num(sub('jitter').rotation, fallback.jitter.rotation, 0, 1),
    },
    pressure: {
      size: num(sub('pressure').size, fallback.pressure.size, 0, 1),
      opacity: num(sub('pressure').opacity, fallback.pressure.opacity, 0, 1),
      curve: num(sub('pressure').curve, fallback.pressure.curve, 0.2, 5),
    },
    tilt: {
      mode: pick(sub('tilt').mode, TILT_MODES, fallback.tilt.mode),
      amount: num(sub('tilt').amount, fallback.tilt.amount, 0, 1),
    },
    speedPressure: typeof r.speedPressure === 'boolean' ? r.speedPressure : fallback.speedPressure,
  };
}
