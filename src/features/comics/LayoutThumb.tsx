import { Canvas, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { findLayout, layoutPanels } from '@/engine/comics/comicLayouts';
import { colors, radius, spacing, themed } from '@/ui/theme';

const THUMB_H = 64;

/** Miniature page showing a panel layout, as a selectable tile. */
export function LayoutThumb({
  layoutId,
  aspect,
  label,
  selected,
  onPress,
}: {
  layoutId: string;
  /** Page width / height. */
  aspect: number;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  // Very tall pages (webtoon) are shown as a slice so the panels stay readable.
  const shownAspect = Math.max(0.28, Math.min(2.2, aspect));
  const h = THUMB_H;
  const w = Math.round(h * shownAspect);
  const path = useMemo(() => {
    const layout = findLayout(layoutId);
    const b = Skia.PathBuilder.Make();
    if (!layout) return b.build();
    const m = Math.min(w, h) * 0.08;
    for (const q of layoutPanels(layout, { x: m, y: m, width: w - 2 * m, height: h - 2 * m }, Math.min(w, h) * 0.05)) {
      b.moveTo(q[0].x, q[0].y).lineTo(q[1].x, q[1].y).lineTo(q[2].x, q[2].y).lineTo(q[3].x, q[3].y).close();
    }
    return b.build();
  }, [layoutId, w, h]);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.tile, selected && styles.tileSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} panel layout`}>
      <View style={{ width: w, height: h }}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={w} height={h} color="#ffffff" />
          <Path path={path} style="stroke" strokeWidth={1.5} color="#111111" />
        </Canvas>
      </View>
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  tile: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.panelRaised,
    minWidth: 84,
  },
  tileSelected: { borderColor: colors.accent },
  label: { color: colors.textDim, fontSize: 11, fontWeight: '600', maxWidth: 110 },
  labelSelected: { color: colors.accent },
}));
