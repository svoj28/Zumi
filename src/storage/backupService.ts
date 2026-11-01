import { Skia } from '@shopify/react-native-skia';
import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import { isSafeName, parseManifest, type ProjectManifest } from '@/engine/document/projectFormat';
import { createId } from '@/engine/ids';
import { assertSharing, clearExportsDir, exportsDir, safeFileName } from '@/storage/exportService';
import {
  APP_VERSION,
  manifestFiles,
  projectDir,
  projectIdInUse,
  projectsRoot,
  readManifest,
  safeDeleteDir,
  writeFileAtomic,
  writeManifest,
} from '@/storage/projectRepository';

/**
 * Editable project backups ("Zumi backup", `.zumi`). A single file, so it can go through the
 * share sheet (Files, AirDrop, a USB transfer…) and come back through the document picker:
 *
 *   bytes 0–7    "ZUMIPKG1"
 *   bytes 8–11   header length N (uint32, little-endian)
 *   bytes 12…    header: ASCII JSON (non-ASCII escaped as \uXXXX)
 *                  { format: "zumi.package", version: 1, createdAt, appVersion,
 *                    manifest: <project.json>, entries: [{ path, offset, length }] }
 *   then         the data section; entry offsets are relative to its start
 *
 * Entries are the files the manifest refers to (`layers/…`, `assets/…`, the thumbnail), stored
 * byte-for-byte. The manifest keeps its own format version, so packages from older app versions
 * are migrated on import exactly like projects on disk.
 *
 * Restoring validates the whole package (header, manifest, every entry's bounds and every layer
 * image) into a staging directory before anything becomes visible, and never replaces an
 * existing artwork: a clash is resolved by importing a copy under a new id.
 */

const MAGIC = 'ZUMIPKG1';
const PACKAGE_FORMAT = 'zumi.package';
const PACKAGE_VERSION = 1;
const PREFIX_BYTES = 12;
const MAX_HEADER_BYTES = 8 * 1024 * 1024;
export const BACKUP_EXTENSION = 'zumi';

interface PackageEntry {
  path: string;
  offset: number;
  length: number;
}

interface PackageHeader {
  format: typeof PACKAGE_FORMAT;
  version: number;
  createdAt: string;
  appVersion: string | null;
  manifest: ProjectManifest;
  entries: PackageEntry[];
}

// ---- byte helpers --------------------------------------------------------------------------

/** JSON with every non-ASCII character escaped, so 1 char = 1 byte (no TextEncoder needed). */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

function asciiText(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return out;
}

function u32le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function readU32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((v, i) => bytes[i] === v);
}

/** `layers/<name>`, `assets/<name>` or a top-level thumbnail — nothing that could escape. */
function isAllowedPath(path: string): boolean {
  const parts = path.split('/');
  if (parts.length === 1) return parts[0].startsWith('thumbnail-') && isSafeName(parts[0]);
  return parts.length === 2 && (parts[0] === 'layers' || parts[0] === 'assets') && isSafeName(parts[1]);
}

// ---- export --------------------------------------------------------------------------------

/**
 * Writes a project into a `.zumi` package in the cache and returns it. Files are appended one
 * at a time, so memory use stays at one layer regardless of project size.
 */
export function createBackupFile(projectId: string): File {
  const dir = projectDir(projectId);
  const manifest = dir.exists ? readManifest(dir) : null;
  if (!manifest) throw new Error('This artwork could not be found or is damaged.');

  const sources: { path: string; file: File }[] = [];
  for (const path of manifestFiles(manifest)) {
    const file = new File(dir, ...path.split('/'));
    if (file.exists) sources.push({ path, file });
    else if (path.startsWith('layers/')) throw new Error('This artwork is missing layer data and cannot be backed up.');
  }
  // Optional files that are missing are simply left out of the package.
  const included = new Set(sources.map((s) => s.path));
  const packaged: ProjectManifest = {
    ...manifest,
    thumbnail: manifest.thumbnail && included.has(manifest.thumbnail) ? manifest.thumbnail : null,
    references: manifest.references.filter((r) => included.has(`assets/${r.file}`)),
  };

  let offset = 0;
  const entries: PackageEntry[] = sources.map(({ path, file }) => {
    const entry = { path, offset, length: file.size };
    offset += file.size;
    return entry;
  });
  const header: PackageHeader = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    manifest: packaged,
    entries,
  };
  const headerBytes = asciiBytes(asciiJson(header));

  clearExportsDir();
  const out = new File(exportsDir(), `${safeFileName(manifest.name)}.${BACKUP_EXTENSION}`);
  out.create({ overwrite: true });
  out.writeSync(asciiBytes(MAGIC));
  out.writeSync(u32le(headerBytes.length), { append: true });
  out.writeSync(headerBytes, { append: true });
  for (const { file } of sources) out.writeSync(file.bytesSync(), { append: true });

  if (out.size !== PREFIX_BYTES + headerBytes.length + offset) {
    throw new Error('The backup could not be written completely. Check free storage space.');
  }
  return out;
}

