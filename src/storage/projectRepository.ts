import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';

import { DrawingDocument, MAX_CANVAS_SIDE, MIN_CANVAS_SIDE } from '@/engine/document/DrawingDocument';
import {
  buildManifest,
  deserializeDocument,
  layerFileName,
  parseManifest,
  type ManifestReference,
  type ProjectManifest,
} from '@/engine/document/projectFormat';
import { comicPanels, drawPageGuides, drawPanels } from '@/engine/comics/drawComic';
import { createId } from '@/engine/ids';
import { encodeThumbnail } from '@/engine/render/composite';
import { decodeImportedImage } from '@/engine/render/imageDecode';

/**
 * Local-only project storage in the app's private documents directory:
 *
 *   <documents>/projects/<projectId>/project.json      ← current manifest
 *                                   /project.json.bak  ← previous manifest (fallback)
 *                                   /session.json      ← present while the editor has it open
 *                                   /thumbnail-<ts>.jpg
 *                                   /layers/<layerId>-r<rev>.png
 *                                   /assets/ref-<ts>.<ext>
 *   <documents>/trash/<projectId>/…same files…
 *                                /trash.json         ← { "deletedAt": ISO-8601 }
 *
 * Saves never destroy the last good copy:
 * - every file is written to `<name>.tmp` and then moved over its final name, so a file with a
 *   final name is always complete;
 * - layer files are named by revision, so changed pixels go to new files and never overwrite
 *   the ones the current manifest points at;
 * - the manifest is replaced last, and the previous one is kept as `project.json.bak`;
 * - only then are files referenced by neither manifest deleted.
 * A crash at any point therefore leaves a readable manifest whose files all exist.
 *
 * Deleting moves the whole project directory into `trash/` ("Recently Deleted"); it is purged
 * automatically after TRASH_RETENTION_DAYS.
 */

const MANIFEST = 'project.json';
const MANIFEST_TMP = 'project.json.tmp';
const MANIFEST_BAK = 'project.json.bak';
const SESSION_MARKER = 'session.json';
const LAYERS_DIR = 'layers';
const ASSETS_DIR = 'assets';
const TRASH_MARKER = 'trash.json';
const TMP_SUFFIX = '.tmp';
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Imported photos larger than this are downscaled to keep layer memory reasonable. */
const MAX_IMPORT_SIDE = 4096;
const DAMAGED = 'This artwork could not be found or is damaged.';

export const APP_VERSION: string | null = Constants.expoConfig?.version ?? null;

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  layerCount: number;
  createdAt: number;
  updatedAt: number;
  folderId: string | null;
  thumbnailUri: string | null;
}

export interface TrashedProject extends ProjectSummary {
  deletedAt: number;
  expiresAt: number;
}

/** A reference image ready to display. */
export interface StoredReference {
  /** Stable id: the asset file name (or the source URI when it could not be stored). */
  file: string;
  uri: string;
  aspect: number;
}

/** Most reference images one artwork keeps. */
export const MAX_REFERENCES = 30;

// ---- directories ---------------------------------------------------------------------------

