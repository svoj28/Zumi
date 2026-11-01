import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import type { RulerKind } from '@/engine/input/rulers';
import { DEFAULT_VANISHING, useSettingsStore, type PerspectiveMode } from '@/state/settingsStore';
import { IconButton } from '@/ui/IconButton';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed } from '@/ui/theme';

const GRID_SIZES = [32, 64, 128, 256, 512];
const PERSPECTIVE_MODES: readonly { value: PerspectiveMode; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 1, label: '1-point' },
  { value: 2, label: '2-point' },
  { value: 3, label: '3-point' },
];
const MAX_GUIDES = 12;
const RULERS: readonly { value: RulerKind; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: '' },
  { value: 'line', label: 'Straight', hint: 'Strokes that start near the ruler follow it exactly.' },
  { value: 'parallel', label: 'Parallel', hint: 'Every stroke is a straight line parallel to the ruler (hatching, rain).' },
  { value: 'ellipse', label: 'Ellipse', hint: 'Strokes follow ellipses around the centre (wheels, plates, halos).' },
  { value: 'radial', label: 'Focus lines', hint: 'Strokes run straight toward the centre (manga speed / focus lines).' },
];

type Axis = 'horizontal' | 'vertical';

/**
 * Drawing guides overlay. Guides are workspace aids: they are never part of the artwork, and
 * exports leave them out unless "Share image with guides" is chosen explicitly.
 */
export function GuidesPanel() {
  const guides = useSettingsStore((s) => s.guides);
  const update = useSettingsStore((s) => s.updateGuides);

  const setLine = (axis: Axis, index: number, value: number) =>
    update({ [axis]: guides[axis].map((v, i) => (i === index ? value : v)) });
  const removeLine = (axis: Axis, index: number) => update({ [axis]: guides[axis].filter((_, i) => i !== index) });
  const addLine = (axis: Axis) => update({ [axis]: [...guides[axis], 0.5] });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Guides</Text>
      <Toggle label="Grid" value={guides.grid} onChange={(grid) => update({ grid })} />
      {guides.grid ? (
        <View style={styles.chips}>
          {GRID_SIZES.map((size) => (
            <Pressable
              key={size}
              onPress={() => update({ gridSize: size })}
              style={[styles.chip, guides.gridSize === size && styles.chipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: guides.gridSize === size }}
              accessibilityLabel={`Grid spacing ${size} pixels`}>
              <Text style={[styles.chipLabel, guides.gridSize === size && styles.chipLabelSelected]}>{size}px</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Toggle label="Centre lines" value={guides.center} onChange={(center) => update({ center })} />
      <Toggle label="Rule of thirds" value={guides.thirds} onChange={(thirds) => update({ thirds })} />

      <Text style={styles.subheading}>Perspective</Text>
      <View style={styles.chips}>
        {PERSPECTIVE_MODES.map((m) => (
          <Pressable
            key={m.value}
            onPress={() => update({ perspective: m.value })}
            style={[styles.chip, guides.perspective === m.value && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: guides.perspective === m.value }}>
            <Text style={[styles.chipLabel, guides.perspective === m.value && styles.chipLabelSelected]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      {guides.perspective > 0 ? (
        <>
          <Toggle
            label="Snap strokes to perspective"
            value={guides.perspectiveSnap}
            onChange={(perspectiveSnap) => update({ perspectiveSnap })}
          />
          <View style={styles.perspectiveRow}>
            <Text style={[styles.hint, styles.flex]}>
              While this panel is open, drag the orange points on the canvas to move the vanishing points (zoom out to reach
              points outside the canvas).
            </Text>
            <Pressable
              onPress={() => update({ vanishing: DEFAULT_VANISHING.map((v) => ({ ...v })) })}
              style={styles.chip}
              accessibilityRole="button">
              <Text style={styles.chipLabel}>Reset points</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <Text style={styles.subheading}>Ruler</Text>
      <View style={styles.chips}>
        {RULERS.map((r) => (
          <Pressable
            key={r.value}
            onPress={() => update({ ruler: { ...guides.ruler, kind: r.value } })}
            style={[styles.chip, guides.ruler.kind === r.value && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: guides.ruler.kind === r.value }}>
            <Text style={[styles.chipLabel, guides.ruler.kind === r.value && styles.chipLabelSelected]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      {guides.ruler.kind !== 'off' ? (
        <View style={styles.perspectiveRow}>
          <Text style={[styles.hint, styles.flex]}>
            {RULERS.find((r) => r.value === guides.ruler.kind)?.hint} While this panel is open, drag the green handles on the canvas to place the ruler.
          </Text>
          <Pressable
            onPress={() => update({ ruler: { kind: guides.ruler.kind, ax: 0.3, ay: 0.5, bx: guides.ruler.kind === 'ellipse' ? 0.5 : 0.7, by: guides.ruler.kind === 'ellipse' ? 0.35 : 0.5 } })}
            style={styles.chip}
            accessibilityRole="button">
            <Text style={styles.chipLabel}>Reset</Text>
          </Pressable>
        </View>
      ) : null}

      <GuideLines axis="horizontal" values={guides.horizontal} onAdd={addLine} onChange={setLine} onRemove={removeLine} />
      <GuideLines axis="vertical" values={guides.vertical} onAdd={addLine} onChange={setLine} onRemove={removeLine} />

      <Slider
        label="Guide opacity"
        value={guides.opacity}
        min={0.1}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => update({ opacity })}
      />
      <Text style={styles.hint}>
        Guides are only shown while you work. They are left out of exports unless you choose “Share image with guides”.
      </Text>
    </ScrollView>
  );
}

function GuideLines({
  axis,
  values,
  onAdd,
  onChange,
  onRemove,
}: {
  axis: Axis;
  values: readonly number[];
  onAdd: (axis: Axis) => void;
  onChange: (axis: Axis, index: number, value: number) => void;
  onRemove: (axis: Axis, index: number) => void;
}) {
  const noun = axis === 'horizontal' ? 'Horizontal guide' : 'Vertical guide';
  const position = axis === 'horizontal' ? 'from top' : 'from left';
  return (
    <View style={styles.group}>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{noun}s</Text>
        <IconButton icon="add" label={`Add ${noun.toLowerCase()}`} onPress={() => onAdd(axis)} disabled={values.length >= MAX_GUIDES} />
      </View>
      {values.map((value, index) => (
        <View key={index} style={styles.lineRow}>
          <View style={styles.lineSlider}>
            <Slider
              label={`${noun} ${index + 1}`}
              value={value}
              min={0}
              max={1}
              format={(v) => `${Math.round(v * 100)}% ${position}`}
              onChange={(v) => onChange(axis, index, v)}
            />
          </View>
          <IconButton icon="trash-outline" label={`Remove ${noun.toLowerCase()} ${index + 1}`} size={18} onPress={() => onRemove(axis, index)} />
        </View>
      ))}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.panelRaised }} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  subheading: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  perspectiveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  group: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  rowLabel: { color: colors.text, fontSize: 14 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  lineSlider: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipSelected: { backgroundColor: colors.accentDim },
  chipLabel: { color: colors.textDim, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chipLabelSelected: { color: colors.accent },
  hint: { color: colors.textDim, fontSize: 12 },
}));
