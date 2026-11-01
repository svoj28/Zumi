import { Ionicons } from '@expo/vector-icons';
import { useRef, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { useSettingsStore } from '@/state/settingsStore';
import { colors, radius, themed, TOUCH_TARGET } from '@/ui/theme';
import { TOOLTIP_LINGER_MS, useTooltipStore } from '@/ui/Tooltip';

/** Compact interface: smaller buttons, still comfortably tappable. */
export const COMPACT_TARGET = 38;
/** Holding a button this long shows its tooltip (and does not press it). */
const TOOLTIP_HOLD_MS = 400;

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Props {
  icon: IconName;
  onPress: () => void;
  /** Accessibility label, also shown as the tooltip when the button is held. */
  label: string;
  active?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
  size?: number;
  tint?: string;
}

export function IconButton({ icon, onPress, label, active, disabled, showLabel, size, tint }: Props) {
  const compact = useSettingsStore((s) => s.compactUi);
  const ref = useRef<ViewInstance>(null);
  const iconSize = size ?? (compact ? 20 : 22);
  const color = disabled ? colors.border : active ? colors.accent : (tint ?? colors.text);

  const showTooltip = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      useTooltipStore.getState().show(label, { x, y, width, height });
    });
  };

  return (
    <Pressable
      ref={ref}
      // Disabled buttons still answer a long press, so a greyed-out button can be identified.
      onPress={disabled ? undefined : onPress}
      onLongPress={showTooltip}
      delayLongPress={TOOLTIP_HOLD_MS}
      onPressOut={() => useTooltipStore.getState().hide(TOOLTIP_LINGER_MS)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        active && styles.active,
        pressed && !disabled && styles.pressed,
      ]}>
      <View style={styles.inner}>
        <Ionicons name={icon} size={iconSize} color={color} />
        {showLabel ? <Text style={[styles.label, { color }]}>{label}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  button: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  compact: { minWidth: COMPACT_TARGET, minHeight: COMPACT_TARGET, paddingHorizontal: 4 },
  inner: { alignItems: 'center', gap: 2 },
  active: { backgroundColor: colors.accentDim },
  pressed: { backgroundColor: colors.panelRaised },
  label: { fontSize: 11, fontWeight: '600' },
}));
