import {
  BlendMode,
  Blur,
  Canvas,
  Circle,
  ClipOp,
  ColorMatrix,
  DashPathEffect,
  Fill,
  FilterMode,
  Group,
  Image,
  ImageShader,
  MipmapMode,
  Paint,
  Patch,
  Path,
  PathOp,
  Picture,
  Rect,
  rect,
  Shader,
  Skia,
  TileMode,
  vec,
  Vertices,
  type SkColor,
  type SkImage,
  type SkPaint,
  type SkPath,
  type SkPathBuilder,
  type SkPicture,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { recognizeShape } from '@/engine/brush/quickShape';
import { shapeLabel, shapeSamples, type ShapeKind } from '@/engine/brush/shapes';
import { appendAtlas, blendSigma, colorToRgb } from '@/engine/brush/stampRenderer';
import {
  replayStroke,
  strokeAdd,
  strokeBegin,
  strokeTail,
  type StrokePathState,
} from '@/engine/brush/strokeInterpolator';
import { applySymmetry, symmetryAxes, type Symmetry, type SymmetryMode } from '@/engine/brush/symmetry';
import { getTextureImage, getTipImage, textureMatrix, TIP_SIZE } from '@/engine/brush/tips';
import type { DrawingDocument, SelectionMode, TransformSession } from '@/engine/document/DrawingDocument';
import { distanceToLine, rulerHandles, rulerPath, rulerSnap, type RulerGeometry } from '@/engine/input/rulers';
import {
  createSmoothingState,
  createSpeedPressureState,
  hasRealPressure,
  nowMs,
  resolvePressure,
  followStep,
  smoothSample,
  updateSpeedPressure,
  type SmoothingState,
  type SpeedPressureState,
} from '@/engine/input/strokeInput';
import {
  applyFocalGesture,
  canvasToScreen,
  fitTransform,
  interpolateView,
  normalizeAngle,
  screenToCanvas,
  snapRotation,
  uprightTransform,
  type ViewTransform,
} from '@/engine/input/viewTransform';
import {
  composeGesture,
  IDENTITY_TRANSFORM,
  mapPoint,
  transformProp,
  type LayerTransform,
} from '@/engine/layers/layerTransform';
import {
  homography,
  moveMeshPoint,
  patchHandles,
  translateMesh,
  type Mesh,
  type MeshMode,
} from '@/engine/layers/meshWarp';
import { maskMatrix, stackItems, type LayerGroup, type StackItem } from '@/engine/layers/layerGroups';
import { createLiquifyMesh, liquifyIndices, liquifyStep, toPoints } from '@/engine/layers/liquify';
import type { RasterLayer } from '@/engine/layers/RasterLayer';
import { adjustEffect, adjustUniforms, blurSigma, type Adjustment } from '@/engine/render/adjustments';
import { blendModeProp } from '@/engine/render/blendModes';
import { checkerCellFor, getCheckerTile, isTransparentColor } from '@/engine/render/checker';
import { gradientShader, toneGradientEffect, type GradientSpec } from '@/engine/render/gradient';
import { buildGuidesPath, buildPerspectivePath } from '@/engine/render/guides';
import { closestDirection, projectOnLine, snapDirections, vanishingPoints, type Point } from '@/engine/render/perspective';
import { renderLoupe, sampleColor } from '@/engine/render/sampler';
import type { StrokeRecipe } from '@/engine/types';
import { useEyedropperStore } from '@/features/editor/eyedropperStore';
import { useDocumentVersion } from '@/features/editor/useEditorSession';
import { useToolBrush } from '@/state/brushStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useToolStore, type SelectShape } from '@/state/toolStore';
import { colors, themed } from '@/ui/theme';

// Gesture modes (UI thread).
const MODE_IDLE = 0;
const MODE_DRAW = 1;
const MODE_PAN = 2;
const MODE_CANCELLED = 3;
const MODE_SAMPLE = 4;
const MODE_LAYER_MOVE = 5;
const MODE_SELECT = 6;
const MODE_SHAPE = 7;
const MODE_AXIS = 8;
const MODE_HANDLE = 9;
const MODE_VP = 10;
const MODE_MESH_POINT = 11;
const MODE_MESH_MOVE = 12;
const MODE_VECTOR = 13;
const MODE_FILL = 14;
const MODE_GRADIENT = 15;
const MODE_LIQUIFY = 16;
/** A QuickShape snapped: the stroke is now a clean shape, committed on lift. */
const MODE_SNAPPED = 17;
const MODE_RULER = 18;

/** A stroke that starts this close to the line ruler (screen points) follows it. */
const RULER_REACH = 40;
/** Moving less than this (screen points) counts as holding still for QuickShape. */
const QUICKSHAPE_STILL = 5;
const RULER_RGB = '0,184,148';
/** Onion skin tints: earlier frames reddish, later frames greenish. */
const ONION_BEFORE = [1, 0.25, 0.3];
const ONION_AFTER = [0.2, 0.75, 0.35];

// What a two-finger gesture manipulates.
const TARGET_VIEW = 0;
const TARGET_LAYER = 1;

/**
 * Live-stroke chunk size (dabs). Each input event only appends to the current chunk; full chunks
 * are merged into the committed arrays, so per-event cost stays bounded however long the stroke.
 */
const CHUNK_DABS = 600;
/** Lift-off catch-up threshold: append the raw end point if smoothing left it this far behind. */
const CATCH_UP_DISTANCE = 0.75;

export const IDENTITY: ViewTransform = { tx: 0, ty: 0, scale: 1, rotation: 0 };

/**
 * Two-finger rotation only starts once the fingers have turned this far (radians, ~7°), so
 * pinch-zooming does not wobble the canvas. The threshold is subtracted, so there is no jump.
 */
const ROTATION_DEADZONE = 0.12;
/** When a gesture ends this close to a right angle (~6°), the view settles onto it. */
const ROTATION_SNAP = 0.1;
const VIEW_ANIMATION_MS = 260;

/**
 * Multi-finger tap shortcuts: all fingers down and up within TAP_MAX_MS, none moving more
 * than TAP_SLOP points. Anything longer or larger is navigation and never triggers them.
 */
const TAP_MAX_MS = 300;
const TAP_SLOP = 14;

/** Touch radius (screen points) of the symmetry-axis handle and transform-box corners. */
const HANDLE_HIT = 28;
/** Drawn size (screen points) of those handles. */
const HANDLE_SIZE = 12;
/** A shape drag shorter than this (canvas px) is treated as a tap and draws nothing. */
const MIN_SHAPE_DRAG = 2;

const AXIS_COLOR = 'rgba(190,120,255,0.85)';
const PERSPECTIVE_RGB = '255,140,60';
/** A snapped stroke picks its perspective line once it has moved this far (screen points). */
const SNAP_DECIDE = 12;
const STAB_COLOR = 'rgba(64,170,255,0.75)';
/** Smallest stabiliser step (document px) worth painting. */
const STAB_MIN_STEP = 0.25;
/** Lift-off glide: simulated in steps of this many ms, at most this many steps. */
const STAB_FINISH_DT = 16;
const STAB_FINISH_STEPS = 200;
const GUIDE_RGB = '64,170,255';

export type QuickHistoryAction = 'undo' | 'redo';

interface TouchTrack {
  /** Pointer ids currently down. */
  ids: number[];
  /** Start positions as [id, x, y] triplets. */
  starts: number[];
  t0: number;
  maxTouches: number;
  moved: boolean;
  /** Set once the sequence has been judged, so a late event cannot trigger it twice. */
  judged: boolean;
  /** View when the first finger landed, restored if the sequence turns out to be a tap. */
  view: ViewTransform;
}

const newTouchTrack = (): TouchTrack => {
  'worklet';
  return { ids: [], starts: [], t0: 0, maxTouches: 0, moved: false, judged: true, view: IDENTITY };
};

interface FingerPair {
  a: number;
  b: number;
  view: ViewTransform;
  layer: LayerTransform;
  /** Midpoint (screen points), spread and angle of the two fingers when anchored. */
  fx: number;
  fy: number;
  d0: number;
  /** Finger angle at the last update, and the rotation accumulated since anchoring. */
  angle: number;
  turn: number;
  /** Rotation is engaged once past the deadzone; `offset` is the deadzone amount subtracted. */
  rotOn: boolean;
  rotOffset: number;
}

/** Pressure curve exponents: soft reaches full width with a lighter touch, firm needs more force. */
const PRESSURE_EXPONENTS = { soft: 0.6, linear: 1, firm: 1.7 } as const;
/** After a stylus event, multi-touch taps are ignored for this long (a resting palm is not a tap). */
const PEN_TAP_GRACE_MS = 250;

const LOUPE = 112;
const LOUPE_RING = 7;

interface Props {
  doc: DrawingDocument;
  /** Increment to re-fit the artwork to the viewport (animated). */
  fitSignal: number;
  /** Increment to rotate the view back upright around the screen centre (animated). */
  resetRotationSignal: number;
  /** Pending transform of the layer/selection while in transform mode (owned by the editor). */
  layerTransform: SharedValue<LayerTransform>;
  /** The content being transformed (set while in transform mode). */
  transformSession: TransformSession | null;
  /** Transform kind: free (move/scale/rotate), distort (corners) or warp (bent edges). */
  meshMode?: MeshMode;
  /** Distort/warp mesh in canvas coordinates (owned by the editor; see meshWarp). */
  mesh?: SharedValue<Mesh>;
  /**
   * Mirror the *display* left↔right. Purely a viewing aid: the artwork, exports and saved file
   * are untouched, and touches are mapped back so painting still lands under the finger.
   */
  viewMirrored: boolean;
  /** Called once per session when a stylus first touches the canvas (automatic palm rejection). */
  onStylusDetected?: () => void;
  /** Called when the view becomes rotated or upright (to offer "reset rotation"). */
  onRotatedChange: (rotated: boolean) => void;
  /** A multi-finger tap shortcut was recognised. */
  onQuickHistory: (action: QuickHistoryAction) => void;
  /** The Guides panel is open: vanishing points can be dragged on the canvas. */
  editGuides?: boolean;
  /**
   * Vector pen tool: one-finger touches in document coordinates, plus the current view scale
   * (to size hit areas in screen points). Pinch and rotate still move the view.
   */
  onVectorPointer?: (phase: 'begin' | 'move' | 'end', x: number, y: number, viewScale: number) => void;
  /** Pen tool overlay (shape being edited, nodes, handles), in document coordinates. */
  vectorOverlay?: SharedValue<SkPicture>;
  /**
   * The view transform and viewport size, when the editor needs them too (the preview window
   * shows and moves the visible area). Owned here when not given.
   */
  view?: SharedValue<ViewTransform>;
  viewport?: SharedValue<{ w: number; h: number }>;
  /** Live preview of an adjustment or filter on a layer (the adjustments panel). */
  adjustPreview?: { layerId: string; adjustment: Adjustment } | null;
  /** Animation playback: the frame shown instead of the current one (null when not playing). */
  playFrame?: number | null;
  /** Liquify mesh positions (owned by the editor while liquify is open; see engine/layers/liquify). */
  liquifyMesh?: SharedValue<number[]>;
}

/**
 * Renders the document and turns touches into edits.
 *
 * Threading model:
 *  - Gesture callbacks run as worklets on the UI thread. Depending on the interaction mode
 *    they paint, draw shapes, sample colours, transform content, or draw a selection outline —
 *    all previewed without React renders or JS-thread round trips.
 *  - Painting: each input event is timestamped, pressure/tilt are read (or pressure simulated
 *    from speed), the point is smoothed, and the stroke interpolator lays dabs along a
 *    Catmull–Rom spline. Symmetry mirrors those dabs. A provisional tail reaches the raw finger
 *    position so the stroke never visibly lags.
 *  - Finished actions are sent once to the JS thread, where the document applies them and
 *    records undo history.
 *  - Two fingers always navigate the view, except in transform mode where they transform
 *    the content.
 *
 * Coordinates: screen → view (pan/zoom/rotate) → display → document. The display↔document step
 * is the optional view mirror; `toDoc`/`toScreen` apply the whole chain.
 */
export function DrawingCanvas({
  doc,
  fitSignal,
  resetRotationSignal,
  onStylusDetected,
  layerTransform,
  transformSession,
  meshMode = 'free',
  mesh: meshProp,
  viewMirrored,
  onRotatedChange,
  onQuickHistory,
  editGuides = false,
  onVectorPointer,
  vectorOverlay,
  view,
  viewport,
  adjustPreview = null,
  playFrame = null,
  liquifyMesh,
}: Props) {
  const [fillBusy, setFillBusy] = useState(false);
  const version = useDocumentVersion(doc);
  const { width: docW, height: docH, background } = doc.info;

  const tool = useToolStore((s) => s.tool);
  const color = useToolStore((s) => s.color);
  const slotBrush = useToolBrush(tool);
  const alpha = useToolStore((s) => s.alpha);
  // Colour alpha multiplies the brush opacity (the eraser ignores colour entirely).
  const brush = useMemo(
    () => (tool === 'eraser' || alpha >= 1 ? slotBrush : { ...slotBrush, opacity: slotBrush.opacity * alpha }),
    [slotBrush, alpha, tool],
  );
  const tipImage = useMemo(
    () => getTipImage(brush.shape.tip, brush.hardness, brush.shape.roundness, brush.shape.image),
    [brush.shape.tip, brush.hardness, brush.shape.roundness, brush.shape.image],
  );
  const interaction = useToolStore((s) => s.interaction);
  const selectShape = useToolStore((s) => s.selectShape);
  const shapeKind = useToolStore((s) => s.shapeKind);
  const shapeConstrain = useToolStore((s) => s.shapeConstrain);
  const symmetrySettings = useToolStore((s) => s.symmetry);
  const stylusOnly = useSettingsStore((s) => s.stylusOnlyDrawing);
  const holdToSample = useSettingsStore((s) => s.eyedropperHold);
  const holdDelay = useSettingsStore((s) => s.eyedropperDelayMs);
  const guides = useSettingsStore((s) => s.guides);
  const tapUndo = useSettingsStore((s) => s.twoFingerTapUndo);
  const tapRedo = useSettingsStore((s) => s.threeFingerTapRedo);
  const rotationEnabled = useSettingsStore((s) => s.rotationEnabled);
  const stabilization = useSettingsStore((s) => s.stabilization);
  const stabilizerOn = useSettingsStore((s) => s.stabilizer);
  const stabilizerStrength = useSettingsStore((s) => s.stabilizerStrength);
  const stabilizerFinish = useSettingsStore((s) => s.stabilizerFinish);
  const pressureCurve = useSettingsStore((s) => s.pressureCurve);
  const simulatePressure = useSettingsStore((s) => s.simulatePressure);
  const autoPalm = useSettingsStore((s) => s.autoPalmRejection);
  const quickShape = useSettingsStore((s) => s.quickShape);
  const quickShapeDelay = useSettingsStore((s) => s.quickShapeDelayMs);
  const gradientSettings = useToolStore((s) => s.gradient);
  const previousColor = useToolStore((s) => s.previousColor);
  const liquifySettings = useToolStore((s) => s.liquify);
  const notifyStylusDetected = () => onStylusDetected?.();
  const canPaint = doc.canPaintOnActiveLayer(tool);
  const alphaLocked = doc.layers.active?.meta.alphaLocked ?? false;
  const selection = doc.selection;

  // Symmetry in canvas coordinates (settings keep the axis as a fraction of the canvas).
  const symmetry = useMemo<Symmetry | null>(
    () =>
      symmetrySettings.mode === 'off'
        ? null
        : { mode: symmetrySettings.mode, x: symmetrySettings.cx * docW, y: symmetrySettings.cy * docH, segments: symmetrySettings.segments },
    [symmetrySettings, docW, docH],
  );

  // Mirror React-side settings into shared values the worklets can read. The tool/colour/brush
  // travel with the samples at stroke end, so the committed stroke always matches the preview.
  const recipeSV = useSharedValue<Omit<StrokeRecipe, 'samples' | 'seed'>>({ tool, color, brush, symmetry });
  const isEraser = tool === 'eraser';
  const rgb = useMemo(() => colorToRgb(isEraser ? 'black' : color), [isEraser, color]);
  const rgbSV = useSharedValue<number[]>(rgb);
  const tipSV = useSharedValue<SkImage>(tipImage);
  const stylusOnlySV = useSharedValue(stylusOnly);
  const canPaintSV = useSharedValue(canPaint);
  const interactionSV = useSharedValue(interaction);
  const selectShapeSV = useSharedValue<SelectShape>(selectShape);
  const shapeSV = useSharedValue({ kind: shapeKind, constrain: shapeConstrain });
  const tapUndoSV = useSharedValue(tapUndo);
  const tapRedoSV = useSharedValue(tapRedo);
  const inputSV = useSharedValue({
    stabilization,
    pressureExponent: PRESSURE_EXPONENTS[pressureCurve],
    simulatePressure,
    autoPalm,
    // Stabiliser strength (> 0 when on; a tiny floor so 0 % still counts as on).
    stabilizer: stabilizerOn ? Math.max(0.001, stabilizerStrength) : 0,
    stabilizerFinish,
  });
  useEffect(() => {
    inputSV.set({
      stabilization,
      pressureExponent: PRESSURE_EXPONENTS[pressureCurve],
      simulatePressure,
      autoPalm,
      stabilizer: stabilizerOn ? Math.max(0.001, stabilizerStrength) : 0,
      stabilizerFinish,
    });
  }, [stabilization, pressureCurve, simulatePressure, autoPalm, stabilizerOn, stabilizerStrength, stabilizerFinish, inputSV]);
  // Palm handling (UI thread). `stylusSeen`: a stylus has touched the canvas this session.
  // `penStroke`: the current stroke is a stylus stroke that other contacts must not disturb.
  // `lastPenAt`: time of the last stylus event, so a resting palm is not read as a tap gesture.
  const stylusSeen = useSharedValue(false);
  const penStroke = useSharedValue(false);
  const lastPenAt = useSharedValue(-1e9);
  const pinchIgnored = useSharedValue(false);
  const mirrorSV = useSharedValue(viewMirrored);
  const symModeSV = useSharedValue<SymmetryMode>(symmetrySettings.mode);
  const symSegmentsSV = useSharedValue(symmetrySettings.segments);
  const axisSV = useSharedValue({ x: symmetrySettings.cx * docW, y: symmetrySettings.cy * docH });
  // Perspective guide (UI thread): vanishing points in canvas pixels (live while dragged),
  // snapping, which point is being dragged, and the line a snapped stroke is locked to.
  const vpLive = useSharedValue<Point[]>(vanishingPoints(guides.perspective, guides.vanishing, docW, docH));
  const perspSnapSV = useSharedValue(guides.perspective > 0 && guides.perspectiveSnap);
  const editGuidesSV = useSharedValue(editGuides);
  // Drawing ruler in canvas pixels (settings keep it as canvas fractions).
  const rulerGeometry = useMemo<RulerGeometry>(
    () => ({
      kind: guides.ruler.kind,
      ax: guides.ruler.ax * docW,
      ay: guides.ruler.ay * docH,
      bx: guides.ruler.bx * docW,
      by: guides.ruler.by * docH,
    }),
    [guides.ruler, docW, docH],
  );
  const rulerSV = useSharedValue<RulerGeometry>(rulerGeometry);
  const rulerDrag = useSharedValue(-1);
  useEffect(() => {
    rulerSV.set(rulerGeometry);
  }, [rulerGeometry, rulerSV]);
  // QuickShape: whether it is on, the hold time, and where/when the finger last moved.
  const quickSV = useSharedValue({ on: quickShape, delay: quickShapeDelay });
  const holdTrack = useSharedValue({ x: 0, y: 0, t: 0 });
  useEffect(() => {
    quickSV.set({ on: quickShape, delay: quickShapeDelay });
  }, [quickShape, quickShapeDelay, quickSV]);
  // Gradient tool: drag start/end (canvas px), its settings and the live preview.
  const gradStart = useSharedValue({ x: 0, y: 0 });
  const gradEnd = useSharedValue({ x: 0, y: 0 });
  const gradientPicture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const gradientSpecBase = useMemo(() => {
    const from = Skia.Color(color);
    const to = gradientSettings.end === 'previous' ? Skia.Color(previousColor) : Float32Array.of(from[0], from[1], from[2], 0);
    return {
      kind: gradientSettings.kind,
      from: [from[0], from[1], from[2], from[3] * alpha],
      to: [to[0], to[1], to[2], to[3] * (gradientSettings.end === 'previous' ? alpha : 0)],
      cell: gradientSettings.cell,
      angle: gradientSettings.angle,
    };
  }, [color, previousColor, alpha, gradientSettings]);
  const gradientSV = useSharedValue(gradientSpecBase);
  const toneEffectSV = useSharedValue(toneGradientEffect());
  useEffect(() => {
    gradientSV.set(gradientSpecBase);
  }, [gradientSpecBase, gradientSV]);
  // Liquify brush settings and the undeformed mesh (texture coordinates).
  const liquifySV = useSharedValue(liquifySettings);
  const liquifyLast = useSharedValue({ x: 0, y: 0 });
  useEffect(() => {
    liquifySV.set(liquifySettings);
  }, [liquifySettings, liquifySV]);
  const liquifyTex = useMemo(() => createLiquifyMesh(docW, docH), [docW, docH]);
  const liquifyIdx = useMemo(() => liquifyIndices(), []);
  const emptyMesh = useSharedValue<number[]>([]);
  const liquifyPositions = liquifyMesh ?? emptyMesh;
  const emptyOverlay = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const overlay = vectorOverlay ?? emptyOverlay;
  const vectorPointer = (phase: 'begin' | 'move' | 'end', x: number, y: number, viewScale: number) => onVectorPointer?.(phase, x, y, viewScale);
  const vpDragIndex = useSharedValue(-1);
  const snapLine = useSharedValue({ ox: 0, oy: 0, dx: 0, dy: 0, decided: false });
  const boxSV = useSharedValue<SkRect | null>(null);
  const localMesh = useSharedValue<Mesh>([]);
  const mesh = meshProp ?? localMesh;
  const meshModeSV = useSharedValue<MeshMode>(meshMode);
  const meshDrag = useSharedValue<{ index: number; x0: number; y0: number; start: Mesh }>({ index: -1, x0: 0, y0: 0, start: [] });
  useEffect(() => {
    tapUndoSV.set(tapUndo);
    tapRedoSV.set(tapRedo);
  }, [tapUndo, tapRedo, tapUndoSV, tapRedoSV]);
  useEffect(() => {
    recipeSV.set({ tool, color, brush, symmetry });
  }, [tool, color, brush, symmetry, recipeSV]);
  useEffect(() => {
    symModeSV.set(symmetrySettings.mode);
    symSegmentsSV.set(symmetrySettings.segments);
    axisSV.set({ x: symmetrySettings.cx * docW, y: symmetrySettings.cy * docH });
  }, [symmetrySettings, docW, docH, symModeSV, symSegmentsSV, axisSV]);
  useEffect(() => {
    vpLive.set(vanishingPoints(guides.perspective, guides.vanishing, docW, docH));
    perspSnapSV.set(guides.perspective > 0 && guides.perspectiveSnap);
  }, [guides.perspective, guides.vanishing, guides.perspectiveSnap, docW, docH, vpLive, perspSnapSV]);
  useEffect(() => {
    editGuidesSV.set(editGuides);
  }, [editGuides, editGuidesSV]);
  useEffect(() => {
    meshModeSV.set(meshMode);
  }, [meshMode, meshModeSV]);
  useEffect(() => {
    shapeSV.set({ kind: shapeKind, constrain: shapeConstrain });
  }, [shapeKind, shapeConstrain, shapeSV]);
  useEffect(() => {
    mirrorSV.set(viewMirrored);
  }, [viewMirrored, mirrorSV]);
  useEffect(() => {
    const box = transformSession?.box;
    boxSV.set(box ? rect(box.x, box.y, box.width, box.height) : null);
  }, [transformSession, boxSV]);
  useEffect(() => {
    rgbSV.set(rgb);
  }, [rgb, rgbSV]);
  useEffect(() => {
    tipSV.set(tipImage);
  }, [tipImage, tipSV]);
  useEffect(() => {
    stylusOnlySV.set(stylusOnly);
  }, [stylusOnly, stylusOnlySV]);
  useEffect(() => {
    canPaintSV.set(canPaint);
  }, [canPaint, canPaintSV]);
  useEffect(() => {
    interactionSV.set(interaction);
  }, [interaction, interactionSV]);
  useEffect(() => {
    selectShapeSV.set(selectShape);
  }, [selectShape, selectShapeSV]);

  // ---- UI-thread state ---------------------------------------------------------------------
  const ownTransform = useSharedValue<ViewTransform>(IDENTITY);
  const ownViewSize = useSharedValue({ w: 0, h: 0 });
  const transform = view ?? ownTransform;
  const viewSize = viewport ?? ownViewSize;
  // Live stroke preview: pictures recorded on the UI thread, each containing one drawAtlas of
  // the same tinted stamps the commit renders. A picture is published through a single shared
  // value, so sprites/transforms/colours can never reach the renderer out of sync. Split so
  // per-event work stays bounded however long the stroke gets:
  //  - committed: finished chunks (a full chunk is folded in by nesting the previous picture)
  //  - chunk:     dabs of the chunk currently being built (re-recorded each event)
  //  - tail:      provisional dabs up to the raw input point, replaced every event (also used
  //               for the whole shape preview, which is re-rendered on every move)
  const committed = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const chunk = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const tail = useSharedValue<SkPicture>(EMPTY_PICTURE);
  // A finished stroke stays on screen as a pending picture until its commit reaches the UI
  // thread together with the new layer image (see settleStroke), so lifting the finger never
  // shows a frame without the stroke — even when the next stroke starts first.
  const pending = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const pendingStrokes = useSharedValue<PendingStroke[]>([]);
  const strokeCounter = useSharedValue(0);
  const freshImage = useSharedValue<FreshImage | null>(null);
  const chunkBuffer = useSharedValue<AtlasBuffer>(emptyBuffer());
  const strokeSeed = useSharedValue(0);
  const strokeState = useSharedValue<StrokePathState | null>(null);
  const samples = useSharedValue<number[]>([]);
  const smooth = useSharedValue<SmoothingState>(createSmoothingState());
  const speed = useSharedValue<SpeedPressureState>(createSpeedPressureState());
  const strokeT0 = useSharedValue(0);
  const lastRaw = useSharedValue({ x: 0, y: 0, p: 1, t: 0, tiltX: 0, tiltY: 0 });
  // Stabiliser: the gliding brush tip and the latest finger sample (document coordinates; the
  // finger also in screen points), plus the on-screen guide (screen points).
  const stabTip = useSharedValue({ x: 0, y: 0 });
  const stabFinger = useSharedValue({ x: 0, y: 0, p: 1, tiltX: 0, tiltY: 0, sx: 0, sy: 0 });
  const stabGuide = useSharedValue({ fx: 0, fy: 0, tx: 0, ty: 0, visible: false });
  const mode = useSharedValue(MODE_IDLE);
  const panStart = useSharedValue({ t: IDENTITY, x: 0, y: 0 });
  const layerDragStart = useSharedValue({ t: IDENTITY_TRANSFORM, x: 0, y: 0 });
  const handleDrag = useSharedValue({ t: IDENTITY_TRANSFORM, cx: 0, cy: 0, d0: 1 });
  // Fingers currently on the screen, as [id, x, y] triplets (screen points).
  const fingers = useSharedValue<number[]>([]);
  // Two-finger gesture, tracked from one fixed pair of fingers (see FingerPair).
  const pair = useSharedValue<FingerPair | null>(null);
  const pinchActive = useSharedValue(false);
  const pinchTarget = useSharedValue(TARGET_VIEW);
  const loupe = useSharedValue({ x: 0, y: 0, visible: false });
  const selectionDraft = useSharedValue<SkPath>(Skia.Path.Make());
  const selectStart = useSharedValue({ x: 0, y: 0 });
  const selectEnd = useSharedValue({ x: 0, y: 0 });
  const lassoBuilder = useSharedValue<SkPathBuilder | null>(null);
  const lassoPoints = useSharedValue<number[]>([]);
  const shapeStart = useSharedValue({ x: 0, y: 0 });
  const shapeEnd = useSharedValue({ x: 0, y: 0 });
  const touchTrack = useSharedValue<TouchTrack>(newTouchTrack());
  // Animated view changes (fit, reset rotation, snapping): progress 0→1 between two views.
  const viewAnim = useSharedValue(1);
  const viewAnimating = useSharedValue(false);
  const viewFrom = useSharedValue<ViewTransform>(IDENTITY);
  const viewTo = useSharedValue<ViewTransform>(IDENTITY);

  const resetLiveStroke = () => {
    'worklet';
    committed.set(emptyPicture());
    chunk.set(emptyPicture());
    tail.set(emptyPicture());
    strokeState.set(null);
  };

  /** Moves the finished live stroke to `pending`; returns the id its commit will settle. */
  const parkLiveStroke = () => {
    'worklet';
    const id = strokeCounter.get() + 1;
    strokeCounter.set(id);
    const list = [...pendingStrokes.get(), { id, picture: combinePictures([committed.get(), chunk.get(), tail.get()]) }];
    pendingStrokes.set(list);
    pending.set(combinePictures(list.map((s) => s.picture)));
    resetLiveStroke();
    return id;
  };

  // The gradient preview stays until the render that includes its commit.
  useEffect(() => {
    gradientPicture.set(EMPTY_PICTURE);
  }, [version, gradientPicture]);

  useLayoutEffect(() => {
    scheduleOnUI(clearSelectionDraft, mode, selectionDraft);
    // Once React has rendered past a stroke's commit, its fresh image is no longer needed.
    scheduleOnUI(dropStaleFreshImage, freshImage, version);
  }, [version, mode, selectionDraft, freshImage]);

  // ---- coordinate mapping ------------------------------------------------------------------

  /** Screen point → document point (through the view transform and the optional mirror). */
  const toDoc = (sx: number, sy: number) => {
    'worklet';
    const p = screenToCanvas(transform.get(), sx, sy);
    return mirrorSV.get() ? { x: docW - p.x, y: p.y } : p;
  };

  /** Document point → screen point. */
  const toScreen = (x: number, y: number) => {
    'worklet';
    return canvasToScreen(transform.get(), mirrorSV.get() ? docW - x : x, y);
  };

  // ---- JS-thread actions -------------------------------------------------------------------
  // Plain functions: React Compiler memoizes them (manual useCallback over shared values that
  // worklets also write cannot be preserved by the compiler).
  const commitStroke = (recipe: StrokeRecipe, strokeId: number) => {
    let drawn = false;
    try {
      drawn = doc.commitStroke(recipe);
    } catch (error) {
      // Never let a failed stroke take the app down; the stroke is simply discarded.
      console.error('[canvas] Stroke commit failed', error);
    }
    // Hand the new layer image to the UI thread in the same step that drops the pending
    // preview. React's re-render (and the Skia redraw it triggers) arrives later.
    const layer = doc.layers.active;
    const fresh = drawn && layer ? { layerId: layer.meta.id, image: layer.image, version: doc.getVersion() } : null;
    scheduleOnUI(settleStroke, strokeId, fresh, freshImage, pendingStrokes, pending);
    if (drawn && recipe.tool === 'brush') useToolStore.getState().pushRecent(recipe.color);
  };

  const sampleAt = (x: number, y: number) => {
    useEyedropperStore.getState().update(sampleColor(doc, x, y), renderLoupe(doc, x, y));
  };

  /** Lifting the finger confirms the sampled colour; nothing is painted. */
  const finishSample = () => {
    const picked = useEyedropperStore.getState().color;
    useEyedropperStore.getState().clear();
    const tools = useToolStore.getState();
    if (picked && picked !== tools.color) {
      const from = tools.color;
      tools.setColor(picked);
      tools.commitColor(from);
    }
    tools.setInteraction('paint');
  };

  const commitSelection = (shape: SelectShape, pts: number[]) => {
    let path: SkPath | null = null;
    if ((shape === 'rect' || shape === 'ellipse') && pts.length === 4) {
      const r = boxFromCorners(pts[0], pts[1], pts[2], pts[3]);
      if (r.width > 2 && r.height > 2) path = shape === 'rect' ? Skia.Path.Rect(r) : Skia.Path.Oval(r);
    } else if (shape === 'lasso' && pts.length >= 6) {
      const points = [];
      for (let i = 0; i + 1 < pts.length; i += 2) points.push(vec(pts[i], pts[i + 1]));
      path = Skia.Path.Polygon(points, true);
    }
    const combine: SelectionMode = useToolStore.getState().selectCombine;
    // A tap (or a degenerate shape) clears the selection, as in most painting apps, unless the
    // shape was meant to add to / subtract from the current one.
    if (!path) {
      if (combine === 'replace') doc.setSelection(null);
    } else {
      doc.combineSelection(path, combine);
    }
    scheduleOnUI(clearSelectionDraft, mode, selectionDraft);
  };

  /** `#rrggbb` + colour alpha as a CSS colour for fills. */
  const fillColor = () => {
    const { color: c, alpha: a } = useToolStore.getState();
    if (a >= 1) return c;
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /** Paint bucket tap. */
  const fillAt = (x: number, y: number) => {
    const tools = useToolStore.getState();
    setFillBusy(true);
    void doc
      .bucketFillAsync(x, y, fillColor(), tools.fill)
      .then((result) => {
        if (!result.ok) Alert.alert('Can’t fill', result.reason);
        else tools.pushRecent(tools.color);
      })
      .catch((error) => {
        console.error('[canvas] Bucket fill failed', error);
        Alert.alert('Can’t fill', 'The bucket fill could not be completed.');
      })
      .finally(() => setFillBusy(false));
  };

  /** Magic wand tap. */
  const wandAt = (x: number, y: number) => {
    const tools = useToolStore.getState();
    const result = doc.magicWand(x, y, tools.fill, tools.selectCombine);
    if (!result.ok) Alert.alert('Nothing selected', result.reason);
  };

  const commitGradient = (spec: GradientSpec) => {
    const result = doc.fillGradient(spec);
    if (!result.ok) {
      Alert.alert('Can’t add the gradient', result.reason);
      gradientPicture.set(EMPTY_PICTURE);
    }
  };

  /** Stores the dragged ruler (as canvas fractions, like the other guides). */
  const commitRuler = (ax: number, ay: number, bx: number, by: number) => {
    const { guides: g, updateGuides } = useSettingsStore.getState();
    updateGuides({ ruler: { ...g.ruler, ax: ax / docW, ay: ay / docH, bx: bx / docW, by: by / docH } });
  };

  /** Stores a dragged vanishing point (as canvas fractions, like the other guides). */
  const commitVanishing = (index: number, x: number, y: number) => {
    const { guides: g, updateGuides } = useSettingsStore.getState();
    updateGuides({ vanishing: g.vanishing.map((v, i) => (i === index ? { x: x / docW, y: y / docH } : v)) });
  };

  const commitAxis = (x: number, y: number) => {
    useToolStore.getState().updateSymmetry({ cx: x / docW, cy: y / docH });
  };

  // ---- stroke worklets ---------------------------------------------------------------------

  /** Pressure for this event: real stylus pressure, simulated from speed, or full. */
  const eventPressure = (sx: number, sy: number, t: number, pointerType: number, stylusPressure: number | undefined) => {
    'worklet';
    const input = inputSV.get();
    if (hasRealPressure(pointerType, stylusPressure)) {
      return Math.max(0.02, Math.pow(resolvePressure(pointerType, stylusPressure), input.pressureExponent));
    }
    if (!input.simulatePressure || !recipeSV.get().brush.speedPressure) return 1;
    const next = updateSpeedPressure(speed.get(), sx, sy, t);
    speed.set(next);
    return next.p;
  };

  /** Brush smoothing combined with the global stabiliser (both 0..1). */
  const smoothingFor = (brushSmoothing: number) => {
    'worklet';
    return 1 - (1 - brushSmoothing) * (1 - inputSV.get().stabilization);
  };

  /** A stroke starting near the line ruler starts on it. */
  const startOnRuler = (pt: Point): Point => {
    'worklet';
    const r = rulerSV.get();
    if (r.kind !== 'line' || distanceToLine(r, pt) > RULER_REACH / transform.get().scale) return pt;
    return rulerSnap(r, pt, pt, Infinity);
  };

  const beginStroke = (
    sx: number,
    sy: number,
    pointerType: number,
    stylusPressure: number | undefined,
    tiltX: number,
    tiltY: number,
  ) => {
    'worklet';
    const recipe = recipeSV.get();
    const b = recipe.brush;
    strokeT0.set(nowMs());
    speed.set(createSpeedPressureState());
    const p = eventPressure(sx, sy, 0, pointerType, stylusPressure);
    const pt = startOnRuler(toDoc(sx, sy));
    holdTrack.set({ x: sx, y: sy, t: nowMs() });
    const s = smoothSample(createSmoothingState(), pt.x, pt.y, p, smoothingFor(b.smoothing));
    // Per-stroke PRNG seed (varies with time and position; recorded for exact replay).
    const seed = (Math.floor(strokeT0.get() * 1000) ^ Math.floor(sx * 7919) ^ Math.floor(sy * 104729)) | 0;
    strokeSeed.set(seed);
    const dabs: number[] = [];
    strokeState.set(strokeBegin(s.x, s.y, s.p, tiltX, tiltY, b, seed, dabs));
    applySymmetry(dabs, recipe.symmetry);
    smooth.set(s);
    samples.set([s.x, s.y, s.p, 0, tiltX, tiltY]);
    lastRaw.set({ x: pt.x, y: pt.y, p, t: 0, tiltX, tiltY });
    snapLine.set({ ox: pt.x, oy: pt.y, dx: 0, dy: 0, decided: false });
    stabTip.set({ x: pt.x, y: pt.y });
    stabFinger.set({ x: pt.x, y: pt.y, p, tiltX, tiltY, sx, sy });
    stabGuide.set({ fx: sx, fy: sy, tx: sx, ty: sy, visible: inputSV.get().stabilizer > 0 });
    const buffer = emptyBuffer();
    appendBuffer(buffer, dabs, rgbSV.get());
    chunkBuffer.set(buffer);
    committed.set(emptyPicture());
    tail.set(emptyPicture());
    chunk.set(recordAtlasPicture(tipSV.get(), buffer, null));
    mode.set(MODE_DRAW);
  };

  /** Adds one input point (document coordinates) to the live stroke. */
  const addStrokePoint = (x: number, y: number, p: number, tiltX: number, tiltY: number, t: number) => {
    'worklet';
    const state = strokeState.get();
    if (!state) return;
    const recipe = recipeSV.get();
    const b = recipe.brush;
    const s = smoothSample(smooth.get(), x, y, p, smoothingFor(b.smoothing));
    smooth.set(s);
    lastRaw.set({ x, y, p, t, tiltX, tiltY });

    const dabs: number[] = [];
    const next = strokeAdd(state, s.x, s.y, s.p, tiltX, tiltY, b, dabs);
    applySymmetry(dabs, recipe.symmetry);
    strokeState.set(next);
    samples.modify((arr) => {
      'worklet';
      arr.push(s.x, s.y, s.p, t, tiltX, tiltY);
      return arr;
    });

    // Append new dabs to the chunk; roll the chunk into the committed arrays when it fills.
    const rgbNow = rgbSV.get();
    const tip = tipSV.get();
    const buffer = chunkBuffer.get();
    if (dabs.length > 0) {
      appendBuffer(buffer, dabs, rgbNow);
      if (buffer.x.length > CHUNK_DABS) {
        // Fold the full chunk into the committed picture (nesting: O(chunk), not O(stroke)).
        committed.set(recordAtlasPicture(tip, buffer, committed.get()));
        chunkBuffer.set(emptyBuffer());
        chunk.set(emptyPicture());
      } else {
        chunkBuffer.set(buffer);
        chunk.set(recordAtlasPicture(tip, buffer, null));
      }
    }

    // Provisional tail to the input position (unsmoothed by the brush): zero perceived lag.
    // With the stabiliser on, the input is the gliding tip, never the finger itself.
    const tailDabs: number[] = [];
    strokeTail(next, x, y, p, tiltX, tiltY, b, tailDabs);
    applySymmetry(tailDabs, recipe.symmetry);
    const tailBuffer = emptyBuffer();
    appendBuffer(tailBuffer, tailDabs, rgbNow);
    tail.set(recordAtlasPicture(tip, tailBuffer, null));
  };

  /**
   * Perspective snapping: once the stroke has moved a little, it locks onto the perspective line
   * (toward a vanishing point, or vertical) closest to its direction, and stays on it.
   */
  const snapToPerspective = (pt: Point): Point => {
    'worklet';
    if (!perspSnapSV.get()) return pt;
    const vps = vpLive.get();
    if (vps.length === 0) return pt;
    const line = snapLine.get();
    const origin = { x: line.ox, y: line.oy };
    if (!line.decided) {
      const dx = pt.x - origin.x;
      const dy = pt.y - origin.y;
      // Hold still until the direction is clear.
      if (Math.sqrt(dx * dx + dy * dy) * transform.get().scale < SNAP_DECIDE) return origin;
      const dir = closestDirection(snapDirections(origin, vps), dx, dy);
      if (!dir) return origin;
      snapLine.set({ ...line, dx: dir.x, dy: dir.y, decided: true });
      return projectOnLine(origin, dir, pt);
    }
    return projectOnLine(origin, { x: line.dx, y: line.dy }, pt);
  };

  /** The ruler wins over perspective snapping when both are on. */
  const snapStrokePoint = (pt: Point): Point => {
    'worklet';
    const r = rulerSV.get();
    if (r.kind === 'off') return snapToPerspective(pt);
    const line = snapLine.get();
    return rulerSnap(r, { x: line.ox, y: line.oy }, pt, RULER_REACH / transform.get().scale);
  };

  const extendStroke = (
    sx: number,
    sy: number,
    pointerType: number,
    stylusPressure: number | undefined,
    tiltX: number,
    tiltY: number,
  ) => {
    'worklet';
    if (!strokeState.get()) return;
    const t = nowMs() - strokeT0.get();
    const p = eventPressure(sx, sy, t, pointerType, stylusPressure);
    const pt = snapStrokePoint(toDoc(sx, sy));
    if (inputSV.get().stabilizer > 0) {
      // The stabiliser's frame callback moves the brush; events only report the finger.
      stabFinger.set({ x: pt.x, y: pt.y, p, tiltX, tiltY, sx, sy });
      return;
    }
    addStrokePoint(pt.x, pt.y, p, tiltX, tiltY, t);
  };

  /** Moves the stabilised tip one step of `dt` ms toward the finger and paints there. */
  const stabilizerStep = (dt: number) => {
    'worklet';
    const f = stabFinger.get();
    const tipNow = stabTip.get();
    const next = followStep(tipNow.x, tipNow.y, f.x, f.y, dt, inputSV.get().stabilizer);
    // Sub-pixel moves add nothing visible; skip them so a resting finger adds no samples.
    if ((next.x - tipNow.x) ** 2 + (next.y - tipNow.y) ** 2 < STAB_MIN_STEP * STAB_MIN_STEP) return false;
    stabTip.set(next);
    addStrokePoint(next.x, next.y, f.p, f.tiltX, f.tiltY, nowMs() - strokeT0.get());
    return true;
  };

  // Stabiliser: runs every frame while drawing, so the brush keeps gliding toward a finger that
  // has stopped. That continuous catch-up is what turns shaky input into smooth curves.
  const stabilizerFrame = useFrameCallback((info) => {
    'worklet';
    if (mode.get() !== MODE_DRAW || inputSV.get().stabilizer <= 0 || !strokeState.get()) return;
    try {
      stabilizerStep(Math.min(64, info.timeSincePreviousFrame ?? 16));
      const f = stabFinger.get();
      const tipNow = stabTip.get();
      const tipScreen = toScreen(tipNow.x, tipNow.y);
      stabGuide.set({ fx: f.sx, fy: f.sy, tx: tipScreen.x, ty: tipScreen.y, visible: true });
    } catch (err) {
      console.error('[draw] stabilizer failed', String(err));
    }
  }, false);
  useEffect(() => {
    stabilizerFrame.setActive(stabilizerOn);
  }, [stabilizerOn, stabilizerFrame]);

  // QuickShape: holding still at the end of a stroke turns it into a clean shape.
  const quickShapeFrame = useFrameCallback(() => {
    'worklet';
    const q = quickSV.get();
    if (!q.on || mode.get() !== MODE_DRAW || !strokeState.get()) return;
    const hold = holdTrack.get();
    if (nowMs() - hold.t < q.delay) return;
    // One attempt per hold: moving again re-arms it.
    holdTrack.set({ ...hold, t: Number.MAX_SAFE_INTEGER });
    try {
      const shape = recognizeShape(samples.get(), 1 / transform.get().scale);
      if (!shape) return;
      const recipe = recipeSV.get();
      samples.set(shape.samples);
      const dabs: number[] = [];
      replayStroke(shape.samples, recipe.brush, strokeSeed.get(), dabs);
      applySymmetry(dabs, recipe.symmetry);
      const buffer = emptyBuffer();
      appendBuffer(buffer, dabs, rgbSV.get());
      committed.set(emptyPicture());
      chunk.set(emptyPicture());
      tail.set(recordAtlasPicture(tipSV.get(), buffer, null));
      strokeState.set(null);
      // (hideStabGuide is declared below this worklet, so it is inlined here.)
      if (stabGuide.get().visible) stabGuide.set({ ...stabGuide.get(), visible: false });
      mode.set(MODE_SNAPPED);
    } catch (err) {
      console.error('[draw] QuickShape failed', String(err));
    }
  }, false);
  useEffect(() => {
    quickShapeFrame.setActive(quickShape);
  }, [quickShape, quickShapeFrame]);

  /** Re-records the gradient preview between the drag's start and end. */
  const previewGradient = () => {
    'worklet';
    const a = gradStart.get();
    const b = gradEnd.get();
    const spec = { ...gradientSV.get(), x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, docW, docH));
    const shader = gradientShader(spec, toneEffectSV.get());
    if (shader) {
      if (selection) canvas.clipPath(selection, ClipOp.Intersect, true);
      const paint = Skia.Paint();
      paint.setShader(shader);
      if (alphaLocked) paint.setBlendMode(BlendMode.SrcATop);
      canvas.drawRect(Skia.XYWHRect(0, 0, docW, docH), paint);
    }
    gradientPicture.set(recorder.finishRecordingAsPicture());
  };

  /** One liquify brush step at canvas point `pt`. */
  const liquifyAt = (pt: Point) => {
    'worklet';
    const s = liquifySV.get();
    const last = liquifyLast.get();
    const positions = liquifyPositions.get();
    if (positions.length !== liquifyTex.length) return;
    liquifyPositions.set(
      liquifyStep(positions, liquifyTex, pt.x, pt.y, pt.x - last.x, pt.y - last.y, s.size / transform.get().scale, s.strength, s.mode),
    );
    liquifyLast.set(pt);
  };

  /** On lift: finish the glide at once (same curve, simulated in small steps) to the finger. */
  const finishStabilizedStroke = () => {
    'worklet';
    if (inputSV.get().stabilizer <= 0) return;
    if (inputSV.get().stabilizerFinish) {
      for (let i = 0; i < STAB_FINISH_STEPS; i++) {
        if (!stabilizerStep(STAB_FINISH_DT)) break;
      }
    } else {
      // End at the tip: the catch-up below must not jump to the finger.
      const tipNow = stabTip.get();
      lastRaw.set({ ...lastRaw.get(), x: tipNow.x, y: tipNow.y });
    }
  };

  // ---- shape worklets ----------------------------------------------------------------------

  /** Samples for the current shape drag; spacing fine enough for the spline to hug the edges. */
  const currentShapeSamples = () => {
    'worklet';
    const a = shapeStart.get();
    const b = shapeEnd.get();
    const sh = shapeSV.get();
    const spacing = Math.min(4, Math.max(1, recipeSV.get().brush.size / 8));
    return shapeSamples(sh.kind, a.x, a.y, b.x, b.y, sh.constrain, spacing);
  };

  /** Re-renders the whole shape preview through the brush engine (same path as the commit). */
  const previewShape = () => {
    'worklet';
    const recipe = recipeSV.get();
    const pts = currentShapeSamples();
    const dabs: number[] = [];
    if (pts.length > 0) replayStroke(pts, recipe.brush, strokeSeed.get(), dabs);
    applySymmetry(dabs, recipe.symmetry);
    const buffer = emptyBuffer();
    appendBuffer(buffer, dabs, rgbSV.get());
    tail.set(recordAtlasPicture(tipSV.get(), buffer, null));
  };

  const commitShape = (recipe: StrokeRecipe, kind: ShapeKind, constrain: boolean, strokeId: number) => {
    commitStroke({ ...recipe, label: shapeLabel(kind, constrain) }, strokeId);
  };

  // Worklets capture their closure when created: anything they call must be declared above
  // them, or it is captured as `undefined` and throws (fatally) on the UI thread.
  const hideStabGuide = () => {
    'worklet';
    if (stabGuide.get().visible) stabGuide.set({ ...stabGuide.get(), visible: false });
  };

  /** Abandons whatever one-finger action is in progress (e.g. a second finger landed). */
  const cancelOneFinger = () => {
    'worklet';
    const m = mode.get();
    if (m === MODE_DRAW || m === MODE_SHAPE || m === MODE_SNAPPED) resetLiveStroke();
    if (m === MODE_GRADIENT) gradientPicture.set(emptyPicture());
    if (m === MODE_SELECT) selectionDraft.set(Skia.Path.Make());
    if (m === MODE_SAMPLE) loupe.set({ x: 0, y: 0, visible: false });
    if (m === MODE_AXIS) {
      const a = axisSV.get();
      scheduleOnRN(commitAxis, a.x, a.y);
    }
    if (m === MODE_VP) {
      const i = vpDragIndex.get();
      const v = vpLive.get()[i];
      if (v) scheduleOnRN(commitVanishing, i, v.x, v.y);
    }
    lassoBuilder.set(null);
    hideStabGuide();
    mode.set(MODE_CANCELLED);
  };

  /** Index of the vanishing point under (sx, sy), or -1; only while the Guides panel is open. */
  const hitVanishingPoint = (sx: number, sy: number) => {
    'worklet';
    if (!editGuidesSV.get()) return -1;
    const vps = vpLive.get();
    for (let i = 0; i < vps.length; i++) {
      const s = toScreen(vps[i].x, vps[i].y);
      if ((s.x - sx) ** 2 + (s.y - sy) ** 2 <= HANDLE_HIT * HANDLE_HIT) return i;
    }
    return -1;
  };

  /** Index of the ruler handle under (sx, sy), or -1; only while the Guides panel is open. */
  const hitRulerHandle = (sx: number, sy: number) => {
    'worklet';
    if (!editGuidesSV.get()) return -1;
    const handles = rulerHandles(rulerSV.get());
    for (let i = 0; i < handles.length; i++) {
      const s = toScreen(handles[i].x, handles[i].y);
      if ((s.x - sx) ** 2 + (s.y - sy) ** 2 <= HANDLE_HIT * HANDLE_HIT) return i;
    }
    return -1;
  };

  /** Whether (sx, sy) is on the symmetry-axis handle (only while painting or drawing shapes). */
  const hitsAxisHandle = (sx: number, sy: number) => {
    'worklet';
    if (symModeSV.get() === 'off') return false;
    const m = interactionSV.get();
    if (m !== 'paint' && m !== 'shape') return false;
    const a = axisSV.get();
    const s = toScreen(a.x, a.y);
    return (s.x - sx) ** 2 + (s.y - sy) ** 2 <= HANDLE_HIT * HANDLE_HIT;
  };

  /** Mesh point under (sx, sy) in distort/warp mode (corners first), or -1. */
  const hitMeshPoint = (sx: number, sy: number) => {
    'worklet';
    const m = mesh.get();
    if (m.length !== 12) return -1;
    const order = meshModeSV.get() === 'warp' ? [0, 3, 6, 9, 1, 2, 4, 5, 7, 8, 10, 11] : [0, 3, 6, 9];
    for (const i of order) {
      const s = toScreen(m[i].x, m[i].y);
      if ((s.x - sx) ** 2 + (s.y - sy) ** 2 <= HANDLE_HIT * HANDLE_HIT) return i;
    }
    return -1;
  };

  /** Whether (sx, sy) is on a corner handle of the transform box. */
  const hitsBoxCorner = (sx: number, sy: number) => {
    'worklet';
    const box = boxSV.get();
    if (!box) return false;
    const t = layerTransform.get();
    const corners = [box.x, box.y, box.x + box.width, box.y, box.x + box.width, box.y + box.height, box.x, box.y + box.height];
    for (let i = 0; i < corners.length; i += 2) {
      const d = mapPoint(t, corners[i], corners[i + 1]);
      const s = toScreen(d.x, d.y);
      if ((s.x - sx) ** 2 + (s.y - sy) ** 2 <= HANDLE_HIT * HANDLE_HIT) return true;
    }
    return false;
  };

  // ---- view animation ----------------------------------------------------------------------

  const animateView = (to: ViewTransform) => {
    'worklet';
    viewFrom.set(transform.get());
    viewTo.set(to);
    viewAnimating.set(true);
    viewAnim.set(0);
    viewAnim.set(withTiming(1, { duration: VIEW_ANIMATION_MS, easing: Easing.out(Easing.cubic) }));
  };

  /** Any touch takes over from a running animation immediately. */
  const stopViewAnimation = () => {
    'worklet';
    if (!viewAnimating.get()) return;
    cancelAnimation(viewAnim);
    viewAnimating.set(false);
  };

  useAnimatedReaction(
    () => viewAnim.get(),
    (p) => {
      if (!viewAnimating.get()) return;
      const { w, h } = viewSize.get();
      transform.set(interpolateView(viewFrom.get(), viewTo.get(), p, w, h));
      if (p >= 1) viewAnimating.set(false);
    },
  );

  /** After a two-finger gesture: settle a nearly-straight view onto the right angle. */
  const settleRotation = () => {
    'worklet';
    const { w, h } = viewSize.get();
    const snapped = snapRotation(transform.get(), w, h, ROTATION_SNAP);
    if (snapped) animateView(snapped);
  };

  // Tell the editor whether "reset rotation" is meaningful (only on change, not per frame).
  useAnimatedReaction(
    () => Math.abs(normalizeAngle(transform.get().rotation)) > 0.001,
    (rotated, previous) => {
      if (rotated !== previous) scheduleOnRN(onRotatedChange, rotated);
    },
  );

  // ---- multi-finger taps -------------------------------------------------------------------

  const trackTouchesDown = (touches: readonly { id: number; x: number; y: number }[]) => {
    'worklet';
    const track = touchTrack.get();
    const next =
      track.ids.length === 0 ? { ...newTouchTrack(), t0: nowMs(), judged: false, view: transform.get() } : { ...track };
    next.ids = [...next.ids];
    next.starts = [...next.starts];
    for (const t of touches) {
      if (next.ids.includes(t.id)) continue;
      next.ids.push(t.id);
      next.starts.push(t.id, t.x, t.y);
    }
    next.maxTouches = Math.max(next.maxTouches, next.ids.length);
    touchTrack.set(next);
    return next.ids.length;
  };

  const trackTouchesMove = (touches: readonly { id: number; x: number; y: number }[]) => {
    'worklet';
    const track = touchTrack.get();
    if (track.moved || track.judged) return;
    for (const t of touches) {
      for (let i = 0; i + 2 < track.starts.length; i += 3) {
        if (track.starts[i] !== t.id) continue;
        if ((t.x - track.starts[i + 1]) ** 2 + (t.y - track.starts[i + 2]) ** 2 > TAP_SLOP * TAP_SLOP) {
          touchTrack.set({ ...track, moved: true });
          return;
        }
      }
    }
  };

  /** Decides once per touch sequence whether it was a two/three-finger tap. */
  const judgeTap = () => {
    'worklet';
    const track = touchTrack.get();
    if (track.judged) return;
    touchTrack.set({ ...track, judged: true });
    if (nowMs() - lastPenAt.get() < TAP_MAX_MS + PEN_TAP_GRACE_MS) return;
    if (track.moved || track.maxTouches < 2 || nowMs() - track.t0 > TAP_MAX_MS) return;
    // Transform mode has a pending, un-committed edit; history shortcuts would be confusing.
    if (interactionSV.get() === 'transform') return;
    const action: QuickHistoryAction | null =
      track.maxTouches === 2 && tapUndoSV.get() ? 'undo' : track.maxTouches === 3 && tapRedoSV.get() ? 'redo' : null;
    if (!action) return;
    // Undo any tiny zoom/rotation the fingers caused while tapping.
    stopViewAnimation();
    transform.set(track.view);
    scheduleOnRN(onQuickHistory, action);
  };

  const trackTouchesUp = (touches: readonly { id: number }[]) => {
    'worklet';
    const track = touchTrack.get();
    const lifted = touches.map((t) => t.id);
    const ids = track.ids.filter((id) => !lifted.includes(id));
    touchTrack.set({ ...track, ids });
    if (ids.length === 0) judgeTap();
  };

  // ---- gestures ----------------------------------------------------------------------------
  const oneFinger = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      try {
        const m = interactionSV.get();
        const pt = toDoc(e.x, e.y);
        const isPen = e.pointerType === PointerType.STYLUS;
        if (isPen) {
          lastPenAt.set(nowMs());
          if (!stylusSeen.get()) {
            stylusSeen.set(true);
            if (inputSV.get().autoPalm && !stylusOnlySV.get()) scheduleOnRN(notifyStylusDetected);
          }
        }
        // With a stylus in use (or stylus-only mode), fingers and palms navigate instead of painting.
        const fingersNavigate = stylusOnlySV.get() || (inputSV.get().autoPalm && stylusSeen.get());
        penStroke.set(false);
        const rh = hitRulerHandle(e.x, e.y);
        if (rh >= 0) {
          rulerDrag.set(rh);
          mode.set(MODE_RULER);
          return;
        }
        const vp = hitVanishingPoint(e.x, e.y);
        if (vp >= 0) {
          vpDragIndex.set(vp);
          mode.set(MODE_VP);
          return;
        }
        if (hitsAxisHandle(e.x, e.y)) {
          mode.set(MODE_AXIS);
          return;
        }
        if (m === 'eyedropper') {
          loupe.set({ x: e.x, y: e.y, visible: true });
          mode.set(MODE_SAMPLE);
          scheduleOnRN(sampleAt, pt.x, pt.y);
          return;
        }
        if (m === 'transform' && meshModeSV.get() !== 'free') {
          // Distort / warp: drag a handle, or anywhere else to move the whole mesh.
          const hit = hitMeshPoint(e.x, e.y);
          meshDrag.set({ index: hit, x0: pt.x, y0: pt.y, start: mesh.get() });
          mode.set(hit >= 0 ? MODE_MESH_POINT : MODE_MESH_MOVE);
          return;
        }
        if (m === 'transform') {
          const t = layerTransform.get();
          const box = boxSV.get();
          if (box && hitsBoxCorner(e.x, e.y)) {
            // Corner handles scale uniformly around the box centre.
            const c = mapPoint(t, box.x + box.width / 2, box.y + box.height / 2);
            handleDrag.set({ t, cx: c.x, cy: c.y, d0: Math.max(1e-3, Math.hypot(pt.x - c.x, pt.y - c.y)) });
            mode.set(MODE_HANDLE);
          } else {
            layerDragStart.set({ t, x: pt.x, y: pt.y });
            mode.set(MODE_LAYER_MOVE);
          }
          return;
        }
        if (m === 'fill') {
          // Fill on lift, only for a tap (a drag pans nothing; it just cancels the fill).
          selectStart.set({ x: e.x, y: e.y });
          selectEnd.set({ x: e.x, y: e.y });
          mode.set(MODE_FILL);
          return;
        }
        if (m === 'gradient') {
          if (!canPaintSV.get()) {
            mode.set(MODE_IDLE);
            return;
          }
          gradStart.set(pt);
          gradEnd.set(pt);
          mode.set(MODE_GRADIENT);
          return;
        }
        if (m === 'liquify') {
          liquifyLast.set(pt);
          mode.set(MODE_LIQUIFY);
          liquifyAt(pt);
          return;
        }
        if (m === 'vector') {
          mode.set(MODE_VECTOR);
          scheduleOnRN(vectorPointer, 'begin', pt.x, pt.y, transform.get().scale);
          return;
        }
        if (m === 'select') {
          selectStart.set(pt);
          selectEnd.set(pt);
          if (selectShapeSV.get() === 'lasso') {
            const b = Skia.PathBuilder.Make();
            b.moveTo(pt.x, pt.y);
            lassoBuilder.set(b);
            lassoPoints.set([pt.x, pt.y]);
          }
          selectionDraft.set(Skia.Path.Make());
          mode.set(MODE_SELECT);
          return;
        }
        if (fingersNavigate && !isPen) {
          // Palm rejection: fingers navigate, only the stylus paints.
          panStart.set({ t: transform.get(), x: e.x, y: e.y });
          mode.set(MODE_PAN);
          return;
        }
        if (!canPaintSV.get()) {
          mode.set(MODE_IDLE);
          return;
        }
        if (m === 'shape') {
          shapeStart.set(pt);
          shapeEnd.set(pt);
          strokeSeed.set((Math.floor(nowMs() * 1000) ^ Math.floor(e.x * 7919)) | 0);
          resetLiveStroke();
          mode.set(MODE_SHAPE);
          return;
        }
        penStroke.set(isPen && fingersNavigate);
        beginStroke(e.x, e.y, e.pointerType, e.stylusData?.pressure, e.stylusData?.tiltX ?? 0, e.stylusData?.tiltY ?? 0);
      } catch (err) {
        // Log instead of crashing: an uncaught worklet error is fatal on Android.
        console.error('[draw] onBegin failed', String(err), (err as Error)?.stack ?? '');
      }
    })
    .onTouchesDown((e) => {
      stopViewAnimation();
      const down = trackTouchesDown(e.changedTouches);
      // A second finger means the user is navigating (or tapping a shortcut), not painting.
      const protectedStroke = penStroke.get() && mode.get() === MODE_DRAW;
      if ((e.numberOfTouches > 1 || down > 1) && !protectedStroke) cancelOneFinger();
    })
    .onTouchesMove((e) => {
      trackTouchesMove(e.allTouches);
    })
    .onTouchesUp((e) => {
      trackTouchesUp(e.changedTouches);
    })
    .onTouchesCancelled((e) => {
      trackTouchesUp(e.changedTouches);
    })
    .onUpdate((e) => {
      try {
        const m = mode.get();
        if (m === MODE_DRAW) {
          // QuickShape: remember when the finger last really moved.
          const hold = holdTrack.get();
          if ((e.x - hold.x) ** 2 + (e.y - hold.y) ** 2 > QUICKSHAPE_STILL * QUICKSHAPE_STILL) {
            holdTrack.set({ x: e.x, y: e.y, t: nowMs() });
          }
          if (penStroke.get()) lastPenAt.set(nowMs());
          extendStroke(e.x, e.y, e.pointerType, e.stylusData?.pressure, e.stylusData?.tiltX ?? 0, e.stylusData?.tiltY ?? 0);
        } else if (m === MODE_SHAPE) {
          shapeEnd.set(toDoc(e.x, e.y));
          previewShape();
        } else if (m === MODE_FILL) {
          selectEnd.set({ x: e.x, y: e.y });
        } else if (m === MODE_GRADIENT) {
          gradEnd.set(toDoc(e.x, e.y));
          previewGradient();
        } else if (m === MODE_LIQUIFY) {
          liquifyAt(toDoc(e.x, e.y));
        } else if (m === MODE_RULER) {
          const pt = toDoc(e.x, e.y);
          const r = rulerSV.get();
          rulerSV.set(rulerDrag.get() === 0 ? { ...r, ax: pt.x, ay: pt.y } : { ...r, bx: pt.x, by: pt.y });
        } else if (m === MODE_PAN) {
          const s = panStart.get();
          transform.set({ ...s.t, tx: s.t.tx + e.x - s.x, ty: s.t.ty + e.y - s.y });
        } else if (m === MODE_SAMPLE) {
          loupe.set({ x: e.x, y: e.y, visible: true });
          const pt = toDoc(e.x, e.y);
          scheduleOnRN(sampleAt, pt.x, pt.y);
        } else if (m === MODE_LAYER_MOVE) {
          const s = layerDragStart.get();
          const pt = toDoc(e.x, e.y);
          layerTransform.set(composeGesture(s.t, s.x, s.y, pt.x, pt.y, 1, 0));
        } else if (m === MODE_HANDLE) {
          const s = handleDrag.get();
          const pt = toDoc(e.x, e.y);
          const k = Math.hypot(pt.x - s.cx, pt.y - s.cy) / s.d0;
          layerTransform.set(composeGesture(s.t, s.cx, s.cy, s.cx, s.cy, Math.max(0.01, k), 0));
        } else if (m === MODE_MESH_POINT) {
          const pt = toDoc(e.x, e.y);
          mesh.set(moveMeshPoint(mesh.get(), meshDrag.get().index, pt.x, pt.y, meshModeSV.get()));
        } else if (m === MODE_MESH_MOVE) {
          const pt = toDoc(e.x, e.y);
          const d = meshDrag.get();
          mesh.set(translateMesh(d.start, pt.x - d.x0, pt.y - d.y0));
        } else if (m === MODE_VP) {
          const pt = toDoc(e.x, e.y);
          const i = vpDragIndex.get();
          vpLive.set(vpLive.get().map((v, k) => (k === i ? pt : v)));
        } else if (m === MODE_AXIS) {
          const pt = toDoc(e.x, e.y);
          axisSV.set({ x: Math.min(docW, Math.max(0, pt.x)), y: Math.min(docH, Math.max(0, pt.y)) });
        } else if (m === MODE_VECTOR) {
          const pt = toDoc(e.x, e.y);
          scheduleOnRN(vectorPointer, 'move', pt.x, pt.y, transform.get().scale);
        } else if (m === MODE_SELECT) {
          const pt = toDoc(e.x, e.y);
          selectEnd.set(pt);
          const shape = selectShapeSV.get();
          if (shape === 'wand') return;
          if (shape === 'lasso') {
            const b = lassoBuilder.get();
            if (!b) return;
            b.lineTo(pt.x, pt.y);
            lassoPoints.modify((arr) => {
              'worklet';
              arr.push(pt.x, pt.y);
              return arr;
            });
            selectionDraft.set(b.build());
          } else {
            const a = selectStart.get();
            const r = boxFromCorners(a.x, a.y, pt.x, pt.y);
            selectionDraft.set(shape === 'rect' ? Skia.Path.Rect(r) : Skia.Path.Oval(r));
          }
        }
      } catch (err) {
        // Log instead of crashing: an uncaught worklet error is fatal on Android.
        console.error('[draw] onUpdate failed', String(err), (err as Error)?.stack ?? '');
      }
    })
    .onFinalize(() => {
      try {
        // Fallback for platforms that end the gesture before the last touch-up arrives.
        judgeTap();
        touchTrack.set(newTouchTrack());
        const m = mode.get();
        mode.set(MODE_IDLE);
        hideStabGuide();
        if (penStroke.get()) lastPenAt.set(nowMs());
        penStroke.set(false);
        if (m === MODE_DRAW) {
          finishStabilizedStroke();
          // Smoothing trails the finger; finish exactly where the stroke was lifted (with the
          // stabiliser on, where its glide ended).
          const raw = lastRaw.get();
          const s = smooth.get();
          if ((raw.x - s.x) ** 2 + (raw.y - s.y) ** 2 > CATCH_UP_DISTANCE ** 2) {
            samples.modify((arr) => {
              'worklet';
              arr.push(raw.x, raw.y, s.p, raw.t, raw.tiltX, raw.tiltY);
              return arr;
            });
          }
          const recipe = { ...recipeSV.get(), seed: strokeSeed.get(), samples: samples.get() };
          scheduleOnRN(commitStroke, recipe, parkLiveStroke());
        } else if (m === MODE_SHAPE) {
          const a = shapeStart.get();
          const b = shapeEnd.get();
          if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SHAPE_DRAG) {
            resetLiveStroke();
            return;
          }
          const sh = shapeSV.get();
          scheduleOnRN(
            commitShape,
            { ...recipeSV.get(), seed: strokeSeed.get(), samples: currentShapeSamples() },
            sh.kind,
            sh.constrain,
            parkLiveStroke(),
          );
        } else if (m === MODE_SNAPPED) {
          const recipe = { ...recipeSV.get(), seed: strokeSeed.get(), samples: samples.get(), label: 'QuickShape' };
          scheduleOnRN(commitStroke, recipe, parkLiveStroke());
        } else if (m === MODE_FILL) {
          const a = selectStart.get();
          const b = selectEnd.get();
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= TAP_SLOP * TAP_SLOP) {
            const pt = toDoc(a.x, a.y);
            scheduleOnRN(fillAt, pt.x, pt.y);
          }
        } else if (m === MODE_GRADIENT) {
          const a = gradStart.get();
          const b = gradEnd.get();
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 1) {
            gradientPicture.set(emptyPicture());
          } else {
            scheduleOnRN(commitGradient, { ...gradientSV.get(), x0: a.x, y0: a.y, x1: b.x, y1: b.y });
          }
        } else if (m === MODE_RULER) {
          const r = rulerSV.get();
          scheduleOnRN(commitRuler, r.ax, r.ay, r.bx, r.by);
        } else if (m === MODE_AXIS) {
          const a = axisSV.get();
          scheduleOnRN(commitAxis, a.x, a.y);
        } else if (m === MODE_VP) {
          const i = vpDragIndex.get();
          const v = vpLive.get()[i];
          if (v) scheduleOnRN(commitVanishing, i, v.x, v.y);
        } else if (m === MODE_SAMPLE) {
          loupe.set({ x: 0, y: 0, visible: false });
          scheduleOnRN(finishSample);
        } else if (m === MODE_VECTOR) {
          scheduleOnRN(vectorPointer, 'end', 0, 0, transform.get().scale);
        } else if (m === MODE_SELECT) {
          const shape = selectShapeSV.get();
          if (shape === 'wand') {
            const a = selectStart.get();
            scheduleOnRN(wandAt, a.x, a.y);
          } else if (shape === 'lasso') {
            lassoBuilder.set(null);
            scheduleOnRN(commitSelection, 'lasso' as SelectShape, lassoPoints.get());
          } else {
            const a = selectStart.get();
            const b = selectEnd.get();
            scheduleOnRN(commitSelection, shape, [a.x, a.y, b.x, b.y]);
          }
        }
      } catch (err) {
        // Log instead of crashing: an uncaught worklet error is fatal on Android. The stroke
        // in progress is dropped rather than left half-drawn.
        console.error('[draw] onFinalize failed', String(err), (err as Error)?.stack ?? '');
        resetLiveStroke();
      }
    });

  // Two-finger pan / zoom / rotate is computed from the raw touches of one fixed pair of
  // fingers rather than the recognisers' focal point, scale and rotation: those come from
  // separate gestures that start at different moments, and the focal point jumps whenever a
  // finger lands or lifts, which made the content drift away from under the fingers.

  /** Screen position of finger `id`, or null if it is not down. */
  const fingerAt = (list: number[], id: number) => {
    'worklet';
    for (let i = 0; i + 2 < list.length; i += 3) {
      if (list[i] === id) return { x: list[i + 1], y: list[i + 2] };
    }
    return null;
  };

  /** Anchors the gesture on the first two fingers down, at the current transforms. */
  const anchorPair = (rotOn: boolean) => {
    'worklet';
    const list = fingers.get();
    if (list.length < 6) {
      pair.set(null);
      return;
    }
    const ax = list[1];
    const ay = list[2];
    const bx = list[4];
    const by = list[5];
    pair.set({
      a: list[0],
      b: list[3],
      view: transform.get(),
      layer: layerTransform.get(),
      fx: (ax + bx) / 2,
      fy: (ay + by) / 2,
      d0: Math.max(1, Math.hypot(bx - ax, by - ay)),
      angle: Math.atan2(by - ay, bx - ax),
      turn: 0,
      rotOn,
      rotOffset: 0,
    });
  };

  const updatePair = () => {
    'worklet';
    if (!pinchActive.get() || pinchIgnored.get()) return;
    const p = pair.get();
    const list = fingers.get();
    const a = p ? fingerAt(list, p.a) : null;
    const b = p ? fingerAt(list, p.b) : null;
    if (!p || !a || !b) {
      // The pair changed (a finger lifted or was replaced): continue from where things are,
      // with whichever two fingers are down now. With one finger left, nothing moves.
      anchorPair(p?.rotOn ?? false);
      return;
    }
    const fx = (a.x + b.x) / 2;
    const fy = (a.y + b.y) / 2;
    const k = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) / p.d0;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const turn = p.turn + normalizeAngle(angle - p.angle);
    let rotOn = p.rotOn;
    let rotOffset = p.rotOffset;
    if (!rotOn && Math.abs(turn) > ROTATION_DEADZONE) {
      rotOn = true;
      rotOffset = Math.sign(turn) * ROTATION_DEADZONE;
    }
    pair.set({ ...p, angle, turn, rotOn, rotOffset });
    const dr = rotationEnabled && rotOn ? turn - rotOffset : 0;
    if (pinchTarget.get() === TARGET_LAYER) {
      // Transform the content around the midpoint, in document space. The view does not move
      // during this gesture, so mapping both midpoints with it is consistent.
      const f0 = toDoc(p.fx, p.fy);
      const f1 = toDoc(fx, fy);
      layerTransform.set(composeGesture(p.layer, f0.x, f0.y, f1.x, f1.y, k, mirrorSV.get() ? -dr : dr));
    } else {
      transform.set(applyFocalGesture(p.view, p.fx, p.fy, fx, fy, k, dr));
    }
  };

  /** Records the fingers down, leaving out `lifted` ones (some platforms still list them). */
  const setFingers = (touches: readonly { id: number; x: number; y: number }[], lifted: readonly { id: number }[]) => {
    'worklet';
    const gone = lifted.map((t) => t.id);
    const list: number[] = [];
    for (const t of touches) {
      if (!gone.includes(t.id)) list.push(t.id, t.x, t.y);
    }
    fingers.set(list);
  };

  // A manual gesture, activated as soon as a second finger lands: a pinch recogniser only
  // starts once the fingers spread or close, so a plain two-finger drag or turn lagged behind.
  const pinch = Gesture.Manual()
    .onTouchesDown((e, manager) => {
      setFingers(e.allTouches, []);
      if (fingers.get().length >= 6 && !pinchActive.get()) manager.activate();
    })
    .onTouchesMove((e) => {
      setFingers(e.allTouches, []);
      updatePair();
    })
    .onTouchesUp((e, manager) => {
      setFingers(e.allTouches, e.changedTouches);
      if (fingers.get().length === 0) manager.end();
    })
    .onTouchesCancelled((_e, manager) => {
      fingers.set([]);
      manager.end();
    })
    .onStart(() => {
      if (penStroke.get() && mode.get() === MODE_DRAW) {
        pinchIgnored.set(true);
        return;
      }
      pinchIgnored.set(false);
      try {
        cancelOneFinger();
      } catch (err) {
        console.error('[draw] cancel failed', String(err));
        resetLiveStroke();
      }
      stopViewAnimation();
      pinchTarget.set(interactionSV.get() === 'transform' && meshModeSV.get() === 'free' ? TARGET_LAYER : TARGET_VIEW);
      pinchActive.set(true);
      anchorPair(false);
    })
    .onEnd(() => {
      if (pinchIgnored.get()) return;
      if (pinchTarget.get() === TARGET_VIEW) settleRotation();
    })
    .onFinalize(() => {
      pinchActive.set(false);
      pair.set(null);
      fingers.set([]);
    });

  // Press and hold (without moving) turns a just-started stroke into the eyedropper. The
  // provisional dab is discarded, so holding to pick a colour never leaves paint behind.
  const hold = Gesture.LongPress()
    .enabled(holdToSample)
    .minDuration(holdDelay)
    .maxDistance(12)
    .onStart((e) => {
      if (mode.get() !== MODE_DRAW) return;
      resetLiveStroke();
      hideStabGuide();
      samples.set([]);
      mode.set(MODE_SAMPLE);
      loupe.set({ x: e.x, y: e.y, visible: true });
      const pt = toDoc(e.x, e.y);
      scheduleOnRN(sampleAt, pt.x, pt.y);
    });

  const gesture = Gesture.Simultaneous(oneFinger, pinch, hold);

  // ---- view fitting ------------------------------------------------------------------------
  const fittedRef = useRef(false);
  // Signals are counters: act only when one actually changes. The request is handed to the UI
  // thread, where the current view is read and the animation starts.
  const handledSignals = useRef({ fit: fitSignal, upright: resetRotationSignal, seq: 0 });
  const viewRequest = useSharedValue<{ seq: number; kind: 'fit' | 'upright' }>({ seq: 0, kind: 'fit' });
  useEffect(() => {
    const handled = handledSignals.current;
    if (fitSignal !== handled.fit) {
      handled.fit = fitSignal;
      viewRequest.set({ seq: ++handled.seq, kind: 'fit' });
    }
    if (resetRotationSignal !== handled.upright) {
      handled.upright = resetRotationSignal;
      viewRequest.set({ seq: ++handled.seq, kind: 'upright' });
    }
  }, [fitSignal, resetRotationSignal, viewRequest]);

  useAnimatedReaction(
    () => viewRequest.get(),
    (request, previous) => {
      if (!previous || request.seq === previous.seq) return;
      const { w, h } = viewSize.get();
      if (w <= 0) return;
      animateView(request.kind === 'fit' ? fitTransform(w, h, docW, docH) : uprightTransform(transform.get(), w, h));
    },
  );

  // ---- derived render values ---------------------------------------------------------------
  const groupTransform = useDerivedValue(() => {
    const t = transform.get();
    const view = [{ translateX: t.tx }, { translateY: t.ty }, { rotate: t.rotation }, { scale: t.scale }];
    // The mirror is the innermost step: document → mirrored display space.
    return mirrorSV.get() ? [...view, { translateX: docW }, { scaleX: -1 }] : view;
  });
  const layerGroupTransform = useDerivedValue(() => transformProp(layerTransform.get()));
  /** 1 screen pixel expressed in canvas units, for hairline overlays. */
  const hairline = useDerivedValue(() => 1 / transform.get().scale);
  const layerHairline = useDerivedValue(() => 1.5 / (transform.get().scale * layerTransform.get().scale));
  const boxPath = useDerivedValue(() => {
    const box = boxSV.get();
    return box ? Skia.Path.Rect(box) : Skia.Path.Make();
  });
  /** Corner handles, sized in screen points whatever the zoom and content scale. */
  const handlesPath = useDerivedValue(() => {
    const box = boxSV.get();
    if (!box) return Skia.Path.Make();
    const size = HANDLE_SIZE / (transform.get().scale * layerTransform.get().scale);
    const b = Skia.PathBuilder.Make();
    const corners = [box.x, box.y, box.x + box.width, box.y, box.x + box.width, box.y + box.height, box.x, box.y + box.height];
    for (let i = 0; i < corners.length; i += 2) {
      b.addRect(Skia.XYWHRect(corners[i] - size / 2, corners[i + 1] - size / 2, size, size));
    }
    return b.build();
  });
  const axesPath = useDerivedValue(() => {
    const m = symModeSV.get();
    if (m === 'off') return Skia.Path.Make();
    const a = axisSV.get();
    const segs = symmetryAxes({ mode: m, x: a.x, y: a.y, segments: symSegmentsSV.get() }, docW, docH);
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i + 3 < segs.length; i += 4) b.moveTo(segs[i], segs[i + 1]).lineTo(segs[i + 2], segs[i + 3]);
    return b.build();
  });
  const rulerGuide = useDerivedValue(() => rulerPath(rulerSV.get(), docW, docH));
  const rulerHandlesPath = useDerivedValue(() => {
    if (!editGuidesSV.get()) return Skia.Path.Make();
    const r = HANDLE_SIZE / transform.get().scale;
    const b = Skia.PathBuilder.Make();
    for (const h of rulerHandles(rulerSV.get())) b.addCircle(h.x, h.y, r);
    return b.build();
  });
  const liquifyPoints = useDerivedValue(() => toPoints(liquifyPositions.get()));
  const liquifyTexPoints = useMemo(() => toPoints(liquifyTex), [liquifyTex]);
  const stabGuidePath = useDerivedValue(() => {
    const g = stabGuide.get();
    if (!g.visible) return Skia.Path.Make();
    return Skia.PathBuilder.Make().moveTo(g.fx, g.fy).lineTo(g.tx, g.ty).build();
  });
  const stabTipX = useDerivedValue(() => stabGuide.get().tx);
  const stabTipY = useDerivedValue(() => stabGuide.get().ty);
  const stabDotR = useDerivedValue(() => (stabGuide.get().visible ? 3 : 0));
  // Distort / warp preview and handles.
  const meshSrc = useMemo(
    () => (transformSession ? { ...transformSession.box, x: transformSession.box.x - transformSession.origin.x, y: transformSession.box.y - transformSession.origin.y } : null),
    [transformSession],
  );
  const meshTexture = useMemo(
    () =>
      meshSrc
        ? ([
            vec(meshSrc.x, meshSrc.y),
            vec(meshSrc.x + meshSrc.width, meshSrc.y),
            vec(meshSrc.x + meshSrc.width, meshSrc.y + meshSrc.height),
            vec(meshSrc.x, meshSrc.y + meshSrc.height),
          ] as const)
        : undefined,
    [meshSrc],
  );
  const distortMatrix = useDerivedValue(() => {
    const m = mesh.get();
    if (!meshSrc || m.length !== 12) return Skia.Matrix();
    return Skia.Matrix(homography(meshSrc, [m[0], m[3], m[6], m[9]]));
  });
  const meshPatch = useDerivedValue(() => {
    const m = mesh.get();
    return m.length === 12 ? patchHandles(m) : patchHandles(Array.from({ length: 12 }, () => ({ x: 0, y: 0 })));
  });
  const meshOutline = useDerivedValue(() => {
    const m = mesh.get();
    if (m.length !== 12) return Skia.Path.Make();
    const b = Skia.PathBuilder.Make().moveTo(m[0].x, m[0].y);
    for (let i = 0; i < 12; i += 3) b.cubicTo(m[i + 1].x, m[i + 1].y, m[i + 2].x, m[i + 2].y, m[(i + 3) % 12].x, m[(i + 3) % 12].y);
    if (meshModeSV.get() === 'warp') {
      // Arms from each corner to its edge handles.
      for (const c of [0, 3, 6, 9]) {
        for (const n of [(c + 11) % 12, c + 1]) b.moveTo(m[c].x, m[c].y).lineTo(m[n].x, m[n].y);
      }
    }
    return b.build();
  });
  /** Corner squares (and edge-handle dots in warp), sized in screen points. */
  const meshHandles = useDerivedValue(() => {
    const m = mesh.get();
    if (m.length !== 12) return Skia.Path.Make();
    const size = HANDLE_SIZE / transform.get().scale;
    const b = Skia.PathBuilder.Make();
    for (const i of [0, 3, 6, 9]) b.addRect(Skia.XYWHRect(m[i].x - size / 2, m[i].y - size / 2, size, size));
    if (meshModeSV.get() === 'warp') {
      for (const i of [1, 2, 4, 5, 7, 8, 10, 11]) b.addCircle(m[i].x, m[i].y, size * 0.45);
    }
    return b.build();
  });
  const meshHairline = useDerivedValue(() => 1.5 / transform.get().scale);
  const perspectivePath = useDerivedValue(() => buildPerspectivePath(docW, docH, vpLive.get()) ?? Skia.Path.Make());
  /** Vanishing-point handles, sized in screen points. */
  const vpHandlesPath = useDerivedValue(() => {
    if (!editGuidesSV.get()) return Skia.Path.Make();
    const r = HANDLE_SIZE / transform.get().scale;
    const b = Skia.PathBuilder.Make();
    for (const v of vpLive.get()) b.addCircle(v.x, v.y, r);
    return b.build();
  });
  const axisHandleX = useDerivedValue(() => axisSV.get().x);
  const axisHandleY = useDerivedValue(() => axisSV.get().y);
  const axisHandleR = useDerivedValue(() => (HANDLE_SIZE * 0.8) / transform.get().scale);
  const axisDash = useDerivedValue(() => [6 / transform.get().scale, 4 / transform.get().scale]);

  const docRect = useMemo(() => rect(0, 0, docW, docH), [docW, docH]);
  const transparentPaper = isTransparentColor(background);
  const checkerTileRect = useMemo(() => {
    const cell = checkerCellFor(docW, docH);
    return rect(0, 0, cell * 2, cell * 2);
  }, [docW, docH]);
  const guidesPath = useMemo(() => buildGuidesPath(docW, docH, guides), [docW, docH, guides]);
  const dash = Math.max(4, Math.max(docW, docH) / 160);

  const activeId = doc.layers.active?.meta.id;
  const activeImageProp = doc.layers.active?.image ?? null;
  const textureImage = useMemo(
    () => getTextureImage(brush.texture.kind, brush.texture.strength, brush.texture.variation),
    [brush.texture.kind, brush.texture.strength, brush.texture.variation],
  );
  // Texture tiles are drawn at their own size times the brush's texture scale, turned by its angle.
  const textureScale = brush.texture.scale;
  const textureAngle = brush.texture.angle;
  const mixSigma = blendSigma(brush, tool);
  const session = interaction === 'transform' ? transformSession : null;
  const strokeBlend = isEraser ? BlendMode.DstOut : alphaLocked ? BlendMode.SrcATop : BlendMode.SrcOver;
  const strokeOpacity = brush.opacity;
  // The active layer (image + pending strokes + live stroke) is recorded into ONE picture on the
  // UI thread. Skia reads each shared value of a recording separately when React re-renders, so
  // separate values could be caught mid-update (e.g. a stroke parked between two reads) and a
  // frame would be drawn without the stroke. A single value is always self-consistent.
  const activeContent = useDerivedValue(() => {
    const fresh = freshImage.get();
    // Until this render includes a stroke's commit, show the image that commit produced.
    const image = fresh && fresh.layerId === activeId && fresh.version > version ? fresh.image : activeImageProp;
    try {
      return recordActiveLayer({
      image,
      width: docW,
      height: docH,
      clip: selection,
      opacity: strokeOpacity,
      blend: strokeBlend,
      texture: textureImage,
      textureScale,
      textureAngle,
      blendSigma: mixSigma,
        groups: [[pending.get()], [committed.get(), chunk.get(), tail.get()]],
      });
    } catch (err) {
      // E.g. an image released mid-frame (layer deleted). Draw nothing this frame rather than
      // crash; the next render brings the current layer.
      console.error('[canvas] active layer render failed', String(err));
      return emptyPicture();
    }
  });
  const showAxisHandle = symmetry !== null && (interaction === 'paint' || interaction === 'shape');
  // While selecting, dim everything outside the selection so its content stands out; the
  // artwork itself is untouched.
  const outsideSelection = useMemo(
    () => (selection ? Skia.Path.MakeFromOp(Skia.Path.Rect(docRect), selection, PathOp.Difference) : null),
    [selection, docRect],
  );

  /**
   * A layer's pixels, without its opacity or blend mode. The active layer shows the live
   * stroke (or the pending transform) on top of its committed pixels.
   */
  const layerContent = (layer: RasterLayer) => {
    if (adjustPreview && adjustPreview.layerId === layer.meta.id) return adjustedContent(layer.image, adjustPreview.adjustment);
    if (layer.meta.id !== activeId) {
      return <Image image={layer.image} x={0} y={0} width={docW} height={docH} fit="fill" />;
    }
    if (interaction === 'liquify' && liquifyMesh) {
      return (
        <Vertices vertices={liquifyPoints} textures={liquifyTexPoints} indices={liquifyIdx} mode="triangles">
          <ImageShader image={layer.image} tx="decal" ty="decal" />
        </Vertices>
      );
    }
    if (!session) {
      return (
        <>
          <Picture picture={activeContent} />
          {interaction === 'gradient' ? <Picture picture={gradientPicture} /> : null}
        </>
      );
    }
    return (
      <>
        {session.base ? <Image image={session.base} x={0} y={0} width={docW} height={docH} fit="fill" /> : null}
        {meshMode === 'distort' ? (
          // Floating pixels (in their own coordinates) through the perspective map.
          <Group matrix={distortMatrix}>
            <Image image={session.floating} x={0} y={0} width={session.floating.width()} height={session.floating.height()} fit="fill" />
          </Group>
        ) : meshMode === 'warp' && meshTexture ? (
          <Patch patch={meshPatch} texture={meshTexture}>
            <ImageShader image={session.floating} tx="decal" ty="decal" />
          </Patch>
        ) : (
          <Group transform={layerGroupTransform}>
            <Image
              image={session.floating}
              x={session.origin.x}
              y={session.origin.y}
              width={session.floating.width()}
              height={session.floating.height()}
              fit="fill"
            />
          </Group>
        )}
      </>
    );
  };

  /** A layer image with an adjustment applied (inside the selection only, if there is one). */
  const adjustedContent = (image: SkImage, adjustment: Adjustment) => {
    const fx = adjustEffect();
    const u = adjustUniforms(adjustment);
    const adjusted =
      adjustment.kind === 'blur' ? (
        <Image image={image} x={0} y={0} width={docW} height={docH} fit="fill">
          <Blur blur={blurSigma(adjustment)} mode="decal" />
        </Image>
      ) : fx ? (
        <Rect rect={docRect}>
          <Shader source={fx} uniforms={{ kind: u.kind, p: u.p, q: u.q }}>
            <ImageShader image={image} tx="clamp" ty="clamp" />
          </Shader>
        </Rect>
      ) : (
        <Image image={image} x={0} y={0} width={docW} height={docH} fit="fill" />
      );
    if (!selection) return adjusted;
    return (
      <>
        <Image image={image} x={0} y={0} width={docW} height={docH} fit="fill" />
        <Group clip={selection}>{adjusted}</Group>
      </>
    );
  };

  /** One layer with its clipping layers and masks (same maths as `drawLayerStack`). */
  const renderUnit = ({ base, attached }: LayerGroup<RasterLayer>) => {
    const { id, visible, opacity, blendMode } = base.meta;
    if (!visible) return null;
    const shown = attached.filter((l) => l.meta.visible);
    if (shown.length === 0) {
      if (id !== activeId && !(adjustPreview && adjustPreview.layerId === id)) {
        return (
          <Image key={id} image={base.image} x={0} y={0} width={docW} height={docH} fit="fill" opacity={opacity} blendMode={blendModeProp(blendMode)} />
        );
      }
      // The active layer is composited in its own save-layer so the live stroke (including
      // eraser previews) interacts only with this layer's pixels.
      return (
        <Group key={id} layer={<Paint opacity={opacity} blendMode={blendModeProp(blendMode)} />}>
          {layerContent(base)}
        </Group>
      );
    }
    return (
      <Group key={id} layer={<Paint blendMode={blendModeProp(blendMode)} />}>
        <Group layer={<Paint opacity={opacity} />}>{layerContent(base)}</Group>
        {shown.map((layer) =>
          layer.meta.mask ? (
            <Group
              key={layer.meta.id}
              layer={
                <Paint blendMode="dstIn">
                  <ColorMatrix matrix={maskMatrix(layer.meta.opacity)} />
                </Paint>
              }>
              <Rect rect={docRect} color="black" />
              {layerContent(layer)}
            </Group>
          ) : (
            <Group key={layer.meta.id} layer={<Paint opacity={layer.meta.opacity} blendMode={blendModeProp(layer.meta.blendMode)} />}>
              {layerContent(layer)}
              <Group layer={<Paint blendMode="dstIn" />}>{layerContent(base)}</Group>
            </Group>
          ),
        )}
      </Group>
    );
  };

  /** A top-level stack item: a folder (composited as one) or a single unit. */
  const renderItem = (item: StackItem<RasterLayer>) => {
    if (item.kind === 'unit') return renderUnit(item.unit);
    if (!item.group.visible) return null;
    return (
      <Group layer={<Paint opacity={item.group.opacity} blendMode={blendModeProp(item.group.blendMode)} />}>
        {item.units.map(renderUnit)}
      </Group>
    );
  };

  // What is drawn: every item, or with animation on the current frame (plus background and
  // tinted onion skins of the neighbouring frames while not playing).
  const items = stackItems(doc.layers.list, doc.groups);
  const anim = doc.animation;
  const shownItems: { item: StackItem<RasterLayer>; onion: { opacity: number; tint: number[] } | null }[] = [];
  if (anim.enabled && items.length > 0) {
    const current = Math.min(items.length - 1, Math.max(0, playFrame ?? doc.activeFrameIndex));
    const first = anim.background ? 1 : 0;
    if (anim.background && current !== 0) shownItems.push({ item: items[0], onion: null });
    if (playFrame === null) {
      for (let k = anim.onionBefore; k >= 1; k--) {
        const i = current - k;
        if (i >= first) shownItems.push({ item: items[i], onion: { opacity: anim.onionOpacity * (1 - (k - 1) / (anim.onionBefore + 1)), tint: ONION_BEFORE } });
      }
      for (let k = anim.onionAfter; k >= 1; k--) {
        const i = current + k;
        if (i < items.length) shownItems.push({ item: items[i], onion: { opacity: anim.onionOpacity * (1 - (k - 1) / (anim.onionAfter + 1)), tint: ONION_AFTER } });
      }
    }
    shownItems.push({ item: items[current], onion: null });
  } else {
    for (const item of items) shownItems.push({ item, onion: null });
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.root}
        collapsable={false}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          viewSize.set({ w: width, h: height });
          if (!fittedRef.current && width > 0) {
            fittedRef.current = true;
            transform.set(fitTransform(width, height, docW, docH));
          }
        }}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={colors.canvasBackdrop} />
          <Group transform={groupTransform}>
            {transparentPaper ? (
              <Rect rect={docRect}>
                <ImageShader image={getCheckerTile()} tx="repeat" ty="repeat" fit="fill" rect={checkerTileRect} />
              </Rect>
            ) : (
              <Rect rect={docRect} color={background} />
            )}
            {/* On transparent paper the layers are composited in their own group, so blend
                modes combine layers only — never the checkerboard, which is not artwork. */}
            <Group clip={docRect} layer={transparentPaper ? <Paint /> : undefined}>
              {shownItems.map(({ item, onion }) => {
                const key = `${item.kind === 'folder' ? item.group.id : item.unit.base.meta.id}${onion ? '-onion' : ''}`;
                if (!onion) return <Group key={key}>{renderItem(item)}</Group>;
                const [r, g, b] = onion.tint;
                return (
                  <Group
                    key={key}
                    layer={
                      <Paint opacity={onion.opacity}>
                        <ColorMatrix matrix={[0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, 1, 0]} />
                      </Paint>
                    }>
                    {renderItem(item)}
                  </Group>
                );
              })}
            </Group>
            {guidesPath ? (
              <Group clip={docRect}>
                <Path path={guidesPath} style="stroke" strokeWidth={hairline} color={`rgba(${GUIDE_RGB},${guides.opacity})`} />
              </Group>
            ) : null}

            {guides.perspective > 0 ? (
              <>
                <Group clip={docRect}>
                  <Path path={perspectivePath} style="stroke" strokeWidth={hairline} color={`rgba(${PERSPECTIVE_RGB},${guides.opacity})`} />
                </Group>
                {/* Handles may lie outside the canvas (zoom out to reach them). */}
                <Path path={vpHandlesPath} color={`rgba(${PERSPECTIVE_RGB},0.35)`} />
                <Path path={vpHandlesPath} style="stroke" strokeWidth={hairline} color={`rgb(${PERSPECTIVE_RGB})`} />
              </>
            ) : null}

            {guides.ruler.kind !== 'off' ? (
              <>
                <Group clip={docRect}>
                  <Path path={rulerGuide} style="stroke" strokeWidth={hairline} color={`rgba(${RULER_RGB},${Math.max(0.35, guides.opacity)})`} />
                </Group>
                <Path path={rulerHandlesPath} color={`rgba(${RULER_RGB},0.35)`} />
                <Path path={rulerHandlesPath} style="stroke" strokeWidth={hairline} color={`rgb(${RULER_RGB})`} />
              </>
            ) : null}

            {symmetry ? (
              <Group clip={docRect}>
                <Path path={axesPath} style="stroke" strokeWidth={hairline} color={AXIS_COLOR}>
                  <DashPathEffect intervals={axisDash} />
                </Path>
              </Group>
            ) : null}
            {showAxisHandle ? (
              <>
                <Circle cx={axisHandleX} cy={axisHandleY} r={axisHandleR} color="rgba(190,120,255,0.35)" />
                <Circle cx={axisHandleX} cy={axisHandleY} r={axisHandleR} style="stroke" strokeWidth={hairline} color={AXIS_COLOR} />
              </>
            ) : null}

            {interaction === 'select' && outsideSelection ? <Path path={outsideSelection} color="rgba(0,0,0,0.28)" /> : null}

            {session && meshMode !== 'free' ? (
              <>
                <Path path={meshOutline} style="stroke" strokeWidth={meshHairline} color={colors.accent} />
                <Path path={meshHandles} color="white" />
                <Path path={meshHandles} style="stroke" strokeWidth={meshHairline} color={colors.accent} />
              </>
            ) : session ? (
              <Group transform={layerGroupTransform}>
                <Path path={boxPath} style="stroke" strokeWidth={layerHairline} color={colors.accent} />
                <Path path={handlesPath} color="white" />
                <Path path={handlesPath} style="stroke" strokeWidth={layerHairline} color={colors.accent} />
                {session.selection ? <MarchingAnts path={session.selection} width={layerHairline} dash={dash} /> : null}
              </Group>
            ) : selection ? (
              <MarchingAnts path={selection} width={hairline} dash={dash} />
            ) : null}
            <MarchingAnts path={selectionDraft} width={hairline} dash={dash} />
            {interaction === 'vector' ? <Picture picture={overlay} /> : null}
          </Group>
          {/* Stabiliser guide (screen space): line from the finger to the gliding brush tip. */}
          <Path path={stabGuidePath} style="stroke" strokeWidth={1.5} color={STAB_COLOR} />
          <Circle cx={stabTipX} cy={stabTipY} r={stabDotR} color={STAB_COLOR} />
        </Canvas>
        <EyedropperLoupe loupe={loupe} />
        {fillBusy ? <BucketProgress /> : null}
      </View>
    </GestureDetector>
  );
}

