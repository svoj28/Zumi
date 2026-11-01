import { Skia } from '@shopify/react-native-skia';

import { normalizePreset, type BrushPreset } from '@/engine/brush/brushPreset';
import { BASE_PRESET } from '@/engine/brush/builtInBrushes';
import { DEFAULT_DPI, DrawingDocument, MAX_CANVAS_SIDE, MIN_CANVAS_SIDE, sanitizeAnimation } from '@/engine/document/DrawingDocument';
import { RasterLayer } from '@/engine/layers/RasterLayer';
import { LAYER_BLEND_MODES } from '@/engine/render/blendModes';
import type { AnimationSettings, LayerGroupMeta, LayerMeta } from '@/engine/types';
import { parseVectorDoc, type VectorDoc } from '@/engine/vector/vectorModel';

/**
 * On-disk project format. A project is a directory:
 *
 *   project.json             ← ProjectManifest (written last, atomically)
 *   thumbnail-<n>.jpg        ← gallery preview
 *   layers/<id>-r<rev>.png   ← one lossless PNG per layer; the revision in the name lets saves
 *                               skip layers whose pixels have not changed since the last save
 *   assets/<name>            ← reference images (never part of the artwork or its exports)
 *
 * Versions:
 *   1 — initial format
 *   2 — adds `appVersion`, `brushes` (brushes the artwork was painted with) and `references`
 *   3 — adds layer `clip`, `mask`, `reference` and `groupId`, plus `groups` (layer folders) and
 *       `animation` (frame-by-frame settings)
 *
 * Older manifests are upgraded step by step by `migrateManifest`, so every later reader only
 * deals with the current shape. Files written by a newer app version are refused rather than
 * guessed at.
 *
 * This module is pure serialization — reading/writing files is done by `src/storage`.
 */

export const PROJECT_FORMAT = 'zumi.project';
export const PROJECT_FORMAT_VERSION = 3;

export interface ManifestLayer extends LayerMeta {
  revision: number;
  file: string;
  /** Shapes of a vector layer (its PNG is their rendering, so older versions still show it). */
  vector?: VectorDoc;
}

/** A floating reference image stored in the project's `assets/` directory. */
export interface ManifestReference {
  /** File name inside `assets/`. */
  file: string;
  /** width / height */
  aspect: number;
}

export interface ProjectManifest {
  format: typeof PROJECT_FORMAT;
  version: number;
  /** Version of the app that wrote the file (diagnostics only). */
  appVersion: string | null;
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  dpi: number;
  /** ISO-8601 UTC */
  createdAt: string;
  /** ISO-8601 UTC */
  updatedAt: string;
  activeLayerId: string | null;
  thumbnail: string | null;
  /** Gallery collection this artwork belongs to (null = none). */
  folderId: string | null;
  /** Bottom → top. */
  layers: ManifestLayer[];
  /** Brushes used on this artwork, least → most recently used. */
  brushes: BrushPreset[];
  references: ManifestReference[];
  /** Per-artwork timelapse recording; null (or absent in older files) follows the app default. */
  recordTimelapse: boolean | null;
  /** Layer groups (folders) referenced by layers' `groupId`. */
  groups: LayerGroupMeta[];
  /** Frame-by-frame animation settings; null when never set. */
  animation: AnimationSettings | null;
}

/** Project-level data the editor does not own but a save must keep. */
export interface ManifestExtras {
  appVersion: string | null;
  thumbnail: string | null;
  folderId: string | null;
  references: ManifestReference[];
}

export function layerFileName(layer: RasterLayer): string {
  return `${layer.meta.id}-r${layer.revision}.png`;
}

export function buildManifest(doc: DrawingDocument, extras: ManifestExtras): ProjectManifest {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    appVersion: extras.appVersion,
    id: doc.info.id,
    name: doc.info.name,
    width: doc.info.width,
    height: doc.info.height,
    background: doc.info.background,
    dpi: doc.info.dpi,
    createdAt: new Date(doc.info.createdAt).toISOString(),
    updatedAt: new Date(doc.info.updatedAt).toISOString(),
    activeLayerId: doc.layers.activeId,
    thumbnail: extras.thumbnail,
    folderId: extras.folderId,
    layers: doc.layers.list.map((layer) => ({
      ...layer.meta,
      revision: layer.revision,
      file: layerFileName(layer),
      ...(layer.vector ? { vector: layer.vector } : {}),
    })),
    brushes: [...doc.brushesUsed.values()],
    references: extras.references,
    recordTimelapse: doc.info.recordTimelapse,
    // Only groups that still have layers.
    groups: [...doc.groups.values()].filter((g) => doc.layers.list.some((l) => l.meta.groupId === g.id)),
    animation: doc.animation,
  };
}

