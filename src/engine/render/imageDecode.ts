import { Skia, type SkImage } from '@shopify/react-native-skia';

/**
 * Decoding of user-supplied images (imports) with EXIF orientation respected.
 *
 * Skia's codec normally applies the EXIF orientation itself. As a safeguard, a JPEG's
 * orientation tag and stored (unrotated) size are read here: if the decoded image still has
 * the stored size although the tag says the axes are swapped, the codec ignored the tag and the
 * rotation is applied manually. Orientations that keep the axes (mirror / 180°) cannot be
 * detected this way and are left to the codec.
 */
export function decodeImportedImage(bytes: Uint8Array): SkImage | null {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) return null;
  const exif = readJpegOrientation(bytes);
  if (!exif || exif.orientation < 5 || exif.width === exif.height) return image;
  const stillRaw = image.width() === exif.width && image.height() === exif.height;
  if (!stillRaw) return image;
  const oriented = applyOrientation(image, exif.orientation);
  if (!oriented) return image;
  image.dispose();
  return oriented;
}

/** Row-major 3×3 matrices mapping stored pixels to display pixels, for w × h stored size. */
function orientationMatrix(orientation: number, w: number, h: number): number[] {
  switch (orientation) {
    case 2: return [-1, 0, w, 0, 1, 0, 0, 0, 1];
    case 3: return [-1, 0, w, 0, -1, h, 0, 0, 1];
    case 4: return [1, 0, 0, 0, -1, h, 0, 0, 1];
    case 5: return [0, 1, 0, 1, 0, 0, 0, 0, 1];
    case 6: return [0, -1, h, 1, 0, 0, 0, 0, 1];
    case 7: return [0, -1, h, -1, 0, w, 0, 0, 1];
    case 8: return [0, 1, 0, -1, 0, w, 0, 0, 1];
    default: return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

function applyOrientation(image: SkImage, orientation: number): SkImage | null {
  const w = image.width();
  const h = image.height();
  const swap = orientation >= 5;
  const surface = Skia.Surface.Make(swap ? h : w, swap ? w : h);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.concat(Skia.Matrix(orientationMatrix(orientation, w, h)));
  canvas.drawImage(image, 0, 0);
  surface.flush();
  const out = surface.makeImageSnapshot();
  surface.dispose();
  return out;
}

/**
 * Reads the EXIF orientation (1–8) and the stored frame size from a JPEG. Returns null for
 * other formats or when either is missing. Only walks marker headers — never decodes pixels.
 */
export function readJpegOrientation(b: Uint8Array): { orientation: number; width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let orientation = 1;
  let width = 0;
  let height = 0;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const length = (b[i + 2] << 8) | b[i + 3];
    const start = i + 4;
    const end = i + 2 + length;
    if (length < 2 || end > b.length) return null;
    if (marker === 0xe1) {
      orientation = exifOrientation(b, start, end) ?? orientation;
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && end - start >= 5) {
      height = (b[start + 1] << 8) | b[start + 2];
      width = (b[start + 3] << 8) | b[start + 4];
    }
    i = end;
  }
  return width > 0 && height > 0 ? { orientation, width, height } : null;
}

function exifOrientation(b: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0" header, then a TIFF structure.
  if (end - start < 14 || b[start] !== 0x45 || b[start + 1] !== 0x78 || b[start + 2] !== 0x69 || b[start + 3] !== 0x66) {
    return null;
  }
  const tiff = start + 6;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) =>
    little
      ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
      : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}
