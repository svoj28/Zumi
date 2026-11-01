import { create } from 'zustand';

import { useBrushStore } from '@/state/brushStore';
import { useSettingsStore } from '@/state/settingsStore';
import {
  commitRestore,
  discardRestore,
  pickBackupFile,
  prepareRestore,
  saveBackupToFolder,
  shareBackup,
  type PreparedRestore,
} from '@/storage/backupService';
import { exportProjectToPhotos, shareProject, type ExportOptions, type PhotosResult } from '@/storage/exportService';
import { pickImageForImport } from '@/storage/importService';
import {
  createFolder,
  deleteFolder,
  listFolders,
  renameFolder,
  type Folder,
} from '@/storage/libraryRepository';
import {
  createProject,
  createProjectFromImage,
  deleteDamagedProject,
  deleteProjectPermanently,
  duplicateProject,
  emptyTrash,
  listDamagedProjects,
  listProjects,
  listTrash,
  moveProject,
  moveToTrash,
  recoverDamagedProject,
  renameProject,
  restoreProject,
  type ComicTemplate,
  type DamagedProject,
  type ProjectSummary,
  type TrashedProject,
} from '@/storage/projectRepository';
import { describeError, type UserFacingError } from '@/utils/errors';

/**
 * Gallery state. Not persisted — the filesystem is the source of truth and this store is a
 * cache of the local listings plus the actions that modify them. Every action reports
 * failures through `error` (shown by the screen) instead of throwing into the UI.
 */
interface GalleryState {
  projects: ProjectSummary[];
  trash: TrashedProject[];
  /** Artwork whose project file is unreadable; shown so it can be recovered, never hidden. */
  damaged: DamagedProject[];
  folders: Folder[];
  loaded: boolean;
  error: UserFacingError | null;
  /** Label for a blocking progress overlay during slow work (import, export…). */
  busy: string | null;

  refresh: () => void;
  clearError: () => void;

  createArtwork: (params: {
    name: string;
    width: number;
    height: number;
    background: string;
    dpi?: number;
    folderId: string | null;
    recordTimelapse?: boolean | null;
    comic?: ComicTemplate | null;
  }) => string | null;
  importImage: (folderId: string | null) => Promise<string | null>;
  rename: (id: string, name: string) => void;
  duplicate: (id: string) => void;
  move: (id: string, folderId: string | null) => void;
  trashProject: (id: string) => void;
  restore: (id: string) => void;
  deleteForever: (id: string) => void;
  emptyTrash: () => void;
  /** Rebuilds a damaged artwork from its readable layers; returns the new artwork's id. */
  recoverDamaged: (id: string) => Promise<string | null>;
  deleteDamaged: (id: string) => void;
  share: (id: string, options: ExportOptions) => Promise<void>;
  /** Resolves to null when an error was reported through `error`. */
  exportToPhotos: (id: string, options: ExportOptions) => Promise<PhotosResult | null>;
  /** Shares an editable `.zumi` backup of the artwork. */
  backup: (id: string) => Promise<void>;
  /** Saves an editable `.zumi` file into the folder chosen in Settings (or Zumi Backups). */
  saveBackup: (id: string) => Promise<{ fileName: string; folderName: string } | null>;
  /**
   * Picks and validates a backup. Nothing is added yet: the caller confirms (e.g. when the
   * artwork already exists) and then calls `finishRestore` or `cancelRestore`.
   */
  pickRestore: () => Promise<PreparedRestore | null>;
  /** Adds a validated backup to the gallery (as a copy if its artwork already exists). */
  finishRestore: (prepared: PreparedRestore) => string | null;
  cancelRestore: (prepared: PreparedRestore) => void;

  createFolder: (name: string) => Folder | null;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
}

const message = (error: unknown): UserFacingError => describeError(error);

/** Lets the busy overlay paint before synchronous native work blocks the JS thread. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 32));

export const useGalleryStore = create<GalleryState>()((set, get) => {
  /** Runs a synchronous mutation, then refreshes listings; errors go to `error`. */
  const mutate = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch (error) {
      set({ error: message(error) });
      return null;
    } finally {
      get().refresh();
    }
  };

  const withBusy = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    set({ busy: label });
    try {
      await nextFrame();
      return await fn();
    } catch (error) {
      set({ error: message(error) });
      return null;
    } finally {
      set({ busy: null });
      get().refresh();
    }
  };

  return {
    projects: [],
    trash: [],
    damaged: [],
    folders: [],
    loaded: false,
    error: null,
    busy: null,

    refresh: () => {
      try {
        set({
          projects: listProjects(),
          trash: listTrash(),
          damaged: listDamagedProjects(),
          folders: listFolders(),
          loaded: true,
        });
      } catch (error) {
        set({ loaded: true, error: message(error) });
      }
    },
    clearError: () => set({ error: null }),

    createArtwork: (params) => mutate(() => createProject(params)),
    importImage: async (folderId) => {
      let picked: Awaited<ReturnType<typeof pickImageForImport>>;
      try {
        picked = await pickImageForImport();
      } catch (error) {
        set({ error: message(error) });
        return null;
      }
      if (!picked) return null;
      const image = picked;
      return withBusy('Importing image…', async () => createProjectFromImage({ ...image, folderId }));
    },
    rename: (id, name) => void mutate(() => renameProject(id, name)),
    duplicate: (id) => void mutate(() => duplicateProject(id)),
    move: (id, folderId) => void mutate(() => moveProject(id, folderId)),
    trashProject: (id) => void mutate(() => moveToTrash(id)),
    restore: (id) =>
      void mutate(() => restoreProject(id, new Set(get().folders.map((f) => f.id)))),
    deleteForever: (id) => void mutate(() => deleteProjectPermanently(id)),
    emptyTrash: () => void mutate(() => emptyTrash()),
    recoverDamaged: (id) => withBusy('Recovering artwork…', async () => recoverDamagedProject(id)),
    deleteDamaged: (id) => void mutate(() => deleteDamagedProject(id)),
    share: async (id, options) => {
      await withBusy('Preparing image…', () => shareProject(id, options));
    },
    exportToPhotos: (id, options) => withBusy('Saving to Photos…', () => exportProjectToPhotos(id, options)),
    backup: async (id) => {
      await withBusy('Preparing backup…', () => shareBackup(id));
    },
    saveBackup: (id) =>
      withBusy('Saving .zumi file…', async () => saveBackupToFolder(id, useSettingsStore.getState().backupFolder)),
    pickRestore: async () => {
      let file: Awaited<ReturnType<typeof pickBackupFile>>;
      try {
        file = await pickBackupFile();
      } catch (error) {
        set({ error: message(error) });
        return null;
      }
      if (!file) return null;
      const picked = file;
      return withBusy('Checking backup…', async () => prepareRestore(picked));
    },
    finishRestore: (prepared) =>
      mutate(() => {
        const id = commitRestore(prepared, new Set(get().folders.map((f) => f.id)));
        // Custom brushes the artwork was painted with come along with it.
        useBrushStore.getState().importPresets(prepared.manifest.brushes);
        return id;
      }),
    cancelRestore: (prepared) => discardRestore(prepared),

    createFolder: (name) => mutate(() => createFolder(name)),
    renameFolder: (id, name) => void mutate(() => renameFolder(id, name)),
    deleteFolder: (id) => void mutate(() => deleteFolder(id)),
  };
});