function rootDir(name: string): Directory {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export const projectsRoot = () => rootDir('projects');
const trashRoot = () => rootDir('trash');

function assertId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid project id: ${id}`);
}

export function projectDir(id: string): Directory {
  assertId(id);
  return new Directory(projectsRoot(), id);
}

function trashDir(id: string): Directory {
  assertId(id);
  return new Directory(trashRoot(), id);
}

/** True if the id is taken by a live or a trashed project. */
export function projectIdInUse(id: string): boolean {
  return projectDir(id).exists || trashDir(id).exists;
}

// ---- file helpers --------------------------------------------------------------------------

/** Writes `bytes` to `<dir>/<name>` via a temp file, so the final name is never half-written. */
export function writeFileAtomic(dir: Directory, name: string, bytes: Uint8Array | string): void {
  const tmp = new File(dir, name + TMP_SUFFIX);
  tmp.create({ overwrite: true });
  tmp.writeSync(bytes);
  tmp.moveSync(new File(dir, name), { overwrite: true });
}

// ---- manifest helpers ----------------------------------------------------------------------

/**
 * Reads the newest valid manifest. `project.json` is preferred; the temp file covers a crash
 * between writing and moving it, and the backup covers a damaged current manifest.
 */
export function readManifest(dir: Directory): ProjectManifest | null {
  for (const name of [MANIFEST, MANIFEST_TMP, MANIFEST_BAK]) {
    const manifest = readManifestFile(new File(dir, name));
    if (manifest) return manifest;
  }
  return null;
}

function readManifestFile(file: File): ProjectManifest | null {
  if (!file.exists) return null;
  try {
    return parseManifest(JSON.parse(file.textSync()));
  } catch (error) {
    console.warn(`[projects] Unreadable ${file.name}:`, error);
    return null;
  }
}

/** Atomically replaces the manifest, keeping the previous valid one as a backup. */
export function writeManifest(dir: Directory, manifest: ProjectManifest): void {
  const current = new File(dir, MANIFEST);
  if (readManifestFile(current)) writeFileAtomic(dir, MANIFEST_BAK, current.textSync());
  writeFileAtomic(dir, MANIFEST, JSON.stringify(manifest));
}

function patchManifest(dir: Directory, patch: Partial<ProjectManifest>): void {
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(DAMAGED);
  writeManifest(dir, { ...manifest, ...patch });
}

function toSummary(dir: Directory, m: ProjectManifest): ProjectSummary {
  const thumb = m.thumbnail ? new File(dir, m.thumbnail) : null;
  return {
    id: m.id,
    name: m.name,
    width: m.width,
    height: m.height,
    layerCount: m.layers.length,
    createdAt: Date.parse(m.createdAt) || 0,
    updatedAt: Date.parse(m.updatedAt) || 0,
    folderId: m.folderId,
    thumbnailUri: thumb?.exists ? thumb.uri : null,
  };
}

/** Every file (path relative to the project directory) a manifest refers to. */
export function manifestFiles(m: ProjectManifest): string[] {
  return [
    ...m.layers.map((l) => `${LAYERS_DIR}/${l.file}`),
    ...m.references.map((r) => `${ASSETS_DIR}/${r.file}`),
    ...(m.thumbnail ? [m.thumbnail] : []),
  ];
}

// ---- projects ------------------------------------------------------------------------------

export function listProjects(): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  for (const entry of projectsRoot().list()) {
    if (!(entry instanceof Directory)) continue;
    const manifest = readManifest(entry);
    if (manifest) out.push(toSummary(entry, manifest));
  }
  return out;
}

// ---- damaged projects ----------------------------------------------------------------------

/** Damaged artwork is moved here after recovery; it is never deleted automatically. */
const damagedRoot = () => rootDir('damaged');
const LAYER_FILE = /^([A-Za-z0-9_]+)-r(\d+)\.png$/;

/** A project directory whose manifest (and its backups) cannot be read, but with layer files left. */
export interface DamagedProject {
  id: string;
  layerFileCount: number;
}

/** Newest file of every layer in a project's `layers/` directory, in layer-creation order. */
function salvageableLayerFiles(dir: Directory): File[] {
  const layersDir = new Directory(dir, LAYERS_DIR);
  if (!layersDir.exists) return [];
  const newest = new Map<string, { rev: number; file: File }>();
  for (const entry of layersDir.list()) {
    if (!(entry instanceof File)) continue;
    const match = LAYER_FILE.exec(entry.name);
    if (!match) continue;
    const rev = Number(match[2]);
    const seen = newest.get(match[1]);
    if (!seen || rev > seen.rev) newest.set(match[1], { rev, file: entry });
  }
  // Layer ids start with their creation time, so this approximates the original stack order.
  return [...newest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.file);
}

/**
 * Projects the gallery cannot list because no manifest is readable. They are reported rather
 * than hidden so the artwork in their layer files is never silently lost.
 */
export function listDamagedProjects(): DamagedProject[] {
  const out: DamagedProject[] = [];
  for (const entry of projectsRoot().list()) {
    if (!(entry instanceof Directory) || readManifest(entry)) continue;
    const layerFileCount = salvageableLayerFiles(entry).length;
    if (layerFileCount > 0) out.push({ id: entry.name, layerFileCount });
  }
  return out;
}

/**
 * Rebuilds a damaged project's readable layers into a new artwork, then moves the damaged
 * directory to `damaged/` (kept, never auto-deleted). Returns the new project's id.
 */
export function recoverDamagedProject(id: string): string {
  const dir = projectDir(id);
  const images = salvageableLayerFiles(dir).flatMap((file) => {
    try {
      const image = decodeImportedImage(file.bytesSync());
      return image ? [image] : [];
    } catch (error) {
      console.warn('[projects] Unreadable layer file', file.name, error);
      return [];
    }
  });
  try {
    if (images.length === 0) throw new Error('No layer of this artwork could be read, so nothing could be recovered.');
    const clampSide = (v: number) => Math.min(MAX_CANVAS_SIDE, Math.max(MIN_CANVAS_SIDE, v));
    const width = clampSide(Math.max(...images.map((i) => i.width())));
    const height = clampSide(Math.max(...images.map((i) => i.height())));
    const doc = DrawingDocument.createBlank({ name: 'Recovered artwork', width, height, background: '#ffffff' });
    try {
      const [first, ...rest] = images;
      doc.layers.active?.loadImage(first);
      rest.forEach((image, i) => doc.addImageLayer(image, `Recovered layer ${i + 2}`));
      saveDocument(doc, null);
      const newId = doc.info.id;
      dir.moveSync(new Directory(damagedRoot(), `${id}-${Date.now()}`));
      return newId;
    } finally {
      doc.dispose();
    }
  } finally {
    for (const image of images) image.dispose();
  }
}

/** Permanently removes a damaged project the user chose not to recover. */
export function deleteDamagedProject(id: string): void {
  const dir = projectDir(id);
  if (dir.exists && !readManifest(dir)) dir.delete();
}

/**
 * Per-document save generation. Every save bumps it, which makes an incremental save still in
 * progress for the same document stop at its next checkpoint.
 */
const saveGenerations = new WeakMap<DrawingDocument, number>();

function bumpGeneration(doc: DrawingDocument): number {
  const next = (saveGenerations.get(doc) ?? 0) + 1;
  saveGenerations.set(doc, next);
  return next;
}

function prepareDirs(id: string): { dir: Directory; layersDir: Directory } {
  const dir = projectDir(id);
  dir.create({ intermediates: true, idempotent: true });
  const layersDir = new Directory(dir, LAYERS_DIR);
  layersDir.create({ idempotent: true });
  return { dir, layersDir };
}

/**
 * Writes the document to disk synchronously. `folderId` defaults to whatever the existing
 * manifest says, so saving from the editor never moves an artwork out of its collection.
 */
export function saveDocument(doc: DrawingDocument, folderId?: string | null): void {
  bumpGeneration(doc);
  const { dir, layersDir } = prepareDirs(doc.info.id);
  commitSave(doc, dir, layersDir, folderId);
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Saves without blocking the UI for long: changed layers are encoded one per task, yielding
 * between them so input and rendering keep flowing, and only the final step (layers edited in
 * the meantime, thumbnail, manifest) runs in one go. Resolves to false if it was superseded by
 * another save or `isCancelled` became true; nothing on disk is left inconsistent either way.
 */
export async function saveDocumentIncremental(doc: DrawingDocument, isCancelled: () => boolean): Promise<boolean> {
  const generation = bumpGeneration(doc);
  const stale = () => isCancelled() || saveGenerations.get(doc) !== generation;
  const { dir, layersDir } = prepareDirs(doc.info.id);

  for (const layer of [...doc.layers.list]) {
    if (stale()) return false;
    // The layer may have been removed (and disposed) while we were yielding.
    if (!doc.layers.get(layer.meta.id)) continue;
    const name = layerFileName(layer);
    if (new File(layersDir, name).exists) continue;
    writeFileAtomic(layersDir, name, layer.encodePng());
    await yieldToUi();
  }
  if (stale()) return false;
  commitSave(doc, dir, layersDir);
  return true;
}

function commitSave(doc: DrawingDocument, dir: Directory, layersDir: Directory, folderId?: string | null): void {
  const version = doc.getContentVersion();
  const previous = readManifest(dir);

  // 1. Layer pixels — only layers whose revision has no file yet are encoded.
  for (const layer of doc.layers.list) {
    const name = layerFileName(layer);
    if (!new File(layersDir, name).exists) writeFileAtomic(layersDir, name, layer.encodePng());
  }

  // 2. Thumbnail (unique name so image caches never show a stale preview).
  let thumbnail: string | null = null;
  const thumbBytes = encodeThumbnail(doc);
  if (thumbBytes) {
    thumbnail = `thumbnail-${Date.now()}.jpg`;
    writeFileAtomic(dir, thumbnail, thumbBytes);
  }

  // 3. Manifest, atomically replaced (the old one becomes the backup).
  writeManifest(
    dir,
    buildManifest(doc, {
      appVersion: APP_VERSION,
      thumbnail,
      folderId: folderId !== undefined ? folderId : (previous?.folderId ?? null),
      references: previous?.references ?? [],
    }),
  );

  // 4. Garbage-collect files neither the new nor the backup manifest references.
  collectGarbage(dir);

  doc.markSaved(version);
}

/** Deletes files no valid manifest (current, temp or backup) refers to, plus stray temp files. */
function collectGarbage(dir: Directory): void {
  const keep = new Set<string>();
  for (const name of [MANIFEST, MANIFEST_TMP, MANIFEST_BAK]) {
    const m = readManifestFile(new File(dir, name));
    if (m) for (const path of manifestFiles(m)) keep.add(path);
  }
  for (const sub of [LAYERS_DIR, ASSETS_DIR]) {
    const subDir = new Directory(dir, sub);
    if (!subDir.exists) continue;
    for (const entry of subDir.list()) {
      if (entry instanceof File && !keep.has(`${sub}/${entry.name}`)) safeDelete(entry);
    }
  }
  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    const staleThumb = entry.name.startsWith('thumbnail-') && !keep.has(entry.name);
    const strayTmp = entry.name.endsWith(TMP_SUFFIX) && entry.name !== MANIFEST_TMP;
    if (staleThumb || strayTmp) safeDelete(entry);
  }
}

export function createProject(params: {
  name: string;
  width: number;
  height: number;
  background: string;
  dpi?: number;
  folderId?: string | null;
  recordTimelapse?: boolean | null;
  /** Manga / comic template: panel borders and page guides on their own layers. */
  comic?: ComicTemplate | null;
}): string {
  const doc = DrawingDocument.createBlank(params);
  try {
    if (params.comic) applyComicTemplate(doc, params.comic);
    saveDocument(doc, params.folderId ?? null);
    return doc.info.id;
  } finally {
    doc.dispose();
  }
}

/** A manga / comic page set-up chosen when creating an artwork. */
export interface ComicTemplate {
  layoutId: string;
  /** Bleed and safe margin in pixels (see comicLayouts.PageFormat). */
  bleed: number;
  safe: number;
  border: number;
  /** Add a locked "Page guides" layer showing bleed, trim and safe area. */
  guides: boolean;
}

/**
 * Lays a comic template over the first layer: a "Panels" layer with the borders and, for print,
 * a locked, half-transparent "Page guides" layer. Drawing stays on the first layer, under the
 * panel borders.
 */
function applyComicTemplate(doc: DrawingDocument, t: ComicTemplate): void {
  const { width, height } = doc.info;
  const drawingLayerId = doc.layers.active?.meta.id;
  const panels = comicPanels(t.layoutId, width, height, t.bleed, t.safe);
  if (panels.length > 0) doc.addDrawnLayer('Panels', 'Add panels', (canvas) => drawPanels(canvas, panels, t.border));
  if (t.guides && (t.bleed > 0 || t.safe > 0)) {
    doc.addDrawnLayer('Page guides (hide before export)', 'Add page guides', (canvas) => drawPageGuides(canvas, width, height, t.bleed, t.safe), {
      locked: true,
      opacity: 0.8,
    });
  }
  if (drawingLayerId) doc.setActiveLayer(drawingLayerId);
}

/**
 * Creates a new artwork whose first layer is the given encoded image (PNG/JPEG/WebP…), upright
 * according to its EXIF orientation. Very large photos are downscaled to MAX_IMPORT_SIDE.
 */
export function createProjectFromImage(params: {
  bytes: Uint8Array;
  name: string;
  folderId?: string | null;
}): string {
  const image = decodeImportedImage(params.bytes);
  if (!image) throw new Error('This image format is not supported.');
  try {
    const longest = Math.max(image.width(), image.height());
    const scale = Math.min(1, MAX_IMPORT_SIDE / longest, MAX_CANVAS_SIDE / longest);
    const width = Math.max(MIN_CANVAS_SIDE, Math.round(image.width() * scale));
    const height = Math.max(MIN_CANVAS_SIDE, Math.round(image.height() * scale));
    const doc = DrawingDocument.createBlank({ name: params.name, width, height, background: '#ffffff' });
    try {
      doc.layers.active?.loadImage(image);
      saveDocument(doc, params.folderId ?? null);
      return doc.info.id;
    } finally {
      doc.dispose();
    }
  } finally {
    image.dispose();
  }
}

export interface LoadedProject {
  doc: DrawingDocument;
  warnings: string[];
  references: StoredReference[];
}

export function loadDocument(id: string): LoadedProject {
  const dir = projectDir(id);
  const manifest = dir.exists ? readManifest(dir) : null;
  if (!manifest) throw new Error(DAMAGED);
  const layersDir = new Directory(dir, LAYERS_DIR);
  const result = deserializeDocument(manifest, (name) => {
    const file = new File(layersDir, name);
    return file.exists ? file.bytesSync() : null;
  });
  if (result.warnings.length === 0) result.doc.markSaved(result.doc.getContentVersion());
  return { ...result, references: storedReferences(dir, manifest) };
}

// ---- editing sessions (crash detection) ----------------------------------------------------

/**
 * Marks a project as open in the editor. If the previous session's marker is still there, the
 * app ended while editing in the foreground (crash or force-quit); returns the time of that
 * session's last successful save so the UI can say what was recovered. The editor removes the
 * marker whenever the app is backgrounded (after saving), so the OS reclaiming a backgrounded
 * app is not reported as a crash.
 */
export function beginEditingSession(id: string): number | null {
  const marker = new File(projectDir(id), SESSION_MARKER);
  let lastSavedAt: number | null = null;
  if (marker.exists) {
    try {
      const parsed = JSON.parse(marker.textSync()) as { savedAt?: unknown };
      const t = Date.parse(String(parsed.savedAt));
      lastSavedAt = Number.isFinite(t) ? t : Date.now();
    } catch {
      lastSavedAt = Date.now();
    }
  }
  touchEditingSession(id);
  return lastSavedAt;
}

/** (Re)writes the session marker, recording the time of the last successful save. */
export function touchEditingSession(id: string, savedAt = Date.now()): void {
  try {
    const dir = projectDir(id);
    if (dir.exists) writeFileAtomic(dir, SESSION_MARKER, JSON.stringify({ savedAt: new Date(savedAt).toISOString() }));
  } catch (error) {
    console.warn('[projects] Could not write session marker', error);
  }
}

export function endEditingSession(id: string): void {
  const marker = new File(projectDir(id), SESSION_MARKER);
  if (marker.exists) safeDelete(marker);
}

// ---- reference images ----------------------------------------------------------------------

function storedReferences(dir: Directory, manifest: ProjectManifest): StoredReference[] {
  const assets = new Directory(dir, ASSETS_DIR);
  return manifest.references.flatMap((r) => {
    const file = new File(assets, r.file);
    return file.exists ? [{ file: r.file, uri: file.uri, aspect: r.aspect }] : [];
  });
}

/**
 * Copies picked images into the project's assets and adds them to its reference images (kept
 * with the artwork, never part of it or its exports). Returns all references afterwards; images
 * beyond MAX_REFERENCES are not added.
 */
export function addReferenceImages(id: string, sources: readonly { uri: string; aspect: number }[]): StoredReference[] {
  const dir = projectDir(id);
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(DAMAGED);
  const assets = new Directory(dir, ASSETS_DIR);
  assets.create({ idempotent: true });
  const room = Math.max(0, MAX_REFERENCES - manifest.references.length);
  const added: ManifestReference[] = [];
  for (const [i, s] of sources.slice(0, room).entries()) {
    const source = new File(s.uri);
    const ext = /^\.[a-z0-9]{1,5}$/i.test(source.extension) ? source.extension.toLowerCase() : '.jpg';
    const name = `ref-${Date.now()}-${i}${ext}`;
    writeFileAtomic(assets, name, source.bytesSync());
    added.push({ file: name, aspect: s.aspect > 0 && Number.isFinite(s.aspect) ? s.aspect : 1 });
  }
  const next = { ...manifest, references: [...manifest.references, ...added] };
  writeManifest(dir, next);
  return storedReferences(dir, next);
}

/** Removes one reference image (by its `file` id) from the project. */
export function removeReferenceImage(id: string, file: string): void {
  const dir = projectDir(id);
  const manifest = readManifest(dir);
  if (!manifest) return;
  const references = manifest.references.filter((r) => r.file !== file);
  if (references.length === manifest.references.length) return;
  writeManifest(dir, { ...manifest, references });
  collectGarbage(dir);
}

export function clearReferenceImages(id: string): void {
  const dir = projectDir(id);
  const manifest = readManifest(dir);
  if (!manifest || manifest.references.length === 0) return;
  writeManifest(dir, { ...manifest, references: [] });
  collectGarbage(dir);
}

// ---- project management --------------------------------------------------------------------

export function renameProject(id: string, name: string): void {
  patchManifest(projectDir(id), { name });
}

export function moveProject(id: string, folderId: string | null): void {
  patchManifest(projectDir(id), { folderId });
}

/** Copies an artwork (all layers) into a new project and returns the new id. */
export function duplicateProject(id: string): string {
  const src = projectDir(id);
  const manifest = readManifest(src);
  if (!manifest) throw new Error(DAMAGED);
  const newId = createId('p_');
  // Destination must not exist: the file system then copies to exactly this path.
  const dest = new Directory(projectsRoot(), newId);
  src.copySync(dest);
  const marker = new File(dest, SESSION_MARKER);
  if (marker.exists) marker.delete();
  const now = new Date().toISOString();
  writeManifest(dest, { ...manifest, id: newId, name: `${manifest.name} copy`, createdAt: now, updatedAt: now });
  return newId;
}

/** Detaches every project (live and trashed) from a collection that is being deleted. */
export function clearFolder(folderId: string): void {
  for (const root of [projectsRoot(), trashRoot()]) {
    for (const entry of root.list()) {
      if (!(entry instanceof Directory)) continue;
      const manifest = readManifest(entry);
      if (manifest?.folderId === folderId) writeManifest(entry, { ...manifest, folderId: null });
    }
  }
}

// ---- Recently Deleted ----------------------------------------------------------------------

export function moveToTrash(id: string): void {
  const src = projectDir(id);
  if (!src.exists) return;
  const dest = trashDir(id);
  if (dest.exists) dest.delete();
  src.moveSync(dest);
  const marker = new File(dest, TRASH_MARKER);
  marker.create({ overwrite: true });
  marker.writeSync(JSON.stringify({ deletedAt: new Date().toISOString() }));
}

function readDeletedAt(dir: Directory): number {
  const marker = new File(dir, TRASH_MARKER);
  try {
    if (marker.exists) {
      const parsed = JSON.parse(marker.textSync()) as { deletedAt?: unknown };
      const t = typeof parsed.deletedAt === 'string' ? Date.parse(parsed.deletedAt) : NaN;
      if (Number.isFinite(t)) return t;
    }
  } catch (error) {
    console.warn('[trash] Unreadable marker in', dir.name, error);
  }
  return Date.now();
}

/** Lists Recently Deleted and permanently removes entries past the retention period. */
export function listTrash(): TrashedProject[] {
  const now = Date.now();
  const out: TrashedProject[] = [];
  for (const entry of trashRoot().list()) {
    if (!(entry instanceof Directory)) continue;
    const deletedAt = readDeletedAt(entry);
    const expiresAt = deletedAt + TRASH_RETENTION_DAYS * DAY_MS;
    if (expiresAt <= now) {
      safeDeleteDir(entry);
      continue;
    }
    // An unreadable entry is kept until it expires, like any other deleted artwork.
    const manifest = readManifest(entry);
    if (!manifest) continue;
    out.push({ ...toSummary(entry, manifest), deletedAt, expiresAt });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Moves a trashed artwork back. Drops its collection if that collection no longer exists. */
export function restoreProject(id: string, existingFolderIds: ReadonlySet<string>): void {
  const src = trashDir(id);
  if (!src.exists) throw new Error('This artwork is no longer in Recently Deleted.');
  const dest = projectDir(id);
  if (dest.exists) throw new Error('An artwork with the same id already exists.');
  const manifest = readManifest(src);
  if (manifest?.folderId && !existingFolderIds.has(manifest.folderId)) {
    writeManifest(src, { ...manifest, folderId: null });
  }
  const marker = new File(src, TRASH_MARKER);
  if (marker.exists) marker.delete();
  src.moveSync(dest);
}

export function deleteProjectPermanently(id: string): void {
  const dir = trashDir(id);
  if (dir.exists) dir.delete();
}

export function emptyTrash(): void {
  for (const entry of trashRoot().list()) {
    if (entry instanceof Directory) safeDeleteDir(entry);
  }
}

// ---- utils ---------------------------------------------------------------------------------

function safeDelete(file: File): void {
  try {
    file.delete();
  } catch (error) {
    console.warn('[projects] Failed to delete', file.uri, error);
  }
}

export function safeDeleteDir(dir: Directory): void {
  try {
    dir.delete();
  } catch (error) {
    console.warn('[projects] Failed to delete', dir.uri, error);
  }
}
