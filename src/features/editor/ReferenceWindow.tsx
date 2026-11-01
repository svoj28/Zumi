import { Ionicons } from '@expo/vector-icons';
import {
  AlphaType,
  Blur,
  Canvas,
  ColorMatrix,
  ColorType,
  Group,
  Image as SkiaImage,
  Path,
  rect,
  Skia,
  useImage,
} from '@shopify/react-native-skia';
import { useMemo, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewInstance } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  displayedAspect,
  filterBlur,
  filterMatrix,
  fitScale,
  imagePointAt,
  maxPan,
  REFERENCE_FILTERS,
  referenceTransform,
  type ReferenceFilter,
  type ReferenceViewState,
} from '@/engine/render/referenceView';
import { paletteFromImage } from '@/engine/render/imagePalette';
import { usePaletteStore } from '@/state/paletteStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useToolStore } from '@/state/toolStore';
import type { StoredReference } from '@/storage/projectRepository';
import { colors, radius, spacing, themed } from '@/ui/theme';
import { TOOLTIP_LINGER_MS, useTooltipStore } from '@/ui/Tooltip';

const MIN_WIDTH = 176;
const MAX_ZOOM = 12;
const ZOOM_STEP = 1.5;
const SIZE_STEP = 1.25;
const OPACITIES = [1, 0.75, 0.5, 0.25];
/** Grid overlay: number of columns (0 = off), cycled by the grid button. */
const GRID_COLUMNS = [0, 3, 4, 6, 8];
/** Colours taken by "Make a palette from this reference". */
const REFERENCE_PALETTE_SIZE = 8;
/** A crop smaller than this (image pixels) is treated as a tap and ignored. */
const MIN_CROP = 8;
const HEADER_H = 36;
const TOOLBAR_H = 40;
/** The image area never takes more than this share of the screen height. */
const MAX_IMAGE_SHARE = 0.6;

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageView {
  flipX: boolean;
  flipY: boolean;
  /** Quarter turns clockwise. */
  quarter: number;
  /** Visible part of the image, image pixels (null: all of it). */
  crop: Crop | null;
}
const DEFAULT_VIEW: ImageView = { flipX: false, flipY: false, quarter: 0, crop: null };

interface Props {
  references: StoredReference[];
  index: number;
  hidden: boolean;
  /** Artwork width, for "same grid on canvas". */
  canvasWidth: number;
  onIndexChange: (index: number) => void;
  onHide: () => void;
  onClose: () => void;
  onAdd: () => void;
  onRemove: (file: string) => void;
}

/**
 * Floating reference window. A viewing aid only: never drawn into layers or exports.
 *
 * - Several images: previous / next, add more, remove the current one.
 * - View: zoom (buttons, pinch, double-tap to reset), pan when zoomed, flip horizontally /
 *   vertically, rotate, crop, filters (grayscale, values, squint, invert, sepia, contrast),
 *   opacity, grid overlay (grid method) that can be mirrored on the canvas.
 * - Window: drag the title bar, resize from the corner, smaller / larger, maximise, minimise to
 *   the title bar, lock in place, hide.
 * - Pick colour: tap the image to take a colour for the brush.
 *
 * Kept mounted while hidden so its position, size and view survive hiding.
 */
