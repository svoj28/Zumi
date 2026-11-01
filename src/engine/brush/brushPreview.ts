import { Skia, type SkImage } from '@shopify/react-native-skia';

import type { BrushPreset } from '@/engine/brush/brushPreset';
import { dabBounds, drawDabs } from '@/engine/brush/stampRenderer';
import { replayStroke } from '@/engine/brush/strokeInterpolator';
import { SAMPLE_STRIDE } from '@/engine/types';

/**
 * Renders a sample stroke with a preset through the real brush engine (same dabs, tips and
 * textures as painting), for the brush library. Results are cached by preset + colour + size.
 */

// Large enough to hold every library row (built-in + custom brushes) so scrolling back is free.
const MAX_CACHE = 256;
const cache = new Map<string, SkImage>();
const PREVIEW_SEED = 1337;

function previewKey(preset: BrushPreset, color: string, width: number, height: number) {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  return { w, h, key: JSON.stringify([preset, color, w, h]) };
}

/** A cached preview without rendering: undefined when it has not been rendered yet. */
export function peekBrushPreview(preset: BrushPreset, color: string, width: number, height: number): SkImage | undefined {
  return cache.get(previewKey(preset, color, width, height).key);
}

export function renderBrushPreview(preset: BrushPreset, color: string, width: number, height: number): SkImage | null {
  const { w, h, key } = previewKey(preset, color, width, height);
  const cached = cache.get(key);
  if (cached) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  // Scale the brush to fit the preview while keeping its character.
  const size = Math.min(preset.size, h * 0.5);
  const factor = size / preset.size;
  const brush: BrushPreset = {
    ...preset,
    size,
    minSize: Math.max(0.5, preset.minSize * factor),
    maxSize: Math.max(size, preset.maxSize * factor),
    texture: { ...preset.texture, scale: preset.texture.scale * Math.max(0.35, factor) },
  };

  // An S-curve with pressure tapering in and out, and some tilt for tilt-aware brushes.
  const pad = size / 2 + 4;
  const n = 48;
  const samples: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = pad + (w - pad * 2) * t;
    const y = h / 2 + Math.sin(t * Math.PI * 2) * (h / 2 - pad) * 0.6;
    const pressure = Math.max(0.12, Math.pow(Math.sin(t * Math.PI), 0.7));
    samples.push(x, y, pressure, i * 12, 35, 10);
  }
  if (samples.length < SAMPLE_STRIDE) return null;

  const dabs: number[] = [];
  replayStroke(samples, brush, PREVIEW_SEED, dabs);
  const bounds = dabBounds(dabs);
  const surface = Skia.Surface.Make(w, h);
  if (!surface || !bounds) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  // A blending brush adds no colour of its own: show the shape of its stroke, faded.
  const shown = brush.blend > 0 || (brush.smudge ?? 0) > 0 ? { ...brush, opacity: brush.opacity * 0.45 } : brush;
  drawDabs(canvas, dabs, { tool: 'brush', color, brush: shown }, bounds);
  surface.flush();
  const image = surface.makeImageSnapshot();

  cache.set(key, image);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return image;
}

// ---- deferred rendering --------------------------------------------------------------------
// Rendering a preview replays a whole stroke on the JS thread, so a list of ~100 brushes
// rendered at once freezes the UI. Requests are queued and rendered a few per frame instead.

interface PreviewJob {
  preset: BrushPreset;
  color: string;
  width: number;
  height: number;
  done: (image: SkImage | null) => void;
  cancelled: boolean;
}

const FRAME_BUDGET_MS = 8;
const queue: PreviewJob[] = [];
let scheduled = false;

function runQueue() {
  scheduled = false;
  const start = Date.now();
  while (queue.length && Date.now() - start < FRAME_BUDGET_MS) {
    const job = queue.shift()!;
    if (!job.cancelled) job.done(renderBrushPreview(job.preset, job.color, job.width, job.height));
  }
  if (queue.length) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(runQueue);
}

/** Renders a preview on a later frame; returns a function that cancels the request. */
export function requestBrushPreview(
  preset: BrushPreset,
  color: string,
  width: number,
  height: number,
  done: (image: SkImage | null) => void,
): () => void {
  const job: PreviewJob = { preset, color, width, height, done, cancelled: false };
  queue.push(job);
  schedule();
  return () => {
    job.cancelled = true;
  };
}
