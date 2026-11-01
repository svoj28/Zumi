import { Ionicons } from '@expo/vector-icons';
import { Canvas, Image, Path, Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { screenToCanvas, type ViewTransform } from '@/engine/input/viewTransform';
import { renderComposite } from '@/engine/render/composite';
import { useDocumentVersion } from '@/features/editor/useEditorSession';
import { colors, radius, spacing, themed } from '@/ui/theme';

/** Longest side of the preview image (points), cycled by the size button. */
const SIZES = [150, 230];
const HEADER_H = 32;
/** Re-render the preview at most this often while drawing (ms). */
const REFRESH_MS = 250;

/**
 * Mini preview (navigator): the whole artwork in a small floating window, with the visible part
 * of the canvas outlined. Tap or drag inside it to move the view there; drag the title bar to
 * move the window. It updates after each edit (not during a stroke).
 */
export function PreviewWindow({
  doc,
  view,
  viewport,
  mirrored,
  onClose,
}: {
  doc: DrawingDocument;
  view: SharedValue<ViewTransform>;
  viewport: SharedValue<{ w: number; h: number }>;
  /** The display is mirrored (flip view): the outline and navigation follow it. */
  mirrored: boolean;
  onClose: () => void;
}) {
  const version = useDocumentVersion(doc);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { width: docW, height: docH } = doc.info;
  const [sizeIndex, setSizeIndex] = useState(0);
  const side = SIZES[sizeIndex];
  const k = side / Math.max(docW, docH);
  const w = Math.max(1, Math.round(docW * k));
  const h = Math.max(1, Math.round(docH * k));

  // The artwork, re-rendered shortly after edits (throttled so long sessions stay smooth).
  // Rendered at twice the preview size so it stays crisp on high-density screens.
  const [image, setImage] = useState<SkImage | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setImage(renderComposite(doc, Math.min(1, k * 2), { underlay: 'checker' }));
      } catch (error) {
        console.warn('[preview] Could not render the preview', error);
      }
    }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [doc, version, k]);

  // Visible area of the canvas, as a polygon in preview coordinates (follows zoom and rotation).
  const outline = useDerivedValue(() => {
    const t = view.get();
    const { w: vw, h: vh } = viewport.get();
    const b = Skia.PathBuilder.Make();
    if (vw <= 0 || vh <= 0) return b.build();
    const corners = [
      [0, 0],
      [vw, 0],
      [vw, vh],
      [0, vh],
    ];
    corners.forEach(([sx, sy], i) => {
      const p = screenToCanvas(t, sx, sy);
      const x = (mirrored ? docW - p.x : p.x) * k;
      const y = p.y * k;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    });
    b.close();
    return b.build();
  });

  // Tap or drag inside the preview: centre the view on that point (zoom and rotation kept).
  const centreOn = (px: number, py: number) => {
    'worklet';
    const t = view.get();
    const { w: vw, h: vh } = viewport.get();
    const dx = Math.min(docW, Math.max(0, px / k));
    const dy = Math.min(docH, Math.max(0, py / k));
    const x = mirrored ? docW - dx : dx;
    const cos = Math.cos(t.rotation) * t.scale;
    const sin = Math.sin(t.rotation) * t.scale;
    view.set({ ...t, tx: vw / 2 - (x * cos - dy * sin), ty: vh / 2 - (x * sin + dy * cos) });
  };
  const navigate = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => centreOn(e.x, e.y))
    .onUpdate((e) => centreOn(e.x, e.y));

  // ---- window position (UI thread) -----------------------------------------------------------
  const posX = useSharedValue<number>(spacing.sm);
  const posY = useSharedValue<number>(spacing.sm + 56);
  const start = useSharedValue({ x: 0, y: 0 });
  const move = Gesture.Pan()
    .onBegin(() => start.set({ x: posX.get(), y: posY.get() }))
    .onUpdate((e) => {
      posX.set(Math.min(screenW - 48, Math.max(48 - w, start.get().x + e.translationX)));
      posY.set(Math.min(screenH - HEADER_H * 2, Math.max(0, start.get().y + e.translationY)));
    });
  const frameStyle = useAnimatedStyle(() => ({ transform: [{ translateX: posX.get() }, { translateY: posY.get() }] }));

  return (
    <Animated.View style={[styles.frame, { width: Math.max(w, 120) }, frameStyle]}>
      <GestureDetector gesture={move}>
        <View style={styles.header} accessibilityLabel="Preview window. Drag to move it.">
          <Ionicons name="reorder-two" size={16} color={colors.textDim} />
          <Text style={styles.title} numberOfLines={1}>
            Preview
          </Text>
          <Pressable
            onPress={() => setSizeIndex((i) => (i + 1) % SIZES.length)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={sizeIndex === 0 ? 'Make the preview larger' : 'Make the preview smaller'}>
            <Ionicons name={sizeIndex === 0 ? 'expand-outline' : 'contract-outline'} size={16} color={colors.text} />
          </Pressable>
          <Pressable onPress={onClose} hitSlop={6} accessibilityRole="button" accessibilityLabel="Hide preview">
            <Ionicons name="close" size={18} color={colors.text} />
          </Pressable>
        </View>
      </GestureDetector>
      <GestureDetector gesture={navigate}>
        <View style={[styles.stage, { width: Math.max(w, 120), height: h }]} accessibilityLabel="Artwork preview. Tap to move the view there.">
          <Canvas style={{ width: w, height: h }} pointerEvents="none">
            {image ? <Image image={image} x={0} y={0} width={w} height={h} fit="fill" /> : null}
            <Path path={outline} style="stroke" strokeWidth={3} color="rgba(0,0,0,0.35)" />
            <Path path={outline} style="stroke" strokeWidth={1.5} color={colors.accent} />
          </Canvas>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
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
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: HEADER_H, paddingHorizontal: spacing.sm },
    title: { flex: 1, color: colors.textDim, fontSize: 12, fontWeight: '600' },
    stage: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backdrop },
  }),
);
