import type { ProjectSummary } from '@/storage/projectRepository';

export type GallerySort = 'updated' | 'created' | 'name' | 'size';
export type GalleryView = 'grid' | 'list';

export const SORT_LABELS: Record<GallerySort, string> = {
  updated: 'Recently edited',
  created: 'Date created',
  name: 'Name',
  size: 'Canvas size',
};

const compare: Record<GallerySort, (a: ProjectSummary, b: ProjectSummary) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  size: (a, b) => b.width * b.height - a.width * a.height,
};

/** Filters by collection (null = all artwork) and search text, then sorts. Pure. */
export function queryProjects<T extends ProjectSummary>(
  projects: readonly T[],
  options: { folderId: string | null; search: string; sort: GallerySort },
): T[] {
  const needle = options.search.trim().toLocaleLowerCase();
  return projects
    .filter((p) => options.folderId === null || p.folderId === options.folderId)
    .filter((p) => !needle || p.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => compare[options.sort](a, b) || b.updatedAt - a.updatedAt);
}
