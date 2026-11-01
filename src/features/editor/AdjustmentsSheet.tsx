import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ADJUSTMENTS,
  adjustmentInfo,
  defaultAdjustment,
  formatParam,
  isNeutral,
  type Adjustment,
  type AdjustmentKind,
} from '@/engine/render/adjustments';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed } from '@/ui/theme';

/**
 * Adjustments and filters for the active layer, previewed live on the canvas (the editor passes
 * `value` to the canvas). Applying records one undo step; only the selection changes if there
 * is one.
 */
export function AdjustmentsSheet({
  layerName,
  value,
  hasSelection,
  bottom,
  onChange,
  onApply,
  onCancel,
}: {
  layerName: string;
  value: Adjustment;
  hasSelection: boolean;
  bottom: number;
  onChange: (adjustment: Adjustment) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const info = adjustmentInfo(value.kind);
  const pick = (kind: AdjustmentKind) => onChange(defaultAdjustment(kind));
  return (
    <View style={[styles.sheet, { bottom }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
        {ADJUSTMENTS.map((a) => {
          const selected = a.kind === value.kind;
          return (
            <Pressable
              key={a.kind}
              onPress={() => pick(a.kind)}
              style={[styles.kind, selected && styles.kindOn]}
              accessibilityRole="button"
              accessibilityState={{ selected }}>
              <Text style={[styles.kindLabel, selected && styles.kindLabelOn]}>{a.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.target} numberOfLines={1}>
        {info.label} · {layerName}
        {hasSelection ? ' · selection only' : ''}
      </Text>
      {info.params.length === 0 ? <Text style={styles.hint}>No settings — Apply to {info.label.toLowerCase()} the layer.</Text> : null}
      {info.params.map((param) => (
        <Slider
          key={param.key}
          label={param.label}
          value={value.values[param.key] ?? param.default}
          min={param.min}
          max={param.max}
          step={param.step}
          format={(v) => formatParam(param, v)}
          onChange={(v) => onChange({ ...value, values: { ...value.values, [param.key]: v } })}
        />
      ))}
      <View style={styles.actions}>
        <Pressable onPress={() => onChange(defaultAdjustment(value.kind))} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Reset</Text>
        </Pressable>
        <View style={styles.flex} />
        <Pressable onPress={onCancel} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={onApply}
          disabled={isNeutral(value)}
          style={[styles.button, styles.primary, isNeutral(value) && styles.disabled]}
          accessibilityRole="button">
          <Text style={styles.primaryLabel}>Apply</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    flex: { flex: 1 },
    sheet: {
      position: 'absolute',
      zIndex: 30,
      left: spacing.sm,
      right: spacing.sm,
      alignSelf: 'center',
      maxWidth: 560,
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.floating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 30,
    },
    kinds: { gap: spacing.xs, paddingBottom: spacing.xs },
    kind: { minHeight: 34, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
    kindOn: { backgroundColor: colors.accentDim },
    kindLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
    kindLabelOn: { color: colors.accent },
    target: { color: colors.text, fontWeight: '700', fontSize: 13 },
    hint: { color: colors.textDim, fontSize: 12 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    button: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.md },
    buttonLabel: { color: colors.text, fontWeight: '600' },
    primary: { backgroundColor: colors.accent },
    primaryLabel: { color: colors.onAccent, fontWeight: '700' },
    disabled: { opacity: 0.4 },
  }),
);