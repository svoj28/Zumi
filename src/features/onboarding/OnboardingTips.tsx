import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSettingsStore } from '@/state/settingsStore';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const SLIDES: { icon: IconName; title: string; points: string[] }[] = [
  {
    icon: 'color-palette-outline',
    title: 'Welcome to Zumi',
    points: ['Everything you make stays on this device.', 'Tap “New Artwork” to start, or “Ask AI” for ideas, themes and palettes.'],
  },
  {
    icon: 'hand-left-outline',
    title: 'Gestures',
    points: [
      'Two fingers: move, zoom and rotate the canvas.',
      'Two-finger tap: undo · three-finger tap: redo.',
      'Press and hold: pick a colour (eyedropper).',
      'Hold still at the end of a line: it snaps into a clean shape.',
    ],
  },
  {
    icon: 'brush-outline',
    title: 'Brushes',
    points: [
      'Pencils, inks, paints, blenders, smudge, airbrushes, textures and screentones.',
      'Make your own in Brush Studio, even from a photo, and share them as .zumibrush files.',
    ],
  },
  {
    icon: 'layers-outline',
    title: 'Layers',
    points: [
      'Clip layers to the one below, add masks, group layers into folders.',
      'Mark line art as a reference layer so the paint bucket fills between its lines.',
    ],
  },
  {
    icon: 'construct-outline',
    title: 'Tools',
    points: [
      'Selection with magic wand, fill, gradients (also manga tone gradients), text and liquify.',
      'Rulers and perspective guides keep lines straight; transform moves, rotates and warps.',
      'Adjustments & filters: colour, levels, curves, blur, sharpen and more.',
    ],
  },
  {
    icon: 'film-outline',
    title: 'Animate & share',
    points: [
      'Turn on Animation to draw frame by frame with onion skins.',
      'Export images, layered PSD files, timelapses and animations (GIF or MP4).',
    ],
  },
];

/** First-run tour of the main gestures and features (shown again from Settings). */
export function OnboardingTips() {
  const seen = useSettingsStore((s) => s.onboardingSeen);
  const setSeen = useSettingsStore((s) => s.setOnboardingSeen);
  const [index, setIndex] = useState(0);
  if (seen) return null;
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;
  const close = () => {
    setSeen(true);
    setIndex(0);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.icon}>
            <Ionicons name={slide.icon} size={32} color={colors.accent} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {slide.title}
          </Text>
          <View style={styles.points}>
            {slide.points.map((p) => (
              <View key={p} style={styles.point}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.pointText}>{p}</Text>
              </View>
            ))}
          </View>
          <View style={styles.dots} accessibilityLabel={`Tip ${index + 1} of ${SLIDES.length}`}>
            {SLIDES.map((s, i) => (
              <View key={s.title} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
          </View>
          <View style={styles.actions}>
            <Pressable onPress={close} style={styles.button} accessibilityRole="button">
              <Text style={styles.skip}>{last ? 'Close' : 'Skip'}</Text>
            </Pressable>
            {index > 0 ? (
              <Pressable onPress={() => setIndex(index - 1)} style={styles.button} accessibilityRole="button">
                <Text style={styles.skip}>Back</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => (last ? close() : setIndex(index + 1))} style={[styles.button, styles.primary]} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{last ? 'Start drawing' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.55)' },
    card: { width: '100%', maxWidth: 420, gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.panel },
    icon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDim, alignSelf: 'center' },
    title: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    points: { gap: spacing.sm },
    point: { flexDirection: 'row', gap: spacing.sm },
    bullet: { color: colors.accent, fontSize: 15, lineHeight: 21 },
    pointText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 21 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.panelRaised },
    dotOn: { backgroundColor: colors.accent, width: 18 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
    skip: { color: colors.text, fontWeight: '600' },
    primary: { backgroundColor: colors.accent },
    primaryLabel: { color: colors.onAccent, fontWeight: '700' },
  }),
);