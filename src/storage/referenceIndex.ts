/**
 * The reference library's index (pure data, no file access): images imported from the home
 * screen, optionally sorted into groups, that any artwork can use in its reference window.
 */

export interface ReferenceGroup {
  id: string;
  name: string;
  createdAt: number;
}

export interface LibraryImage {
  id: string;
  /** File name inside the library folder. */
  file: string;
  name: string;
  /** width / height */
  aspect: number;
  /** null: not in a group. */
  groupId: string | null;
  addedAt: number;
}

export interface ReferenceIndex {
  groups: ReferenceGroup[];
  images: LibraryImage[];
}

/** What the library shows: everything, the images in no group, or one group. */
export type ReferenceFilter = { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'group'; id: string };

export const EMPTY_INDEX: ReferenceIndex = { groups: [], images: [] };

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

/** Reads a stored index, dropping anything malformed (a bad entry never loses the others). */
export function parseReferenceIndex(raw: unknown): ReferenceIndex {
  const data = (raw ?? {}) as { groups?: unknown; images?: unknown };
  const groups = (Array.isArray(data.groups) ? data.groups : []).flatMap((g: unknown): ReferenceGroup[] => {
    const r = (g ?? {}) as Partial<{ id: unknown; name: unknown; createdAt: unknown }>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') return [];
    return [{ id: r.id, name: r.name, createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0 }];
  });
  const groupIds = new Set(groups.map((g) => g.id));
  const images = (Array.isArray(data.images) ? data.images : []).flatMap((i: unknown): LibraryImage[] => {
    const r = (i ?? {}) as Partial<Record<keyof LibraryImage, unknown>>;
    if (typeof r.id !== 'string' || typeof r.file !== 'string' || !SAFE_NAME.test(r.file)) return [];
    const aspect = typeof r.aspect === 'number' && r.aspect > 0 && Number.isFinite(r.aspect) ? r.aspect : 1;
    const groupId = typeof r.groupId === 'string' && groupIds.has(r.groupId) ? r.groupId : null;
    return [
      {
        id: r.id,
        file: r.file,
        name: typeof r.name === 'string' && r.name ? r.name : 'Reference',
        aspect,
        groupId,
        addedAt: typeof r.addedAt === 'number' ? r.addedAt : 0,
      },
    ];
  });
  return { groups, images };
}

/** Groups A→Z. */
export function sortedGroups(index: ReferenceIndex): ReferenceGroup[] {
  return [...index.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Images matching the filter, newest first. */
export function filterImages(index: ReferenceIndex, filter: ReferenceFilter): LibraryImage[] {
  const images = [...index.images].sort((a, b) => b.addedAt - a.addedAt);
  switch (filter.kind) {
    case 'all':
      return images;
    case 'ungrouped':
      return images.filter((i) => i.groupId === null);
    case 'group':
      return images.filter((i) => i.groupId === filter.id);
  }
}

export function countInGroup(index: ReferenceIndex, groupId: string | null): number {
  return index.images.reduce((n, i) => (i.groupId === groupId ? n + 1 : n), 0);
}

export function moveImages(index: ReferenceIndex, ids: readonly string[], groupId: string | null): ReferenceIndex {
  const set = new Set(ids);
  const target = groupId !== null && index.groups.some((g) => g.id === groupId) ? groupId : null;
  return { ...index, images: index.images.map((i) => (set.has(i.id) ? { ...i, groupId: target } : i)) };
}

/** Removes images; returns the new index and the files no longer used. */
export function removeImages(index: ReferenceIndex, ids: readonly string[]): { index: ReferenceIndex; files: string[] } {
  const set = new Set(ids);
  const files = index.images.filter((i) => set.has(i.id)).map((i) => i.file);
  return { index: { ...index, images: index.images.filter((i) => !set.has(i.id)) }, files };
}

/**
 * Deletes a group. Its images either go with it, or stay in the library without a group.
 * Returns the files to delete.
 */
export function removeGroup(index: ReferenceIndex, groupId: string, withImages: boolean): { index: ReferenceIndex; files: string[] } {
  const groups = index.groups.filter((g) => g.id !== groupId);
  if (withImages) {
    const ids = index.images.filter((i) => i.groupId === groupId).map((i) => i.id);
    return removeImages({ ...index, groups }, ids);
  }
  return { index: { groups, images: index.images.map((i) => (i.groupId === groupId ? { ...i, groupId: null } : i)) }, files: [] };
}
