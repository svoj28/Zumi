import { Ionicons } from '@expo/vector-icons';
import { Canvas, Image, type SkImage } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { renderComposite } from '@/engine/render/composite';
import type { AnimationLoop } from '@/engine/types';
import { useDocumentVersion } from '@/features/editor/useEditorSession';
import { colors, radius, spacing, themed } from '@/ui/theme';

const THUMB = 52;
const FPS = [2, 4, 6, 8, 12, 15, 24];
const LOOPS: { id: AnimationLoop; label: string }[] = [
  { id: 'loop', label: 'Loop' },
  { id: 'pingPong', label: 'Ping-pong' },
  { id: 'once', label: 'Play once' },
];
const ONION = [0, 1, 2, 3];
const ONION_OPACITY = [0.2, 0.35, 0.5, 0.7];

function next<T>(list: readonly T[], value: T): T {
  const i = list.indexOf(value);
  return list[(i + 1) % list.length];
}

/**
 * Frame-by-frame animation timeline: each top-level layer (or layer group) is a frame. Tap a
 * frame to draw on it; earlier/later frames show as tinted onion skins.
 */
export function AnimationBar({
  doc,
  playing,
  playFrame,
  bottom,
  onPlay,
  onStop,
  onExport,
  onClose,
}: {
  doc: DrawingDocument;
  playing: boolean;
  playFrame: number | null;
  bottom: number;
  onPlay: () => void;
  onStop: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const version = useDocumentVersion(doc);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const frames = doc.frames;
  const current = playFrame ?? doc.activeFrameIndex;
  const a = doc.animation;

  // Small previews of every frame (re-rendered after edits).
  const thumbs = useMemo(() => {
    const scale = (THUMB * 2) / Math.max(doc.info.width, doc.info.height);
    return frames.map((f) => renderComposite(doc, scale, { layers: f.layers, background: false, underlay: 'white' }));
    // `version` changes whenever the frames' pixels or order change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, version]);
  const aspect = doc.info.width / doc.info.height;
  const tw = aspect >= 1 ? THUMB : THUMB * aspect;
  const th = aspect >= 1 ? THUMB / aspect : THUMB;

  return (
    <View style={[styles.bar, { bottom }]}>
      {settingsOpen ? (
        <View style={styles.settings}>
          <Chip label={`${a.fps} fps`} onPress={() => doc.setAnimation({ fps: next(FPS, a.fps) })} />
          <Chip label={LOOPS.find((l) => l.id === a.loop)?.label ?? 'Loop'} onPress={() => doc.setAnimation({ loop: next(LOOPS.map((l) => l.id), a.loop) })} />
          <Chip label={`Onion before ${a.onionBefore}`} onPress={() => doc.setAnimation({ onionBefore: next(ONION, a.onionBefore) })} />
          <Chip label={`Onion after ${a.onionAfter}`} onPress={() => doc.setAnimation({ onionAfter: next(ONION, a.onionAfter) })} />
          <Chip
            label={`Onion ${Math.round(a.onionOpacity * 100)}%`}
            onPress={() => doc.setAnimation({ onionOpacity: next(ONION_OPACITY, ONION_OPACITY.reduce((x, y) => (Math.abs(y - a.onionOpacity) < Math.abs(x - a.onionOpacity) ? y : x))) })}
          />
          <Chip label={a.background ? 'Background frame: on' : 'Background frame: off'} active={a.background} onPress={() => doc.setAnimation({ background: !a.background })} />
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable onPress={playing ? onStop : onPlay} style={styles.play} accessibilityRole="button" accessibilityLabel={playing ? 'Stop' : 'Play animation'}>
          <Ionicons name={playing ? 'stop' : 'play'} size={20} color={colors.onAccent} />
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.frames}>
          {frames.map((f, i) => (
            <FrameThumb
              key={f.kind === 'folder' ? f.group.id : f.unit.base.meta.id}
              index={i}
              image={thumbs[i] ?? null}
              width={tw}
              height={th}
              current={i === current}
              background={a.background && i === 0}
              onPress={() => {
                if (playing) onStop();
                doc.selectFrame(i);
              }}
            />
          ))}
          <Pressable
            onPress={() => {
              if (playing) onStop();
              doc.addFrame();
            }}
            style={[styles.add, { height: th + 18 }]}
            accessibilityRole="button"
            accessibilityLabel="Add frame">
            <Ionicons name="add" size={22} color={colors.accent} />
          </Pressable>
        </ScrollView>
        <View style={styles.tools}>
          <IconBtn icon="copy-outline" label="Duplicate frame" onPress={() => doc.duplicateFrame()} />
          <IconBtn icon="options-outline" label="Animation settings" active={settingsOpen} onPress={() => setSettingsOpen((o) => !o)} />
          <IconBtn icon="share-outline" label="Export animation (GIF or MP4)" onPress={onExport} />
          <IconBtn icon="close" label="Close timeline" onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

function FrameThumb({
  index,
  image,
  width,
  height,
  current,
  background,
  onPress,
}: {
  index: number;
  image: SkImage | null;
  width: number;
  height: number;
  current: boolean;
  background: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.frame, current && styles.frameOn]} accessibilityRole="button" accessibilityState={{ selected: current }} accessibilityLabel={`Frame ${index + 1}${background ? ', background' : ''}`}>
      <Canvas style={{ width, height }} pointerEvents="none">
        {image ? <Image image={image} x={0} y={0} width={width} height={height} fit="contain" /> : null}
      </Canvas>
      <Text style={[styles.frameLabel, current && styles.frameLabelOn]}>{background ? 'BG' : index + 1}</Text>
    </Pressable>
  );
}

function Chip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button">
      <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({ icon, label, onPress, active }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={[styles.iconBtn, active && styles.chipOn]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.text} />
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    bar: {
      position: 'absolute',
      left: spacing.sm,
      right: spacing.sm,
      gap: spacing.xs,
      padding: spacing.xs,
      borderRadius: radius.lg,
      backgroundColor: colors.floating,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 8,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    frames: { gap: spacing.xs, alignItems: 'center', paddingHorizontal: 2 },
    frame: { alignItems: 'center', padding: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent', backgroundColor: colors.panelRaised },
    frameOn: { borderColor: colors.accent },
    frameLabel: { color: colors.textDim, fontSize: 10, fontWeight: '700', marginTop: 2 },
    frameLabelOn: { color: colors.accent },
    add: { width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed' },
    tools: { flexDirection: 'row', gap: 2 },
    iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    settings: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.xs },
    chip: { minHeight: 32, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
    chipOn: { backgroundColor: colors.accentDim },
    chipLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
    chipLabelOn: { color: colors.accent },
  }),
);