import { ManifestError, parseManifest, PROJECT_FORMAT, PROJECT_FORMAT_VERSION } from '@/engine/document/projectFormat';

// The parser is pure validation; the Skia-backed modules it imports for (de)serialising
// documents are not exercised here, so they are stubbed.
jest.mock('@shopify/react-native-skia', () => ({
  Skia: {},
  BlendMode: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('@/engine/document/DrawingDocument', () => ({
  DEFAULT_DPI: 72,
  MIN_CANVAS_SIDE: 16,
  MAX_CANVAS_SIDE: 8192,
  DrawingDocument: class {},
}));
jest.mock('@/engine/layers/RasterLayer', () => ({ RasterLayer: class {} }));

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    appVersion: '1.0.0',
    id: 'p_test123',
    name: 'Sunset',
    width: 2048,
    height: 1536,
    background: '#ffffff',
    dpi: 300,
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-03T03:04:05.000Z',
    activeLayerId: 'l_a',
    thumbnail: 'thumbnail-1.jpg',
    folderId: null,
    layers: [
      { id: 'l_a', name: 'Sketch', visible: true, opacity: 0.5, blendMode: 'multiply', locked: false, alphaLocked: true, revision: 3, file: 'l_a-r3.png' },
      { id: 'l_b', name: 'Ink', visible: false, opacity: 1, blendMode: 'srcOver', locked: true, alphaLocked: false, revision: 0, file: 'l_b-r0.png' },
    ],
    brushes: [],
    references: [{ file: 'ref-1.jpg', aspect: 1.5 }],
    ...overrides,
  };
}

describe('parseManifest', () => {
  it('round-trips a valid manifest', () => {
    const parsed = parseManifest(JSON.parse(JSON.stringify(manifest())));
    expect(parsed.name).toBe('Sunset');
    expect(parsed.width).toBe(2048);
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.layers[0]).toMatchObject({ opacity: 0.5, blendMode: 'multiply', alphaLocked: true, revision: 3 });
    expect(parsed.layers[1]).toMatchObject({ visible: false, locked: true });
    expect(parsed.references).toEqual([{ file: 'ref-1.jpg', aspect: 1.5 }]);
    expect(parsed.recordTimelapse).toBeNull();
  });

  it('keeps the per-artwork timelapse choice', () => {
    expect(parseManifest(manifest({ recordTimelapse: false })).recordTimelapse).toBe(false);
    expect(parseManifest(manifest({ recordTimelapse: true })).recordTimelapse).toBe(true);
    // Anything else (including files from older versions) follows the app default.
    expect(parseManifest(manifest({ recordTimelapse: 'yes' })).recordTimelapse).toBeNull();
  });

  it('upgrades version 1 projects', () => {
    const v1 = manifest({ version: 1 });
    delete v1.brushes;
    delete v1.references;
    delete v1.appVersion;
    const parsed = parseManifest(v1);
    expect(parsed.version).toBe(PROJECT_FORMAT_VERSION);
    expect(parsed.brushes).toEqual([]);
    expect(parsed.references).toEqual([]);
    expect(parsed.appVersion).toBeNull();
  });

  it('refuses projects written by a newer app instead of guessing', () => {
    expect(() => parseManifest(manifest({ version: PROJECT_FORMAT_VERSION + 1 }))).toThrow(/newer version/);
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['another format', manifest({ format: 'other.app' })],
    ['a missing id', manifest({ id: undefined })],
    ['an id with path traversal', manifest({ id: '../evil' })],
    ['a canvas that is too small', manifest({ width: 4 })],
    ['a canvas that is too large', manifest({ height: 100000 })],
    ['no layers', manifest({ layers: [] })],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseManifest(raw)).toThrow(ManifestError);
  });

  it('rejects layer files that could escape the project directory', () => {
    const layers = [{ id: 'l_a', file: '../../other/l_a-r0.png' }];
    expect(() => parseManifest(manifest({ layers }))).toThrow(ManifestError);
  });

  it('rejects duplicate layer ids', () => {
    const layers = [
      { id: 'l_a', file: 'l_a-r0.png' },
      { id: 'l_a', file: 'l_a-r1.png' },
    ];
    expect(() => parseManifest(manifest({ layers }))).toThrow(ManifestError);
  });

  it('repairs out-of-range layer properties instead of failing the project', () => {
    const layers = [{ id: 'l_a', file: 'l_a-r0.png', opacity: 7, blendMode: 'sparkle', revision: -2 }];
    const parsed = parseManifest(manifest({ layers }));
    expect(parsed.layers[0]).toMatchObject({ opacity: 1, blendMode: 'srcOver', revision: 0, visible: true, name: 'Layer 1' });
  });

  it('drops unsafe reference image names', () => {
    const parsed = parseManifest(manifest({ references: [{ file: '../x.jpg', aspect: 1 }, { file: 'ok.png', aspect: -1 }] }));
    expect(parsed.references).toEqual([{ file: 'ok.png', aspect: 1 }]);
  });
});
