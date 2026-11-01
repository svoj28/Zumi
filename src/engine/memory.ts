/**
 * Canvas memory model. Every raster layer is an uncompressed RGBA surface (4 bytes/pixel), so
 * memory grows with width × height × layers. The budget adapts to the device's physical RAM
 * (configured once at startup) so large tablets allow more layers than small phones.
 */

const MB = 1024 * 1024;
const MIN_BUDGET = 256 * MB;
const MAX_BUDGET = 1536 * MB;
/** Share of physical RAM we let layer surfaces use; the OS, JS heap and GPU need the rest. */
const RAM_SHARE = 0.2;
const MAX_LAYERS_HARD = 100;
/**
 * Working set just to open a canvas: the layer surface, its on-screen snapshot, and headroom
 * for compositing (thumbnails/export) and undo regions.
 */
const BASE_LAYER_MULTIPLIER = 3;

let budget = 640 * MB;

/** Call once at startup with the device's total RAM (e.g. expo-device `totalMemory`). */
export function configureMemoryBudget(totalDeviceBytes: number | null | undefined): void {
  if (!totalDeviceBytes || totalDeviceBytes <= 0) return;
  budget = Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, totalDeviceBytes * RAM_SHARE));
}

export function layerMemoryBudget(): number {
  return budget;
}

/**
 * Undo history budget. Pixel history is stored as dirty-region snapshots, so most steps are
 * small; the byte cap exists for the occasional full-layer step (clear, transform, merge,
 * deleted layers kept for undo) on large canvases. Scales with the layer budget so small
 * phones keep less history instead of being killed by the OS.
 */
const HISTORY_SHARE = 0.3;
const MIN_HISTORY_BYTES = 64 * MB;
const MAX_HISTORY_BYTES = 512 * MB;
const MAX_HISTORY_STEPS = 100;

export function historyLimits(): { maxEntries: number; maxBytes: number } {
  return {
    maxEntries: MAX_HISTORY_STEPS,
    maxBytes: Math.min(MAX_HISTORY_BYTES, Math.max(MIN_HISTORY_BYTES, budget * HISTORY_SHARE)),
  };
}

export function bytesPerLayer(width: number, height: number): number {
  return width * height * 4;
}

export function maxLayersFor(width: number, height: number): number {
  return Math.max(1, Math.min(MAX_LAYERS_HARD, Math.floor(budget / bytesPerLayer(width, height))));
}

export type MemoryLevel = 'ok' | 'caution' | 'danger' | 'blocked';

export interface CanvasMemoryEstimate {
  layerBytes: number;
  /** Estimated memory needed just to open the canvas with one layer. */
  baseBytes: number;
  maxLayers: number;
  budgetBytes: number;
  level: MemoryLevel;
  message: string;
}

export function estimateCanvasMemory(width: number, height: number): CanvasMemoryEstimate {
  const layerBytes = bytesPerLayer(width, height);
  const baseBytes = layerBytes * BASE_LAYER_MULTIPLIER;
  const maxLayers = maxLayersFor(width, height);
  const base = { layerBytes, baseBytes, maxLayers, budgetBytes: budget };

  if (baseBytes > budget) {
    return { ...base, maxLayers: 0, level: 'blocked', message: 'Too large for this device’s memory. Choose a smaller size.' };
  }
  if (maxLayers < 3) {
    return {
      ...base,
      level: 'danger',
      message: `Extremely large for this device: only ${maxLayers} layer${maxLayers === 1 ? '' : 's'} will fit, and the app may be closed by the system under memory pressure.`,
    };
  }
  if (maxLayers < 10 || layerBytes >= 64 * MB) {
    return { ...base, level: 'caution', message: `Large canvas: up to ${maxLayers} layers on this device. Brushes and saving may be slower.` };
  }
  return { ...base, level: 'ok', message: `Up to ${maxLayers} layers on this device.` };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}
