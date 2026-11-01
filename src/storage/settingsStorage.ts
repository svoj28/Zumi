import { Directory, File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand persistence backend that stores each store as a small JSON file in the app's
 * private documents directory. Local-only, synchronous, and survives app restarts.
 *
 * Writes are coalesced: persist calls `setItem` on every state change (e.g. each slider
 * event), so the latest value per store is written once things settle, and at once when the
 * app leaves the foreground. Reads see pending values, so nothing is ever lost or stale.
 */

/** Quiet period before pending settings are written to disk. */
const WRITE_DELAY_MS = 400;

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function settingsDir(): Directory {
  const dir = new Directory(Paths.document, 'settings');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileFor(name: string): File {
  return new File(settingsDir(), `${name.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

function writeNow(name: string, value: string): void {
  try {
    const file = fileFor(name);
    file.create({ overwrite: true });
    file.writeSync(value);
  } catch (error) {
    console.warn('[settings] write failed', name, error);
  }
}

/** Writes every pending store to disk now. */
export function flushSettings(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const entries = [...pending];
  pending.clear();
  for (const [name, value] of entries) writeNow(name, value);
}

AppState.addEventListener('change', (next) => {
  if (next !== 'active') flushSettings();
});

export const fileStateStorage: StateStorage = {
  getItem(name) {
    const queued = pending.get(name);
    if (queued !== undefined) return queued;
    try {
      const file = fileFor(name);
      return file.exists ? file.textSync() : null;
    } catch (error) {
      console.warn('[settings] read failed', name, error);
      return null;
    }
  },
  setItem(name, value) {
    pending.set(name, value);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushSettings, WRITE_DELAY_MS);
  },
  removeItem(name) {
    pending.delete(name);
    const file = fileFor(name);
    if (file.exists) file.delete();
  },
};