export async function shareBackup(projectId: string): Promise<void> {
  await assertSharing();
  const file = createBackupFile(projectId);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/octet-stream',
    UTI: 'public.data',
    dialogTitle: 'Save or share backup',
  });
}

// ---- save to a folder ----------------------------------------------------------------------

/** A folder chosen in Settings for saved `.zumi` files. */
export interface BackupFolder {
  uri: string;
  name: string;
}

/** Name of the app's own backup folder (in Documents; shown in the Files app on iOS). */
export const APP_BACKUP_FOLDER_NAME = 'Zumi Backups';
const COPY_CHUNK = 1024 * 1024;

function appBackupDir(): Directory {
  return new Directory(Paths.document, APP_BACKUP_FOLDER_NAME);
}

/**
 * Lets the user choose a folder for saved `.zumi` files (Android: any folder, kept across
 * restarts; iOS: access may end when the app restarts). Returns null when cancelled.
 */
export async function pickBackupFolder(): Promise<BackupFolder | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    const name = decodeURIComponent(dir.name || '').split(/[:/]/).filter(Boolean).pop() || 'Chosen folder';
    return { uri: dir.uri, name };
  } catch (error) {
    if (/cancel/i.test(String((error as Error)?.message ?? error))) return null;
    throw error;
  }
}