export class ManifestError extends Error {}

/** The validated `vector` field of a layer entry, or nothing for raster layers / bad data. */
function vectorField(raw: unknown): { vector?: VectorDoc } {
  if (raw === undefined) return {};
  const vector = parseVectorDoc(raw);
  return vector ? { vector } : {};
}

type RawManifest = Record<string, unknown>;

/**
 * Upgrade steps, keyed by the version they upgrade *from*. Each step must be pure and only
 * add or reshape fields; validation happens once, after the last step.
 */
const MIGRATIONS: Record<number, (m: RawManifest) => RawManifest> = {
  1: (m) => ({ ...m, version: 2, appVersion: null, brushes: [], references: [] }),
  2: (m) => ({ ...m, version: 3, groups: [], animation: null }),
};

/** Upgrades an older manifest to PROJECT_FORMAT_VERSION. Throws for unknown/newer versions. */
export function migrateManifest(raw: RawManifest): RawManifest {
  let m = raw;
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) {
    throw new ManifestError(`Unknown project version ${String(m.version)}`);
  }
  let version: number = m.version;
  if (version > PROJECT_FORMAT_VERSION) {
    throw new ManifestError('This artwork was saved by a newer version of Zumi. Update the app to open it.');
  }
  while (version < PROJECT_FORMAT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ManifestError(`No upgrade path from project version ${version}`);
    m = step(m);
    version = m.version as number;
  }
  return m;
}

/** Validates (and migrates) untrusted JSON into a manifest. Throws ManifestError on invalid data. */
export function parseManifest(raw: unknown): ProjectManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ManifestError('Manifest is not an object');
  if ((raw as RawManifest).format !== PROJECT_FORMAT) throw new ManifestError('Not a Zumi project');
  const m = migrateManifest(raw as RawManifest) as Partial<Record<keyof ProjectManifest, unknown>>;

  if (typeof m.id !== 'string' || !isSafeName(m.id)) throw new ManifestError('Missing or invalid id');
  if (!isSide(m.width) || !isSide(m.height)) throw new ManifestError('Invalid canvas size');
  if (!Array.isArray(m.layers) || m.layers.length === 0) throw new ManifestError('No layers');

  const seen = new Set<string>();
  const layers: ManifestLayer[] = m.layers.map((raw: unknown, i) => {
    const l = (raw ?? {}) as Partial<ManifestLayer>;
    if (typeof l.id !== 'string' || typeof l.file !== 'string' || !isSafeName(l.file) || seen.has(l.id)) {
      throw new ManifestError(`Invalid layer at index ${i}`);
    }
    seen.add(l.id);
    return {
      id: l.id,
      name: typeof l.name === 'string' ? l.name : `Layer ${i + 1}`,
      visible: l.visible !== false,
      opacity: clamp01(typeof l.opacity === 'number' ? l.opacity : 1),
      blendMode: l.blendMode && LAYER_BLEND_MODES.includes(l.blendMode) ? l.blendMode : 'srcOver',
      locked: l.locked === true,
      alphaLocked: l.alphaLocked === true,
      ...(l.clip === true ? { clip: true } : {}),
      ...(l.mask === true ? { mask: true } : {}),
      ...(l.reference === true ? { reference: true } : {}),
      ...(typeof l.groupId === 'string' && l.groupId ? { groupId: l.groupId } : {}),
      revision: typeof l.revision === 'number' && Number.isInteger(l.revision) && l.revision >= 0 ? l.revision : 0,
      file: l.file,
      ...vectorField(l.vector),
      // Projects saved with the former animated brushes may still list an `animated` field: it is
      // ignored, and those layers load as ordinary layers showing their saved (first) frame.
    };
  });

  const brushes = (Array.isArray(m.brushes) ? m.brushes : [])
    .filter((b: unknown) => !!b && typeof (b as { id?: unknown }).id === 'string')
    .map((b: unknown) => normalizePreset(b, BASE_PRESET));

  const references = (Array.isArray(m.references) ? m.references : []).flatMap((raw: unknown): ManifestReference[] => {
    const r = (raw ?? {}) as Partial<ManifestReference>;
    if (typeof r.file !== 'string' || !isSafeName(r.file)) return [];
    const aspect = typeof r.aspect === 'number' && r.aspect > 0 && Number.isFinite(r.aspect) ? r.aspect : 1;
    return [{ file: r.file, aspect }];
  });

  const groups = (Array.isArray(m.groups) ? m.groups : []).flatMap((raw: unknown): LayerGroupMeta[] => {
    const g = (raw ?? {}) as Partial<LayerGroupMeta>;
    if (typeof g.id !== 'string' || !g.id) return [];
    return [
      {
        id: g.id,
        name: typeof g.name === 'string' && g.name ? g.name : 'Group',
        visible: g.visible !== false,
        opacity: clamp01(typeof g.opacity === 'number' ? g.opacity : 1),
        blendMode: g.blendMode && LAYER_BLEND_MODES.includes(g.blendMode) ? g.blendMode : 'srcOver',
        collapsed: g.collapsed === true,
      },
    ];
  });
  const animation = m.animation && typeof m.animation === 'object' ? sanitizeAnimation(m.animation as Partial<AnimationSettings>) : null;

  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    appVersion: typeof m.appVersion === 'string' ? m.appVersion : null,
    id: m.id,
    name: typeof m.name === 'string' && m.name ? m.name : 'Untitled',
    width: m.width,
    height: m.height,
    background: typeof m.background === 'string' ? m.background : '#ffffff',
    dpi: typeof m.dpi === 'number' && m.dpi >= 1 && m.dpi <= 2400 ? m.dpi : DEFAULT_DPI,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : now,
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : now,
    activeLayerId: typeof m.activeLayerId === 'string' ? m.activeLayerId : null,
    recordTimelapse: typeof m.recordTimelapse === 'boolean' ? m.recordTimelapse : null,
    thumbnail: typeof m.thumbnail === 'string' && isSafeName(m.thumbnail) ? m.thumbnail : null,
    folderId: typeof m.folderId === 'string' ? m.folderId : null,
    layers,
    brushes,
    references,
    groups,
    animation,
  };
}

