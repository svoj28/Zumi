import type { SkImage } from '@shopify/react-native-skia';

/**
 * In-app pixel clipboard (copy/cut/paste between layers and artworks). Kept in memory for the
 * app session only; the image is owned here and released when replaced.
 */
export interface ClipboardContent {
  image: SkImage;
  /** Where the pixels came from, in source-canvas coordinates (paste puts them back there). */
  x: number;
  y: number;
}

let content: ClipboardContent | null = null;

export function setClipboard(next: ClipboardContent): void {
  content?.image.dispose();
  content = next;
}

export function getClipboard(): ClipboardContent | null {
  return content;
}