export function ReferenceWindow({ references, index, hidden, canvasWidth, onIndexChange, onHide, onClose, onAdd, onRemove }: Props) {
  const reference = references[Math.min(index, references.length - 1)];
  const image = useImage(reference?.uri ?? null);
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [views, setViews] = useState<Record<string, ImageView>>({});
  const view = (reference && views[reference.file]) ?? DEFAULT_VIEW;
  const [filter, setFilter] = useState<ReferenceFilter>('none');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [opacityIndex, setOpacityIndex] = useState(0);
  const [gridIndex, setGridIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState<{ x: number; y: number; w: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState(false);

  // The visible region of the image (the crop, or the whole image).
  const fullW = image?.width() ?? 1;
  const fullH = image?.height() ?? 1;
  const crop = view.crop;
  const cx = crop?.x ?? 0;
  const cy = crop?.y ?? 0;
  const iw = crop?.w ?? fullW;
  const ih = crop?.h ?? fullH;
  const regionAspect = image ? iw / Math.max(1, ih) : (reference?.aspect ?? 1);
  const aspect = displayedAspect(regionAspect, view.quarter);
  const maxImageH = screenH * MAX_IMAGE_SHARE;
  const maxW = Math.max(MIN_WIDTH, screenW - spacing.lg);
  const gridColumns = GRID_COLUMNS[gridIndex];

  // Window geometry and zoom live on the UI thread.
  const x = useSharedValue<number>(Math.max(spacing.sm, screenW - 260 - spacing.sm));
  const y = useSharedValue<number>(spacing.sm);
  const width = useSharedValue<number>(240);
  const start = useSharedValue({ x: 0, y: 0, w: 0 });
  const zoom = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const zoomStart = useSharedValue({ zoom: 1, panX: 0, panY: 0 });
  const frameSize = useSharedValue({ width: 0, height: 0 });
  const cropDrag = useSharedValue({ x0: 0, y0: 0, x1: 0, y1: 0, active: false });

  // ---- worklet helpers (declared before the gestures that use them) ------------------------
  const viewState = (z: number, px: number, py: number): ReferenceViewState => {
    'worklet';
    const f = frameSize.get();
    return { W: f.width, H: f.height, iw, ih, quarter: view.quarter, flipX: view.flipX, flipY: view.flipY, zoom: z, panX: px, panY: py };
  };

  /** Keeps the zoomed image covering the frame (no empty edges when panning). */
  const clampPan = (px: number, py: number, z: number) => {
    'worklet';
    const m = maxPan(viewState(z, 0, 0));
    return { x: Math.min(m.x, Math.max(-m.x, px)), y: Math.min(m.y, Math.max(-m.y, py)) };
  };

  /** Keeps at least the grip of the title bar on screen. */
  const placeWindow = (nx: number, ny: number) => {
    'worklet';
    x.set(Math.min(screenW - 64, Math.max(64 - width.get(), nx)));
    y.set(Math.min(screenH - HEADER_H * 3, Math.max(0, ny)));
  };

  const setZoom = (z: number, animated: boolean) => {
    'worklet';
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const p = clampPan((panX.get() * next) / zoom.get(), (panY.get() * next) / zoom.get(), next);
    zoom.set(animated ? withTiming(next) : next);
    panX.set(animated ? withTiming(p.x) : p.x);
    panY.set(animated ? withTiming(p.y) : p.y);
  };

  // ---- JS actions ---------------------------------------------------------------------------
  const updateView = (patch: Partial<ImageView>) => {
    if (!reference) return;
    setViews((all) => ({ ...all, [reference.file]: { ...view, ...patch } }));
  };

  const resetZoom = () => {
    zoom.set(withTiming(1));
    panX.set(withTiming(0));
    panY.set(withTiming(0));
  };

  const go = (delta: number) => {
    if (references.length < 2) return;
    onIndexChange((index + delta + references.length) % references.length);
    setCropping(false);
    zoom.set(1);
    panX.set(0);
    panY.set(0);
  };

  const resize = (factor: number) => {
    setMaximized(null);
    width.set(withTiming(Math.min(maxW, Math.max(MIN_WIDTH, width.get() * factor))));
  };

  const toggleMaximize = () => {
    if (maximized) {
      x.set(withTiming(maximized.x));
      y.set(withTiming(maximized.y));
      width.set(withTiming(maximized.w));
      setMaximized(null);
      return;
    }
    setMaximized({ x: x.get(), y: y.get(), w: width.get() });
    setMinimized(false);
    // As large as fits: full width, unless the image would then be taller than allowed.
    x.set(withTiming(spacing.sm));
    y.set(withTiming(spacing.sm));
    width.set(withTiming(Math.min(maxW, Math.max(MIN_WIDTH, maxImageH * aspect))));
  };

  /** Full-image pixel under a point of the frame. */
  const pixelAt = (tx: number, ty: number, W: number, H: number, z: number, px: number, py: number) => {
    const p = imagePointAt({ W, H, iw, ih, quarter: view.quarter, flipX: view.flipX, flipY: view.flipY, zoom: z, panX: px, panY: py }, tx, ty);
    return { x: p.x + cx, y: p.y + cy };
  };

  /** Colour of the reference pixel under a tap, applied to the brush. */
  const pickAt = (tx: number, ty: number, W: number, H: number, z: number, px: number, py: number) => {
    if (!image) return;
    const p = pixelAt(tx, ty, W, H, z, px, py);
    const ix = Math.floor(p.x);
    const iy = Math.floor(p.y);
    if (ix < cx || iy < cy || ix >= cx + iw || iy >= cy + ih) return;
    const pixel = image.readPixels(ix, iy, { width: 1, height: 1, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 });
    if (!pixel || pixel.length < 3) return;
    const hex = `#${[pixel[0], pixel[1], pixel[2]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`;
    const tools = useToolStore.getState();
    const from = tools.color;
    tools.setColor(hex);
    tools.commitColor(from);
    setPicking(false);
  };

  /** Crops to the rectangle dragged over the frame (frame points). */
  const applyCrop = (x0: number, y0: number, x1: number, y1: number, W: number, H: number, z: number, px: number, py: number) => {
    const a = pixelAt(x0, y0, W, H, z, px, py);
    const b = pixelAt(x1, y1, W, H, z, px, py);
    const left = Math.max(0, Math.min(a.x, b.x));
    const top = Math.max(0, Math.min(a.y, b.y));
    const right = Math.min(fullW, Math.max(a.x, b.x));
    const bottom = Math.min(fullH, Math.max(a.y, b.y));
    setCropping(false);
    if (right - left < MIN_CROP || bottom - top < MIN_CROP) return;
    updateView({ crop: { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) } });
    zoom.set(1);
    panX.set(0);
    panY.set(0);
  };

  const resetCrop = () => {
    updateView({ crop: null });
    setCropping(false);
    resetZoom();
  };

  /** Saves the main colours of the visible (cropped) image as a new palette. */
  const makePalette = () => {
    if (!image) return;
    const colorsFound = paletteFromImage(image, REFERENCE_PALETTE_SIZE, { x: cx, y: cy, w: iw, h: ih });
    if (colorsFound.length === 0) {
      Alert.alert('No colours found', 'This image has no visible colours to take.');
      return;
    }
    const name = references.length > 1 ? `Reference ${index + 1}` : 'Reference';
    usePaletteStore.getState().createPaletteWithColors(name, colorsFound);
    Alert.alert('Palette saved', `"${name}" (${colorsFound.length} colours) is now in Colour › Palettes.`);
  };

  const matchGridOnCanvas = () => {
    if (gridColumns <= 0) return;
    useSettingsStore.getState().updateGuides({ grid: true, gridSize: Math.max(8, Math.round(canvasWidth / gridColumns)) });
  };

  // ---- gestures ----------------------------------------------------------------------------
  const moveGesture = Gesture.Pan()
    .enabled(!locked)
    .onBegin(() => start.set({ x: x.get(), y: y.get(), w: width.get() }))
    .onUpdate((e) => placeWindow(start.get().x + e.translationX, start.get().y + e.translationY));

  const resizeGesture = Gesture.Pan()
    .enabled(!locked)
    .onBegin(() => start.set({ x: x.get(), y: y.get(), w: width.get() }))
    .onUpdate((e) => width.set(Math.max(MIN_WIDTH, Math.min(maxW, start.get().w + e.translationX))))
    .onEnd(() => scheduleOnRN(setMaximized, null));

  const pinch = Gesture.Pinch()
    .enabled(!cropping)
    .onStart(() => zoomStart.set({ zoom: zoom.get(), panX: panX.get(), panY: panY.get() }))
    .onUpdate((e) => {
      const s = zoomStart.get();
      const z = Math.min(MAX_ZOOM, Math.max(1, s.zoom * e.scale));
      zoom.set(z);
      const p = clampPan((s.panX * z) / s.zoom, (s.panY * z) / s.zoom, z);
      panX.set(p.x);
      panY.set(p.y);
    });

  const imagePan = Gesture.Pan()
    .enabled(!cropping)
    .maxPointers(1)
    .minDistance(4)
    .onBegin(() => {
      start.set({ x: x.get(), y: y.get(), w: width.get() });
      zoomStart.set({ zoom: zoom.get(), panX: panX.get(), panY: panY.get() });
    })
    .onUpdate((e) => {
      if (zoom.get() > 1.01) {
        const s = zoomStart.get();
        const p = clampPan(s.panX + e.translationX, s.panY + e.translationY, zoom.get());
        panX.set(p.x);
        panY.set(p.y);
      } else if (!locked) {
        // Not zoomed: dragging the image moves the window (unless it is locked).
        placeWindow(start.get().x + e.translationX, start.get().y + e.translationY);
      }
    });

  const cropPan = Gesture.Pan()
    .enabled(cropping)
    .minDistance(0)
    .onBegin((e) => cropDrag.set({ x0: e.x, y0: e.y, x1: e.x, y1: e.y, active: true }))
    .onUpdate((e) => cropDrag.set({ ...cropDrag.get(), x1: e.x, y1: e.y }))
    .onEnd(() => {
      const d = cropDrag.get();
      const f = frameSize.get();
      scheduleOnRN(applyCrop, d.x0, d.y0, d.x1, d.y1, f.width, f.height, zoom.get(), panX.get(), panY.get());
    })
    .onFinalize(() => cropDrag.set({ ...cropDrag.get(), active: false }));

  const doubleTap = Gesture.Tap()
    .enabled(!cropping)
    .numberOfTaps(2)
    .onEnd((_e, ok) => {
      if (ok) scheduleOnRN(resetZoom);
    });

  const pickTap = Gesture.Tap()
    .enabled(picking && !cropping)
    .onEnd((e, ok) => {
      if (!ok) return;
      const f = frameSize.get();
      scheduleOnRN(pickAt, e.x, e.y, f.width, f.height, zoom.get(), panX.get(), panY.get());
    });

  const imageGestures = Gesture.Simultaneous(pinch, Gesture.Exclusive(cropPan, doubleTap, pickTap, imagePan));

  // ---- rendering ---------------------------------------------------------------------------
  const frameStyle = useAnimatedStyle(() => ({
    width: width.get(),
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
  }));
  const imageFrameStyle = useAnimatedStyle(() => ({ height: Math.min(maxImageH, width.get() / aspect) }));
  const cropBoxStyle = useAnimatedStyle(() => {
    const d = cropDrag.get();
    return {
      opacity: d.active ? 1 : 0,
      left: Math.min(d.x0, d.x1),
      top: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0),
      height: Math.abs(d.y1 - d.y0),
    };
  });
  const transform = useDerivedValue(() => referenceTransform(viewState(zoom.get(), panX.get(), panY.get())));
  /** Display scale (frame points per image pixel), for sizes that must look constant. */
  const displayScale = useDerivedValue(() => {
    const f = frameSize.get();
    return Math.max(0.0001, fitScale(f.width, f.height, iw, ih, view.quarter) * zoom.get());
  });

  const matrix = filterMatrix(filter);
  const blur = filterBlur(filter);
  // The image is drawn in its own pixels, scaled down to the frame: express sizes in pixels so
  // they look the same at any window size and zoom.
  const blurInPixels = useDerivedValue(() => blur / displayScale.get());
  const gridLine = useDerivedValue(() => 1 / displayScale.get());
  const gridShadow = useDerivedValue(() => 2.5 / displayScale.get());
  const gridPath = useMemo(() => {
    if (gridColumns <= 0) return null;
    const cell = iw / gridColumns;
    const b = Skia.PathBuilder.Make();
    for (let i = 1; i < gridColumns; i++) b.moveTo(i * cell, 0).lineTo(i * cell, ih);
    for (let yy = cell; yy < ih - 0.5; yy += cell) b.moveTo(0, yy).lineTo(iw, yy);
    return b.build();
  }, [gridColumns, iw, ih]);
  const regionRect = useMemo(() => rect(0, 0, iw, ih), [iw, ih]);

  const opacity = OPACITIES[opacityIndex];
  const count = references.length;
  const filterLabel = REFERENCE_FILTERS.find((f) => f.id === filter)?.label ?? 'Original';

  if (!reference) return null;

  return (
    <Animated.View style={[styles.frame, frameStyle, hidden && styles.hidden]} pointerEvents={hidden ? 'none' : 'auto'}>
      <GestureDetector gesture={moveGesture}>
        <View style={styles.header} accessibilityLabel={locked ? 'Reference window (locked)' : 'Reference window. Drag to move.'}>
          <Ionicons name={locked ? 'lock-closed' : 'reorder-two'} size={locked ? 14 : 18} color={colors.textDim} />
          <Text style={styles.title} numberOfLines={1}>
            {count > 1 ? `Reference ${index + 1}/${count}` : 'Reference'}
          </Text>
          <RefButton
            icon={locked ? 'lock-closed' : 'lock-open-outline'}
            label={locked ? 'Unlock window (allow moving and resizing)' : 'Lock window in place'}
            active={locked}
            onPress={() => setLocked((l) => !l)}
          />
          <RefButton
            icon={minimized ? 'chevron-down' : 'remove'}
            label={minimized ? 'Expand reference window' : 'Minimise to title bar'}
            onPress={() => setMinimized((m) => !m)}
          />
          <RefButton icon="eye-off-outline" label="Hide reference window" onPress={onHide} />
          <RefButton icon="close" label="Close reference window (images are kept)" onPress={onClose} />
        </View>
      </GestureDetector>

      {minimized ? null : (
        <>
          <GestureDetector gesture={imageGestures}>
            <Animated.View
              style={[styles.imageFrame, imageFrameStyle, (picking || cropping) && styles.modeActive]}
              accessibilityLabel="Reference image. Pinch to zoom, double-tap to reset zoom.">
              {image ? (
                <Canvas style={StyleSheet.absoluteFill} onSize={frameSize}>
                  <Group transform={transform}>
                    <Group clip={regionRect}>
                      <SkiaImage image={image} x={-cx} y={-cy} width={fullW} height={fullH} fit="fill" opacity={opacity}>
                        {matrix ? <ColorMatrix matrix={matrix} /> : null}
                        {blur > 0 ? <Blur blur={blurInPixels} mode="clamp" /> : null}
                      </SkiaImage>
                    </Group>
                    {gridPath ? (
                      <>
                        <Path path={gridPath} style="stroke" strokeWidth={gridShadow} color="rgba(0,0,0,0.45)" />
                        <Path path={gridPath} style="stroke" strokeWidth={gridLine} color="rgba(255,255,255,0.9)" />
                      </>
                    ) : null}
                  </Group>
                </Canvas>
              ) : (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.textDim} />
                </View>
              )}
              <Animated.View style={[styles.cropBox, cropBoxStyle]} pointerEvents="none" />
              {picking ? (
                <View style={styles.modeHint} pointerEvents="none">
                  <Text style={styles.modeHintText}>Tap to pick a colour</Text>
                </View>
              ) : null}
            </Animated.View>
          </GestureDetector>

          {cropping ? (
            <View style={styles.cropBar}>
              <Text style={styles.cropBarText} numberOfLines={2}>
                Drag over the part to keep
              </Text>
              {crop ? (
                <Pressable onPress={resetCrop} style={styles.cropBarButton} accessibilityRole="button">
                  <Text style={styles.cropBarButtonText}>Show all</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setCropping(false)} style={styles.cropBarButton} accessibilityRole="button">
                <Text style={styles.cropBarButtonText}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}

          {filtersOpen ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {REFERENCE_FILTERS.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  style={[styles.chip, filter === f.id && styles.chipSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: filter === f.id }}
                  accessibilityHint={f.hint}>
                  <Text style={[styles.chipLabel, filter === f.id && styles.chipLabelSelected]}>{f.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar} style={styles.toolbarScroll}>
            {count > 1 ? (
              <>
                <RefButton icon="chevron-back" label="Previous reference" onPress={() => go(-1)} />
                <RefButton icon="chevron-forward" label="Next reference" onPress={() => go(1)} />
                <View style={styles.divider} />
              </>
            ) : null}
            <RefButton icon="remove-circle-outline" label="Zoom out" onPress={() => setZoom(zoom.get() / ZOOM_STEP, true)} />
            <RefButton icon="add-circle-outline" label="Zoom in" onPress={() => setZoom(zoom.get() * ZOOM_STEP, true)} />
            <RefButton icon="scan-outline" label="Fit image (reset zoom)" onPress={resetZoom} />
            <View style={styles.divider} />
            <RefButton icon="swap-horizontal" label="Flip horizontally" active={view.flipX} onPress={() => updateView({ flipX: !view.flipX })} />
            <RefButton icon="swap-vertical" label="Flip vertically" active={view.flipY} onPress={() => updateView({ flipY: !view.flipY })} />
            <RefButton icon="refresh" label="Rotate 90°" onPress={() => updateView({ quarter: (view.quarter + 1) % 4 })} />
            <RefButton
              icon="crop-outline"
              label={crop ? 'Crop (cropped; tap to change or show all)' : 'Crop to a part of the image'}
              active={cropping || !!crop}
              onPress={() => {
                setPicking(false);
                setCropping((c) => !c);
              }}
            />
            <RefButton
              icon="color-filter-outline"
              label={`Filter: ${filterLabel}`}
              active={filter !== 'none' || filtersOpen}
              onPress={() => setFiltersOpen((o) => !o)}
            />
            <Pressable
              onPress={() => setOpacityIndex((i) => (i + 1) % OPACITIES.length)}
              style={styles.badge}
              accessibilityRole="button"
              accessibilityLabel={`Reference opacity ${Math.round(opacity * 100)} percent. Tap to change.`}>
              <Text style={styles.badgeText}>{Math.round(opacity * 100)}%</Text>
            </Pressable>
            <RefButton
              icon="grid-outline"
              label={gridColumns > 0 ? `Grid: ${gridColumns} columns (tap for more, then off)` : 'Grid overlay (grid method)'}
              active={gridColumns > 0}
              onPress={() => setGridIndex((i) => (i + 1) % GRID_COLUMNS.length)}
            />
            {gridColumns > 0 ? (
              <Pressable
                onPress={matchGridOnCanvas}
                style={styles.badge}
                accessibilityRole="button"
                accessibilityLabel={`Show the same ${gridColumns}-column grid on the canvas`}>
                <Text style={styles.badgeText}>{gridColumns}× on canvas</Text>
              </Pressable>
            ) : null}
            <RefButton
              icon="eyedrop-outline"
              label="Pick a colour from the reference"
              active={picking}
              onPress={() => {
                setCropping(false);
                setPicking((p) => !p);
              }}
            />
            <RefButton icon="color-palette-outline" label="Make a palette from this reference" onPress={makePalette} />
            <View style={styles.divider} />
            <RefButton icon="contract-outline" label="Smaller window" onPress={() => resize(1 / SIZE_STEP)} />
            <RefButton icon="expand-outline" label="Larger window" onPress={() => resize(SIZE_STEP)} />
            <RefButton
              icon={maximized ? 'copy-outline' : 'square-outline'}
              label={maximized ? 'Restore window size' : 'Maximise window'}
              active={!!maximized}
              onPress={toggleMaximize}
            />
            <View style={styles.divider} />
            <RefButton icon="add" label="Add reference images" onPress={onAdd} />
            <RefButton icon="trash-outline" label="Remove this reference" onPress={() => onRemove(reference.file)} />
          </ScrollView>

          {locked ? null : (
            <GestureDetector gesture={resizeGesture}>
              <View style={styles.resize} accessibilityLabel="Resize reference window">
                <Ionicons name="resize" size={14} color={colors.text} />
              </View>
            </GestureDetector>
          )}
        </>
      )}
    </Animated.View>
  );
}

/** Small window button; holding it shows its tooltip. Shared by the floating windows. */
export function RefButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const ref = useRef<ViewInstance>(null);
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLongPress={() =>
        ref.current?.measureInWindow((x, y, width, height) => useTooltipStore.getState().show(label, { x, y, width, height }))
      }
      delayLongPress={400}
      onPressOut={() => useTooltipStore.getState().hide(TOOLTIP_LINGER_MS)}
      hitSlop={4}
      style={({ pressed }) => [styles.button, active && styles.buttonActive, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}>
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.text} />
    </Pressable>
  );
}

/** Shown while the reference window is hidden, to bring it back. */
export function ShowReferenceButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.show} accessibilityRole="button" accessibilityLabel="Show reference window">
      <Ionicons name="images-outline" size={16} color={colors.text} />
      <Text style={styles.showText}>{count > 1 ? `References (${count})` : 'Reference'}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  frame: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: HEADER_H, paddingHorizontal: spacing.sm },
  title: { flex: 1, color: colors.textDim, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  imageFrame: { overflow: 'hidden', backgroundColor: colors.backdrop },
  modeActive: { borderWidth: 2, borderColor: colors.accent },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  modeHint: {
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
  },
  modeHintText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  cropBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  cropBarText: { flex: 1, color: colors.textDim, fontSize: 12 },
  cropBarButton: { minHeight: 30, paddingHorizontal: spacing.sm, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.panelRaised },
  cropBarButtonText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  toolbarScroll: { flexGrow: 0 },
  toolbar: { alignItems: 'center', gap: 2, height: TOOLBAR_H, paddingHorizontal: spacing.xs, paddingRight: 36 },
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 4, backgroundColor: colors.border },
  button: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  buttonActive: { backgroundColor: colors.accentDim },
  pressed: { backgroundColor: colors.panelRaised },
  badge: {
    minWidth: 42,
    height: 28,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.panelRaised,
  },
  badgeText: { color: colors.text, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  filterRow: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.panelRaised,
  },
  chipSelected: { backgroundColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipLabelSelected: { color: colors.onAccent },
  resize: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: TOOLBAR_H,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  show: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.floating,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  showText: { color: colors.text, fontSize: 12, fontWeight: '600' },
}));