function BucketProgress() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => progress.set(0);
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [-42, 42]) }],
  }));
  return (
    <View pointerEvents="none" style={styles.bucketProgress} accessibilityLabel="Filling canvas">
      <View style={styles.bucketProgressTrack}>
        <Animated.View style={[styles.bucketProgressFill, style]} />
      </View>
    </View>
  );
}

/** Normalised rectangle from two opposite corners. */
function boxFromCorners(x0: number, y0: number, x1: number, y1: number): SkRect {
  'worklet';
  return Skia.XYWHRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
}

/** UI-thread buffer of atlas items for the chunk being drawn. Arrays always grow together. */
interface AtlasBuffer {
  x: SkRSXform[];
  c: SkColor[];
  s: SkRect[];
}

function emptyBuffer(): AtlasBuffer {
  'worklet';
  return { x: [], c: [], s: [] };
}

function appendBuffer(buffer: AtlasBuffer, dabs: number[], rgb: number[]): void {
  'worklet';
  appendAtlas(dabs, 0, rgb, Skia.XYWHRect(0, 0, TIP_SIZE, TIP_SIZE), buffer.x, buffer.c, buffer.s);
}

/** Recording bounds for live pictures: generously larger than any canvas. */
const RECORD_EXTENT = 1 << 16;

