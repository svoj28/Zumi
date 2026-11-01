import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLEND_GROUP_NAMES, BLEND_MODE_GROUPS } from '@/engine/render/blendModes';
import type { LayerBlendMode } from '@/engine/types';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

interface Props {
  visible: boolean;
  layerName: string;
  value: LayerBlendMode;
  /** Applied immediately, so modes can be compared on the canvas while the picker is open. */
  onChange: (mode: LayerBlendMode) => void;
  onClose: () => void;
}

/**
 * All layer blend modes at once, grouped, in a card centred in the upper part of the screen —
 * away from the screen edge, with large targets. Tapping a mode applies it straight away.
 */
export function BlendModePicker({ visible, layerName, value, onChange, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable
        style={[styles.backdrop, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        onPress={onClose}
        accessibilityLabel="Close blend modes">
        {/* Inner Pressable swallows taps so they don't close the picker. */}
        <Pressable style={[styles.card, { maxHeight: height * 0.75 }]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Blend mode</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {layerName}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.done} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={styles.doneLabel}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {BLEND_MODE_GROUPS.map((group, i) => (
              <View key={group[0].mode} style={styles.group}>
                <Text style={styles.groupName}>{BLEND_GROUP_NAMES[i]}</Text>
                <View style={styles.grid}>
                  {group.map(({ mode, label }) => {
                    const selected = value === mode;
                    return (
                      <Pressable
                        key={mode}
                        onPress={() => onChange(mode)}
                        style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}>
                        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]} numberOfLines={1}>
                          {label}
                        </Text>
                        {selected ? <Ionicons name="checkmark" size={16} color={colors.onAccent} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  // Centred, nudged above the middle: easy to reach and clear of the bottom edge.
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    marginBottom: '15%',
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 12 },
  done: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accent },
  doneLabel: { color: colors.onAccent, fontWeight: '700' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  group: { gap: spacing.xs },
  groupName: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Two per row: big targets whatever the label length.
  option: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panelRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  optionLabel: { color: colors.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  optionLabelSelected: { color: colors.onAccent, fontWeight: '700' },
}));
