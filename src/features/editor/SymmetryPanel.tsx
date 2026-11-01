import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SymmetryMode } from '@/engine/brush/symmetry';
import { useToolStore } from '@/state/toolStore';
import { colors, radius, spacing, themed } from '@/ui/theme';

const MODES: { mode: SymmetryMode; label: string; hint: string }[] = [
  { mode: 'off', label: 'Off', hint: 'Strokes are not mirrored.' },
  { mode: 'vertical', label: 'Vertical', hint: 'Mirrors left ↔ right across a vertical axis.' },
  { mode: 'horizontal', label: 'Horizontal', hint: 'Mirrors top ↔ bottom across a horizontal axis.' },
  { mode: 'quadrant', label: 'Quadrant', hint: 'Mirrors across both axes: four copies.' },
  { mode: 'radial', label: 'Radial', hint: 'Rotated copies around the centre, like a mandala.' },
];

const SEGMENTS = [3, 4, 5, 6, 8, 12, 16];

/** Symmetry drawing settings. The axis is a guide only; it is never drawn into the artwork. */
export function SymmetryPanel() {
  const symmetry = useToolStore((s) => s.symmetry);
  const update = useToolStore((s) => s.updateSymmetry);
  const active = MODES.find((m) => m.mode === symmetry.mode) ?? MODES[0];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Symmetry</Text>
      <Chips
        items={MODES.map((m) => ({ key: m.mode, label: m.label }))}
        selected={symmetry.mode}
        onSelect={(mode) => update({ mode: mode as SymmetryMode })}
      />
      <Text style={styles.hint}>{active.hint}</Text>

      {symmetry.mode === 'radial' ? (
        <View style={styles.group}>
          <Text style={styles.label}>Segments</Text>
          <Chips
            items={SEGMENTS.map((n) => ({ key: String(n), label: String(n) }))}
            selected={String(symmetry.segments)}
            onSelect={(n) => update({ segments: Number(n) })}
          />
        </View>
      ) : null}

      {symmetry.mode !== 'off' ? (
        <>
          <Pressable
            style={styles.button}
            onPress={() => update({ cx: 0.5, cy: 0.5 })}
            accessibilityRole="button"
            accessibilityLabel="Move the symmetry axis back to the centre of the canvas">
            <Text style={styles.buttonLabel}>Centre the axis</Text>
          </Pressable>
          <Text style={styles.hint}>
            Drag the purple handle on the canvas to move the axis. Shapes are mirrored too. The axis is a guide only and is
            never exported.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function Chips({
  items,
  selected,
  onSelect,
}: {
  items: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {items.map((item) => {
        const on = item.key === selected;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.chip, on && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}>
            <Text style={[styles.chipLabel, on && styles.chipLabelSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  group: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipSelected: { backgroundColor: colors.accentDim },
  chipLabel: { color: colors.textDim, fontWeight: '600' },
  chipLabelSelected: { color: colors.accent },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.panelRaised },
  buttonLabel: { color: colors.text, fontWeight: '600' },
}));