/**
 * Records a picture that draws `base` (if any) followed by the buffer as one atlas. Array
 * lengths are validated here, on the recording thread, so a mismatch can never reach the
 * renderer (where Skia would abort the app).
 */
function recordAtlasPicture(tip: SkImage | null, buffer: AtlasBuffer | null, base: SkPicture | null): SkPicture {
  'worklet';
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(-RECORD_EXTENT, -RECORD_EXTENT, RECORD_EXTENT * 2, RECORD_EXTENT * 2));
  if (base) canvas.drawPicture(base);
  const n = buffer ? buffer.x.length : 0;
  if (tip && buffer && n > 0 && buffer.s.length === n && buffer.c.length === n) {
    canvas.drawAtlas(tip, buffer.s, buffer.x, Skia.Paint(), BlendMode.Modulate, buffer.c, {
      filter: FilterMode.Linear,
      mipmap: MipmapMode.Linear,
    });
  }
  return recorder.finishRecordingAsPicture();
}

function emptyPicture(): SkPicture {
  'worklet';
  return recordAtlasPicture(null, null, null);
}

const EMPTY_PICTURE = emptyPicture();

/** A finished stroke shown until its commit is on screen. */
interface PendingStroke {
  id: number;
  picture: SkPicture;
}

/** The active layer's image right after a stroke commit, and the document version it belongs to. */
interface FreshImage {
  layerId: string;
  image: SkImage;
  version: number;
}

