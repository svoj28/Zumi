import { Ionicons } from '@expo/vector-icons';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { drawFigure, type FigureStyle } from '@/engine/figure/drawFigure';
import {
  BODIES,
  buildFigure,
  DEFAULT_CAMERA,
  hitJoint,
  makeProjector,
  mirrorPose,
  POSE_PRESETS,
  presetPose,
  rotateJoint,
  type BodyType,
  type Camera,
  type JointName,
  type Pose,
} from '@/engine/figure/mannequin';
import { RefButton } from '@/features/editor/ReferenceWindow';
import { colors, radius, spacing, themed } from '@/ui/theme';

/** Window sizes (canvas area, points), cycled by the size button. */
const SIZES = [
  { w: 220, h: 300 },
  { w: 280, h: 380 },
  { w: 340, h: 460 },
];
const HEADER_H = 36;
/** A finger within this distance (points) of a joint grabs it. */
const JOINT_HIT = 18;
/** Orbit degrees per point dragged. */
const ORBIT_SPEED = 0.5;

/** Everything needed to draw the figure elsewhere (e.g. onto the artwork). */
export interface FigureSnapshot {
  body: BodyType;
  pose: Pose;
  camera: Camera;
  style: FigureStyle;
  /** Height of the window's canvas area, for scaling the camera pan. */
  frameHeight: number;
}

type DragMode = { kind: 'joint'; joint: JointName; lastAngle: number; lastX: number } | { kind: 'orbit'; lastX: number; lastY: number } | null;

/**
 * Floating 3D pose figure: an artist's mannequin with correct proportions (in head units) and the
 * construction lines to draw from. Not part of the artwork until "Place on canvas" is used.
 *
 * - Drag empty space to orbit; pinch to zoom; double-tap to reset the view.
 * - Tap a joint to select it, then drag to swing that limb around the joint (or twist it).
 */
