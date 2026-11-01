import { File } from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';

/**
 * Local image picking. The system picker needs no permission prompt and hands back a local
 * copy of the chosen image; nothing is uploaded.
 */

export interface PickedImageFile {
  uri: string;
  width: number;
  height: number;
  /** File name without extension, or a fallback. */
  name: string;
}

export async function pickImageFile(): Promise<PickedImageFile | null> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const base = asset.fileName?.replace(/\.[^.]+$/, '').trim();
  return { uri: asset.uri, width: asset.width, height: asset.height, name: base || 'Imported image' };
}

/** Picks one or more images (e.g. reference images); an empty list when cancelled. */
export async function pickImageFiles(limit: number): Promise<PickedImageFile[]> {
  if (limit <= 0) return [];
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    name: asset.fileName?.replace(/\.[^.]+$/, '').trim() || 'Image',
  }));
}

/** Picks an image and returns its encoded bytes (for decoding into a canvas or layer). */
export async function pickImageForImport(): Promise<{ bytes: Uint8Array; name: string } | null> {
  const picked = await pickImageFile();
  if (!picked) return null;
  const bytes = await new File(picked.uri).bytes();
  return { bytes, name: picked.name };
}