interface ActiveLayerContent {
  /** Committed pixels of the active layer. */
  image: SkImage | null;
  width: number;
  height: number;
  /** Selection: strokes are clipped to it, the layer image is not. */
  clip: SkPath | null;
  opacity: number;
  blend: BlendMode;
  texture: SkImage | null;
  textureScale: number;
  textureAngle: number;
  /** Blending brush: the strokes mask the layer blurred by this sigma (0 = they paint). */
  blendSigma: number;
  /** Stroke pictures; each group is drawn opaque and composited once with the brush opacity. */
  groups: SkPicture[][];
}

/** Records the whole active layer as one picture (see `activeContent`). */
function recordActiveLayer(c: ActiveLayerContent): SkPicture {
  'worklet';
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(-RECORD_EXTENT, -RECORD_EXTENT, RECORD_EXTENT * 2, RECORD_EXTENT * 2));
  const area = Skia.XYWHRect(0, 0, c.width, c.height);
  if (c.image) {
    canvas.drawImageRectOptions(
      c.image,
      Skia.XYWHRect(0, 0, c.image.width(), c.image.height()),
      area,
      FilterMode.Linear,
      MipmapMode.None,
      null,
    );
  }
  canvas.save();
  if (c.clip) canvas.clipPath(c.clip, ClipOp.Intersect, true);
  const layerPaint = Skia.Paint();
  layerPaint.setAlphaf(c.opacity);
  layerPaint.setBlendMode(c.blend);
  let texturePaint: SkPaint | null = null;
  if (c.texture) {
    texturePaint = Skia.Paint();
    texturePaint.setShader(
      c.texture.makeShaderOptions(
        TileMode.Repeat,
        TileMode.Repeat,
        FilterMode.Linear,
        MipmapMode.None,
        Skia.Matrix(textureMatrix(c.textureScale, c.textureAngle)),
      ),
    );
    texturePaint.setBlendMode(BlendMode.DstIn);
  }
  let mixPaint: SkPaint | null = null;
  if (c.image && c.blendSigma > 0) {
    mixPaint = Skia.Paint();
    mixPaint.setImageFilter(Skia.ImageFilter.MakeBlur(c.blendSigma, c.blendSigma, TileMode.Decal, null));
    mixPaint.setBlendMode(BlendMode.SrcIn);
  }
  for (const group of c.groups) {
    canvas.saveLayer(layerPaint, area);
    for (const picture of group) canvas.drawPicture(picture);
    if (texturePaint) canvas.drawRect(area, texturePaint);
    if (mixPaint && c.image) canvas.drawImage(c.image, 0, 0, mixPaint);
    canvas.restore();
  }
  canvas.restore();
  return recorder.finishRecordingAsPicture();
}

