import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PANEL_LAYOUTS } from '@/engine/comics/comicLayouts';
import { LayoutThumb } from '@/features/comics/LayoutThumb';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

export interface PanelChoice {
  layoutId: string;
  /** Border width, canvas pixels. */
  border: number;
  /** Margin around the panels, canvas pixels. */
  margin: number;
}

const BORDERS = [
  { label: 'Thin', factor: 0.6 },
  { label: 'Medium', factor: 1 },
  { label: 'Thick', factor: 1.8 },
];
const MARGINS = [
  { label: 'None', share: 0 },
  { label: 'Small', share: 0.03 },
  { label: 'Page', share: 0.08 },
];

/**
 * Adds comic / manga panel borders to the open artwork on a new "Panels" layer: pick a layout,
 * border thickness and margin. Previews follow the artwork's proportions.
 */
export function PanelLayoutPicker({
  visible,
  width,
  height,
  onAdd,
  onClose,
}: {
  visible: boolean;
  width: number;
  height: number;
  onAdd: (choice: PanelChoice) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [layoutId, setLayoutId] = useState('manga-dynamic');
  const [borderIndex, setBorderIndex] = useState(1);
  const [marginIndex, setMarginIndex] = useState(2);
  const short = Math.min(width, height);
  const baseBorder = Math.max(3, Math.round(short / 450));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={[styles.backdrop, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Comic panels</Text>
          <Text style={styles.hint}>Added on a new “Panels” layer above your drawing. You can move, hide or erase it like any layer.</Text>
          <ScrollView contentContainerStyle={styles.grid}>
            {PANEL_LAYOUTS.filter((l) => l.id !== 'none').map((l) => (
              <LayoutThumb
                key={l.id}
                layoutId={l.id}
                aspect={width / height}
                label={l.label}
                selected={layoutId === l.id}
                onPress={() => setLayoutId(l.id)}
              />
            ))}
          </ScrollView>
          <Choice label="Border" options={BORDERS.map((b) => b.label)} value={borderIndex} onChange={setBorderIndex} />
          <Choice label="Margin" options={MARGINS.map((m) => m.label)} value={marginIndex} onChange={setMarginIndex} />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.button} accessibilityRole="button">
              <Text style={styles.buttonLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                onAdd({
                  layoutId,
                  border: Math.max(2, Math.round(baseBorder * BORDERS[borderIndex].factor)),
                  margin: Math.round(short * MARGINS[marginIndex].share),
                })
              }
              style={[styles.button, styles.primary]}
              accessibilityRole="button">
              <Text style={styles.primaryLabel}>Add panels</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Choice({ label, options, value, onChange }: { label: string; options: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <View style={styles.choice}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o, i) => (
          <Pressable
            key={o}
            onPress={() => onChange(i)}
            style={[styles.chip, value === i && styles.chipSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === i }}>
            <Text style={[styles.chipLabel, value === i && styles.chipLabelSelected]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '100%',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  choiceLabel: { width: 56, color: colors.textDim, fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipSelected: { backgroundColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipLabelSelected: { color: colors.onAccent },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
  buttonLabel: { color: colors.text, fontWeight: '600' },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
}));
