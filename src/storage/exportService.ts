import { ImageFormat } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { renderComposite, type CompositeOptions } from '@/engine/render/composite';
import { renderArtworkClip } from '@/storage/animationExport';
import { loadDocument } from '@/storage/projectRepository';
import { renderPsd } from '@/storage/psdExport';

/**
 * Flattened image export. Images are rendered on-device into the app cache and then handed to
 * the OS share sheet or saved to the photo library — nothing is uploaded by the app itself.
 *
 * Only the artwork is exported: visible layers composited with their opacity and blend modes.
 * Hidden layers, reference images and guides never appear (guides only when explicitly
 * requested through `guides`).
 */

/**
 * Export formats. PNG, JPEG and WebP are still images; GIF and MP4 show the artwork as a single
 * frame (a 2 s clip for video); PSD keeps the layers.
 */
export type ExportImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'mp4' | 'psd';

export interface ExportOptions {
  format: ExportImageFormat;
  /** 1–100; used by JPEG and WebP (PNG is always lossless). */
  quality: number;
  /** Leave the paper colour out so empty areas stay transparent (PNG and WebP only). */
  transparent: boolean;
  /** Guide lines to draw over the artwork — only when the user explicitly asked for them. */
  guides?: CompositeOptions['guides'];
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { format: 'png', quality: 92, transparent: false };

export const FORMAT_INFO: Record<
  ExportImageFormat,
  { label: string; ext: string; mime: string; uti: string; alpha: boolean; lossy: boolean }
> = {
  png: { label: 'PNG', ext: 'png', mime: 'image/png', uti: 'public.png', alpha: true, lossy: false },
  jpeg: { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', uti: 'public.jpeg', alpha: false, lossy: true },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', uti: 'org.webmproject.webp', alpha: true, lossy: true },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif', uti: 'com.compuserve.gif', alpha: false, lossy: false },
  mp4: { label: 'MP4', ext: 'mp4', mime: 'video/mp4', uti: 'public.mpeg-4', alpha: false, lossy: false },
  psd: { label: 'PSD', ext: 'psd', mime: 'image/vnd.adobe.photoshop', uti: 'com.adobe.photoshop-image', alpha: true, lossy: false },
};

const SKIA_FORMAT: Record<'png' | 'jpeg' | 'webp', ImageFormat> = {
  png: ImageFormat.PNG,
  jpeg: ImageFormat.JPEG,
  webp: ImageFormat.WEBP,
};

export function exportsDir(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Removes previous exports so the cache does not grow without bound. */
export function clearExportsDir(): void {
  for (const entry of exportsDir().list()) {
    try {
      entry.delete();
    } catch {
      // A file still being shared may be locked; it will be cleaned up next time.
    }
  }
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60);
  return cleaned || 'artwork';
}

/** Renders an open document into a temporary file in any export format. */
export async function renderDocumentFile(doc: DrawingDocument, options: ExportOptions): Promise<File> {
  if (options.format === 'gif' || options.format === 'mp4') {
    clearExportsDir();
    return renderArtworkClip(doc, options.format);
  }
  if (options.format === 'psd') {
    clearExportsDir();
    return renderPsd(doc);
  }
  return renderDocumentImage(doc, options as ExportOptions & { format: 'png' | 'jpeg' | 'webp' });
}

/** Renders an open document at full resolution into a temporary still image file. */
export function renderDocumentImage(doc: DrawingDocument, options: ExportOptions & { format: 'png' | 'jpeg' | 'webp' }): File {
  const info = FORMAT_INFO[options.format];
  const transparent = options.transparent && info.alpha;
  const image = renderComposite(doc, 1, {
    background: !transparent,
    // Formats without alpha flatten transparent areas onto white instead of black.
    underlay: info.alpha ? 'none' : 'white',
    guides: options.guides,
  });
  if (!image) throw new Error('Not enough memory to render this artwork.');
  let bytes: Uint8Array | null = null;
  try {
    const quality = info.lossy ? Math.round(Math.min(100, Math.max(1, options.quality))) : 100;
    bytes = image.encodeToBytes(SKIA_FORMAT[options.format], quality);
  } catch (error) {
    console.warn('[export] encode failed', error);
  } finally {
    image.dispose();
  }
  if (!bytes || bytes.length === 0) {
    throw new Error(`${info.label} export is not supported on this device. Try PNG or JPEG.`);
  }

  clearExportsDir();
  const file = new File(exportsDir(), `${safeFileName(doc.info.name)}.${info.ext}`);
  file.create({ overwrite: true });
  file.writeSync(bytes);
  return file;
}

/** Loads a saved project, renders it, and releases it. */
async function renderProjectImage(id: string, options: ExportOptions): Promise<File> {
  const { doc } = loadDocument(id);
  try {
    return await renderDocumentFile(doc, options);
  } finally {
    doc.dispose();
  }
}

export async function assertSharing(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
}

/** How the share sheet should describe a file. */
export interface ShareType {
  mime: string;
  uti: string;
}

export async function shareFile(file: File, type: ShareType): Promise<void> {
  await Sharing.shareAsync(file.uri, { mimeType: type.mime, UTI: type.uti, dialogTitle: 'Share artwork' });
}

const shareImageFile = (file: File, format: ExportImageFormat) => shareFile(file, FORMAT_INFO[format]);

export async function shareProject(id: string, options: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<void> {
  await assertSharing();
  await shareImageFile(await renderProjectImage(id, options), options.format);
}

export async function shareDocument(doc: DrawingDocument, options: ExportOptions = DEFAULT_EXPORT_OPTIONS): Promise<void> {
  await assertSharing();
  await shareImageFile(await renderDocumentFile(doc, options), options.format);
}

/**
 * Outcome of "save to Photos":
 * - `saved`: added to the photo library
 * - `denied`: the user refused photo-library access
 * - `shared`: no photo-library module in this runtime; the share sheet was opened instead
 *   (it offers "Save Image" on both platforms)
 */
export type PhotosResult = 'saved' | 'denied' | 'shared';

function isMissingNativeModule(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes('native module');
}

/**
 * Saves an image file to the photo library.
 *
 * expo-media-library is loaded lazily: its default entry needs the new `ExpoMediaLibraryNext`
 * native module, which some runtimes (e.g. Expo Go) do not ship, and a top-level import would
 * crash the whole app at startup. We try the current API, then the legacy module, and finally
 * fall back to the share sheet.
 */
export async function saveFileToPhotos(file: File, type: ShareType): Promise<PhotosResult> {
  try {
    const media = await import('expo-media-library');
    if (!(await media.requestPermissionsAsync(true, ['photo'])).granted) return 'denied';
    await media.Asset.create(file.uri);
    return 'saved';
  } catch (error) {
    if (!isMissingNativeModule(error)) throw error;
  }
  try {
    const legacy = await import('expo-media-library/legacy');
    if (!(await legacy.requestPermissionsAsync(true, ['photo'])).granted) return 'denied';
    await legacy.saveToLibraryAsync(file.uri);
    return 'saved';
  } catch (error) {
    if (!isMissingNativeModule(error)) throw error;
  }
  await assertSharing();
  await shareFile(file, type);
  return 'shared';
}

export async function exportProjectToPhotos(id: string, options: ExportOptions): Promise<PhotosResult> {
  return saveFileToPhotos(await renderProjectImage(id, options), FORMAT_INFO[options.format]);
}

export async function saveDocumentToPhotos(doc: DrawingDocument, options: ExportOptions): Promise<PhotosResult> {
  return saveFileToPhotos(await renderDocumentFile(doc, options), FORMAT_INFO[options.format]);
}
