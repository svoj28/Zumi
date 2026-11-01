import {
  countInGroup,
  filterImages,
  moveImages,
  parseReferenceIndex,
  removeGroup,
  removeImages,
  sortedGroups,
  type ReferenceIndex,
} from '@/storage/referenceIndex';

const index: ReferenceIndex = {
  groups: [
    { id: 'g2', name: 'poses', createdAt: 2 },
    { id: 'g1', name: 'Hands', createdAt: 1 },
  ],
  images: [
    { id: 'a', file: 'a.jpg', name: 'A', aspect: 1, groupId: 'g1', addedAt: 1 },
    { id: 'b', file: 'b.png', name: 'B', aspect: 2, groupId: null, addedAt: 3 },
    { id: 'c', file: 'c.jpg', name: 'C', aspect: 0.5, groupId: 'g2', addedAt: 2 },
  ],
};

describe('reference library index', () => {
  it('parses stored data and drops malformed entries', () => {
    const parsed = parseReferenceIndex({
      version: 1,
      groups: [{ id: 'g1', name: 'Hands', createdAt: 5 }, { id: 3 }, null],
      images: [
        { id: 'a', file: 'a.jpg', name: 'A', aspect: 1.5, groupId: 'g1', addedAt: 9 },
        { id: 'b', file: '../escape.jpg', aspect: 1 },
        { id: 'c', file: 'c.jpg', aspect: -2, groupId: 'missing' },
        'junk',
      ],
    });
    expect(parsed.groups).toEqual([{ id: 'g1', name: 'Hands', createdAt: 5 }]);
    expect(parsed.images.map((i) => i.id)).toEqual(['a', 'c']);
    // A bad aspect becomes 1; a group that no longer exists becomes "no group".
    expect(parsed.images[1]).toMatchObject({ aspect: 1, groupId: null, name: 'Reference' });
    expect(parseReferenceIndex(null)).toEqual({ groups: [], images: [] });
  });

  it('filters by group, newest first', () => {
    expect(filterImages(index, { kind: 'all' }).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(filterImages(index, { kind: 'ungrouped' }).map((i) => i.id)).toEqual(['b']);
    expect(filterImages(index, { kind: 'group', id: 'g1' }).map((i) => i.id)).toEqual(['a']);
    expect(sortedGroups(index).map((g) => g.name)).toEqual(['Hands', 'poses']);
    expect(countInGroup(index, null)).toBe(1);
  });

  it('moves images, ignoring unknown groups', () => {
    const moved = moveImages(index, ['a', 'b'], 'g2');
    expect(countInGroup(moved, 'g2')).toBe(3);
    expect(countInGroup(moveImages(index, ['a'], 'nope'), null)).toBe(2);
  });

  it('removes images and reports their files', () => {
    const { index: next, files } = removeImages(index, ['a', 'c']);
    expect(next.images.map((i) => i.id)).toEqual(['b']);
    expect(files).toEqual(['a.jpg', 'c.jpg']);
  });

  it('deletes a group, keeping or removing its images', () => {
    const kept = removeGroup(index, 'g1', false);
    expect(kept.index.groups.map((g) => g.id)).toEqual(['g2']);
    expect(kept.index.images.find((i) => i.id === 'a')?.groupId).toBeNull();
    expect(kept.files).toEqual([]);

    const gone = removeGroup(index, 'g1', true);
    expect(gone.index.images.map((i) => i.id)).toEqual(['b', 'c']);
    expect(gone.files).toEqual(['a.jpg']);
  });
});
