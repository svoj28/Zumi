import { ImageFormat } from '@shopify/react-native-skia';
import { Directory, File } from 'expo-file-system';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import {
  chunkName,
  FRAMES_PER_CHUNK,
  parseState,
  snapToGrid,
  TIMELAPSE_FORMAT,
  TIMELAPSE_VERSION,
  type TimelapseFrame,
  type TimelapseLayerState,
  type TimelapsePatch,
  type TimelapseState,
} from '@/engine/timelapse/timelapseFormat';
import { projectDir, safeDeleteDir, writeFileAtomic } from '@/storage/projectRepository';

/**
 * Timelapse recording on disk (format: engine/timelapse/timelapseFormat). The recording lives
 * inside the project directory, so it is duplicated, trashed and deleted with the artwork.
 */

const DIR = 'timelapse';
const PATCHES = 'patches';
const STATE = 'state.json';

function timelapseDir(projectId: string): Directory {
  return new Directory(projectDir(projectId), DIR);
}

function readJson(file: File): unknown {
  if (!file.exists) return null;
  try {
    return JSON.parse(file.textSync());
  } catch (error) {
    console.warn('[timelapse] Unreadable', file.name, error);
    return null;
  }
}

function readState(dir: Directory): TimelapseState | null {
  return dir.exists ? parseState(readJson(new File(dir, STATE))) : null;
}

function freshState(width: number, height: number): TimelapseState {
  return {
    format: TIMELAPSE_FORMAT,
    version: TIMELAPSE_VERSION,
    width,
    height,
    frameCount: 0,
    nextPatch: 0,
    bytes: 0,
    revisions: {},
    stack: [],
    background: '',
  };
}

function readChunk(dir: Directory, index: number): TimelapseFrame[] {
  const raw = readJson(new File(dir, chunkName(index)));
  return Array.isArray(raw) ? (raw as TimelapseFrame[]) : [];
}

function stackOf(doc: DrawingDocument): TimelapseLayerState[] {
  return doc.layers.list.map(({ meta }) => ({
    id: meta.id,
    name: meta.name,
    visible: meta.visible,
    opacity: meta.opacity,
    blendMode: meta.blendMode,
  }));
}