/** One picture drawing `pictures` in order. */
function combinePictures(pictures: SkPicture[]): SkPicture {
  'worklet';
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(-RECORD_EXTENT, -RECORD_EXTENT, RECORD_EXTENT * 2, RECORD_EXTENT * 2));
  for (const picture of pictures) canvas.drawPicture(picture);
  return recorder.finishRecordingAsPicture();
}

/**
 * Runs when a stroke's commit reaches the UI thread: publishes the new layer image (null if
 * nothing was drawn) and drops the stroke's pending preview in the same frame. Commits arrive
 * in order, so every pending stroke up to `id` is settled.
 */
function settleStroke(
  id: number,
  fresh: FreshImage | null,
  freshImage: SharedValue<FreshImage | null>,
  pendingStrokes: SharedValue<PendingStroke[]>,
  pending: SharedValue<SkPicture>,
): void {
  'worklet';
  try {
    if (fresh) freshImage.set(fresh);
    const list = pendingStrokes.get().filter((s) => s.id > id);
    pendingStrokes.set(list);
    pending.set(combinePictures(list.map((s) => s.picture)));
  } catch (err) {
    console.error('[canvas] settle failed', String(err));
    pendingStrokes.set([]);
    pending.set(emptyPicture());
  }
}

/** Releases the fresh image once React has rendered a later version (which shows it already). */
function dropStaleFreshImage(freshImage: SharedValue<FreshImage | null>, version: number): void {
  'worklet';
  const fresh = freshImage.get();
  if (fresh && fresh.version < version) freshImage.set(null);
}

