import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { GallerySort, GalleryView } from '@/features/gallery/galleryQuery';
import type { RulerKind } from '@/engine/input/rulers';
import type { BackupFolder } from '@/storage/backupService';
import { fileStateStorage } from '@/storage/settingsStorage';
import type { ThemePreference } from '@/ui/theme';

export type PressureCurve = 'soft' | 'linear' | 'firm';
const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system'];
const CURVES: readonly PressureCurve[] = ['soft', 'linear', 'firm'];
/** Upper bound for the global stabiliser; beyond this strokes lag too far behind the pen. */
export const MAX_STABILIZATION = 0.9;
export const MAX_WATERMARK_LENGTH = 40;

/** Default strength (0..1) of the on-canvas stabiliser. */
export const DEFAULT_STABILIZER_STRENGTH = 0.5;

const clampStrength = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_STABILIZER_STRENGTH;
const clampStabilization = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_STABILIZATION, Math.max(0, v)) : 0;
const isBackground = (v: unknown): v is string => v === 'transparent' || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));

export interface GuideSettings {
  grid: boolean;
  /** Grid cell size in canvas pixels. */
  gridSize: number;
  thirds: boolean;
  center: boolean;
  /** Horizontal guide lines, as fractions (0..1) of the canvas height. */
  horizontal: number[];
  /** Vertical guide lines, as fractions (0..1) of the canvas width. */
  vertical: number[];
  /** Line opacity 0.1..1. */
  opacity: number;
  /** Perspective guide: number of vanishing points (0 = off). */
  perspective: PerspectiveMode;
  /**
   * Vanishing points as fractions of the canvas (may lie outside it, as they often do). All three
   * are kept; 1-point uses the first, 2-point the first two.
   */
  vanishing: { x: number; y: number }[];
  /** Strokes lock onto the perspective line closest to the direction they start in. */
  perspectiveSnap: boolean;
  /** Drawing ruler; its two points are fractions of the canvas (see engine/input/rulers). */
  ruler: RulerSettings;
}

export interface RulerSettings {
  kind: RulerKind;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const DEFAULT_RULER: RulerSettings = { kind: 'off', ax: 0.3, ay: 0.5, bx: 0.7, by: 0.5 };
const RULER_KINDS: readonly RulerKind[] = ['off', 'line', 'parallel', 'ellipse', 'radial'];

export type PerspectiveMode = 0 | 1 | 2 | 3;

/** Starting vanishing points: centre for 1-point, either side of the horizon, then below. */
export const DEFAULT_VANISHING: readonly { x: number; y: number }[] = [
  { x: 0.5, y: 0.4 },
  { x: 1.25, y: 0.4 },
  { x: 0.5, y: 1.8 },
];

const DEFAULT_GUIDES: GuideSettings = {
  grid: false,
  gridSize: 128,
  thirds: false,
  center: false,
  horizontal: [],
  vertical: [],
  opacity: 0.55,
  perspective: 0,
  vanishing: DEFAULT_VANISHING.map((v) => ({ ...v })),
  perspectiveSnap: false,
  ruler: DEFAULT_RULER,
};

/** Keeps persisted guide settings valid even if the file was written by an older version. */
function sanitizeGuides(g: Partial<GuideSettings> | undefined): GuideSettings {
  const merged = { ...DEFAULT_GUIDES, ...g };
  const fractions = (v: unknown) =>
    Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && n >= 0 && n <= 1).slice(0, 12) : [];
  return {
    ...merged,
    horizontal: fractions(merged.horizontal),
    vertical: fractions(merged.vertical),
    opacity: Math.min(1, Math.max(0.1, typeof merged.opacity === 'number' ? merged.opacity : DEFAULT_GUIDES.opacity)),
    perspective: ([0, 1, 2, 3] as const).includes(merged.perspective) ? merged.perspective : 0,
    vanishing: DEFAULT_VANISHING.map((d, i) => {
      const v = Array.isArray(merged.vanishing) ? merged.vanishing[i] : undefined;
      const coord = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(4, Math.max(-3, n)) : fallback);
      return { x: coord(v?.x, d.x), y: coord(v?.y, d.y) };
    }),
    perspectiveSnap: merged.perspectiveSnap === true,
    ruler: sanitizeRuler(merged.ruler),
  };
}

function sanitizeRuler(raw: unknown): RulerSettings {
  const r = (raw ?? {}) as Partial<RulerSettings>;
  const coord = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(3, Math.max(-2, n)) : fallback);
  return {
    kind: RULER_KINDS.includes(r.kind as RulerKind) ? (r.kind as RulerKind) : 'off',
    ax: coord(r.ax, DEFAULT_RULER.ax),
    ay: coord(r.ay, DEFAULT_RULER.ay),
    bx: coord(r.bx, DEFAULT_RULER.bx),
    by: coord(r.by, DEFAULT_RULER.by),
  };
}

