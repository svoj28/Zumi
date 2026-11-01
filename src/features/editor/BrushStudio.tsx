import { Ionicons } from '@expo/vector-icons';
import { BlendColor, Canvas, Image, Rect, Skia, type SkImage, type SkSurface } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, PixelRatio, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  isCircleTone,
  isToneTexture,
  mergePreset,
  normalizePreset,
  type BrushPreset,
  type BrushPresetPatch,
  type BrushTexture,
  type BrushTip,
} from '@/engine/brush/brushPreset';
import { renderBrushPreview } from '@/engine/brush/brushPreview';
import { BASE_PRESET, findBuiltIn } from '@/engine/brush/builtInBrushes';
import { dabBounds, drawDabs } from '@/engine/brush/stampRenderer';
import { replayStroke } from '@/engine/brush/strokeInterpolator';
import { getTipImage, toneCellSize } from '@/engine/brush/tips';
import { useBrushStore } from '@/state/brushStore';
import { pickTipImage } from '@/storage/brushTips';
import { useToolStore } from '@/state/toolStore';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed } from '@/ui/theme';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} px`;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Starting points: a built-in brush (or a patch of the base) the new brush is made from. */
const TEMPLATES: { id: string; label: string; icon: IconName; make: () => BrushPreset }[] = [
  { id: 'pen', label: 'Pen', icon: 'create-outline', make: () => fromBuiltIn('studio-pen') },
  { id: 'pencil', label: 'Pencil', icon: 'pencil-outline', make: () => fromBuiltIn('pencil') },
  { id: 'marker', label: 'Marker', icon: 'brush-outline', make: () => fromBuiltIn('marker') },
  { id: 'paint', label: 'Paint', icon: 'color-palette-outline', make: () => fromBuiltIn('round-brush') },
  { id: 'airbrush', label: 'Airbrush', icon: 'cloud-outline', make: () => fromBuiltIn('airbrush') },
  { id: 'blender', label: 'Blender', icon: 'water-outline', make: () => fromBuiltIn('blender') },
  { id: 'texture', label: 'Chalk', icon: 'grid-outline', make: () => fromBuiltIn('chalk') },
  { id: 'spray', label: 'Spray', icon: 'sparkles-outline', make: () => fromBuiltIn('spray') },
  { id: 'tone', label: 'Screentone', icon: 'apps-outline', make: () => fromBuiltIn('tone-medium') },
  {
    id: 'stamp',
    label: 'Stamp',
    icon: 'star-outline',
    make: () =>
      mergePreset(BASE_PRESET, {
        size: 40, minSize: 4, maxSize: 300, hardness: 1, spacing: 1.2, smoothing: 0.2,
        shape: { tip: 'star' }, scatter: 0.3, jitter: { size: 0.4, rotation: 1 }, pressure: { size: 0.2 },
      }),
  },
];

function fromBuiltIn(id: string): BrushPreset {
  return findBuiltIn(id) ?? BASE_PRESET;
}

const TIPS: { id: BrushTip; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'flat', label: 'Flat' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'chalk', label: 'Chalk' },
  { id: 'charcoal', label: 'Charcoal' },
  { id: 'grain', label: 'Grain' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'heart', label: 'Heart' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'splat', label: 'Splat' },
];

const TEXTURES: { id: BrushTexture; label: string }[] = [
  { id: 'none', label: 'Smooth' },
  { id: 'paper', label: 'Paper' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'grain', label: 'Grain' },
  { id: 'tone-dots', label: 'Dots' },
  { id: 'tone-rings', label: 'Rings' },
  { id: 'tone-stipple', label: 'Sand' },
  { id: 'tone-lines', label: 'Lines' },
  { id: 'tone-crosshatch', label: 'Crosshatch' },
];

/**
 * Brush studio: make your own brush. Pick a starting point, shape it with a few plain-language
 * controls while trying it on a scratch pad, then save it to "My Brushes". `initial` edits an
 * existing custom brush (or starts from a copy of any brush); null starts from scratch.
 */
export function BrushStudio({
  visible,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initial: BrushPreset | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      {/* Gesture handlers inside a Modal need their own root view on Android. */}
      <GestureHandlerRootView style={styles.flex}>
        {visible ? <StudioBody initial={initial} onClose={onClose} onSaved={onSaved} /> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function StudioBody({ initial, onClose, onSaved }: { initial: BrushPreset | null; onClose: () => void; onSaved: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const color = useToolStore((s) => s.color);
  const [template, setTemplate] = useState(initial ? null : TEMPLATES[0].id);
  const [draft, setDraft] = useState<BrushPreset>(() => initial ?? TEMPLATES[0].make());
  const [name, setName] = useState(initial?.name ?? 'My Brush');
  const [padKey, setPadKey] = useState(0);

  const update = (patch: BrushPresetPatch) => setDraft((d) => normalizePreset(mergePreset(d, patch), d));
  const pickTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplate(id);
    setDraft(t.make());
  };
  const save = () => {
    const store = useBrushStore.getState();
    const id = store.savePreset({ ...draft, name: name.trim() || 'My Brush' });
    store.selectPreset('brush', id);
    onSaved(id);
  };

  const tone = isToneTexture(draft.texture.kind);
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.headerButton} accessibilityRole="button">
          <Text style={styles.headerCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Brush Studio</Text>
        <Pressable onPress={save} style={[styles.headerButton, styles.saveButton]} accessibilityRole="button" accessibilityLabel="Save brush">
          <Text style={styles.saveLabel}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Brush name"
          placeholderTextColor={colors.textDim}
          maxLength={60}
          style={styles.nameInput}
          accessibilityLabel="Brush name"
        />

        <Text style={styles.sectionTitle}>Start from</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templates}>
          {TEMPLATES.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => pickTemplate(t.id)}
              style={[styles.template, template === t.id && styles.selected]}
              accessibilityRole="button"
              accessibilityState={{ selected: template === t.id }}>
              <Ionicons name={t.icon} size={22} color={template === t.id ? colors.accent : colors.text} />
              <Text style={[styles.templateLabel, template === t.id && styles.selectedLabel]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <StrokePreview brush={draft} color={color} />
        <TestPad key={padKey} brush={draft} color={color} />
        <View style={styles.padActions}>
          <PadButton icon="refresh" label="Clear pad" onPress={() => setPadKey((k) => k + 1)} />
          <PadButton icon="dice-outline" label="Surprise me" onPress={() => setDraft((d) => surprise(d))} />
        </View>

        <Text style={styles.sectionTitle}>Shape</Text>
        <View style={styles.tipGrid}>
          {TIPS.map((t) => (
            <TipTile key={t.id} tip={t.id} label={t.label} hardness={draft.hardness} selected={draft.shape.tip === t.id} onPress={() => update({ shape: { tip: t.id } })} />
          ))}
          {draft.shape.tip === 'image' && draft.shape.image ? (
            <TipTile tip="image" image={draft.shape.image} label="Picture" hardness={draft.hardness} selected onPress={() => {}} />
          ) : null}
          <Pressable
            onPress={() => {
              pickTipImage()
                .then((id) => {
                  if (id) update({ shape: { tip: 'image', image: id } });
                })
                .catch((error: unknown) => Alert.alert('Can’t use that picture', (error as Error).message));
            }}
            style={[styles.tip, styles.photoTile]}
            accessibilityRole="button"
            accessibilityLabel="Use a picture as the brush tip">
            <Ionicons name="image-outline" size={24} color={colors.accent} />
            <Text style={styles.tipLabel}>From photo</Text>
          </Pressable>
        </View>
        <Slider label="Size" value={draft.size} min={1} max={400} curve="quadratic" format={px} onChange={(size) => setDraft((d) => normalizePreset(mergePreset(d, { size, maxSize: Math.max(d.maxSize, size), minSize: Math.min(d.minSize, size) }), d))} />
        <Slider label="Softness" value={1 - draft.hardness} min={0} max={1} format={percent} onChange={(v) => update({ hardness: 1 - v })} />
        <Slider label="Squash (flat tip)" value={1 - draft.shape.roundness} min={0} max={0.95} format={percent} onChange={(v) => update({ shape: { roundness: 1 - v } })} />
        <Slider label="Angle" value={draft.rotation.angle} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(angle) => update({ rotation: { angle } })} />
        <SwitchRow label="Turn with the stroke" value={draft.rotation.followStroke} onChange={(followStroke) => update({ rotation: { followStroke } })} />

        <Text style={styles.sectionTitle}>Ink</Text>
        <Slider label="Opacity" value={draft.opacity} min={0.01} max={1} format={percent} onChange={(opacity) => update({ opacity })} />
        <Slider label="Build-up (flow)" value={draft.flow} min={0.01} max={1} format={percent} onChange={(flow) => update({ flow })} />
        <Slider label="Blend existing colours" value={draft.blend} min={0} max={1} format={(v) => (v > 0 ? percent(v) : 'Off')} onChange={(blend) => update({ blend })} />
        <Slider label="Smudge (drag colours along)" value={draft.smudge} min={0} max={1} format={(v) => (v > 0 ? percent(v) : 'Off')} onChange={(smudge) => update({ smudge })} />

        <Text style={styles.sectionTitle}>Stroke</Text>
        <Slider label="Spacing (dots ↔ line)" value={draft.spacing} min={0.01} max={2} curve="quadratic" format={percent} onChange={(spacing) => update({ spacing })} />
        <Slider label="Scatter" value={draft.scatter} min={0} max={2} format={percent} onChange={(scatter) => update({ scatter })} />
        <Slider label="Random size" value={draft.jitter.size} min={0} max={1} format={percent} onChange={(size) => update({ jitter: { size } })} />
        <Slider label="Random angle" value={draft.jitter.rotation} min={0} max={1} format={percent} onChange={(rotation) => update({ jitter: { rotation } })} />
        <Slider label="Random opacity" value={draft.jitter.opacity} min={0} max={1} format={percent} onChange={(opacity) => update({ jitter: { opacity } })} />
        <Slider label="Stabiliser" value={draft.smoothing} min={0} max={1} format={percent} onChange={(smoothing) => update({ smoothing })} />

        <Text style={styles.sectionTitle}>Pressure</Text>
        <Slider label="Pressure → size" value={draft.pressure.size} min={0} max={1} format={percent} onChange={(size) => update({ pressure: { size } })} />
        <Slider label="Pressure → opacity" value={draft.pressure.opacity} min={0} max={1} format={percent} onChange={(opacity) => update({ pressure: { opacity } })} />
        <SwitchRow label="Thinner when drawing fast (fingers)" value={draft.speedPressure} onChange={(speedPressure) => update({ speedPressure })} />

        <Text style={styles.sectionTitle}>Texture</Text>
        <View style={styles.pills}>
          {TEXTURES.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => update({ texture: { kind: t.id, strength: t.id !== 'none' && draft.texture.strength === 0 ? 0.5 : draft.texture.strength } })}
              style={[styles.pill, draft.texture.kind === t.id && styles.selected]}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.texture.kind === t.id }}>
              <Text style={[styles.pillLabel, draft.texture.kind === t.id && styles.selectedLabel]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        {draft.texture.kind !== 'none' ? (
          tone ? (
            <>
              <Slider label={isCircleTone(draft.texture.kind) ? 'Circle size' : 'Line spacing'} value={draft.texture.scale} min={0.25} max={4} format={(v) => `${Math.round(toneCellSize(v))} px`} onChange={(scale) => update({ texture: { scale } })} />
              <Slider label="Density" value={draft.texture.strength} min={0.05} max={1} format={percent} onChange={(strength) => update({ texture: { strength } })} />
              {isCircleTone(draft.texture.kind) ? (
                <Slider label="Circle size variation" value={draft.texture.variation} min={0} max={1} format={(v) => (v > 0 ? percent(v) : 'Same size')} onChange={(variation) => update({ texture: { variation } })} />
              ) : null}
              <Slider label="Pattern angle" value={draft.texture.angle} min={-90} max={90} step={1} format={(v) => `${Math.round(v)}°`} onChange={(angle) => update({ texture: { angle } })} />
            </>
          ) : (
            <>
              <Slider label="Texture strength" value={draft.texture.strength} min={0} max={1} format={percent} onChange={(strength) => update({ texture: { strength } })} />
              <Slider label="Texture scale" value={draft.texture.scale} min={0.25} max={4} format={(v) => `${v.toFixed(2)}×`} onChange={(scale) => update({ texture: { scale } })} />
            </>
          )
        ) : null}
        <Text style={styles.hint}>Saved brushes appear under “My Brushes”. You can fine-tune them later in Settings.</Text>
      </ScrollView>
    </View>
  );
}

/** A random, still usable variation of the brush. */
function surprise(d: BrushPreset): BrushPreset {
  const r = Math.random;
  const tip = TIPS[Math.floor(r() * TIPS.length)].id;
  const stamp = !['round', 'flat', 'pencil', 'chalk', 'charcoal', 'grain'].includes(tip);
  return normalizePreset(
    mergePreset(d, {
      shape: { tip, roundness: stamp ? 1 : 0.4 + r() * 0.6 },
      hardness: 0.3 + r() * 0.7,
      spacing: stamp ? 0.6 + r() * 1.2 : 0.03 + r() * 0.15,
      scatter: r() < 0.5 ? 0 : r() * 0.8,
      jitter: { size: r() * 0.6, rotation: r() < 0.5 ? 0 : 1, opacity: r() * 0.4 },
      rotation: { followStroke: r() < 0.3 },
    }),
    d,
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.border }} accessibilityLabel={label} />
    </View>
  );
}

function PadButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.padButton, pressed && styles.pressed]} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={colors.text} />
      <Text style={styles.padButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const TILE = 52;

function TipTile({
  tip,
  image: imageId,
  label,
  hardness,
  selected,
  onPress,
}: {
  tip: BrushTip;
  image?: string;
  label: string;
  hardness: number;
  selected: boolean;
  onPress: () => void;
}) {
  const image = useMemo(() => getTipImage(tip, hardness, 1, imageId), [tip, hardness, imageId]);
  return (
    <Pressable onPress={onPress} style={[styles.tip, selected && styles.selected]} accessibilityRole="button" accessibilityLabel={`${label} tip`} accessibilityState={{ selected }}>
      <Canvas style={styles.tipCanvas} pointerEvents="none">
        {/* Tips are white masks; tint them so they show in both themes. */}
        <Image image={image} x={6} y={6} width={TILE - 20} height={TILE - 20} fit="contain">
          <BlendColor color={selected ? colors.accent : colors.text} mode="srcIn" />
        </Image>
      </Canvas>
      <Text style={[styles.tipLabel, selected && styles.selectedLabel]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const PAPER = '#fbfbf7';

/** The brush drawn along a fixed curve, updated as settings change. */
function StrokePreview({ brush, color }: { brush: BrushPreset; color: string }) {
  const { width } = useWindowDimensions();
  const w = Math.min(560, width - spacing.md * 2);
  const h = 72;
  const scale = PixelRatio.get();
  const image = useMemo(() => renderBrushPreview(brush, color, w * scale, h * scale), [brush, color, w, scale]);
  return (
    <Canvas style={[styles.preview, { width: w, height: h }]} pointerEvents="none">
      <Rect x={0} y={0} width={w} height={h} color={PAPER} />
      {image ? <Image image={image} x={0} y={0} width={w} height={h} fit="fill" /> : null}
    </Canvas>
  );
}

/**
 * The test pad's pixels: finished strokes plus the one being drawn, rendered with the real
 * brush engine at `k` pixels per point.
 */
class PadSketch {
  private surface: SkSurface | null;
  private base: SkImage | null = null;
  private samples: number[] = [];
  private t0 = 0;

  constructor(
    width: number,
    height: number,
    private k: number,
  ) {
    this.surface = Skia.Surface.Make(Math.round(width * k), Math.round(height * k));
  }

  begin(x: number, y: number, pressure: number | undefined, brush: BrushPreset, color: string): SkImage | null {
    this.t0 = Date.now();
    this.samples = [];
    return this.move(x, y, pressure, brush, color);
  }

  move(x: number, y: number, pressure: number | undefined, brush: BrushPreset, color: string): SkImage | null {
    const s = this.surface;
    if (!s) return null;
    this.samples.push(x * this.k, y * this.k, pressure ?? 1, Date.now() - this.t0, 0, 0);
    const canvas = s.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    if (this.base) canvas.drawImage(this.base, 0, 0);
    const dabs: number[] = [];
    replayStroke(this.samples, brush, 7, dabs);
    const bounds = dabBounds(dabs);
    // Blending brushes mix what is already on the pad.
    if (bounds) drawDabs(canvas, dabs, { tool: 'brush', color, brush }, bounds, this.base);
    s.flush();
    return s.makeImageSnapshot();
  }

  /** The finished stroke becomes part of the pad. */
  end(): void {
    if (this.surface) this.base = this.surface.makeImageSnapshot();
    this.samples = [];
  }

  dispose(): void {
    this.surface?.dispose();
    this.surface = null;
  }
}

/** Scratch pad: draw with the brush being made (through the real brush engine). */
function TestPad({ brush, color }: { brush: BrushPreset; color: string }) {
  const { width } = useWindowDimensions();
  const w = Math.min(560, width - spacing.md * 2);
  // A new pad (blank) when the width changes, e.g. on rotation.
  return <TestPadSurface key={w} width={w} brush={brush} color={color} />;
}

function TestPadSurface({ width: w, brush, color }: { width: number; brush: BrushPreset; color: string }) {
  const h = 200;
  // Pad pixels per point: enough for crisp strokes without huge surfaces.
  const [pad] = useState(() => new PadSketch(w, h, Math.min(2, PixelRatio.get())));
  const [image, setImage] = useState<SkImage | null>(null);
  useEffect(() => () => pad.dispose(), [pad]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => setImage(pad.begin(e.x, e.y, e.stylusData?.pressure, brush, color)))
    .onUpdate((e) => setImage(pad.move(e.x, e.y, e.stylusData?.pressure, brush, color)))
    .onFinalize(() => pad.end());

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.pad, { width: w, height: h }]} accessibilityLabel="Test pad: draw here to try the brush">
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={0} y={0} width={w} height={h} color={PAPER} />
          {image ? <Image image={image} x={0} y={0} width={w} height={h} fit="fill" /> : null}
        </Canvas>
        {!image ? <Text style={styles.padHint}>Draw here to try your brush</Text> : null}
      </View>
    </GestureDetector>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    flex: { flex: 1 },
    root: { flex: 1, backgroundColor: colors.panel },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
    headerCancel: { color: colors.text, fontSize: 15, fontWeight: '600' },
    title: { color: colors.text, fontSize: 17, fontWeight: '700' },
    saveButton: { alignItems: 'center', borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: spacing.md },
    saveLabel: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
    content: { padding: spacing.md, gap: spacing.sm, alignItems: 'stretch' },
    nameInput: {
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.panelRaised,
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    sectionTitle: {
      marginTop: spacing.sm,
      color: colors.textDim,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    templates: { gap: spacing.xs },
    template: {
      width: 76,
      minHeight: 64,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderRadius: radius.md,
      backgroundColor: colors.panelRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    templateLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
    selected: { backgroundColor: colors.accentDim, borderColor: colors.accent },
    selectedLabel: { color: colors.accent },
    preview: { alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden' },
    pad: { alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    padHint: { color: '#8a8a92', fontSize: 13 },
    padActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
    padButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 40,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.panelRaised,
    },
    padButtonLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.7 },
    tipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    tip: {
      width: TILE + 8,
      paddingVertical: 4,
      alignItems: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.panelRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    tipCanvas: { width: TILE - 8, height: TILE - 8 },
    photoTile: { justifyContent: 'center', minHeight: TILE + 10, borderStyle: 'dashed', borderColor: colors.accent },
    tipLabel: { color: colors.textDim, fontSize: 10, fontWeight: '600' },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    pill: {
      minHeight: 34,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.panelRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    pillLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
    switchLabel: { color: colors.text, fontSize: 14, flex: 1 },
    hint: { color: colors.textDim, fontSize: 12, marginTop: spacing.sm },
  }),
);
