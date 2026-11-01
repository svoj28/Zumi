import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Image, type ImageSourcePropType, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Hold the native splash until the animated one has its first frame ready to take over.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Rendered width of the Z mark, in dp. Must match the native splash: `imageWidth` × 0.66 (see app.json). */
const MARK_WIDTH = 140;

// Piece rectangles in "Zumi Logo.png" pixels, relative to the logo's visible bounds.
const LOGO = { w: 681, h: 808 };
const MARK = { x: 49, y: 0, w: 612, h: 555 };
const LETTER_TOP = 604;
const LETTER_HEIGHT = 204;
const LETTERS: { source: ImageSourcePropType; x: number; w: number }[] = [
  { source: require('@/assets/images/splash/letter-z.png'), x: 0, w: 181 },
  { source: require('@/assets/images/splash/letter-u.png'), x: 185, w: 160 },
  { source: require('@/assets/images/splash/letter-m.png'), x: 368, w: 239 },
  { source: require('@/assets/images/splash/letter-i.png'), x: 627, w: 54 },
];

const SCALE = MARK_WIDTH / MARK.w;
// The native splash centers the mark alone; the finished logo centers mark + wordmark together.
const MARK_START_X = (LOGO.w / 2 - (MARK.x + MARK.w / 2)) * SCALE;
const MARK_START_Y = (LOGO.h / 2 - (MARK.y + MARK.h / 2)) * SCALE;

const LETTERS_AT = 450;
const LETTER_STAGGER = 80;
const EXIT_AT = 1500;
const EXIT_DURATION = 380;
/** Starts anyway if the mark image never reports loaded, so the app can't stay stuck behind the splash. */
const LOAD_TIMEOUT = 1500;

/**
 * Takes over from the native splash with the same Z mark, dabs it like a brush stroke,
 * lifts it while "Zumi" pops in letter by letter, then fades out over the app.
 */
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const reduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);

  const lift = useSharedValue(reduceMotion ? 1 : 0);
  const dab = useSharedValue(1);
  const tilt = useSharedValue(0);
  const exit = useSharedValue(0);

  const start = () => {
    if (started) return;
    setStarted(true);
    SplashScreen.hide();
    if (!reduceMotion) {
      dab.set(withSequence(
        withTiming(1.12, { duration: 180, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 8, stiffness: 180 }),
      ));
      tilt.set(withSequence(
        withTiming(-8, { duration: 180, easing: Easing.out(Easing.quad) }),
        withSpring(0, { damping: 8, stiffness: 180 }),
      ));
      lift.set(withDelay(250, withSpring(1, { damping: 14, stiffness: 120 })));
    }
    exit.set(withDelay(
      reduceMotion ? 600 : EXIT_AT,
      withTiming(1, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(onFinish);
      }),
    ));
  };

  useEffect(() => {
    if (started) return;
    const timer = setTimeout(start, LOAD_TIMEOUT);
    return () => clearTimeout(timer);
  });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.get() }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.08 * exit.get() }] }));
  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (1 - lift.get()) * MARK_START_X },
      { translateY: (1 - lift.get()) * MARK_START_Y },
      { scale: dab.get() },
      { rotate: `${tilt.get()}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.backdrop, backdropStyle]} accessible accessibilityLabel="Zumi">
      <Animated.View style={[styles.logo, logoStyle]}>
        <Animated.View style={[styles.mark, markStyle]}>
          <Image source={require('@/assets/images/splash/mark.png')} style={styles.fill} onLoad={start} />
        </Animated.View>
        {LETTERS.map((letter, i) => (
          <Letter
            key={letter.x}
            source={letter.source}
            x={letter.x}
            w={letter.w}
            delay={LETTERS_AT + i * LETTER_STAGGER}
            started={started}
            instant={reduceMotion}
          />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

function Letter({ source, x, w, delay, started, instant }: {
  source: ImageSourcePropType;
  x: number;
  w: number;
  delay: number;
  started: boolean;
  instant: boolean;
}) {
  const progress = useSharedValue(instant ? 1 : 0);

  useEffect(() => {
    if (started && !instant) progress.set(withDelay(delay, withSpring(1, { damping: 11, stiffness: 170 })));
  }, [started, instant, delay, progress]);

  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [0, 0.4], [0, 1], 'clamp'),
      transform: [{ translateY: (1 - p) * 18 }, { scale: 0.6 + 0.4 * p }],
    };
  });

  return (
    <Animated.View
      style={[
        { position: 'absolute', left: x * SCALE, top: LETTER_TOP * SCALE, width: w * SCALE, height: LETTER_HEIGHT * SCALE },
        style,
      ]}>
      <Image source={source} style={styles.fill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Same white as the native splash so the handoff is invisible.
  backdrop: { ...StyleSheet.absoluteFill, zIndex: 1000, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  logo: { width: LOGO.w * SCALE, height: LOGO.h * SCALE },
  mark: { position: 'absolute', left: MARK.x * SCALE, top: MARK.y * SCALE, width: MARK.w * SCALE, height: MARK.h * SCALE },
  fill: { width: '100%', height: '100%' },
});