/** "Name.zumi", or "Name (2).zumi"… when that name is taken in a local folder. */
function freeName(dir: Directory, base: string): string {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${base}.${BACKUP_EXTENSION}` : `${base} (${n}).${BACKUP_EXTENSION}`;
    if (!new File(dir, name).exists) return name;
  }
  return `${base} ${Date.now()}.${BACKUP_EXTENSION}`;
}

/** Copies a file into `out` in chunks, so memory use stays small for big artworks. */
function copyInto(source: File, out: File): void {
  const handle = source.open(FileMode.ReadOnly);
  try {
    let first = true;
    for (;;) {
      const chunk = handle.readBytesSync(COPY_CHUNK);
      if (chunk.length === 0) break;
      out.writeSync(chunk, { append: !first });
      first = false;
    }
    if (first) out.writeSync(new Uint8Array(0));
  } finally {
    handle.close();
  }
}

/**
 * Saves an editable `.zumi` file of the artwork into `folder` (from Settings), or into the
 * app's own "Zumi Backups" folder when none is chosen. Never overwrites an earlier file.
 */
export function saveBackupToFolder(projectId: string, folder: BackupFolder | null): { fileName: string; folderName: string } {
  const packaged = createBackupFile(projectId);
  const suffix = `.${BACKUP_EXTENSION}`;
  const base = packaged.name.endsWith(suffix) ? packaged.name.slice(0, -suffix.length) : packaged.name;

  if (!folder) {
    const dir = appBackupDir();
    dir.create({ idempotent: true, intermediates: true });
    const fileName = freeName(dir, base);
    packaged.copy(new File(dir, fileName));
    return { fileName, folderName: APP_BACKUP_FOLDER_NAME };
  }

  let out: File;
  try {
    const dir = new Directory(folder.uri);
    // Android's document folders pick a free name themselves ("Name (1).zumi").
    const fileName = folder.uri.startsWith('content:') ? `${base}.${BACKUP_EXTENSION}` : freeName(dir, base);
    out = dir.createFile(fileName, 'application/octet-stream');
  } catch (error) {
    console.warn('[backup] Folder not writable', error);
    throw new BackupError(
      `Zumi can no longer save to “${folder.name}”. Choose the folder again in Settings › Storage${Platform.OS === 'ios' ? ', or use the Zumi Backups folder' : ''}.`,
    );
  }
  copyInto(packaged, out);
  return { fileName: out.name, folderName: folder.name };
}

// ---- restore -------------------------------------------------------------------------------

export class BackupError extends Error {}

/** A validated package unpacked into staging, waiting for `commitRestore` or `discardRestore`. */
export interface PreparedRestore {
  manifest: ProjectManifest;
  /** The package's artwork id is already used by an artwork on this device. */
  conflict: boolean;
  staging: Directory;
}

function stagingRoot(): Directory {
  // Inside documents (same volume as projects/), so the final move is a cheap rename.
  const dir = new Directory(Paths.document, 'restore-staging');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Removes leftovers of restores interrupted by a crash. */
export function cleanRestoreStaging(): void {
  for (const entry of stagingRoot().list()) {
    if (entry instanceof Directory) safeDeleteDir(entry);
  }
}

export async function pickBackupFile(): Promise<File | null> {
  const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  return new File(result.assets[0].uri);
}

interface ByteReader {
  readBytesSync(length: number): Uint8Array;
  offset: number | null;
}

function readHeader(handle: ByteReader, size: number): PackageHeader {
  const fail = (why: string): never => {
    throw new BackupError(`This file is not a valid Zumi backup (${why}).`);
  };
  if (size < PREFIX_BYTES) fail('too small');
  handle.offset = 0;
  const prefix = handle.readBytesSync(PREFIX_BYTES);
  if (asciiText(prefix.subarray(0, MAGIC.length)) !== MAGIC) fail('unknown file type');
  const headerLength = readU32le(prefix, MAGIC.length);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES || PREFIX_BYTES + headerLength > size) fail('bad header');

  let raw: Partial<PackageHeader> = {};
  try {
    raw = JSON.parse(asciiText(handle.readBytesSync(headerLength))) as Partial<PackageHeader>;
  } catch {
    fail('unreadable header');
  }
  if (raw.format !== PACKAGE_FORMAT) fail('unknown format');
  if (typeof raw.version !== 'number' || raw.version > PACKAGE_VERSION) {
    throw new BackupError('This backup was made by a newer version of Zumi. Update the app to restore it.');
  }

  let manifest: ProjectManifest;
  try {
    manifest = parseManifest(raw.manifest);
  } catch (error) {
    throw new BackupError(error instanceof Error ? error.message : 'Invalid artwork data.');
  }

  const dataStart = PREFIX_BYTES + headerLength;
  const entries: PackageEntry[] = Array.isArray(raw.entries) ? raw.entries : fail('no contents');
  const seen = new Set<string>();
  for (const e of entries) {
    const ok =
      !!e &&
      typeof e.path === 'string' &&
      isAllowedPath(e.path) &&
      !seen.has(e.path) &&
      Number.isInteger(e.offset) &&
      Number.isInteger(e.length) &&
      e.offset >= 0 &&
      e.length > 0 &&
      dataStart + e.offset + e.length <= size;
    if (!ok) fail('damaged contents');
    seen.add(e.path);
  }
  for (const layer of manifest.layers) {
    if (!seen.has(`layers/${layer.file}`)) fail(`missing layer "${layer.name}"`);
  }
  return {
    format: PACKAGE_FORMAT,
    version: raw.version,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : null,
    manifest: {
      ...manifest,
      thumbnail: manifest.thumbnail && seen.has(manifest.thumbnail) ? manifest.thumbnail : null,
      references: manifest.references.filter((r) => seen.has(`assets/${r.file}`)),
    },
    entries: entries.map((e) => ({ path: e.path, offset: e.offset + dataStart, length: e.length })),
  };
}

/** Every layer must be a PNG that decodes at the canvas size. */
function validateLayer(bytes: Uint8Array, manifest: ProjectManifest, name: string): void {
  const image = isPng(bytes) ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes)) : null;
  const ok = !!image && image.width() === manifest.width && image.height() === manifest.height;
  image?.dispose();
  if (!ok) throw new BackupError(`This backup is damaged: layer "${name}" cannot be read.`);
}

/**
 * Reads and fully validates a package, unpacking it into a private staging directory. Nothing
 * in the gallery changes until `commitRestore`.
 */
export function prepareRestore(file: File): PreparedRestore {
  if (!file.exists) throw new BackupError('The selected file could not be opened.');
  const staging = new Directory(stagingRoot(), createId('r_'));
  const handle = file.open();
  try {
    const header = readHeader(handle, file.size);
    const { manifest } = header;
    staging.create({ intermediates: true });
    const layersByPath = new Map(manifest.layers.map((l) => [`layers/${l.file}`, l.name]));
    const wanted = new Set(manifestFiles(manifest));

    for (const entry of header.entries) {
      if (!wanted.has(entry.path)) continue; // unknown extras are ignored, never written
      handle.offset = entry.offset;
      const bytes = handle.readBytesSync(entry.length);
      if (bytes.length !== entry.length) throw new BackupError('This backup is incomplete.');
      const layerName = layersByPath.get(entry.path);
      if (layerName !== undefined) validateLayer(bytes, manifest, layerName);
      const [first, second] = entry.path.split('/');
      const targetDir = second ? new Directory(staging, first) : staging;
      if (!targetDir.exists) targetDir.create({ idempotent: true });
      writeFileAtomic(targetDir, second ?? first, bytes);
    }
    return { manifest, conflict: projectIdInUse(manifest.id), staging };
  } catch (error) {
    safeDeleteDir(staging);
    throw error;
  } finally {
    handle.close();
  }
}

/**
 * Makes a prepared restore visible in the gallery and returns the artwork id. If the id is
 * taken the artwork is always imported as a copy with a new id — never over the existing one.
 * The collection is kept only if it exists on this device.
 */
export function commitRestore(prepared: PreparedRestore, existingFolderIds: ReadonlySet<string>): string {
  const { manifest, staging } = prepared;
  try {
    const clash = projectIdInUse(manifest.id);
    const id = clash ? createId('p_') : manifest.id;
    writeManifest(staging, {
      ...manifest,
      id,
      name: clash ? `${manifest.name} (restored)` : manifest.name,
      folderId: manifest.folderId && existingFolderIds.has(manifest.folderId) ? manifest.folderId : null,
      appVersion: APP_VERSION,
    });
    const dest = new Directory(projectsRoot(), id);
    if (dest.exists) throw new Error('An artwork with the same id already exists.');
    staging.moveSync(dest);
    return id;
  } catch (error) {
    safeDeleteDir(staging);
    throw error;
  }
}

export function discardRestore(prepared: PreparedRestore): void {
  if (prepared.staging.exists) safeDeleteDir(prepared.staging);
}
