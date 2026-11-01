import { Directory, File, Paths } from 'expo-file-system';

import { createId } from '@/engine/ids';
import {
  EMPTY_INDEX,
  moveImages,
  parseReferenceIndex,
  removeGroup,
  removeImages,
  type LibraryImage,
  type ReferenceGroup,
  type ReferenceIndex,
} from '@/storage/referenceIndex';

/**
 * The reference library on disk: `<documents>/reference-library/` holds the imported images
 * and `index.json` (groups and image list). It is separate from every artwork; using a library
 * image in an artwork copies it into that artwork's own reference images.
 */

const DIR_NAME = 'reference-library';
const INDEX = 'index.json';

function libraryDir(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

export function readReferenceIndex(): ReferenceIndex {
  const file = new File(libraryDir(), INDEX);
  if (!file.exists) return EMPTY_INDEX;
  try {
    return parseReferenceIndex(JSON.parse(file.textSync()));
  } catch (error) {
    console.warn('[references] Unreadable index.json', error);
    return EMPTY_INDEX;
  }
}

function writeIndex(index: ReferenceIndex): void {
  const dir = libraryDir();
  dir.create({ idempotent: true, intermediates: true });
  const tmp = new File(dir, `${INDEX}.tmp`);
  tmp.create({ overwrite: true });
  tmp.writeSync(JSON.stringify({ version: 1, ...index }));
  tmp.moveSync(new File(dir, INDEX), { overwrite: true });
}

function deleteFiles(files: readonly string[]): void {
  const dir = libraryDir();
  for (const name of files) {
    try {
      const file = new File(dir, name);
      if (file.exists) file.delete();
    } catch (error) {
      console.warn('[references] Could not delete', name, error);
    }
  }
}

/** Local URI of a library image (for display, or to copy into an artwork). */
export function libraryImageUri(image: LibraryImage): string {
  return new File(libraryDir(), image.file).uri;
}

/** Copies picked images into the library (into `groupId`, or no group). */
export function importLibraryImages(
  sources: readonly { uri: string; aspect: number; name: string }[],
  groupId: string | null,
): ReferenceIndex {
  const index = readReferenceIndex();
  const dir = libraryDir();
  dir.create({ idempotent: true, intermediates: true });
  const now = Date.now();
  const added: LibraryImage[] = [];
  for (const [i, s] of sources.entries()) {
    const source = new File(s.uri);
    const ext = /^\.[a-z0-9]{1,5}$/i.test(source.extension) ? source.extension.toLowerCase() : '.jpg';
    const id = createId('r_');
    const file = `${id}${ext}`.replace(/[^A-Za-z0-9._-]/g, '_');
    const target = new File(dir, file);
    target.create({ overwrite: true });
    target.writeSync(source.bytesSync());
    added.push({
      id,
      file,
      name: s.name,
      aspect: s.aspect > 0 && Number.isFinite(s.aspect) ? s.aspect : 1,
      groupId: groupId !== null && index.groups.some((g) => g.id === groupId) ? groupId : null,
      // Newest first keeps the picked order.
      addedAt: now + (sources.length - i),
    });
  }
  const next = { ...index, images: [...index.images, ...added] };
  writeIndex(next);
  return next;
}

export function deleteLibraryImages(ids: readonly string[]): ReferenceIndex {
  const { index, files } = removeImages(readReferenceIndex(), ids);
  writeIndex(index);
  deleteFiles(files);
  return index;
}

export function moveLibraryImages(ids: readonly string[], groupId: string | null): ReferenceIndex {
  const index = moveImages(readReferenceIndex(), ids, groupId);
  writeIndex(index);
  return index;
}

export function createReferenceGroup(name: string): { index: ReferenceIndex; group: ReferenceGroup } {
  const group: ReferenceGroup = { id: createId('g_'), name, createdAt: Date.now() };
  const current = readReferenceIndex();
  const index = { ...current, groups: [...current.groups, group] };
  writeIndex(index);
  return { index, group };
}

export function renameReferenceGroup(id: string, name: string): ReferenceIndex {
  const current = readReferenceIndex();
  const index = { ...current, groups: current.groups.map((g) => (g.id === id ? { ...g, name } : g)) };
  writeIndex(index);
  return index;
}

export function deleteReferenceGroup(id: string, withImages: boolean): ReferenceIndex {
  const { index, files } = removeGroup(readReferenceIndex(), id, withImages);
  writeIndex(index);
  deleteFiles(files);
  return index;
}
