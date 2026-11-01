import { queryProjects } from '@/features/gallery/galleryQuery';
import { configureMemoryBudget, estimateCanvasMemory, historyLimits, maxLayersFor } from '@/engine/memory';
import type { ProjectSummary } from '@/storage/projectRepository';

const GB = 1024 * 1024 * 1024;

function project(id: string, name: string, extra: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id,
    name,
    width: 1000,
    height: 1000,
    layerCount: 1,
    createdAt: 0,
    updatedAt: 0,
    folderId: null,
    thumbnailUri: null,
    ...extra,
  };
}

describe('queryProjects', () => {
  const projects = [
    project('a', 'Sketch 10', { updatedAt: 3, createdAt: 1, folderId: 'f1' }),
    project('b', 'sketch 2', { updatedAt: 1, createdAt: 3, width: 4000, height: 4000 }),
    project('c', 'Landscape', { updatedAt: 2, createdAt: 2, folderId: 'f1' }),
  ];

  it('sorts by most recently edited by default', () => {
    expect(queryProjects(projects, { folderId: null, search: '', sort: 'updated' }).map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts names naturally and case-insensitively', () => {
    expect(queryProjects(projects, { folderId: null, search: '', sort: 'name' }).map((p) => p.name)).toEqual([
      'Landscape',
      'sketch 2',
      'Sketch 10',
    ]);
  });

  it('filters by collection and search text', () => {
    expect(queryProjects(projects, { folderId: 'f1', search: 'SKETCH', sort: 'updated' }).map((p) => p.id)).toEqual(['a']);
  });

  it('does not modify the input', () => {
    const before = projects.map((p) => p.id);
    queryProjects(projects, { folderId: null, search: '', sort: 'size' });
    expect(projects.map((p) => p.id)).toEqual(before);
  });
});

describe('canvas memory budget', () => {
  it('allows more layers on devices with more RAM', () => {
    configureMemoryBudget(3 * GB);
    const small = maxLayersFor(4096, 4096);
    configureMemoryBudget(8 * GB);
    const large = maxLayersFor(4096, 4096);
    expect(large).toBeGreaterThan(small);
  });

  it('blocks canvases that cannot even be opened, and warns before that', () => {
    configureMemoryBudget(2 * GB);
    expect(estimateCanvasMemory(8192, 8192).level).toBe('blocked');
    expect(estimateCanvasMemory(2048, 2048).level).toBe('ok');
    expect(estimateCanvasMemory(8192, 8192).message).toMatch(/smaller size/);
  });

  it('caps undo history memory below the layer budget', () => {
    configureMemoryBudget(4 * GB);
    const { maxBytes, maxEntries } = historyLimits();
    expect(maxEntries).toBeGreaterThan(0);
    expect(maxBytes).toBeLessThan(4 * GB * 0.2);
  });
});