/**
 * Rebuilds a document from a manifest. `readLayer` returns encoded PNG bytes or null; a
 * missing or corrupt layer file yields an empty layer instead of failing the whole project.
 */
export function deserializeDocument(
  manifest: ProjectManifest,
  readLayer: (file: string) => Uint8Array | null,
): { doc: DrawingDocument; warnings: string[] } {
  const warnings: string[] = [];
  const doc = new DrawingDocument({
    id: manifest.id,
    name: manifest.name,
    width: manifest.width,
    height: manifest.height,
    background: manifest.background,
    dpi: manifest.dpi,
    createdAt: Date.parse(manifest.createdAt) || Date.now(),
    updatedAt: Date.parse(manifest.updatedAt) || Date.now(),
    recordTimelapse: manifest.recordTimelapse,
  });

  for (const entry of manifest.layers) {
    const { revision, file, vector, ...meta } = entry;
    const layer = RasterLayer.create(meta, manifest.width, manifest.height, revision);
    // The PNG already shows the shapes; keep them so the layer stays editable as vector.
    if (vector) layer.vector = vector;
    const bytes = readLayer(file);
    const image = bytes ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes)) : null;
    if (image) {
      layer.loadImage(image);
      image.dispose();
    } else {
      warnings.push(`Layer "${meta.name}" could not be read and was left empty.`);
      // Force a re-save so the manifest stops pointing at the broken file.
      layer.revision = revision + 1;
    }
    doc.restoreLayer(layer);
  }
  for (const brush of manifest.brushes) doc.noteBrush(brush);
  doc.restoreStructure(manifest.groups, manifest.animation);

  doc.layers.activeId =
    manifest.activeLayerId && doc.layers.get(manifest.activeLayerId)
      ? manifest.activeLayerId
      : (doc.layers.list[doc.layers.count - 1]?.meta.id ?? null);
  return { doc, warnings };
}

/** A plain file/id name: no path separators or traversal, so it can never escape its directory. */
export function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..');
}

function isSide(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_CANVAS_SIDE && v <= MAX_CANVAS_SIDE;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
