import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DrawingDocument, TransformSession } from '@/engine/document/DrawingDocument';
import type { ViewTransform } from '@/engine/input/viewTransform';
import { composeGesture, flipTransform, IDENTITY_TRANSFORM, mapPoint, type LayerTransform } from '@/engine/layers/layerTransform';
import { meshFromCorners, meshFromTransform, type Mesh, type MeshMode } from '@/engine/layers/meshWarp';
import { buildGuidesPath } from '@/engine/render/guides';
import { decodeImportedImage } from '@/engine/render/imageDecode';
import { comicPanels, drawPanels } from '@/engine/comics/drawComic';
import { traceLayerImage } from '@/engine/vector/traceLayer';
import { PanelLayoutPicker } from '@/features/comics/PanelLayoutPicker';
import { useVectorTool } from '@/features/vector/useVectorTool';
import { VectorBar, VectorLayerHint } from '@/features/vector/VectorBar';
import { VectorConvertDialog } from '@/features/vector/VectorConvertDialog';
import { BrushPanel } from '@/features/editor/BrushPanel';
import { ColorPanel } from '@/features/editor/ColorPanel';
import { DrawingCanvas, type QuickHistoryAction } from '@/features/editor/DrawingCanvas';
import { GuidesPanel } from '@/features/editor/GuidesPanel';
import { LayersPanel } from '@/features/editor/LayersPanel';
import { PhoneSideSliders, PhoneToolbar, ToolRail, type EditorPanel, type ExtraTool } from '@/features/editor/QuickTools';
import { SettingsPanel } from '@/features/editor/SettingsPanel';
import { SymmetryPanel } from '@/features/editor/SymmetryPanel';
import { useDocumentVersion, useEditorSession, type SaveStatus } from '@/features/editor/useEditorSession';
import { drawFigure } from '@/engine/figure/drawFigure';
import { BODIES, buildFigure, makeProjector } from '@/engine/figure/mannequin';
import { ReferenceWindow, ShowReferenceButton } from '@/features/editor/ReferenceWindow';
import { PoseFigureWindow, ShowFigureButton, type FigureSnapshot } from '@/features/figure/PoseFigureWindow';
import { PreviewWindow } from '@/features/editor/PreviewWindow';
import { ReferenceLibraryPicker } from '@/features/references/ReferenceLibraryPicker';
import { AdjustmentsSheet } from '@/features/editor/AdjustmentsSheet';
import { AnimationBar } from '@/features/editor/AnimationBar';
import { CanvasSizeDialog, HistoryDialog, TextDialog } from '@/features/editor/EditorDialogs';
import { createLiquifyMesh } from '@/engine/layers/liquify';
import { adjustmentInfo, defaultAdjustment, type Adjustment } from '@/engine/render/adjustments';
import { renderTextImage, type TextSpec } from '@/engine/render/text';
import { screenToCanvas } from '@/engine/input/viewTransform';
import { ANIMATION_FILE_TYPES, isVideoExportAvailable, renderAnimation } from '@/storage/animationExport';
import { assertSharing, shareFile } from '@/storage/exportService';
import { PSD_FILE_TYPE, renderPsd } from '@/storage/psdExport';
import { SHORTCUTS, shortcutFor, useKeyPresses, type ShortcutAction } from '@/features/editor/keyboardShortcuts';
import { KeyCaptureView, type KeyPress } from '../../../modules/zumi-keyboard';
import {
  FillBar,
  GradientBar,
  LiquifyBar,
  SelectionBar,
  ShapeBar,
  Toast,
  TopBar,
  TransformBar,
  ViewFlippedBadge,
} from '@/features/editor/WorkspaceChrome';
import { ExportDialog } from '@/features/export/ExportDialog';
import { TimelapseDialog } from '@/features/timelapse/TimelapseDialog';
import { useBrushStore } from '@/state/brushStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useReferenceLibraryStore } from '@/state/referenceLibraryStore';
import { useToolStore } from '@/state/toolStore';
import { saveBackupToFolder, shareBackup } from '@/storage/backupService';
import { DEFAULT_EXPORT_OPTIONS, saveDocumentToPhotos, shareDocument, type ExportOptions } from '@/storage/exportService';
import { pickImageFile, pickImageFiles } from '@/storage/importService';
import {
  addReferenceImages,
  clearReferenceImages,
  MAX_REFERENCES,
  removeReferenceImage,
  type StoredReference,
} from '@/storage/projectRepository';
import type { LibraryImage } from '@/storage/referenceIndex';
import { libraryImageUri } from '@/storage/referenceLibrary';
import type { TimelapseRecorder } from '@/storage/timelapseRepository';
import { ActionSheet, type ActionSheetOption } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { colors, radius, spacing, themed } from '@/ui/theme';
import { describeError, errorText } from '@/utils/errors';

/** Width at which the workspace switches to the tablet layout (rail + side panels). */
const TABLET_WIDTH = 720;
/** Below this width the top bar folds secondary tools into an overflow menu. */
const COMPACT_BAR_WIDTH = 600;
/**
 * Tablet side-panel widths: the brush browser and layer list get more room than on a phone;
 * both also run the full height of the canvas.
 */
const TABLET_PANEL_WIDTH: Record<EditorPanel, number> = {
  brush: 420,
  layers: 380,
  color: 340,
  guides: 320,
  symmetry: 320,
  settings: 340,
};
const TALL_PANELS: readonly EditorPanel[] = ['brush', 'layers'];
/** Height taken by the rail's buttons, dividers and the top bar — what the sliders cannot use. */
const RAIL_CHROME_HEIGHT = 440;
const TOAST_MS = 1400;

type Menu = 'more' | 'import' | 'export' | 'refSource';

export function EditorScreen({ projectId }: { projectId: string }) {
  const { state, save, saveStatus, retry, getTimelapse } = useEditorSession(projectId);

  useEffect(() => {
    if (state.status !== 'ready') return;
    if (state.recoveredFrom !== null) {
      const when = new Date(state.recoveredFrom).toLocaleString();
      Alert.alert(
        'Artwork recovered',
        `Zumi closed unexpectedly while this artwork was open. It was reopened from the last autosave (${when}).`,
      );
    }
    if (state.warnings.length > 0) {
      Alert.alert('Some content could not be restored', state.warnings.join('\n'));
    }
  }, [state]);

  if (state.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.centerText}>Opening artwork…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.center} accessibilityRole="alert">
        <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
        <Text style={styles.centerTitle}>{state.error.title}</Text>
        <Text style={styles.centerText}>{state.error.message}</Text>
        <Text style={styles.centerHint}>{state.error.recovery}</Text>
        <View style={styles.centerActions}>
          <Pressable style={styles.textButton} accessibilityRole="button" onPress={retry}>
            <Text style={styles.textButtonLabel}>Try again</Text>
          </Pressable>
          <Pressable style={styles.textButton} accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.textButtonLabel}>Back to gallery</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Editor
      doc={state.doc}
      onSave={save}
      saveStatus={saveStatus}
      initialReferences={state.references}
      getTimelapse={getTimelapse}
    />
  );
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 32));

