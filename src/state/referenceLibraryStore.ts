import { Alert } from 'react-native';
import { create } from 'zustand';

import { pickImageFiles } from '@/storage/importService';
import { EMPTY_INDEX, type ReferenceGroup, type ReferenceIndex } from '@/storage/referenceIndex';
import {
  createReferenceGroup,
  deleteLibraryImages,
  deleteReferenceGroup,
  importLibraryImages,
  moveLibraryImages,
  readReferenceIndex,
  renameReferenceGroup,
} from '@/storage/referenceLibrary';
import { describeError, errorText } from '@/utils/errors';

/** Images picked from the device in one go. */
const IMPORT_BATCH = 50;

interface ReferenceLibraryState {
  index: ReferenceIndex;
  loaded: boolean;
  busy: string | null;
  refresh: () => void;
  /** Picks images from the device into the library; returns how many were added. */
  importImages: (groupId: string | null) => Promise<number>;
  deleteImages: (ids: readonly string[]) => void;
  moveImages: (ids: readonly string[], groupId: string | null) => void;
  createGroup: (name: string) => ReferenceGroup | null;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string, withImages: boolean) => void;
}

/** Runs a library change; a failure is reported and leaves the shown library as it was. */
function attempt(title: string, run: () => ReferenceIndex, set: (s: Partial<ReferenceLibraryState>) => void): boolean {
  try {
    set({ index: run() });
    return true;
  } catch (error) {
    console.warn(`[references] ${title}`, error);
    Alert.alert(title, errorText(describeError(error)));
    return false;
  }
}

/** The reference library (home screen → References), shared by the gallery and the editor. */
export const useReferenceLibraryStore = create<ReferenceLibraryState>((set) => ({
  index: EMPTY_INDEX,
  loaded: false,
  busy: null,
  refresh: () => {
    set({ index: readReferenceIndex(), loaded: true });
  },
  importImages: async (groupId) => {
    const picked = await pickImageFiles(IMPORT_BATCH);
    if (picked.length === 0) return 0;
    set({ busy: picked.length > 1 ? `Importing ${picked.length} images…` : 'Importing image…' });
    // Let the busy overlay render before the (synchronous) copy.
    await new Promise((r) => setTimeout(r, 30));
    const sources = picked.map((p) => ({ uri: p.uri, aspect: p.width / Math.max(1, p.height), name: p.name }));
    const ok = attempt('Couldn’t import the images', () => importLibraryImages(sources, groupId), set);
    set({ busy: null });
    return ok ? sources.length : 0;
  },
  deleteImages: (ids) => {
    attempt('Couldn’t delete the images', () => deleteLibraryImages(ids), set);
  },
  moveImages: (ids, groupId) => {
    attempt('Couldn’t move the images', () => moveLibraryImages(ids, groupId), set);
  },
  createGroup: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    let group: ReferenceGroup | null = null;
    attempt(
      'Couldn’t create the group',
      () => {
        const result = createReferenceGroup(trimmed);
        group = result.group;
        return result.index;
      },
      set,
    );
    return group;
  },
  renameGroup: (id, name) => {
    const trimmed = name.trim();
    if (trimmed) attempt('Couldn’t rename the group', () => renameReferenceGroup(id, trimmed), set);
  },
  deleteGroup: (id, withImages) => {
    attempt('Couldn’t delete the group', () => deleteReferenceGroup(id, withImages), set);
  },
}));
