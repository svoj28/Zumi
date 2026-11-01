jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
jest.mock('@/storage/exportService', () => ({ assertSharing: jest.fn(), exportsDir: jest.fn(), safeFileName: (s: string) => s, shareFile: jest.fn() }));
jest.mock('@/storage/importService', () => ({ pickImageForImport: jest.fn() }));
jest.mock('@/engine/render/imageDecode', () => ({ decodeImportedImage: jest.fn() }));
jest.mock('@shopify/react-native-skia', () => ({ Skia: {}, ImageFormat: {}, ColorType: {}, AlphaType: {}, BlendMode: {}, PaintStyle: {}, TileMode: {}, BlurStyle: {} }));

import { BASE_PRESET } from '@/engine/brush/builtInBrushes';
import { shortcutFor } from '@/features/editor/keyboardShortcuts';
import { parseBrushFile } from '@/storage/brushTips';
import { base64ToBytes, bytesToBase64 } from '@/utils/base64';

const press = (key: string, mods: Partial<{ shift: boolean; ctrl: boolean; meta: boolean; alt: boolean }> = {}) => ({
  key,
  shift: false,
  ctrl: false,
  meta: false,
  alt: false,
  ...mods,
});

describe('keyboard shortcuts', () => {
  it('maps undo and redo on both platforms', () => {
    expect(shortcutFor(press('z', { meta: true }))).toBe('undo');
    expect(shortcutFor(press('z', { ctrl: true }))).toBe('undo');
    expect(shortcutFor(press('z', { meta: true, shift: true }))).toBe('redo');
    expect(shortcutFor(press('y', { ctrl: true }))).toBe('redo');
  });

  it('maps single-key tools and brush size', () => {
    expect(shortcutFor(press('b'))).toBe('brush');
    expect(shortcutFor(press('E'))).toBe('eraser');
    expect(shortcutFor(press('['))).toBe('sizeDown');
    expect(shortcutFor(press(']'))).toBe('sizeUp');
    expect(shortcutFor(press('Escape'))).toBe('cancel');
  });

  it('ignores other keys', () => {
    expect(shortcutFor(press('q'))).toBeNull();
    expect(shortcutFor(press('b', { alt: true }))).toBeNull();
    expect(shortcutFor(press('q', { ctrl: true }))).toBeNull();
  });
});

describe('base64', () => {
  it.each([[[]], [[1]], [[1, 2]], [[1, 2, 3]], [Array.from({ length: 257 }, (_, i) => i % 256)]])('round-trips %#', (bytes) => {
    const data = Uint8Array.from(bytes);
    expect(Array.from(base64ToBytes(bytesToBase64(data)))).toEqual(bytes);
  });

  it('matches the standard encoding', () => {
    expect(bytesToBase64(Uint8Array.from([77, 97, 110]))).toBe('TWFu');
    expect(bytesToBase64(Uint8Array.from([77, 97]))).toBe('TWE=');
  });
});

describe('brush files', () => {
  it('reads brushes and tips', () => {
    const file = JSON.stringify({
      format: 'zumi.brushes',
      version: 1,
      brushes: [{ ...BASE_PRESET, id: 'u_1', name: 'Leafy', shape: { tip: 'image', roundness: 1, image: 't_1' } }],
      tips: { t_1: bytesToBase64(Uint8Array.from([1, 2, 3])) },
    });
    const parsed = parseBrushFile(file);
    expect(parsed.brushes[0].name).toBe('Leafy');
    expect(parsed.brushes[0].shape).toMatchObject({ tip: 'image', image: 't_1' });
    expect(Array.from(parsed.tips.t_1)).toEqual([1, 2, 3]);
  });

  it('refuses other files', () => {
    expect(() => parseBrushFile('not json')).toThrow();
    expect(() => parseBrushFile(JSON.stringify({ format: 'other' }))).toThrow();
    expect(() => parseBrushFile(JSON.stringify({ format: 'zumi.brushes', version: 99, brushes: [] }))).toThrow(/newer/);
  });
});