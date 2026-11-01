import { AlphaType, ColorType, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { normalizePreset, type BrushPreset } from '@/engine/brush/brushPreset';
import { BASE_PRESET } from '@/engine/brush/builtInBrushes';
import { setImageTipLoader, TIP_SIZE } from '@/engine/brush/tips';
import { createId } from '@/engine/ids';
import { decodeImportedImage } from '@/engine/render/imageDecode';
import { assertSharing, exportsDir, safeFileName, shareFile } from '@/storage/exportService';
import { pickImageForImport } from '@/storage/importService';
import { base64ToBytes, bytesToBase64 } from '@/utils/base64';

/**
 * Image brush tips (made from a photo or drawing) and brush files.
 *
 * Tips are stored as white alpha masks (TIP_SIZE square PNGs) in `brush-tips/<id>.png` and
 * loaded into the brush engine on demand. Brush files (`.zumibrush`) are JSON:
 *
 *   { format: 'zumi.brushes', version: 1, brushes: BrushPreset[], tips: { [id]: base64 PNG } }
 */

const FORMAT = 'zumi.brushes';
const VERSION = 1;
export const BRUSH_FILE_TYPE = { mime: 'application/json', uti: 'public.json', ext: 'zumibrush' };

function tipsDir(): Directory {
  const dir = new Directory(Paths.document, 'brush-tips');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const isTipId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const loaded = new Map<string, SkImage | null>();

function loadTip(id: string): SkImage | null {
  if (loaded.has(id)) return loaded.get(id) ?? null;
  let image: SkImage | null = null;
  try {
    const file = new File(tipsDir(), `${id}.png`);
    if (isTipId(id) && file.exists) image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(file.bytesSync()));
  } catch (error) {
    console.warn('[brush-tips] Could not load tip', id, error);
  }
  loaded.set(id, image);
  return image;
}

// The brush engine asks for image tips through this loader.
setImageTipLoader(loadTip);

/**
 * Turns a picture into a tip: where the picture is transparent, its opacity is the shape;
 * otherwise darker = more paint (so a black drawing on white paper becomes a black stamp).
 */
export function tipFromImage(source: SkImage): SkImage | null {
  const S = TIP_SIZE;
  const surface = Skia.Surface.Make(S, S);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  const scale = Math.min(S / source.width(), S / source.height());
  const w = source.width() * scale;
  const h = source.height() * scale;
  canvas.drawImageRect(source, Skia.XYWHRect(0, 0, source.width(), source.height()), Skia.XYWHRect((S - w) / 2, (S - h) / 2, w, h), Skia.Paint());
  surface.flush();
  const fitted = surface.makeImageSnapshot();
  surface.dispose();
  const px = fitted.readPixels(0, 0, { width: S, height: S, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  fitted.dispose();
  if (!(px instanceof Uint8Array)) return null;
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) transparent++;
  const useAlpha = transparent > (S * S) / 20;
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const a = px[i * 4 + 3];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const alpha = useAlpha ? a : Math.round(((255 - luma) * a) / 255);
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = alpha;
  }
  return Skia.Image.MakeImage({ width: S, height: S, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }, Skia.Data.fromBytes(out), S * 4);
}

function saveTip(image: SkImage, id = createId('t_')): string {
  const bytes = image.encodeToBytes(ImageFormat.PNG, 100);
  const file = new File(tipsDir(), `${id}.png`);
  file.create({ overwrite: true });
  file.writeSync(bytes);
  loaded.delete(id);
  return id;
}

/** Picks a picture and stores it as a brush tip; returns the tip id, or null if cancelled. */
export async function pickTipImage(): Promise<string | null> {
  const picked = await pickImageForImport();
  if (!picked) return null;
  const image = decodeImportedImage(picked.bytes);
  if (!image) throw new Error('That picture could not be read.');
  const tip = tipFromImage(image);
  image.dispose();
  if (!tip) throw new Error('Not enough memory to make a brush tip.');
  const id = saveTip(tip);
  tip.dispose();
  return id;
}

/** Shares brushes as a `.zumibrush` file (image tips included). */
export async function shareBrushes(brushes: readonly BrushPreset[], name: string): Promise<void> {
  const tips: Record<string, string> = {};
  for (const b of brushes) {
    const id = b.shape.image;
    if (b.shape.tip !== 'image' || !id || tips[id]) continue;
    const file = new File(tipsDir(), `${id}.png`);
    if (isTipId(id) && file.exists) tips[id] = bytesToBase64(file.bytesSync());
  }
  const json = JSON.stringify({ format: FORMAT, version: VERSION, brushes, tips });
  const file = new File(exportsDir(), `${safeFileName(name)}.${BRUSH_FILE_TYPE.ext}`);
  file.create({ overwrite: true });
  file.write(json);
  await assertSharing();
  await shareFile(file, BRUSH_FILE_TYPE);
}

/** Parses a brush file: the brushes (normalised) and their tip images. Throws on bad files. */
export function parseBrushFile(text: string): { brushes: BrushPreset[]; tips: Record<string, Uint8Array> } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a Zumi brush file.');
  }
  const r = (raw ?? {}) as { format?: unknown; version?: unknown; brushes?: unknown; tips?: unknown };
  if (r.format !== FORMAT || !Array.isArray(r.brushes)) throw new Error('This is not a Zumi brush file.');
  if (typeof r.version === 'number' && r.version > VERSION) throw new Error('This brush file was made by a newer version of Zumi.');
  const brushes = r.brushes
    .filter((b: unknown) => !!b && typeof (b as { id?: unknown }).id === 'string')
    .map((b: unknown) => normalizePreset(b, { ...BASE_PRESET, category: 'custom' }));
  const tips: Record<string, Uint8Array> = {};
  if (r.tips && typeof r.tips === 'object') {
    for (const [id, data] of Object.entries(r.tips as Record<string, unknown>)) {
      if (isTipId(id) && typeof data === 'string') {
        try {
          tips[id] = base64ToBytes(data);
        } catch {
          // A broken tip falls back to a round tip; the brush still imports.
        }
      }
    }
  }
  return { brushes, tips };
}

/**
 * Picks a `.zumibrush` file and returns its brushes ready to add (tips saved, ids fresh so
 * importing twice never overwrites). Null when cancelled.
 */
export async function pickBrushFile(): Promise<BrushPreset[] | null> {
  const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const { brushes, tips } = parseBrushFile(await new File(result.assets[0].uri).text());
  const tipIds = new Map<string, string>();
  for (const [id, bytes] of Object.entries(tips)) {
    const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
    if (!image) continue;
    tipIds.set(id, saveTip(image));
    image.dispose();
  }
  return brushes.map((b) => {
    const image = b.shape.image ? tipIds.get(b.shape.image) : undefined;
    return { ...b, id: createId('u_'), builtIn: false, category: 'custom', shape: { ...b.shape, image } };
  });
}