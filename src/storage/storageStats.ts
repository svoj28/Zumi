import { Directory, File, Paths } from 'expo-file-system';

import { cleanRestoreStaging } from '@/storage/backupService';
import { listProjects, listTrash } from '@/storage/projectRepository';

/**
 * On-device storage usage for the Settings screen, and clearing of temporary files.
 *
 * Artwork lives in `<documents>/projects` and `<documents>/trash`; everything in the cache
 * directory (exports, picked images, image caches) is temporary and safe to delete, as are
 * leftovers of interrupted backup restores. Clearing never touches projects, Recently Deleted
 * or settings.
 */

export interface StorageStats {
  artworkBytes: number;
  trashBytes: number;
  tempBytes: number;
  projectCount: number;
  trashCount: number;
}

function sizeOf(entry: File | Directory): number {
  try {
    if (entry instanceof File) return entry.exists ? entry.size : 0;
    if (!entry.exists) return 0;
    let total = 0;
    for (const child of entry.list()) total += sizeOf(child);
    return total;
  } catch (error) {
    console.warn('[storage] Could not measure', entry.uri, error);
    return 0;
  }
}

const stagingDir = () => new Directory(Paths.document, 'restore-staging');
const tempBytes = () => sizeOf(Paths.cache) + sizeOf(stagingDir());

export function getStorageStats(): StorageStats {
  return {
    artworkBytes: sizeOf(new Directory(Paths.document, 'projects')),
    trashBytes: sizeOf(new Directory(Paths.document, 'trash')),
    tempBytes: tempBytes(),
    projectCount: listProjects().length,
    trashCount: listTrash().length,
  };
}

/** Deletes temporary files only. Returns the number of bytes freed. */
export function clearTemporaryFiles(): number {
  const before = tempBytes();
  for (const entry of Paths.cache.list()) {
    try {
      entry.delete();
    } catch (error) {
      // Files in use (e.g. being shared right now) are skipped and cleared next time.
      console.warn('[storage] Could not delete', entry.uri, error);
    }
  }
  cleanRestoreStaging();
  return Math.max(0, before - tempBytes());
}