/** Clears the in-progress selection outline unless a selection drag is in progress. */
function clearSelectionDraft(mode: SharedValue<number>, draft: SharedValue<SkPath>): void {
  'worklet';
  if (mode.get() !== MODE_SELECT) draft.set(Skia.Path.Make());
}

/** Selection outline: a white line under a dashed black line, readable on any artwork. */
function MarchingAnts({
  path,
  width,
  dash,
}: {
  path: SkPath | SharedValue<SkPath>;
  width: SharedValue<number>;
  dash: number;
}) {
  return (
    <>
      <Path path={path} style="stroke" strokeWidth={width} color="white" />
      <Path path={path} style="stroke" strokeWidth={width} color="black">
        <DashPathEffect intervals={[dash, dash]} />
      </Path>
    </>
  );
}

/**
 * Eyedropper loupe shown above the finger: magnified pixels around the sample point with the
 * target pixel outlined, ringed by the sampled colour (top half: current colour for comparison).
 */
function EyedropperLoupe({ loupe }: { loupe: SharedValue<{ x: number; y: number; visible: boolean }> }) {
  const sampled = useEyedropperStore((s) => s.color);
  const preview = useEyedropperStore((s) => s.preview);
  const current = useToolStore((s) => s.color);
  const style = useAnimatedStyle(() => {
    const l = loupe.get();
    return {
      opacity: l.visible ? 1 : 0,
      transform: [{ translateX: l.x - LOUPE / 2 }, { translateY: l.y - LOUPE - 48 }],
    };
  });
  const inner = LOUPE - LOUPE_RING * 2;
  const cell = inner / 11;
  return (
    <Animated.View pointerEvents="none" style={[styles.loupe, style]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle cx={LOUPE / 2} cy={LOUPE / 2} r={LOUPE / 2} color={sampled ?? colors.panel} />
        <Group clip={rect(0, 0, LOUPE, LOUPE / 2)}>
          <Circle cx={LOUPE / 2} cy={LOUPE / 2} r={LOUPE / 2} color={current} />
        </Group>
        <Group clip={Skia.RRectXY(rect(LOUPE_RING, LOUPE_RING, inner, inner), inner / 2, inner / 2)}>
          <Rect x={LOUPE_RING} y={LOUPE_RING} width={inner} height={inner} color={colors.panel} />
          {preview ? <Image image={preview} x={LOUPE_RING} y={LOUPE_RING} width={inner} height={inner} fit="fill" /> : null}
          <Rect x={LOUPE / 2 - cell / 2} y={LOUPE / 2 - cell / 2} width={cell} height={cell} style="stroke" strokeWidth={1.5} color="white" />
        </Group>
        <Circle cx={LOUPE / 2} cy={LOUPE / 2} r={LOUPE / 2 - 0.5} style="stroke" strokeWidth={1} color="rgba(0,0,0,0.5)" />
      </Canvas>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.canvasBackdrop },
  bucketProgress: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bucketProgressTrack: {
    width: 96,
    height: 6,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: colors.overlay,
  },
  bucketProgressFill: {
    width: 44,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  loupe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: LOUPE,
    height: LOUPE,
    borderRadius: LOUPE / 2,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
}));
