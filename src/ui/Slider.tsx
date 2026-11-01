import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { nowMs } from '@/engine/input/strokeInput';
import { colors, radius, spacing, themed } from '@/ui/theme';
import { useFrameThrottle } from '@/ui/useFrameThrottle';
import { ValueEntryDialog, type ValueEntry } from '@/ui/valueEntry';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Maps slider fraction → value non-linearly (e.g. brush size). Defaults to linear. */
  curve?: 'linear' | 'quadratic';
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: (value: number) => void;
  /** Optional colour ramp drawn as the track (colour sliders). Replaces the accent fill. */
  gradient?: string[];
  /** Enables typing an exact value by double-tapping the slider. */
  entry?: ValueEntry;
}

/** Two taps within this time (ms) are a double tap. */
const DOUBLE_TAP_MS = 300;

/**
 * Gesture-driven slider. The thumb moves on the UI thread; the JS callback receives values but
 * the thumb never waits for a React render, so dragging stays smooth.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 0,
  curve = 'linear',
  format = (v) => String(Math.round(v)),
  onChange,
  onChangeStart,
  onChangeEnd,
  gradient,
  entry,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const width = useSharedValue(1);
  const fraction = useSharedValue(toFraction(value, min, max, curve));
  const dragging = useSharedValue(false);
  const change = useFrameThrottle(onChange);
  const tapGuard = useSharedValue({ before: 0, lastEnd: -1e9 });

  useEffect(() => {
    if (!dragging.get()) fraction.set(toFraction(value, min, max, curve));
  }, [value, min, max, curve, dragging, fraction]);

  /** The final value is applied at once, before `onChangeEnd`. */
  const end = (v: number) => {
    change.push(v);
    change.flush();
    onChangeEnd?.(v);
  };

  const emit = (f: number, phase: 'start' | 'move' | 'end') => {
    'worklet';
    const v = fromFraction(f, min, max, curve, step);
    if (phase === 'start' && onChangeStart) scheduleOnRN(onChangeStart);
    if (phase === 'end') scheduleOnRN(end, v);
    else scheduleOnRN(change.push, v);
  };

  /** After a double tap: undo the jumps the two taps made, then ask for an exact value. */
  const openEntry = (restored: number) => {
    // Runs after the second tap's own end handling, which is scheduled at the same moment.
    setTimeout(() => {
      end(restored);
      setEditing(true);
    }, 0);
  };

  const submitEntry = (v: number) => {
    onChangeStart?.();
    end(v);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const guard = tapGuard.get();
      // Remember the value before a touch sequence (not before the second tap of a pair).
      if (nowMs() - guard.lastEnd > DOUBLE_TAP_MS) tapGuard.set({ ...guard, before: fraction.get() });
      dragging.set(true);
      fraction.set(clamp01(e.x / width.get()));
      emit(fraction.get(), 'start');
    })
    .onUpdate((e) => {
      fraction.set(clamp01(e.x / width.get()));
      emit(fraction.get(), 'move');
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      tapGuard.set({ ...tapGuard.get(), lastEnd: nowMs() });
      emit(fraction.get(), 'end');
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(DOUBLE_TAP_MS)
    .onEnd((_e, success) => {
      if (!success) return;
      const before = tapGuard.get().before;
      fraction.set(before);
      scheduleOnRN(openEntry, fromFraction(before, min, max, curve, step));
    });

  const gesture = entry ? Gesture.Simultaneous(pan, doubleTap) : pan;

  const fillStyle = useAnimatedStyle(() => ({ width: `${fraction.get() * 100}%` }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fraction.get() * width.get() - THUMB / 2 }],
  }));

  return (
    <View style={styles.root} accessible accessibilityLabel={`${label} ${format(value)}`}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{format(value)}</Text>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.hit}
          onLayout={(e) => {
            width.set(Math.max(1, e.nativeEvent.layout.width));
            if (gradient) setTrackWidth(e.nativeEvent.layout.width);
          }}>
          <View style={[styles.track, gradient && styles.gradientTrack]}>
            {gradient ? (
              trackWidth > 0 ? (
                <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Rect x={0} y={0} width={trackWidth} height={GRADIENT_H}>
                    <LinearGradient start={vec(0, 0)} end={vec(trackWidth, 0)} colors={gradient} />
                  </Rect>
                </Canvas>
              ) : null
            ) : (
              <Animated.View style={[styles.fill, fillStyle]} />
            )}
          </View>
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
      {editing && entry ? (
        <ValueEntryDialog
          label={label}
          value={value}
          min={min}
          max={max}
          entry={entry}
          onSubmit={submitEntry}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </View>
  );
}

const THUMB = 20;
const GRADIENT_H = 14;

function clamp01(v: number): number {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

function toFraction(value: number, min: number, max: number, curve: 'linear' | 'quadratic'): number {
  'worklet';
  const linear = clamp01((value - min) / (max - min));
  return curve === 'quadratic' ? Math.sqrt(linear) : linear;
}

function fromFraction(
  f: number,
  min: number,
  max: number,
  curve: 'linear' | 'quadratic',
  step: number,
): number {
  'worklet';
  const t = curve === 'quadratic' ? f * f : f;
  const v = min + (max - min) * t;
  return step > 0 ? Math.round(v / step) * step : v;
}

const styles = themed(() => StyleSheet.create({
  root: { gap: spacing.xs },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  value: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  hit: { height: 32, justifyContent: 'center' },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.panelRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  gradientTrack: { height: GRADIENT_H, borderWidth: 1, borderColor: colors.border },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.accent,
  },
}));