const sameStack = (a: TimelapseLayerState[], b: TimelapseLayerState[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Records an open document. Call `capture()` after edits (debounced — never per stroke point):
 * it compares each layer's revision with the last recorded one and stores only the changed
 * rectangle of changed layers. Recording failures never interrupt painting; the next capture
 * simply records the affected layers in full.
 */
export class TimelapseRecorder {
  private constructor(
    private readonly doc: DrawingDocument,
    private readonly dir: Directory,
    private state: TimelapseState,
    /** Frames of the chunk the next frame goes into. */
    private chunk: TimelapseFrame[],
  ) {}

  /** Opens (or starts) the recording and records whatever changed since it was last updated. */
  static open(projectId: string, doc: DrawingDocument): TimelapseRecorder {
    const dir = timelapseDir(projectId);
    let state = readState(dir);
    if (state && (state.width !== doc.info.width || state.height !== doc.info.height)) state = null;
    if (!state) {
      if (dir.exists) safeDeleteDir(dir);
      state = freshState(doc.info.width, doc.info.height);
    }
    const chunk = readChunk(dir, Math.floor(state.frameCount / FRAMES_PER_CHUNK)).slice(0, state.frameCount % FRAMES_PER_CHUNK);
    const recorder = new TimelapseRecorder(doc, dir, state, chunk);
    recorder.capture();
    return recorder;
  }

  get frameCount(): number {
    return this.state.frameCount;
  }

  get bytes(): number {
    return this.state.bytes;
  }

  /** Records changes since the last frame. Returns true if a frame was written. */
  capture(): boolean {
    const { doc } = this;
    const { width, height } = doc.info;
    // The canvas was resized, cropped or rotated: the recording restarts at the new size.
    if (width !== this.state.width || height !== this.state.height) {
      this.reset();
      return true;
    }
    const prev = this.state;
    const stack = stackOf(doc);
    const stackChanged = !sameStack(stack, prev.stack);
    const backgroundChanged = doc.info.background !== prev.background;

    const revisions = { ...prev.revisions };
    const patches: TimelapsePatch[] = [];
    let nextPatch = prev.nextPatch;
    let bytes = 0;
    let patchesDir: Directory | null = null;

    for (const layer of doc.layers.list) {
      const id = layer.meta.id;
      // Always consumed, so the next frame only contains later changes.
      const dirty = layer.takeDirty();
      if (revisions[id] === layer.revision) continue;
      const known = id in revisions;
      revisions[id] = layer.revision;
      // A layer seen for the first time (or whose changes were not tracked) is stored whole.
      const rect = snapToGrid(known && dirty ? dirty : { x: 0, y: 0, width, height }, width, height);
      if (!rect) continue;

      const image = layer.readRegion(rect);
      let png: Uint8Array;
      try {
        png = image.encodeToBytes(ImageFormat.PNG, 100);
      } finally {
        image.dispose();
      }
      if (!patchesDir) {
        patchesDir = new Directory(this.dir, PATCHES);
        patchesDir.create({ intermediates: true, idempotent: true });
      }
      const file = `${nextPatch}.png`;
      writeFileAtomic(patchesDir, file, png);
      nextPatch += 1;
      bytes += png.length;
      patches.push({ layerId: id, file, ...rect });
    }

    if (!stackChanged && !backgroundChanged && patches.length === 0) {
      this.state = { ...prev, revisions };
      return false;
    }

    const frame: TimelapseFrame = {
      t: Date.now(),
      ...(stackChanged ? { stack } : {}),
      ...(backgroundChanged ? { background: doc.info.background } : {}),
      patches,
    };
    const chunk = [...this.chunk, frame];
    this.dir.create({ intermediates: true, idempotent: true });
    writeFileAtomic(this.dir, chunkName(Math.floor(prev.frameCount / FRAMES_PER_CHUNK)), JSON.stringify(chunk));
    const next: TimelapseState = {
      ...prev,
      frameCount: prev.frameCount + 1,
      nextPatch,
      bytes: prev.bytes + bytes,
      revisions,
      stack,
      background: doc.info.background,
    };
    writeFileAtomic(this.dir, STATE, JSON.stringify(next));
    // Only now, with everything on disk, does the recorder move on.
    this.state = next;
    this.chunk = next.frameCount % FRAMES_PER_CHUNK === 0 ? [] : chunk;
    return true;
  }

  /** Deletes the recording and starts a new one from the artwork as it is now. */
  reset(): void {
    if (this.dir.exists) this.dir.delete();
    this.state = freshState(this.doc.info.width, this.doc.info.height);
    this.chunk = [];
    this.capture();
  }
}

/** Deletes a project's recording when no recorder is open (recording switched off). */
export function deleteTimelapse(projectId: string): void {
  const dir = timelapseDir(projectId);
  if (dir.exists) dir.delete();
}

// ---- reading (for export) ----------------------------------------------------------------------

export interface TimelapseRecording {
  state: TimelapseState;
  frames: TimelapseFrame[];
  patchesDir: Directory;
}

/**
 * Loads all recorded frames. A damaged chunk ends the recording there (earlier frames still
 * play); null when there is no recording.
 */
export function loadTimelapse(projectId: string): TimelapseRecording | null {
  const dir = timelapseDir(projectId);
  const state = readState(dir);
  if (!state || state.frameCount === 0) return null;
  const frames: TimelapseFrame[] = [];
  const chunks = Math.ceil(state.frameCount / FRAMES_PER_CHUNK);
  for (let i = 0; i < chunks && frames.length < state.frameCount; i++) {
    const chunk = readChunk(dir, i);
    if (chunk.length === 0) break;
    frames.push(...chunk);
    if (chunk.length < FRAMES_PER_CHUNK) break;
  }
  return frames.length > 0 ? { state, frames: frames.slice(0, state.frameCount), patchesDir: new Directory(dir, PATCHES) } : null;
}

export interface TimelapseLayerInfo {
  id: string;
  name: string;
  /** False for layers that were deleted later (they still appear in the timelapse). */
  current: boolean;
}

/**
 * Every layer that appears in the recording: current layers top → bottom, then deleted ones
 * (with their last name).
 */
export function timelapseLayers(recording: TimelapseRecording, currentIds: readonly string[]): TimelapseLayerInfo[] {
  const names = new Map<string, string>();
  for (const frame of recording.frames) for (const l of frame.stack ?? []) names.set(l.id, l.name);
  const current = [...currentIds].reverse().filter((id) => names.has(id));
  const removed = [...names.keys()].filter((id) => !currentIds.includes(id));
  return [
    ...current.map((id) => ({ id, name: names.get(id) ?? id, current: true })),
    ...removed.map((id) => ({ id, name: names.get(id) ?? id, current: false })),
  ];
}