export function PoseFigureWindow({
  hidden,
  onHide,
  onClose,
  onPlace,
}: {
  hidden: boolean;
  onHide: () => void;
  onClose: () => void;
  onPlace: (snapshot: FigureSnapshot) => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [bodyType, setBodyType] = useState<BodyType>('male');
  const [pose, setPose] = useState<Pose>(() => presetPose('stand'));
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [selected, setSelected] = useState<JointName | null>(null);
  const [twist, setTwist] = useState(false);
  const [guides, setGuides] = useState({ body: true, construction: true, centerLine: true, proportions: true, actionLine: false, joints: true });
  const drag = useSharedValue<DragMode>(null);
  const pinchStart = useSharedValue(1);

  const body = BODIES[bodyType];
  const { w: W, h: H } = SIZES[sizeIndex];
  const proj = useMemo(() => makeProjector(body, camera, W, H), [body, camera, W, H]);
  const geo = useMemo(() => buildFigure(body, pose, proj), [body, pose, proj]);
  const style: FigureStyle = useMemo(() => ({ ...guides, bodyOpacity: 1, selected, lineScale: 1 }), [guides, selected]);
  const picture = useMemo(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, W, H));
    drawFigure(canvas, geo, style);
    return recorder.finishRecordingAsPicture();
  }, [geo, style, W, H]);

  // ---- window position (UI thread) ----------------------------------------------------------
  const x = useSharedValue<number>(spacing.sm);
  const y = useSharedValue<number>(spacing.sm + 48);
  const start = useSharedValue({ x: 0, y: 0 });
  const moveGesture = Gesture.Pan()
    .onBegin(() => start.set({ x: x.get(), y: y.get() }))
    .onUpdate((e) => {
      x.set(Math.min(screenW - 64, Math.max(64 - W, start.get().x + e.translationX)));
      y.set(Math.min(screenH - HEADER_H * 3, Math.max(0, start.get().y + e.translationY)));
    });
  const frameStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));

  // ---- figure gestures (JS thread: they need the current geometry) --------------------------
  const figurePan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(2)
    .onBegin((e) => {
      const j = hitJoint(geo.guides, e.x, e.y, JOINT_HIT);
      if (j) {
        setSelected(j);
        const jp = geo.guides.joints.find((g) => g.name === j)!.p;
        drag.set({ kind: 'joint', joint: j, lastAngle: Math.atan2(e.y - jp.y, e.x - jp.x), lastX: e.x });
      } else {
        drag.set({ kind: 'orbit', lastX: e.x, lastY: e.y });
      }
    })
    .onUpdate((e) => {
      const d = drag.get();
      if (!d) return;
      if (d.kind === 'orbit') {
        const dx = e.x - d.lastX;
        const dy = e.y - d.lastY;
        drag.set({ ...d, lastX: e.x, lastY: e.y });
        setCamera((c) => ({ ...c, yaw: c.yaw - dx * ORBIT_SPEED, pitch: Math.max(-80, Math.min(80, c.pitch + dy * ORBIT_SPEED)) }));
        return;
      }
      if (twist) {
        const delta = (e.x - d.lastX) * 0.02;
        drag.set({ ...d, lastX: e.x });
        setPose((p) => rotateJoint(body, p, d.joint, delta, proj, true));
        return;
      }
      const jp = geo.guides.joints.find((g) => g.name === d.joint)!.p;
      const angle = Math.atan2(e.y - jp.y, e.x - jp.x);
      let delta = angle - d.lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      drag.set({ ...d, lastAngle: angle });
      setPose((p) => rotateJoint(body, p, d.joint, delta, proj));
    })
    .onFinalize(() => {
      drag.set(null);
    });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, ok) => {
      if (ok) setSelected(hitJoint(geo.guides, e.x, e.y, JOINT_HIT));
    });
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd((_e, ok) => {
      if (ok) setCamera(DEFAULT_CAMERA);
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchStart.set(camera.zoom);
    })
    .onUpdate((e) => setCamera((c) => ({ ...c, zoom: Math.max(0.4, Math.min(4, pinchStart.get() * e.scale)) })));
  const figureGestures = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, tap, figurePan));

  const toggle = (key: keyof typeof guides) => setGuides((g) => ({ ...g, [key]: !g[key] }));
  const perspective = Number.isFinite(camera.distance);

  return (
    <Animated.View style={[styles.frame, { width: W }, frameStyle, hidden && styles.hidden]} pointerEvents={hidden ? 'none' : 'auto'}>
      <GestureDetector gesture={moveGesture}>
        <View style={styles.header} accessibilityLabel="Pose figure window. Drag to move.">
          <Ionicons name="reorder-two" size={18} color={colors.textDim} />
          <Text style={styles.title} numberOfLines={1}>
            Pose figure · {body.label} ({body.heads} heads)
          </Text>
          <RefButton icon="eye-off-outline" label="Hide pose figure" onPress={onHide} />
          <RefButton icon="close" label="Close pose figure" onPress={onClose} />
        </View>
      </GestureDetector>

      <GestureDetector gesture={figureGestures}>
        <View style={[styles.stage, { width: W, height: H }]} accessibilityLabel="3D figure. Drag to turn it, tap a joint and drag to pose it, pinch to zoom.">
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
          <View style={styles.stageHint} pointerEvents="none">
            <Text style={styles.stageHintText}>
              {selected ? `${JOINT_LABELS[selected]} · drag to ${twist ? 'twist' : 'bend'}` : 'Drag to turn · tap a joint to pose'}
            </Text>
          </View>
        </View>
      </GestureDetector>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {(Object.keys(BODIES) as BodyType[]).map((t) => (
          <Chip key={t} label={BODIES[t].label} selected={bodyType === t} onPress={() => setBodyType(t)} />
        ))}
        <View style={styles.divider} />
        {POSE_PRESETS.map((p) => (
          <Chip
            key={p.id}
            label={p.label}
            onPress={() => {
              setPose(presetPose(p.id));
              setSelected(null);
            }}
          />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
        <RefButton icon="body-outline" label="Body volumes" active={guides.body} onPress={() => toggle('body')} />
        <RefButton icon="cube-outline" label="Construction (ribcage and pelvis boxes, shoulder and hip tilt)" active={guides.construction} onPress={() => toggle('construction')} />
        <RefButton icon="git-commit-outline" label="Centre line and head cross (eye line)" active={guides.centerLine} onPress={() => toggle('centerLine')} />
        <RefButton icon="resize-outline" label="Proportions ruler (head units)" active={guides.proportions} onPress={() => toggle('proportions')} />
        <RefButton icon="trending-up-outline" label="Action line (gesture)" active={guides.actionLine} onPress={() => toggle('actionLine')} />
        <RefButton icon="radio-button-on-outline" label="Joints" active={guides.joints} onPress={() => toggle('joints')} />
        <View style={styles.divider} />
        <RefButton
          icon="eye-outline"
          label={perspective ? 'Perspective on (tap for flat view)' : 'Flat view (tap for perspective)'}
          active={perspective}
          onPress={() => setCamera((c) => ({ ...c, distance: perspective ? Infinity : DEFAULT_CAMERA.distance }))}
        />
        <RefButton
          icon="sync-outline"
          label={twist ? 'Twist mode: drag sideways turns the selected bone' : 'Bend mode (tap for twist)'}
          active={twist}
          onPress={() => setTwist((t) => !t)}
        />
        <RefButton icon="swap-horizontal" label="Mirror pose (swap left and right)" onPress={() => setPose((p) => mirrorPose(p))} />
        <RefButton
          icon="refresh"
          label="Reset pose"
          onPress={() => {
            setPose(presetPose('stand'));
            setSelected(null);
          }}
        />
        <RefButton icon="scan-outline" label="Reset view" onPress={() => setCamera(DEFAULT_CAMERA)} />
        <RefButton icon="expand-outline" label="Window size" onPress={() => setSizeIndex((i) => (i + 1) % SIZES.length)} />
        <View style={styles.divider} />
        <Pressable
          onPress={() => onPlace({ body: bodyType, pose, camera, style: { ...style, selected: null, joints: false }, frameHeight: H })}
          style={styles.place}
          accessibilityRole="button"
          accessibilityLabel="Place the figure and its guides on a new layer">
          <Ionicons name="download-outline" size={15} color={colors.onAccent} />
          <Text style={styles.placeText}>Place on canvas</Text>
        </Pressable>
      </ScrollView>
    </Animated.View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]} accessibilityRole="button" accessibilityState={{ selected: !!selected }}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const JOINT_LABELS: Record<JointName, string> = {
  pelvis: 'Hips (whole body)', spine: 'Chest', neck: 'Neck', head: 'Head',
  shoulderL: 'Left shoulder', elbowL: 'Left elbow', wristL: 'Left wrist',
  shoulderR: 'Right shoulder', elbowR: 'Right elbow', wristR: 'Right wrist',
  hipL: 'Left hip', kneeL: 'Left knee', ankleL: 'Left ankle',
  hipR: 'Right hip', kneeR: 'Right knee', ankleR: 'Right ankle',
};

/** Shown while the pose figure is hidden, to bring it back. */
export function ShowFigureButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.show} accessibilityRole="button" accessibilityLabel="Show pose figure">
      <Ionicons name="body-outline" size={16} color={colors.text} />
      <Text style={styles.showText}>Pose figure</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  frame: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: HEADER_H, paddingHorizontal: spacing.sm },
  title: { flex: 1, color: colors.textDim, fontSize: 12, fontWeight: '600' },
  stage: { backgroundColor: '#f4f2ee' },
  stageHint: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  stageHintText: { color: '#ffffff', fontSize: 10, fontWeight: '600' },
  chipRow: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, alignItems: 'center' },
  chip: { minHeight: 30, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipSelected: { backgroundColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipLabelSelected: { color: colors.onAccent },
  toolbar: { alignItems: 'center', gap: 2, height: 44, paddingHorizontal: spacing.xs },
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 4, backgroundColor: colors.border },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  placeText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  show: {
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.floating,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  showText: { color: colors.text, fontSize: 12, fontWeight: '600' },
}));
