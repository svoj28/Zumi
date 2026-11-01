import { parseManifest, PROJECT_FORMAT } from '@/engine/document/projectFormat';

jest.mock('@shopify/react-native-skia', () => ({ Skia: {}, BlendMode: new Proxy({}, { get: (_t, k) => String(k) }) }));
jest.mock('@/engine/document/DrawingDocument', () => ({
  DEFAULT_DPI: 72,
  MIN_CANVAS_SIDE: 16,
  MAX_CANVAS_SIDE: 8192,
  DrawingDocument: class {},
  sanitizeAnimation: (a: Record<string, unknown>) => ({ ...a, sanitized: true }),
}));
jest.mock('@/engine/layers/RasterLayer', () => ({ RasterLayer: class {} }));

const base = {
  format: PROJECT_FORMAT,
  id: 'p_1',
  name: 'Comic',
  width: 800,
  height: 600,
  background: '#ffffff',
  dpi: 72,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  activeLayerId: null,
  thumbnail: null,
  folderId: null,
  brushes: [],
  references: [],
};

describe('project format v3', () => {
  it('keeps clipping, masks, reference layers, groups and animation', () => {
    const parsed = parseManifest({
      ...base,
      version: 3,
      layers: [
        { id: 'a', file: 'a-r0.png', reference: true, groupId: 'g' },
        { id: 'b', file: 'b-r0.png', clip: true, groupId: 'g' },
        { id: 'c', file: 'c-r0.png', mask: true },
      ],
      groups: [{ id: 'g', name: 'Folder', visible: false, opacity: 0.5, blendMode: 'multiply', collapsed: true }],
      animation: { enabled: true, fps: 12 },
    });
    expect(parsed.layers[0]).toMatchObject({ reference: true, groupId: 'g' });
    expect(parsed.layers[1]).toMatchObject({ clip: true });
    expect(parsed.layers[2]).toMatchObject({ mask: true });
    expect(parsed.groups).toEqual([{ id: 'g', name: 'Folder', visible: false, opacity: 0.5, blendMode: 'multiply', collapsed: true }]);
    expect(parsed.animation).toMatchObject({ enabled: true, fps: 12, sanitized: true });
  });

  it('upgrades version 2 files', () => {
    const parsed = parseManifest({ ...base, version: 2, layers: [{ id: 'a', file: 'a-r0.png' }] });
    expect(parsed.groups).toEqual([]);
    expect(parsed.animation).toBeNull();
    expect(parsed.layers[0].clip).toBeUndefined();
  });
});