/**
 * Frees a transform session's images once the UI thread has stopped drawing them (the last
 * frame may still reference them right after the session ends).
 */
function releaseLater(doc: DrawingDocument, session: TransformSession): void {
  setTimeout(() => doc.endTransform(session), 1000);
}

function Editor({
  doc,
  onSave,
  saveStatus,
  initialReferences,
  getTimelapse,
}: {
  doc: DrawingDocument;
  onSave: () => boolean;
  saveStatus: SaveStatus;
  initialReferences: StoredReference[];
  getTimelapse: () => TimelapseRecorder | null;
}) {
  useDocumentVersion(doc);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_WIDTH;
  const compactUi = useSettingsStore((s) => s.compactUi);
  const compactBar = compactUi || width < COMPACT_BAR_WIDTH;
  // Landscape phones qualify as wide, but are short: keep the rail's sliders on screen.
  const railSliderLength = Math.max(56, Math.min(compactUi ? 110 : 130, Math.floor((height - RAIL_CHROME_HEIGHT) / 2) + 60));
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const leftHanded = useSettingsStore((s) => s.leftHanded);
  const railSide = leftHanded ? 'right' : 'left';

  const interaction = useToolStore((s) => s.interaction);
  const tool = useToolStore((s) => s.tool);
  const selectShape = useToolStore((s) => s.selectShape);
  const setInteraction = useToolStore((s) => s.setInteraction);
  const setSelectShape = useToolStore((s) => s.setSelectShape);
  const shapeKind = useToolStore((s) => s.shapeKind);
  const shapeConstrain = useToolStore((s) => s.shapeConstrain);
  const setShapeKind = useToolStore((s) => s.setShapeKind);
  const setShapeConstrain = useToolStore((s) => s.setShapeConstrain);
  const symmetryMode = useToolStore((s) => s.symmetry.mode);
  const guides = useSettingsStore((s) => s.guides);

  const [panel, setPanel] = useState<EditorPanel | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [resetRotationSignal, setResetRotationSignal] = useState(0);
  const [rotated, setRotated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Reference images (kept with the artwork) and the floating window showing them.
  const [references, setReferences] = useState<StoredReference[]>(initialReferences);
  const [refIndex, setRefIndex] = useState(0);
  const [refWindow, setRefWindow] = useState<'open' | 'hidden' | 'closed'>(initialReferences.length > 0 ? 'open' : 'closed');
  const [exportOpen, setExportOpen] = useState(false);
  const [timelapseOpen, setTimelapseOpen] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [vectorizeOpen, setVectorizeOpen] = useState(false);
  const vectorTool = useVectorTool(doc, interaction === 'vector');
  const [figureWindow, setFigureWindow] = useState<'open' | 'hidden' | 'closed'>('closed');
  const [viewMirrored, setViewMirrored] = useState(false);
  // Mini preview window, and the canvas view it shows and moves (owned here, used by the canvas).
  const [previewOpen, setPreviewOpen] = useState(false);
  const view = useSharedValue<ViewTransform>({ tx: 0, ty: 0, scale: 1, rotation: 0 });
  const viewport = useSharedValue({ w: 0, h: 0 });
  const layerTransform = useSharedValue<LayerTransform>(IDENTITY_TRANSFORM);
  // Distort / warp: the mode and the mesh being dragged (canvas coordinates).
  const [meshMode, setMeshMode] = useState<MeshMode>('free');
  const mesh = useSharedValue<Mesh>([]);
  const [transformSession, setTransformSession] = useState<TransformSession | null>(null);
  // Adjustments sheet (live preview on the canvas), dialogs, animation playback, liquify mesh.
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(doc.animation.enabled);
  const [playFrame, setPlayFrame] = useState<number | null>(null);
  const liquifyMesh = useSharedValue<number[]>([]);
  const fill = useToolStore((s) => s.fill);
  const gradient = useToolStore((s) => s.gradient);
  const liquify = useToolStore((s) => s.liquify);
  const selectCombine = useToolStore((s) => s.selectCombine);
  // Mirrors the state so a session is released exactly once, whoever ends it.
  const sessionRef = useRef<TransformSession | null>(null);

  // Leaving transform mode any way (Apply, Cancel, or picking another tool, which sets the
  // interaction from elsewhere) discards the pending transform and frees the session's images.
  useEffect(() => {
    const release = () => {
      if (sessionRef.current) releaseLater(doc, sessionRef.current);
      sessionRef.current = null;
      layerTransform.set(IDENTITY_TRANSFORM);
    };
    const unsubscribe = useToolStore.subscribe((state, prev) => {
      if (prev.interaction === 'transform' && state.interaction !== 'transform') {
        release();
        setTransformSession(null);
      }
    });
    return () => {
      unsubscribe();
      release();
    };
  }, [doc, layerTransform]);

  // Leaving liquify any way other than Apply discards the pending mesh.
  useEffect(
    () =>
      useToolStore.subscribe((state, prev) => {
        if (prev.interaction === 'liquify' && state.interaction !== 'liquify') liquifyMesh.set([]);
      }),
    [liquifyMesh],
  );

  // Animation playback: step through the frames at the artwork's frame rate.
  const playing = playFrame !== null;
  useEffect(() => {
    if (!playing) return;
    const { fps, loop, background } = doc.animation;
    const frameCount = doc.frames.length;
    const first = background && frameCount > 1 ? 1 : 0;
    let direction = 1;
    const timer = setInterval(() => {
      setPlayFrame((current) => {
        if (current === null) return null;
        let next = current + direction;
        if (next >= frameCount) {
          if (loop === 'once') return null;
          if (loop === 'pingPong') {
            direction = -1;
            next = Math.max(first, frameCount - 2);
          } else {
            next = first;
          }
        } else if (next < first) {
          direction = 1;
          next = Math.min(frameCount - 1, first + 1);
        }
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(timer);
  }, [playing, doc]);

  // Every editor session starts (and ends) in paint mode.
  useEffect(() => () => useToolStore.getState().setInteraction('paint'), []);
  // Canvas-sized brushes can grow up to the open canvas's longest side.
  const canvasSide = Math.max(doc.info.width, doc.info.height);
  useEffect(() => {
    useBrushStore.getState().setCanvasSide(canvasSide);
    return () => useBrushStore.getState().setCanvasSide(0);
  }, [canvasSide]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  /** Gesture shortcuts give feedback, since there is no button press to confirm them. */
  const quickHistory = (action: QuickHistoryAction) => {
    if (action === 'undo') {
      const label = doc.undo();
      showToast(label ? `Undo · ${label}` : 'Nothing to undo');
    } else {
      const label = doc.redo();
      showToast(label ? `Redo · ${label}` : 'Nothing to redo');
    }
  };

  const togglePanel = (next: EditorPanel) => {
    setSheetCollapsed(false);
    setPanel((p) => (p === next ? null : next));
  };

  const runBusy = async (label: string, work: () => Promise<void> | void) => {
    setBusy(label);
    try {
      await nextFrame();
      await work();
    } catch (error) {
      console.error(`[editor] ${label}`, error);
      const described = describeError(error);
      Alert.alert(described.title, errorText(described));
    } finally {
      setBusy(null);
    }
  };

  // ---- workspace actions ---------------------------------------------------------------------

  /** Enters transform mode for the selected pixels, or the whole active layer. */
  const startTransform = () => {
    const result = doc.beginTransform();
    if (!result.ok) {
      Alert.alert('Nothing to transform', result.reason);
      return;
    }
    if (sessionRef.current) releaseLater(doc, sessionRef.current);
    sessionRef.current = result.value;
    layerTransform.set(IDENTITY_TRANSFORM);
    setMeshMode('free');
    setTransformSession(result.value);
    setPanel(null);
    setInteraction('transform');
  };

  const toggleTransform = () => (interaction === 'transform' ? setInteraction('paint') : startTransform());

  /** A one-tap tool mode (fill, gradient): toggles it and closes panels that would cover the canvas. */
  const toggleMode = (mode: 'fill' | 'gradient') => {
    setPanel(null);
    setInteraction(interaction === mode ? 'paint' : mode);
  };

  const startLiquify = () => {
    const layer = doc.layers.active;
    if (!layer || layer.meta.locked || !layer.meta.visible || layer.vector) {
      Alert.alert('Can’t liquify', 'Choose a visible, unlocked pixel layer first.');
      return;
    }
    setPanel(null);
    liquifyMesh.set(createLiquifyMesh(doc.info.width, doc.info.height));
    setInteraction('liquify');
  };

  const applyLiquify = () => {
    const result = doc.applyLiquify(liquifyMesh.get());
    if (!result.ok && result.reason !== 'Nothing was liquified.') Alert.alert('Can’t liquify', result.reason);
    setInteraction('paint');
  };

  const openAdjustments = () => {
    const layer = doc.layers.active;
    if (!layer || layer.vector) {
      Alert.alert('Adjustments', 'Choose a pixel layer first.');
      return;
    }
    setPanel(null);
    setInteraction('paint');
    setAdjustment(defaultAdjustment('hsl'));
  };

  const applyAdjustment = () => {
    const layer = doc.layers.active;
    if (!layer || !adjustment) return;
    const result = doc.applyAdjustment(layer.meta.id, adjustment, adjustmentInfo(adjustment.kind).label);
    if (!result.ok) Alert.alert('Can’t apply', result.reason);
    else setAdjustment(null);
  };

  /** Adds text as a new layer centred in the visible area, then lets the user place it. */
  const addText = (spec: TextSpec) => {
    setTextOpen(false);
    const image = renderTextImage(spec);
    if (!image) {
      Alert.alert('Can’t add text', 'The text is too large for this device. Try a smaller size.');
      return;
    }
    const { w, h } = viewport.get();
    const centre = w > 0 ? screenToCanvas(view.get(), w / 2, h / 2) : { x: doc.info.width / 2, y: doc.info.height / 2 };
    const cx = viewMirrored ? doc.info.width - centre.x : centre.x;
    const name = `Text: ${spec.text.trim().split('\n')[0].slice(0, 24)}`;
    const result = doc.addDrawnLayer(name, 'Add text', (canvas) => canvas.drawImage(image, cx - image.width() / 2, centre.y - image.height() / 2));
    image.dispose();
    if (!result.ok) {
      Alert.alert('Can’t add text', result.reason);
      return;
    }
    startTransform();
  };

  const toggleAnimation = () => {
    const enabled = !doc.animation.enabled;
    doc.setAnimation({ enabled });
    setTimelineOpen(enabled);
    setPlayFrame(null);
    if (enabled) showToast('Animation on · each layer (or group) is a frame');
  };

  const exportAnimation = (format: 'gif' | 'mp4') =>
    void runBusy('Rendering animation…', async () => {
      const file = await renderAnimation(doc, format, () => {});
      await assertSharing();
      await shareFile(file, ANIMATION_FILE_TYPES[format]);
    });

  // ---- hardware keyboard shortcuts ------------------------------------------------------------
  const runShortcut = (action: ShortcutAction) => {
    const tools = useToolStore.getState();
    const brushes = useBrushStore.getState();
    const report = (title: string, result: { ok: boolean; reason?: string } | null) => {
      if (result && !result.ok) Alert.alert(title, result.reason);
    };
    switch (action) {
      case 'undo':
        showToast(doc.undo() ? 'Undo' : 'Nothing to undo');
        break;
      case 'redo':
        showToast(doc.redo() ? 'Redo' : 'Nothing to redo');
        break;
      case 'brush':
      case 'eraser':
        tools.setTool(action);
        break;
      case 'select':
        setInteraction('select');
        break;
      case 'transform':
        startTransform();
        break;
      case 'fill':
      case 'gradient':
        toggleMode(action);
        break;
      case 'text':
        setTextOpen(true);
        break;
      case 'eyedropper':
        setInteraction('eyedropper');
        break;
      case 'sizeDown':
      case 'sizeUp': {
        const size = brushes.slots[tools.tool].size;
        brushes.setSize(tools.tool, Math.max(1, action === 'sizeUp' ? size * 1.15 : size / 1.15));
        break;
      }
      case 'fit':
        setFitSignal((n) => n + 1);
        break;
      case 'resetRotation':
        setResetRotationSignal((n) => n + 1);
        break;
      case 'flipView':
        setViewMirrored((m) => !m);
        break;
      case 'swapColors':
        tools.swapWithPrevious();
        break;
      case 'selectAll':
        doc.selectAll();
        break;
      case 'deselect':
        doc.setSelection(null);
        break;
      case 'invertSelection':
        doc.invertSelection();
        break;
      case 'newLayer':
        if (!doc.addLayer()) Alert.alert('Layer limit reached', `This canvas size supports up to ${doc.maxLayers} layers on this device.`);
        break;
      case 'duplicateLayer':
        if (doc.layers.active) report('Can’t duplicate', doc.duplicateLayer(doc.layers.active.meta.id));
        break;
      case 'mergeDown':
        if (doc.layers.active) report('Can’t merge', doc.mergeDown(doc.layers.active.meta.id));
        break;
      case 'save':
        showToast(onSave() ? 'Saved' : 'Save failed');
        break;
      case 'cancel':
        setAdjustment(null);
        setInteraction('paint');
        break;
      case 'help':
        Alert.alert('Keyboard shortcuts', SHORTCUTS.map((sc) => `${sc.keys} — ${sc.label}`).join('\n'));
        break;
    }
  };
  const onKeyPress = (press: KeyPress) => {
    // While a dialog is open, keys belong to it.
    if (textOpen || canvasOpen || historyOpen || exportOpen) return;
    const action = shortcutFor(press);
    if (action) runShortcut(action);
  };
  useKeyPresses(onKeyPress);

  const exportPsd = () =>
    void runBusy('Creating PSD…', async () => {
      const file = renderPsd(doc);
      await assertSharing();
      await shareFile(file, PSD_FILE_TYPE);
    });

  const applyTransform = () => {
    if (transformSession && meshMode !== 'free') {
      if (!doc.applyMesh(transformSession, meshMode, mesh.get())) {
        Alert.alert('Can’t apply this distortion', 'The corners cross over or collapse. Drag them apart and try again.');
        return;
      }
    } else if (transformSession) {
      doc.applyTransform(transformSession, layerTransform.get());
    }
    setInteraction('paint');
  };

  /**
   * Switches between free transform, distort and warp. Distort and warp start from the current
   * free transform; going back to free discards the distortion (it cannot be expressed there).
   */
  const changeMeshMode = (next: MeshMode) => {
    if (!transformSession || next === meshMode) return;
    if (next === 'free') {
      setMeshMode('free');
      return;
    }
    const current = mesh.get();
    if (meshMode === 'free' || current.length !== 12) mesh.set(meshFromTransform(transformSession.box, layerTransform.get()));
    else if (next === 'distort') mesh.set(meshFromCorners(current[0], current[3], current[6], current[9]));
    setMeshMode(next);
  };

  const resetTransform = () => {
    layerTransform.set(IDENTITY_TRANSFORM);
    if (transformSession && meshMode !== 'free') mesh.set(meshFromTransform(transformSession.box, IDENTITY_TRANSFORM));
  };

  /** Flips the pending transform around the centre of the content being transformed. */
  const flipPending = (axis: 'x' | 'y') => {
    if (!transformSession) return;
    const { box } = transformSession;
    layerTransform.set(flipTransform(layerTransform.get(), axis, box.x + box.width / 2, box.y + box.height / 2));
  };

  /** Turns the pending transform 90° clockwise around the centre of the content. */
  const rotatePending = () => {
    if (!transformSession) return;
    const { box } = transformSession;
    const t = layerTransform.get();
    const c = mapPoint(t, box.x + box.width / 2, box.y + box.height / 2);
    layerTransform.set(composeGesture(t, c.x, c.y, c.x, c.y, 1, Math.PI / 2));
  };

  const shareWithGuides = () => {
    const path = buildGuidesPath(doc.info.width, doc.info.height, guides);
    if (!path) {
      Alert.alert('No guides to include', 'Turn on a grid or add guide lines first.');
      return;
    }
    void runBusy('Preparing image…', () =>
      shareDocument(doc, { ...DEFAULT_EXPORT_OPTIONS, guides: { path, opacity: guides.opacity } }),
    );
  };

  const pasteAsLayer = () => {
    const result = doc.paste();
    if (!result.ok) {
      Alert.alert('Can’t paste', result.reason);
      return;
    }
    // Pasted pixels usually need placing, as with imports.
    startTransform();
  };

  const importAsLayer = async () => {
    const picked = await pickImageFile();
    if (!picked) return;
    await runBusy('Importing image…', async () => {
      const bytes = await new File(picked.uri).bytes();
      const image = decodeImportedImage(bytes);
      if (!image) throw new Error('This image format is not supported.');
      const layer = doc.addImageLayer(image, picked.name);
      image.dispose();
      if (!layer) {
        Alert.alert('Layer limit reached', `This canvas supports up to ${doc.maxLayers} layers on this device.`);
        return;
      }
      // Let the user position the imported image straight away.
      startTransform();
    });
  };

  /** Asks where new reference images come from: the reference library, or the device. */
  const addReferences = () => {
    if (MAX_REFERENCES - references.length <= 0) {
      showToast(`Up to ${MAX_REFERENCES} reference images per artwork`);
      return;
    }
    setMenu('refSource');
  };

  const openLibraryPicker = () => {
    useReferenceLibraryStore.getState().refresh();
    setLibraryPickerOpen(true);
  };

  const addReferencesFromDevice = async () => {
    const picked = await pickImageFiles(MAX_REFERENCES - references.length);
    if (picked.length === 0) return;
    storeReferences(picked.map((p) => ({ uri: p.uri, aspect: p.width / Math.max(1, p.height) })));
  };

  const addReferencesFromLibrary = (images: LibraryImage[]) => {
    setLibraryPickerOpen(false);
    if (images.length > 0) storeReferences(images.map((i) => ({ uri: libraryImageUri(i), aspect: i.aspect })));
  };

  /** Copies images into the project's assets, so they reopen with the artwork, and shows them. */
  const storeReferences = (sources: { uri: string; aspect: number }[]) => {
    let next: StoredReference[];
    try {
      next = addReferenceImages(doc.info.id, sources);
    } catch (error) {
      // Still usable for this session, just not remembered.
      console.warn('[editor] Could not store reference images', error);
      next = [...references, ...sources.map((src) => ({ ...src, file: src.uri }))];
    }
    // Show the first of the newly added images.
    setRefIndex(Math.min(references.length, next.length - 1));
    setReferences(next);
    setRefWindow('open');
  };

  /** Opens the window with the stored images, or asks for images when there are none. */
  const openReferences = () => {
    if (references.length === 0) addReferences();
    else setRefWindow('open');
  };

  /**
   * Draws the pose figure and its guides onto a new "Pose guide" layer, filling most of the
   * canvas height (same view and pose as the window), then opens Transform on it so it can be
   * moved, scaled and rotated into place straight away.
   */
  const placeFigure = (snap: FigureSnapshot) => {
    const { width, height } = doc.info;
    const body = BODIES[snap.body];
    const k = height / snap.frameHeight;
    const camera = { ...snap.camera, panX: snap.camera.panX * k, panY: snap.camera.panY * k };
    const geo = buildFigure(body, snap.pose, makeProjector(body, camera, width, height));
    const style = { ...snap.style, bodyOpacity: 0.45, lineScale: Math.max(1, k) };
    const result = doc.addDrawnLayer('Pose guide', 'Add pose guide', (canvas) => drawFigure(canvas, geo, style), { opacity: 0.7 });
    if (!result.ok) {
      Alert.alert('Can’t place the figure', result.reason);
      return;
    }
    // Transform moves only selected pixels when there is a selection: move the whole figure.
    if (doc.selection) doc.setSelection(null);
    setFigureWindow('hidden');
    startTransform();
    showToast('Drag to move the figure · corners or pinch to scale and rotate · Apply when done');
  };

  const removeReference = (file: string) => {
    try {
      removeReferenceImage(doc.info.id, file);
    } catch (error) {
      console.warn('[editor] Could not remove reference image', error);
    }
    const next = references.filter((r) => r.file !== file);
    setReferences(next);
    setRefIndex((i) => Math.max(0, Math.min(i, next.length - 1)));
    if (next.length === 0) setRefWindow('closed');
  };

  const removeAllReferences = () => {
    setReferences([]);
    setRefIndex(0);
    setRefWindow('closed');
    try {
      clearReferenceImages(doc.info.id);
    } catch (error) {
      console.warn('[editor] Could not remove reference images', error);
    }
  };

  const backUp = () =>
    runBusy('Preparing backup…', async () => {
      // The backup is made from disk, so everything must be saved first.
      if (!onSave()) throw new Error('The artwork could not be saved, so no backup was made. Check free storage space.');
      await shareBackup(doc.info.id);
    });

  const saveZumi = () =>
    runBusy('Saving .zumi file…', async () => {
      if (!onSave()) throw new Error('The artwork could not be saved, so no file was made. Check free storage space.');
      const saved = saveBackupToFolder(doc.info.id, useSettingsStore.getState().backupFolder);
      Alert.alert('Saved', `“${saved.fileName}” was saved to ${saved.folderName}. Change the folder in Settings › Storage.`);
    });

  const exportToPhotos = (options: ExportOptions) =>
    runBusy('Saving to Photos…', async () => {
      const result = await saveDocumentToPhotos(doc, options);
      if (result === 'saved') Alert.alert('Saved to Photos', `"${doc.info.name}" was added to your photo library.`);
      else if (result === 'denied') Alert.alert('Permission needed', 'Allow Zumi to add photos in your device settings to export artwork.');
      // 'shared': this runtime has no photo-library module; the share sheet (with Save Image) was shown.
    });

  const menuOptions: Record<Menu, ActionSheetOption[]> = {
    more: [
      {
        label: viewMirrored ? 'Unflip view' : 'Flip view (display only)',
        icon: 'swap-horizontal-outline',
        selected: viewMirrored,
        onPress: () => setViewMirrored((m) => !m),
      },
      { label: 'Symmetry', icon: 'flower-outline', onPress: () => togglePanel('symmetry') },
      { label: 'Guides', icon: 'grid-outline', onPress: () => togglePanel('guides') },
      { label: 'Comic panels…', icon: 'albums-outline', onPress: () => setPanelsOpen(true) },
      { label: '3D pose figure', icon: 'body-outline', onPress: () => setFigureWindow('open') },
      { label: 'Paint bucket (fill)', icon: 'color-fill-outline', onPress: () => toggleMode('fill') },
      { label: 'Gradient', icon: 'contrast-outline', onPress: () => toggleMode('gradient') },
      { label: 'Add text…', icon: 'text-outline', onPress: () => setTextOpen(true) },
      { label: 'Adjustments & filters…', icon: 'options-outline', onPress: openAdjustments },
      { label: 'Liquify', icon: 'water-outline', onPress: startLiquify },
      { label: 'Canvas size, crop & rotate…', icon: 'resize-outline', onPress: () => setCanvasOpen(true) },
      { label: 'History…', icon: 'time-outline', onPress: () => setHistoryOpen(true) },
      {
        label: doc.animation.enabled ? 'Animation (on)' : 'Animation (frame by frame)',
        icon: 'film-outline',
        selected: doc.animation.enabled,
        onPress: toggleAnimation,
      },
      {
        label: previewOpen ? 'Hide preview window' : 'Show preview window',
        icon: 'tablet-landscape-outline',
        selected: previewOpen,
        onPress: () => setPreviewOpen((o) => !o),
      },
      {
        label: 'Vector pen tool',
        icon: 'create-outline',
        onPress: () => {
          setPanel(null);
          setInteraction('vector');
        },
      },
      { label: 'Import / reference image…', icon: 'image-outline', onPress: () => setMenu('import') },
      { label: 'Export…', icon: 'share-outline', onPress: () => setMenu('export') },
      { label: 'Settings', icon: 'settings-outline', onPress: () => togglePanel('settings') },
    ],
    import: [
      // Two clearly separate actions: one edits the artwork, the other never touches it.
      { label: 'Import image as new layer (editable)', icon: 'layers-outline', onPress: () => void importAsLayer() },
      {
        label: references.length > 0 ? `Reference window (${references.length} images)` : 'Open reference images (not part of artwork)',
        icon: 'albums-outline',
        onPress: openReferences,
      },
      { label: 'Add reference images…', icon: 'images-outline', onPress: addReferences },
      ...(references.length > 0
        ? [{ label: 'Remove all reference images', icon: 'trash-outline' as const, destructive: true, onPress: removeAllReferences }]
        : []),
    ],
    refSource: [
      { label: 'From my reference library…', icon: 'albums-outline', onPress: openLibraryPicker },
      { label: 'From photos…', icon: 'images-outline', onPress: () => void addReferencesFromDevice() },
    ],
    export: [
      {
        label: 'Save now',
        icon: 'save-outline',
        onPress: () => {
          if (!onSave()) Alert.alert('Save failed', 'The artwork could not be saved. Check free storage space.');
        },
      },
      { label: 'Export image (PNG, JPEG, WebP, GIF, MP4, PSD)…', icon: 'image-outline', onPress: () => setExportOpen(true) },
      { label: 'Layered PSD (Photoshop, Clip Studio, Krita)…', icon: 'layers-outline', onPress: exportPsd },
      { label: `Timelapse (${isVideoExportAvailable() ? 'MP4, ' : ''}GIF)…`, icon: 'film-outline', onPress: () => setTimelapseOpen(true) },
      ...(doc.animation.enabled
        ? [
            ...(isVideoExportAvailable() ? [{ label: 'Animation as MP4', icon: 'videocam-outline' as const, onPress: () => exportAnimation('mp4') }] : []),
            { label: 'Animation as GIF', icon: 'images-outline' as const, onPress: () => exportAnimation('gif') },
          ]
        : []),
      { label: 'Share image with guides', icon: 'grid-outline', onPress: shareWithGuides },
      { label: 'Save .zumi file (editable)', icon: 'download-outline', onPress: () => void saveZumi() },
      { label: 'Share .zumi file…', icon: 'archive-outline', onPress: () => void backUp() },
    ],
  };
  const menuTitles: Record<Menu, string | undefined> = { more: undefined, import: 'Import', export: 'Export', refSource: 'Add reference images' };

  const active = doc.layers.active;
  const blockedReason =
    (interaction !== 'paint' && interaction !== 'shape' && interaction !== 'fill' && interaction !== 'gradient') || !active
      ? null
      : active.meta.locked
        ? 'Layer is locked — painting disabled'
        : !active.meta.visible
          ? 'Layer is hidden — painting disabled'
          : tool === 'eraser' && active.meta.alphaLocked
            ? 'Alpha lock is on — eraser disabled'
            : null;

  const panelContent =
    panel === 'brush' ? (
      <BrushPanel />
    ) : panel === 'color' ? (
      <ColorPanel />
    ) : panel === 'layers' ? (
      <LayersPanel doc={doc} onPaste={pasteAsLayer} onVectorize={() => setVectorizeOpen(true)} onTransform={startTransform} />
    ) : panel === 'guides' ? (
      <GuidesPanel />
    ) : panel === 'symmetry' ? (
      <SymmetryPanel />
    ) : panel === 'settings' ? (
      <SettingsPanel />
    ) : null;

  const panelSide = railSide === 'left' ? 'right' : 'left';

  /** More tools, in the phone toolbar's extra row (shown with its arrow button). */
  const extraTools: ExtraTool[] = [
    { icon: 'create-outline', label: 'Vector pen', active: interaction === 'vector', onPress: () => setInteraction(interaction === 'vector' ? 'paint' : 'vector') },
    { icon: 'scan-outline', label: 'Select', active: interaction === 'select', onPress: () => setInteraction(interaction === 'select' ? 'paint' : 'select') },
    { icon: 'color-fill-outline', label: 'Paint bucket', active: interaction === 'fill', onPress: () => toggleMode('fill') },
    { icon: 'contrast-outline', label: 'Gradient', active: interaction === 'gradient', onPress: () => toggleMode('gradient') },
    { icon: 'text-outline', label: 'Text', onPress: () => setTextOpen(true) },
    { icon: 'options-outline', label: 'Adjustments & filters', active: adjustment !== null, onPress: openAdjustments },
    { icon: 'water-outline', label: 'Liquify', active: interaction === 'liquify', onPress: startLiquify },
    { icon: 'resize-outline', label: 'Canvas size, crop & rotate', onPress: () => setCanvasOpen(true) },
    { icon: 'time-outline', label: 'History', onPress: () => setHistoryOpen(true) },
    { icon: 'film-outline', label: 'Animation', active: doc.animation.enabled, onPress: toggleAnimation },
    { icon: 'move-outline', label: 'Transform (move, scale, distort, warp)', active: interaction === 'transform', onPress: toggleTransform },
    { icon: 'flower-outline', label: 'Symmetry', active: panel === 'symmetry', onPress: () => togglePanel('symmetry') },
    { icon: 'grid-outline', label: 'Guides and perspective', active: panel === 'guides', onPress: () => togglePanel('guides') },
    { icon: 'albums-outline', label: 'Comic panels', onPress: () => setPanelsOpen(true) },
    { icon: 'body-outline', label: '3D pose figure', active: figureWindow === 'open', onPress: () => setFigureWindow(figureWindow === 'open' ? 'hidden' : 'open') },
    { icon: 'images-outline', label: 'Reference images', active: refWindow === 'open', onPress: openReferences },
    { icon: 'tablet-landscape-outline', label: 'Preview window', active: previewOpen, onPress: () => setPreviewOpen((o) => !o) },
    { icon: 'settings-outline', label: 'Settings', active: panel === 'settings', onPress: () => togglePanel('settings') },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <TopBar
        title={doc.info.name}
        saveStatus={saveStatus}
        compact={compactBar}
        canUndo={doc.history.canUndo && interaction !== 'transform'}
        canRedo={doc.history.canRedo && interaction !== 'transform'}
        undoLabel={doc.history.undoLabel}
        redoLabel={doc.history.redoLabel}
        rotated={rotated}
        viewMirrored={viewMirrored}
        symmetryActive={panel === 'symmetry' || symmetryMode !== 'off'}
        transformActive={interaction === 'transform'}
        selectActive={interaction === 'select'}
        guidesActive={panel === 'guides'}
        settingsActive={panel === 'settings'}
        onBack={() => router.back()}
        onUndo={() => doc.undo()}
        onRedo={() => doc.redo()}
        onFit={() => setFitSignal((n) => n + 1)}
        onResetRotation={() => setResetRotationSignal((n) => n + 1)}
        onFlipView={() => setViewMirrored((m) => !m)}
        onSymmetry={() => togglePanel('symmetry')}
        onTransform={toggleTransform}
        onSelect={() => setInteraction(interaction === 'select' ? 'paint' : 'select')}
        onGuides={() => togglePanel('guides')}
        onImport={() => setMenu('import')}
        onExport={() => setMenu('export')}
        onSettings={() => togglePanel('settings')}
        onMore={() => setMenu('more')}
      />

      <View style={styles.canvasArea}>
        <DrawingCanvas
          doc={doc}
          fitSignal={fitSignal}
          resetRotationSignal={resetRotationSignal}
          layerTransform={layerTransform}
          transformSession={transformSession}
          meshMode={interaction === 'transform' ? meshMode : 'free'}
          mesh={mesh}
          viewMirrored={viewMirrored}
          view={view}
          viewport={viewport}
          onRotatedChange={setRotated}
          onStylusDetected={() => showToast('Stylus detected — fingers now move the canvas')}
          onQuickHistory={quickHistory}
          editGuides={panel === 'guides'}
          onVectorPointer={vectorTool.onPointer}
          vectorOverlay={vectorTool.overlay}
          adjustPreview={adjustment && doc.layers.active ? { layerId: doc.layers.active.meta.id, adjustment } : null}
          playFrame={playFrame}
          liquifyMesh={liquifyMesh}
        />

        {interaction === 'transform' ? (
          <TransformBar
            selection={transformSession?.selection != null}
            mode={meshMode}
            onMode={changeMeshMode}
            onFlipX={() => flipPending('x')}
            onFlipY={() => flipPending('y')}
            onRotate={rotatePending}
            onReset={resetTransform}
            onCancel={() => setInteraction('paint')}
            onApply={applyTransform}
          />
        ) : null}
        {interaction === 'vector' ? (
          <VectorBar
            tool={vectorTool}
            onNewLayer={() => {
              const r = doc.addVectorLayer();
              if (!r.ok) Alert.alert('Can’t add a layer', r.reason);
            }}
            onConvert={() => setVectorizeOpen(true)}
            onDone={() => setInteraction('paint')}
          />
        ) : null}
        {(interaction === 'paint' || interaction === 'shape') && doc.isVectorLayer(doc.layers.active?.meta.id) ? (
          <VectorLayerHint onPress={() => setInteraction('vector')} />
        ) : null}
        {interaction === 'fill' ? (
          <FillBar fill={fill} onChange={(patch) => useToolStore.getState().updateFill(patch)} onDone={() => setInteraction('paint')} />
        ) : null}
        {interaction === 'gradient' ? (
          <GradientBar gradient={gradient} onChange={(patch) => useToolStore.getState().updateGradient(patch)} onDone={() => setInteraction('paint')} />
        ) : null}
        {interaction === 'liquify' ? (
          <LiquifyBar
            settings={liquify}
            onChange={(patch) => useToolStore.getState().updateLiquify(patch)}
            onReset={() => liquifyMesh.set(createLiquifyMesh(doc.info.width, doc.info.height))}
            onCancel={() => setInteraction('paint')}
            onApply={applyLiquify}
          />
        ) : null}
        {adjustment && doc.layers.active ? (
          <AdjustmentsSheet
            layerName={doc.layers.active.meta.name}
            value={adjustment}
            hasSelection={doc.selection !== null}
            bottom={isTablet ? spacing.lg : insets.bottom + 76}
            onChange={setAdjustment}
            onApply={applyAdjustment}
            onCancel={() => setAdjustment(null)}
          />
        ) : null}
        {timelineOpen && doc.animation.enabled && !adjustment ? (
          <AnimationBar
            doc={doc}
            playing={playing}
            playFrame={playFrame}
            bottom={isTablet ? spacing.lg : insets.bottom + 76}
            onPlay={() => setPlayFrame(doc.animation.background && doc.frames.length > 1 ? 1 : 0)}
            onStop={() => setPlayFrame(null)}
            onExport={() =>
              Alert.alert('Export animation', undefined, [
                ...(isVideoExportAvailable() ? [{ text: 'MP4 video', onPress: () => exportAnimation('mp4') }] : []),
                { text: 'GIF', onPress: () => exportAnimation('gif') },
                { text: 'Cancel', style: 'cancel' as const },
              ])
            }
            onClose={() => {
              setPlayFrame(null);
              setTimelineOpen(false);
            }}
          />
        ) : null}
        {interaction === 'shape' ? (
          <ShapeBar
            kind={shapeKind}
            constrain={shapeConstrain}
            onKind={setShapeKind}
            onConstrain={setShapeConstrain}
            onDone={() => setInteraction('paint')}
          />
        ) : null}
        {interaction === 'select' ? (
          <SelectionBar
            shape={selectShape}
            combine={selectCombine}
            fill={fill}
            feather={doc.selectionFeather}
            hasSelection={doc.selection !== null}
            canPaste={doc.canPaste}
            onShape={setSelectShape}
            onCombine={(mode) => useToolStore.getState().setSelectCombine(mode)}
            onFill={(patch) => useToolStore.getState().updateFill(patch)}
            onAll={() => doc.selectAll()}
            onInvert={() => doc.invertSelection()}
            onLayerContent={() => {
              const layer = doc.layers.active;
              const result = layer ? doc.selectLayerContent(layer.meta.id, selectCombine) : null;
              if (result && !result.ok) Alert.alert('Nothing selected', result.reason);
            }}
            onGrow={(px) => {
              const result = doc.resizeSelection(px);
              if (!result.ok) Alert.alert(px > 0 ? 'Can’t grow' : 'Can’t shrink', result.reason);
            }}
            onFeather={(px) => {
              doc.setSelectionFeather(px);
              showToast(px > 0 ? `Soft selection edge: ${px} px` : 'Hard selection edge');
            }}
            onCrop={() => {
              const result = doc.cropToSelection();
              if (!result.ok) Alert.alert('Can’t crop', result.reason);
              else setFitSignal((n) => n + 1);
            }}
            onClear={() => {
              if (!doc.clearSelection()) Alert.alert('Nothing cleared', 'Unlock and show the active layer first.');
            }}
            onCut={() => {
              const result = doc.cutSelection();
              if (!result.ok) Alert.alert('Can’t cut', result.reason);
            }}
            onCopy={() => {
              const result = doc.copySelection();
              if (result.ok) showToast(doc.selection ? 'Selection copied' : 'Layer copied');
              else Alert.alert('Can’t copy', result.reason);
            }}
            onPaste={pasteAsLayer}
            onDuplicate={() => {
              const result = doc.duplicateSelection();
              if (!result.ok) Alert.alert('Can’t duplicate', result.reason);
              else showToast(doc.selection ? 'Selection duplicated to a new layer' : 'Layer duplicated');
            }}
            onDeselect={() => doc.setSelection(null)}
            onDone={() => setInteraction('paint')}
          />
        ) : null}

        {blockedReason ? (
          <View style={[styles.banner, { bottom: isTablet ? spacing.lg : insets.bottom + 76 }]} pointerEvents="none">
            <Ionicons name="lock-closed" size={12} color={colors.text} />
            <Text style={styles.bannerText}>{blockedReason}</Text>
          </View>
        ) : null}

        {isTablet ? (
          <ToolRail side={railSide} sliderLength={railSliderLength} panel={panel} onTogglePanel={togglePanel} />
        ) : (
          <>
            <PhoneSideSliders side={railSide} />
            <PhoneToolbar bottomInset={insets.bottom} panel={panel} onTogglePanel={togglePanel} extras={extraTools} />
          </>
        )}

        <Toast message={toast} />
        {KeyCaptureView ? (
          <KeyCaptureView style={styles.keyCapture} pointerEvents="none" onKey={(e) => onKeyPress(e.nativeEvent)} />
        ) : null}

        <TextDialog
          visible={textOpen}
          color={useToolStore.getState().color}
          canvasSide={Math.max(doc.info.width, doc.info.height)}
          onAdd={addText}
          onClose={() => setTextOpen(false)}
        />
        <CanvasSizeDialog
          visible={canvasOpen}
          doc={doc}
          onClose={() => setCanvasOpen(false)}
          onDone={(result) => {
            if (!result.ok) {
              Alert.alert('Can’t change the canvas', result.reason);
              return;
            }
            setCanvasOpen(false);
            setFitSignal((n) => n + 1);
          }}
        />
        <HistoryDialog visible={historyOpen} doc={doc} onClose={() => setHistoryOpen(false)} />

        {viewMirrored ? (
          <ViewFlippedBadge onPress={() => setViewMirrored(false)} bottom={isTablet ? spacing.lg : insets.bottom + 76} />
        ) : null}

        {refWindow !== 'closed' && references.length > 0 ? (
          <ReferenceWindow
            references={references}
            index={refIndex}
            canvasWidth={doc.info.width}
            hidden={refWindow === 'hidden'}
            onIndexChange={setRefIndex}
            onHide={() => setRefWindow('hidden')}
            onClose={() => setRefWindow('closed')}
            onAdd={addReferences}
            onRemove={removeReference}
          />
        ) : null}
        {figureWindow !== 'closed' ? (
          <PoseFigureWindow
            hidden={figureWindow === 'hidden'}
            onHide={() => setFigureWindow('hidden')}
            onClose={() => setFigureWindow('closed')}
            onPlace={placeFigure}
          />
        ) : null}
        {figureWindow === 'hidden' ? <ShowFigureButton onPress={() => setFigureWindow('open')} /> : null}
        {previewOpen ? (
          <PreviewWindow doc={doc} view={view} viewport={viewport} mirrored={viewMirrored} onClose={() => setPreviewOpen(false)} />
        ) : null}
        {refWindow === 'hidden' && references.length > 0 ? (
          <ShowReferenceButton count={references.length} onPress={() => setRefWindow('open')} />
        ) : null}

        {panelContent && panel ? (
          isTablet ? (
            <View
              style={[
                styles.sidePanel,
                { width: Math.min(TABLET_PANEL_WIDTH[panel], width * 0.45) },
                panelSide === 'right' ? styles.sidePanelRight : styles.sidePanelLeft,
                TALL_PANELS.includes(panel) ? styles.sidePanelTall : null,
              ]}>
              <PanelClose onPress={() => setPanel(null)} />
              {panelContent}
            </View>
          ) : (
            <View
              style={[
                styles.sheet,
                panel === 'layers' && !sheetCollapsed ? styles.sheetTall : null,
                { paddingBottom: insets.bottom },
              ]}>
              {/* Tapping the handle folds the sheet down so the canvas is visible, without closing it. */}
              <Pressable
                onPress={() => setSheetCollapsed((c) => !c)}
                style={styles.sheetHandleHit}
                accessibilityRole="button"
                accessibilityLabel={sheetCollapsed ? 'Expand panel' : 'Collapse panel'}
                accessibilityState={{ expanded: !sheetCollapsed }}>
                <View style={styles.sheetHandle} />
              </Pressable>
              <PanelClose onPress={() => setPanel(null)} />
              <View style={sheetCollapsed ? styles.collapsed : styles.sheetBody}>{panelContent}</View>
            </View>
          )
        ) : null}
      </View>

      <ReferenceLibraryPicker
        visible={libraryPickerOpen}
        room={Math.max(0, MAX_REFERENCES - references.length)}
        onUse={addReferencesFromLibrary}
        onClose={() => setLibraryPickerOpen(false)}
      />
      <ActionSheet
        visible={menu !== null}
        title={menu ? menuTitles[menu] : undefined}
        options={menu ? menuOptions[menu] : []}
        onClose={() => setMenu(null)}
      />
      <ExportDialog
        visible={exportOpen}
        subtitle={`${doc.info.width} × ${doc.info.height} px`}
        onClose={() => setExportOpen(false)}
        onSaveToDevice={(options) => {
          setExportOpen(false);
          void exportToPhotos(options);
        }}
        onShare={(options) => {
          setExportOpen(false);
          void runBusy('Preparing image…', () => shareDocument(doc, options));
        }}
      />
      <VectorConvertDialog
        visible={vectorizeOpen}
        layerName={doc.layers.active?.meta.name ?? 'Layer'}
        onClose={() => setVectorizeOpen(false)}
        onConvert={(choice) => {
          setVectorizeOpen(false);
          const layer = doc.layers.active;
          if (!layer) return;
          void runBusy(choice ? 'Tracing into vector shapes…' : 'Converting…', () => {
            const shapes = choice ? traceLayerImage(layer.image, choice.colors, choice.detail, choice.smooth) : { shapes: [] };
            const result = doc.convertToVector(layer.meta.id, shapes);
            if (!result.ok) Alert.alert('Can’t convert', result.reason);
            else showToast(choice ? `Traced into ${shapes.shapes.length} shapes · use the Vector pen to edit` : 'Now a vector layer');
          });
        }}
      />
      <PanelLayoutPicker
        visible={panelsOpen}
        width={doc.info.width}
        height={doc.info.height}
        onClose={() => setPanelsOpen(false)}
        onAdd={(choice) => {
          setPanelsOpen(false);
          const panels = comicPanels(choice.layoutId, doc.info.width, doc.info.height, 0, choice.margin);
          const result = doc.addDrawnLayer('Panels', 'Add panels', (canvas) => drawPanels(canvas, panels, choice.border));
          if (!result.ok) Alert.alert('Can’t add panels', result.reason);
          else showToast('Panels added on a new layer');
        }}
      />
      <TimelapseDialog visible={timelapseOpen} doc={doc} getRecorder={getTimelapse} onClose={() => setTimelapseOpen(false)} />
      <BusyOverlay label={busy} />
    </SafeAreaView>
  );
}

function PanelClose({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.panelHeader}>
      <Pressable onPress={onPress} style={styles.panelClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close panel">
        <Ionicons name="close" size={20} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

const panelShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 14,
  elevation: 10,
} as const;

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop },
  keyCapture: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.backdrop, padding: spacing.xl },
  centerTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  centerText: { color: colors.text, fontSize: 15, textAlign: 'center' },
  centerHint: { color: colors.textDim, fontSize: 13, textAlign: 'center', maxWidth: 420 },
  centerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  textButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.panelRaised },
  textButtonLabel: { color: colors.accent, fontWeight: '600' },
  canvasArea: { flex: 1 },
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
  },
  bannerText: { color: colors.text, fontSize: 12 },
  sidePanel: {
    ...panelShadow,
    position: 'absolute',
    zIndex: 20,
    elevation: 20,
    top: spacing.sm,
    width: 320,
    maxHeight: '94%',
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sidePanelRight: { right: spacing.sm },
  sidePanelLeft: { left: spacing.sm },
  sidePanelTall: { bottom: spacing.sm },
  sheet: {
    ...panelShadow,
    position: 'absolute',
    zIndex: 20,
    elevation: 20,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '62%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sheetTall: { height: '58%' },
  sheetHandleHit: { alignSelf: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xs },
  // Fills a fixed-height sheet (Layers), so the panel's list can take the remaining space;
  // content-sized sheets are unaffected.
  sheetBody: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  collapsed: { display: 'none' },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.sm,
    backgroundColor: colors.border,
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.xs, marginBottom: -spacing.md },
  panelClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
}));
