import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { nowMs } from '@/engine/input/strokeInput';
import { colors, radius, themed } from '@/ui/theme';
import { useFrameThrottle } from '@/ui/useFrameThrottle';
import { ValueEntryDialog, type ValueEntry } from '@/ui/valueEntry';

/** Two taps within this time (ms) are a double tap. */
const DOUBLE_TAP_MS = 300;

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Track length in points. */
  length?: number;
  curve?: 'linear' | 'quadratic';
  format: (value: number) => string;
  onChange: (value: number) => void;
  /** Which side the value bubble appears on while dragging. */
  bubbleSide?: 'left' | 'right';
  /** Enables typing an exact value by double-tapping the slider. */
  entry?: ValueEntry;
}

const WIDTH = 34;

/**
 * Compact vertical slider for quick brush size / opacity changes. The fill follows the finger
 * on the UI thread; a value bubble appears beside it while dragging.
 */
export function VerticalSlider({
  label,
  value,
  min,
  max,
  length = 150,
  curve = 'linear',
  format,
  onChange,
  bubbleSide = 'right',
  entry,
}: Props) {
  const fraction = useSharedValue(toFraction(value, min, max, curve));
  const dragging = useSharedValue(false);
  const [active, setActive] = useState(false);
  const [editing, setEditing] = useState(false);
  const change = useFrameThrottle(onChange);
  const tapGuard = useSharedValue({ before: 0, lastEnd: -1e9 });

  useEffect(() => {
    if (!dragging.get()) fraction.set(toFraction(value, min, max, curve));
  }, [value, min, max, curve, dragging, fraction]);

  const update = (y: number) => {
    'worklet';
    const f = Math.min(1, Math.max(0, 1 - y / length));
    fraction.set(f);
    scheduleOnRN(change.push, fromFraction(f, min, max, curve));
  };

  const end = () => {
    change.flush();
    setActive(false);
  };

  /** After a double tap: undo the jumps the two taps made, then ask for an exact value. */
  const openEntry = (restored: number) => {
    // Runs after the second tap's own end handling, which is scheduled at the same moment.
    setTimeout(() => {
      change.push(restored);
      change.flush();
      setEditing(true);
    }, 0);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const guard = tapGuard.get();
      // Remember the value before a touch sequence (not before the second tap of a pair).
      if (nowMs() - guard.lastEnd > DOUBLE_TAP_MS) tapGuard.set({ ...guard, before: fraction.get() });
      dragging.set(true);
      scheduleOnRN(setActive, true);
      update(e.y);
    })
    .onUpdate((e) => update(e.y))
    .onFinalize(() => {
      dragging.set(false);
      tapGuard.set({ ...tapGuard.get(), lastEnd: nowMs() });
      scheduleOnRN(end);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(DOUBLE_TAP_MS)
    .onEnd((_e, success) => {
      if (!success) return;
      const before = tapGuard.get().before;
      fraction.set(before);
      scheduleOnRN(openEntry, fromFraction(before, min, max, curve));
    });

  const gesture = entry ? Gesture.Simultaneous(pan, doubleTap) : pan;

  const fillStyle = useAnimatedStyle(() => ({ height: `${fraction.get() * 100}%` }));

  return (
    <View style={styles.wrap} accessible accessibilityRole="adjustable" accessibilityLabel={`${label} ${format(value)}`}>
      <GestureDetector gesture={gesture}>
        <View style={[styles.track, { height: length }]} hitSlop={{ left: 8, right: 8 }}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
      </GestureDetector>
      {active ? (
        <View style={[styles.bubble, bubbleSide === 'right' ? { left: WIDTH + 10 } : { right: WIDTH + 10 }]} pointerEvents="none">
          <Text style={styles.bubbleLabel}>{label}</Text>
          <Text style={styles.bubbleValue}>{format(value)}</Text>
        </View>
      ) : null}
      {editing && entry ? (
        <ValueEntryDialog
          label={label}
          value={value}
          min={min}
          max={max}
          entry={entry}
          onSubmit={onChange}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </View>
  );
}

function toFraction(value: number, min: number, max: number, curve: 'linear' | 'quadratic'): number {
  'worklet';
  const linear = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return curve === 'quadratic' ? Math.sqrt(linear) : linear;
}

function fromFraction(f: number, min: number, max: number, curve: 'linear' | 'quadratic'): number {
  'worklet';
  const t = curve === 'quadratic' ? f * f : f;
  return min + (max - min) * t;
}

const styles = themed(() => StyleSheet.create({
  wrap: { width: WIDTH, alignItems: 'center', justifyContent: 'center' },
  track: {
    width: WIDTH - 12,
    borderRadius: radius.pill,
    backgroundColor: colors.panelRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { width: '100%', backgroundColor: colors.text, opacity: 0.85 },
  bubble: {
    position: 'absolute',
    minWidth: 76,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bubbleLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  bubbleValue: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