/** App-wide preferences. Persisted locally. */
interface SettingsState {
  /** Palm rejection: only stylus input paints, a single finger pans the canvas. */
  stylusOnlyDrawing: boolean;
  /** Autosave interval while editing, in seconds (0 disables timed autosave). */
  autosaveSeconds: number;
  gallerySort: GallerySort;
  galleryView: GalleryView;
  /** Mirrors the editor tool rail to the right edge. */
  leftHanded: boolean;
  guides: GuideSettings;
  /** Press and hold on the canvas to pick a colour. */
  eyedropperHold: boolean;
  /** Hold duration before the eyedropper engages, ms. */
  eyedropperDelayMs: number;
  /** Quick tap with two fingers on the canvas undoes. */
  twoFingerTapUndo: boolean;
  /** Quick tap with three fingers on the canvas redoes. */
  threeFingerTapRedo: boolean;
  theme: ThemePreference;
  /** Smaller toolbars and controls, leaving more room for the canvas. */
  compactUi: boolean;
  /** Paper colour preselected for new artwork: '#rrggbb' or 'transparent'. */
  defaultBackground: string;
  /** Two-finger rotation of the canvas view. */
  rotationEnabled: boolean;
  /** Global stabiliser (0..MAX_STABILIZATION) added on top of each brush's own smoothing. */
  stabilization: number;
  /** Stabiliser: the brush glides after the finger over time, smoothing lines and curves. */
  stabilizer: boolean;
  /** How slowly the brush follows, 0..1. */
  stabilizerStrength: number;
  /** On lift, finish the glide at once so the stroke ends where the finger was. */
  stabilizerFinish: boolean;
  /** How stylus pressure maps to brush dynamics. */
  pressureCurve: PressureCurve;
  /** Simulate pressure from stroke speed for fingers / styluses without pressure. */
  simulatePressure: boolean;
  /** Once a stylus touches the canvas, fingers and palms navigate instead of painting. */
  autoPalmRejection: boolean;
  /** Record a timelapse of each artwork (changed areas only). */
  recordTimelapse: boolean;
  /** Last watermark text used for timelapse exports. */
  timelapseWatermark: string;
  /** Where "Save .zumi file" writes; null = the app's own "Zumi Backups" folder. */
  backupFolder: BackupFolder | null;
  /** Hold the pen still at the end of a stroke to turn it into a clean shape. */
  quickShape: boolean;
  /** How long to hold before the shape snaps, ms. */
  quickShapeDelayMs: number;
  /** The welcome tips were shown (or dismissed). */
  onboardingSeen: boolean;
  setQuickShape: (value: boolean) => void;
  setQuickShapeDelayMs: (value: number) => void;
  setOnboardingSeen: (value: boolean) => void;
  setStylusOnlyDrawing: (value: boolean) => void;
  setAutosaveSeconds: (value: number) => void;
  setGallerySort: (value: GallerySort) => void;
  setGalleryView: (value: GalleryView) => void;
  setLeftHanded: (value: boolean) => void;
  updateGuides: (patch: Partial<GuideSettings>) => void;
  setEyedropperHold: (value: boolean) => void;
  setEyedropperDelayMs: (value: number) => void;
  setTwoFingerTapUndo: (value: boolean) => void;
  setThreeFingerTapRedo: (value: boolean) => void;
  setTheme: (value: ThemePreference) => void;
  setCompactUi: (value: boolean) => void;
  setDefaultBackground: (value: string) => void;
  setRotationEnabled: (value: boolean) => void;
  setStabilization: (value: number) => void;
  setStabilizer: (value: boolean) => void;
  setStabilizerStrength: (value: number) => void;
  setStabilizerFinish: (value: boolean) => void;
  setPressureCurve: (value: PressureCurve) => void;
  setSimulatePressure: (value: boolean) => void;
  setAutoPalmRejection: (value: boolean) => void;
  setRecordTimelapse: (value: boolean) => void;
  setTimelapseWatermark: (value: string) => void;
  setBackupFolder: (value: BackupFolder | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      stylusOnlyDrawing: false,
      autosaveSeconds: 30,
      gallerySort: 'updated',
      galleryView: 'grid',
      leftHanded: false,
      guides: DEFAULT_GUIDES,
      eyedropperHold: true,
      eyedropperDelayMs: 450,
      twoFingerTapUndo: true,
      threeFingerTapRedo: true,
      theme: 'dark',
      compactUi: false,
      defaultBackground: '#ffffff',
      rotationEnabled: true,
      stabilization: 0,
      stabilizer: false,
      stabilizerStrength: DEFAULT_STABILIZER_STRENGTH,
      stabilizerFinish: true,
      pressureCurve: 'linear',
      simulatePressure: true,
      autoPalmRejection: true,
      recordTimelapse: true,
      timelapseWatermark: '',
      backupFolder: null,
      quickShape: true,
      quickShapeDelayMs: 600,
      onboardingSeen: false,
      setQuickShape: (quickShape) => set({ quickShape }),
      setQuickShapeDelayMs: (value) => set({ quickShapeDelayMs: Math.min(1500, Math.max(250, value)) }),
      setOnboardingSeen: (onboardingSeen) => set({ onboardingSeen }),
      setStylusOnlyDrawing: (stylusOnlyDrawing) => set({ stylusOnlyDrawing }),
      setAutosaveSeconds: (autosaveSeconds) => set({ autosaveSeconds: Math.max(0, autosaveSeconds) }),
      setGallerySort: (gallerySort) => set({ gallerySort }),
      setGalleryView: (galleryView) => set({ galleryView }),
      setLeftHanded: (leftHanded) => set({ leftHanded }),
      updateGuides: (patch) => set((s) => ({ guides: sanitizeGuides({ ...s.guides, ...patch }) })),
      setEyedropperHold: (eyedropperHold) => set({ eyedropperHold }),
      setEyedropperDelayMs: (value) => set({ eyedropperDelayMs: Math.min(1500, Math.max(200, value)) }),
      setTwoFingerTapUndo: (twoFingerTapUndo) => set({ twoFingerTapUndo }),
      setThreeFingerTapRedo: (threeFingerTapRedo) => set({ threeFingerTapRedo }),
      setTheme: (theme) => set({ theme }),
      setCompactUi: (compactUi) => set({ compactUi }),
      setDefaultBackground: (value) => {
        if (isBackground(value)) set({ defaultBackground: value.toLowerCase() });
      },
      setRotationEnabled: (rotationEnabled) => set({ rotationEnabled }),
      setStabilization: (value) => set({ stabilization: clampStabilization(value) }),
      setStabilizer: (stabilizer) => set({ stabilizer }),
      setStabilizerStrength: (value) => set({ stabilizerStrength: clampStrength(value) }),
      setStabilizerFinish: (stabilizerFinish) => set({ stabilizerFinish }),
      setPressureCurve: (pressureCurve) => set({ pressureCurve }),
      setSimulatePressure: (simulatePressure) => set({ simulatePressure }),
      setAutoPalmRejection: (autoPalmRejection) => set({ autoPalmRejection }),
      setRecordTimelapse: (recordTimelapse) => set({ recordTimelapse }),
      setTimelapseWatermark: (value) => set({ timelapseWatermark: value.slice(0, MAX_WATERMARK_LENGTH) }),
      setBackupFolder: (backupFolder) => set({ backupFolder }),
    }),
    {
      name: 'zumi.settings',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          guides: sanitizeGuides(p.guides),
          theme: THEMES.includes(p.theme as ThemePreference) ? (p.theme as ThemePreference) : current.theme,
          pressureCurve: CURVES.includes(p.pressureCurve as PressureCurve) ? (p.pressureCurve as PressureCurve) : current.pressureCurve,
          stabilization: clampStabilization(p.stabilization),
          stabilizer: p.stabilizer === true,
          stabilizerStrength: clampStrength(p.stabilizerStrength),
          stabilizerFinish: p.stabilizerFinish !== false,
          defaultBackground: isBackground(p.defaultBackground) ? p.defaultBackground : current.defaultBackground,
          recordTimelapse: typeof p.recordTimelapse === 'boolean' ? p.recordTimelapse : current.recordTimelapse,
          timelapseWatermark:
            typeof p.timelapseWatermark === 'string' ? p.timelapseWatermark.slice(0, MAX_WATERMARK_LENGTH) : current.timelapseWatermark,
          backupFolder:
            p.backupFolder && typeof p.backupFolder.uri === 'string' && typeof p.backupFolder.name === 'string'
              ? { uri: p.backupFolder.uri, name: p.backupFolder.name }
              : null,
          quickShape: p.quickShape !== false,
          quickShapeDelayMs:
            typeof p.quickShapeDelayMs === 'number' ? Math.min(1500, Math.max(250, p.quickShapeDelayMs)) : current.quickShapeDelayMs,
          onboardingSeen: p.onboardingSeen === true,
        };
      },
      storage: createJSONStorage(() => fileStateStorage),
      partialize: ({
        stylusOnlyDrawing,
        autosaveSeconds,
        gallerySort,
        galleryView,
        leftHanded,
        guides,
        eyedropperHold,
        eyedropperDelayMs,
        twoFingerTapUndo,
        threeFingerTapRedo,
        theme,
        compactUi,
        defaultBackground,
        rotationEnabled,
        stabilization,
        stabilizer,
        stabilizerStrength,
        stabilizerFinish,
        pressureCurve,
        simulatePressure,
        autoPalmRejection,
        recordTimelapse,
        timelapseWatermark,
        backupFolder,
        quickShape,
        quickShapeDelayMs,
        onboardingSeen,
      }) => ({
        quickShape,
        quickShapeDelayMs,
        onboardingSeen,
        stabilizer,
        stabilizerStrength,
        stabilizerFinish,
        theme,
        compactUi,
        defaultBackground,
        rotationEnabled,
        stabilization,
        pressureCurve,
        simulatePressure,
        autoPalmRejection,
        recordTimelapse,
        timelapseWatermark,
        backupFolder,
        twoFingerTapUndo,
        threeFingerTapRedo,
        eyedropperHold,
        eyedropperDelayMs,
        leftHanded,
        guides,
        stylusOnlyDrawing,
        autosaveSeconds,
        gallerySort,
        galleryView,
      }),
    },
  ),
);
