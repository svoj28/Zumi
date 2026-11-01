import type { LayerBlendMode, Rect } from '@/engine/types';

/**
 * Timelapse recording format. A recording is a sequence of frames, each holding only what
 * changed after an edit: the layer stack (when it changed) and, per changed layer, a PNG of the
 * changed rectangle. Nothing is stored for parts of the canvas that did not change, so a long
 * painting session costs roughly as much storage as the strokes themselves.
 *
 *   <project>/timelapse/state.json        ← TimelapseState (written after every frame)
 *                      /frames-00000.json ← TimelapseFrame[] (FRAMES_PER_CHUNK per file)
 *                      /patches/<n>.png   ← changed rectangles
 *
 * Rectangles are snapped outward to PATCH_GRID pixels so that replaying at 1/2, 1/4 or 1/8
 * scale maps every patch to whole output pixels (no seams between patches).
 */

export const TIMELAPSE_FORMAT = 'zumi.timelapse';
export const TIMELAPSE_VERSION = 1;
export const FRAMES_PER_CHUNK = 100;
export const PATCH_GRID = 8;

export interface TimelapseLayerState {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: LayerBlendMode;
}

export interface TimelapsePatch {
  layerId: string;
  /** File name inside `patches/`. */
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelapseFrame {
  /** Capture time, ms since epoch. */
  t: number;
  /** Full layer stack (bottom → top), present only when it changed. */
  stack?: TimelapseLayerState[];
  /** Paper colour, present only when it changed. */
  background?: string;
  patches: TimelapsePatch[];
}

export interface TimelapseState {
  format: typeof TIMELAPSE_FORMAT;
  version: number;
  width: number;
  height: number;
  frameCount: number;
  nextPatch: number;
  /** Total size of all patch files, bytes. */
  bytes: number;
  /** Layer revision last recorded, per layer id: unchanged layers are skipped. */
  revisions: Record<string, number>;
  stack: TimelapseLayerState[];
  background: string;
}

export function chunkName(index: number): string {
  return `frames-${String(index).padStart(5, '0')}.json`;
}

/** Grows `rect` to PATCH_GRID boundaries, clamped to the canvas. Null if nothing is left. */
export function snapToGrid(rect: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(rect.x / PATCH_GRID) * PATCH_GRID);
  const y0 = Math.max(0, Math.floor(rect.y / PATCH_GRID) * PATCH_GRID);
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) / PATCH_GRID) * PATCH_GRID);
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) / PATCH_GRID) * PATCH_GRID);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Validates a parsed state file; null when it is not a usable recording. */
export function parseState(raw: unknown): TimelapseState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<TimelapseState>;
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (s.format !== TIMELAPSE_FORMAT || s.version !== TIMELAPSE_VERSION) return null;
  if (!int(s.width) || !int(s.height) || !int(s.frameCount) || !int(s.nextPatch) || !int(s.bytes)) return null;
  if (!s.revisions || typeof s.revisions !== 'object' || !Array.isArray(s.stack) || typeof s.background !== 'string') return null;
  return s as TimelapseState;
}

// ---- playback plan -----------------------------------------------------------------------------

/** GIF frames per second (GIF delays are in 1/100 s, so 15 fps ≈ 6.7 cs per frame). */
export const TIMELAPSE_FPS = 15;
/** MP4 frames per second: video players handle more frames smoothly and cheaply. */
export const TIMELAPSE_VIDEO_FPS = 30;
/** Longest side of the exported animation. */
export const TIMELAPSE_MAX_SIDE = 1080;
export const TIMELAPSE_DURATIONS = [5, 10, 15, 30, 60] as const;

/**
 * Integer downscale (1, 2, 4 or 8) for the output: the smallest that fits TIMELAPSE_MAX_SIDE.
 * Powers of two divide PATCH_GRID, so patch edges land on whole output pixels.
 */
export function outputScale(width: number, height: number): { divisor: number; width: number; height: number } {
  const longest = Math.max(width, height);
  let divisor = 1;
  while (divisor < PATCH_GRID && longest / divisor > TIMELAPSE_MAX_SIDE) divisor *= 2;
  return { divisor, width: Math.max(1, Math.ceil(width / divisor)), height: Math.max(1, Math.ceil(height / divisor)) };
}

export interface PlaybackPlan {
  /** For each output frame, the index of the last recorded frame it shows. */
  frames: number[];
  /** Display time of each output frame, 1/100 s; the last one includes the final hold. */
  delaysCs: number[];
}

/**
 * Spreads `recorded` frames over `seconds`: at most `fps` output frames per second
 * (fewer, each shown longer, when little was recorded), always ending on the finished artwork,
 * which is held for the last ~20% of the time (max 2 s).
 */
export function planPlayback(recorded: number, seconds: number, fps = TIMELAPSE_FPS): PlaybackPlan {
  if (recorded <= 0) return { frames: [], delaysCs: [] };
  const totalCs = Math.max(20, Math.round(seconds * 100));
  const holdCs = Math.min(200, Math.round(totalCs * 0.2));
  const playCs = totalCs - holdCs;
  const count = Math.max(1, Math.min(recorded, Math.floor((playCs / 100) * fps)));

  const frames: number[] = [];
  const delaysCs: number[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(Math.ceil(((i + 1) * recorded) / count) - 1);
    delaysCs.push(Math.round(((i + 1) * playCs) / count) - Math.round((i * playCs) / count));
  }
  delaysCs[count - 1] += holdCs;
  return { frames, delaysCs };
}
