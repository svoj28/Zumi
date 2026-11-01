import { File, Paths } from 'expo-file-system';

import { createId } from '@/engine/ids';
import { clearFolder } from '@/storage/projectRepository';

/**
 * Gallery collections ("folders"). The folder list lives in `<documents>/library.json`;
 * membership is stored in each project's manifest (`folderId`) so a project directory stays
 * self-describing.
 */

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

interface LibraryFile {
  version: 1;
  folders: { id: string; name: string; createdAt: string }[];
}

function libraryFile(): File {
  return new File(Paths.document, 'library.json');
}

function read(): Folder[] {
  const file = libraryFile();
  if (!file.exists) return [];
  try {
    const data = JSON.parse(file.textSync()) as Partial<LibraryFile>;
    if (!Array.isArray(data.folders)) return [];
    return data.folders
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name, createdAt: Date.parse(f.createdAt) || 0 }));
  } catch (error) {
    console.warn('[library] Unreadable library.json', error);
    return [];
  }
}

function write(folders: Folder[]): void {
  const data: LibraryFile = {
    version: 1,
    folders: folders.map((f) => ({ id: f.id, name: f.name, createdAt: new Date(f.createdAt).toISOString() })),
  };
  const tmp = new File(Paths.document, 'library.json.tmp');
  tmp.create({ overwrite: true });
  tmp.writeSync(JSON.stringify(data));
  tmp.moveSync(libraryFile(), { overwrite: true });
}

export function listFolders(): Folder[] {
  return read().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function createFolder(name: string): Folder {
  const folder: Folder = { id: createId('f_'), name, createdAt: Date.now() };
  write([...read(), folder]);
  return folder;
}

export function renameFolder(id: string, name: string): void {
  write(read().map((f) => (f.id === id ? { ...f, name } : f)));
}

/** Deletes the collection only — its artworks are kept and become unfiled. */
export function deleteFolder(id: string): void {
  clearFolder(id);
  write(read().filter((f) => f.id !== id));
}
