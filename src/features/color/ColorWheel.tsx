import { Canvas, Circle, Group, RadialGradient, SweepGradient, vec } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { hsvToHex } from '@/engine/color/colorMath';

const HUES = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'];

interface Props {
  size: number;
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
  onChange: (h: number, s: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Hue/saturation wheel: angle = hue, distance from centre = saturation. Brightness (value) is
 * shown by darkening the disk and edited with the value slider next to it.
 */
export function ColorWheel({ size, h, s, v, onChange, onStart, onEnd }: Props) {
  const r = size / 2;
  const knobX = r + Math.cos((h * Math.PI) / 180) * s * (r - 2);
  const knobY = r + Math.sin((h * Math.PI) / 180) * s * (r - 2);

  const pick = (x: number, y: number) => {
    'worklet';
    const dx = x - r;
    const dy = y - r;
    let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (r - 2));
    scheduleOnRN(onChange, hue, sat);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (onStart) scheduleOnRN(onStart);
      pick(e.x, e.y);
    })
    .onUpdate((e) => pick(e.x, e.y))
    .onFinalize(() => {
      if (onEnd) scheduleOnRN(onEnd);
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width: size, height: size }} accessibilityLabel="Colour wheel" accessibilityHint="Drag to choose hue and saturation">
        <Canvas style={StyleSheet.absoluteFill}>
          <Circle cx={r} cy={r} r={r}>
            <SweepGradient c={vec(r, r)} colors={HUES} />
          </Circle>
          <Circle cx={r} cy={r} r={r}>
            <RadialGradient c={vec(r, r)} r={r} colors={['#ffffff', 'rgba(255,255,255,0)']} />
          </Circle>
          <Circle cx={r} cy={r} r={r} color="black" opacity={1 - v} />
          <Group>
            <Circle cx={knobX} cy={knobY} r={11} color="white" />
            <Circle cx={knobX} cy={knobY} r={8} color={hsvToHex({ h, s, v })} />
            <Circle cx={knobX} cy={knobY} r={11} color="black" style="stroke" strokeWidth={1} opacity={0.4} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}
