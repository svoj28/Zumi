import { Ionicons } from '@expo/vector-icons';
import { Canvas, ImageShader, Rect } from '@shopify/react-native-skia';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { defaultBorderWidth, PAGE_FORMATS, PANEL_LAYOUTS, type ComicKind } from '@/engine/comics/comicLayouts';
import { MAX_CANVAS_SIDE, MIN_CANVAS_SIDE } from '@/engine/document/DrawingDocument';
import { estimateCanvasMemory, formatBytes, type MemoryLevel } from '@/engine/memory';
import { getCheckerTile } from '@/engine/render/checker';
import {
  DEFAULT_PRINT_DPI,
  DPI_CHOICES,
  formatValue,
  fromPixels,
  parseValue,
  PRESETS,
  toPixels,
  UNITS,
  type CanvasPreset,
  type Unit,
} from '@/features/new-canvas/canvasPresets';
import { LayoutThumb } from '@/features/comics/LayoutThumb';
import { useGalleryStore } from '@/state/galleryStore';
import { useSettingsStore } from '@/state/settingsStore';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

type BackgroundKind = 'white' | 'transparent' | 'custom';

/** Manga / comic page formats, shown like the other presets (all in pixels). */
const COMIC_PRESETS: CanvasPreset[] = PAGE_FORMATS.map((f) => ({
  id: f.id,
  label: f.label,
  detail: f.detail,
  group: 'print',
  width: f.width,
  height: f.height,
  unit: 'px',
}));

/** Layouts for a kind of page first, then the rest. */
function layoutsFor(kind: ComicKind) {
  const suits = PANEL_LAYOUTS.filter((l) => l.kinds.includes(kind));
  return [...suits, ...PANEL_LAYOUTS.filter((l) => !suits.includes(l))];
}

const CUSTOM_SWATCHES = ['#f6efe2', '#fdf6d8', '#e8eef4', '#dfe9df', '#8f8f95', '#3a3a40', '#1c1c20', '#0f2233'];

const LEVEL_COLORS = themed(
  (): Record<MemoryLevel, string> => ({
    ok: colors.success,
    caution: colors.warning,
    danger: colors.danger,
    blocked: colors.danger,
  }),
);

function normalizeHex(text: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

export function NewCanvasScreen({ folderId }: { folderId: string | null }) {
  const createArtwork = useGalleryStore((s) => s.createArtwork);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('px');
  const [widthText, setWidthText] = useState('2048');
  const [heightText, setHeightText] = useState('2048');
  const [dpiText, setDpiText] = useState('72');
  const defaultBackground = useSettingsStore((s) => s.defaultBackground);
  const [recordTimelapse, setRecordTimelapse] = useState(() => useSettingsStore.getState().recordTimelapse);
  // Manga / comic template: the chosen page format, panel layout and page-guides layer.
  const [comicId, setComicId] = useState<string | null>(null);
  const [layoutId, setLayoutId] = useState('none');
  const [comicGuides, setComicGuides] = useState(true);
  const comicFormat = PAGE_FORMATS.find((f) => f.id === comicId) ?? null;
  const [bgKind, setBgKind] = useState<BackgroundKind>(() =>
    defaultBackground === '#ffffff' ? 'white' : defaultBackground === 'transparent' ? 'transparent' : 'custom',
  );
  const [customText, setCustomText] = useState(() =>
    defaultBackground.startsWith('#') && defaultBackground !== '#ffffff' ? defaultBackground : CUSTOM_SWATCHES[0],
  );

  const dpiRaw = Number.parseInt(dpiText, 10);
  const dpi = Number.isFinite(dpiRaw) && dpiRaw >= 1 && dpiRaw <= 2400 ? dpiRaw : NaN;
  const pxW = toPixels(parseValue(widthText), unit, dpi);
  const pxH = toPixels(parseValue(heightText), unit, dpi);
  const sizeValid =
    Number.isFinite(pxW) && Number.isFinite(pxH) &&
    pxW >= MIN_CANVAS_SIDE && pxH >= MIN_CANVAS_SIDE && pxW <= MAX_CANVAS_SIDE && pxH <= MAX_CANVAS_SIDE;
  const customHex = normalizeHex(customText);
  const background = bgKind === 'white' ? '#ffffff' : bgKind === 'transparent' ? 'transparent' : customHex;
  const estimate = sizeValid ? estimateCanvasMemory(pxW, pxH) : null;
  const canCreate = sizeValid && !!background && estimate?.level !== 'blocked';

  const selectedPreset = PRESETS.find(
    (p) => p.unit === unit && formatValue(p.width, unit) === widthText && formatValue(p.height, unit) === heightText,
  );

  const changeUnit = (next: Unit) => {
    if (next === unit) return;
    if (Number.isFinite(pxW) && Number.isFinite(pxH) && Number.isFinite(dpi)) {
      setWidthText(formatValue(fromPixels(pxW, next, dpi), next));
      setHeightText(formatValue(fromPixels(pxH, next, dpi), next));
    }
    setUnit(next);
  };

  const applyPreset = (p: CanvasPreset) => {
    setComicId(null);
    setUnit(p.unit);
    setWidthText(formatValue(p.width, p.unit));
    setHeightText(formatValue(p.height, p.unit));
    if (p.group === 'print' && !(dpi >= 150)) setDpiText(String(DEFAULT_PRINT_DPI));
    if (p.group === 'screen') setDpiText('72');
  };

  /** Picks a manga / comic page: its size and resolution, and its usual panel layout. */
  const applyComicFormat = (p: CanvasPreset) => {
    const f = PAGE_FORMATS.find((x) => x.id === p.id);
    if (!f) return;
    setComicId(f.id);
    setLayoutId(f.defaultLayout);
    setComicGuides(f.bleed > 0);
    setUnit('px');
    setWidthText(String(f.width));
    setHeightText(String(f.height));
    setDpiText(String(f.dpi));
  };

  const swap = () => {
    setWidthText(heightText);
    setHeightText(widthText);
  };

  const create = () => {
    if (!canCreate || !background || !estimate) return;
    const run = () => {
      const id = createArtwork({
        name: name.trim() || 'Untitled',
        width: pxW,
        height: pxH,
        background,
        dpi,
        folderId,
        recordTimelapse,
        comic: comicFormat
          ? {
              layoutId,
              bleed: comicFormat.bleed,
              safe: comicFormat.safe,
              border: defaultBorderWidth(comicFormat),
              guides: comicGuides,
            }
          : null,
      });
      if (id) router.replace({ pathname: '/canvas/[id]', params: { id } });
    };
    if (estimate.level === 'danger') {
      Alert.alert('Very large canvas', `${estimate.message}\n\nCreate it anyway?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Create anyway', style: 'destructive', onPress: run },
      ]);
    } else {
      run();
    }
  };

  const physical =
    Number.isFinite(dpi) && sizeValid
      ? `${formatValue(fromPixels(pxW, 'in', dpi), 'in')} × ${formatValue(fromPixels(pxH, 'in', dpi), 'in')} in at ${dpi} DPI`
      : null;

  let sizeError: string | null = null;
  if (!Number.isFinite(dpi)) sizeError = 'DPI must be between 1 and 2400.';
  else if (!Number.isFinite(pxW) || !Number.isFinite(pxH)) sizeError = 'Enter a width and height.';
  else if (!sizeValid) {
    sizeError = `Each side must be between ${MIN_CANVAS_SIDE} and ${MAX_CANVAS_SIDE} px — this is ${pxW} × ${pxH} px.`;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.topBar}>
        <Pressable style={styles.barButton} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.barCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.barTitle} accessibilityRole="header">
          New Artwork
        </Text>
        <Pressable
          style={[styles.barButton, styles.createButton, !canCreate && styles.disabled]}
          onPress={create}
          disabled={!canCreate}
          accessibilityRole="button">
          <Text style={styles.createLabel}>Create</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Section title="Name">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Untitled"
              placeholderTextColor={colors.textDim}
              maxLength={80}
              style={styles.input}
              accessibilityLabel="Artwork name"
            />
          </Section>

          <Section title="Screen & social">
            <PresetGrid presets={PRESETS.filter((p) => p.group === 'screen')} selected={selectedPreset} onSelect={applyPreset} />
          </Section>
          <Section title="Print">
            <PresetGrid presets={PRESETS.filter((p) => p.group === 'print')} selected={selectedPreset} onSelect={applyPreset} />
          </Section>

          <Section title="Manga, manhwa & comics">
            <PresetGrid presets={COMIC_PRESETS} selected={COMIC_PRESETS.find((c) => c.id === comicId)} onSelect={applyComicFormat} />
            {comicFormat ? (
              <View style={styles.comicOptions}>
                <Text style={styles.comicHint}>Panel layout (drawn on its own “Panels” layer; drawing goes on the layer below)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.layoutRow}>
                  {layoutsFor(comicFormat.kind).map((l) => (
                    <LayoutThumb
                      key={l.id}
                      layoutId={l.id}
                      aspect={comicFormat.width / comicFormat.height}
                      label={l.label}
                      selected={layoutId === l.id}
                      onPress={() => setLayoutId(l.id)}
                    />
                  ))}
                </ScrollView>
                {comicFormat.bleed > 0 || comicFormat.safe > 0 ? (
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleText}>
                      <Text style={styles.toggleLabel}>Page guides layer</Text>
                      <Text style={styles.toggleHint}>
                        {comicFormat.bleed > 0
                          ? 'Bleed (tinted), trim line and safe area (dashed), on a locked layer. Hide it before exporting.'
                          : 'Safe margin (dashed), on a locked layer. Hide it before exporting.'}
                      </Text>
                    </View>
                    <Switch
                      value={comicGuides}
                      onValueChange={setComicGuides}
                      trackColor={{ true: colors.accent, false: colors.panelRaised }}
                      accessibilityLabel="Add a page guides layer"
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Section>

          <Section title="Custom size">
            <Segmented options={UNITS} value={unit} onChange={changeUnit} />
            <View style={styles.sizeRow}>
              <NumberField label="Width" value={widthText} unit={unit} onChange={setWidthText} />
              <Pressable style={styles.swap} onPress={swap} accessibilityRole="button" accessibilityLabel="Swap width and height">
                <Ionicons name="swap-horizontal" size={20} color={colors.text} />
              </Pressable>
              <NumberField label="Height" value={heightText} unit={unit} onChange={setHeightText} />
            </View>
            <View style={styles.dpiRow}>
              <NumberField label="DPI" value={dpiText} integer onChange={setDpiText} compact />
              <View style={styles.dpiChips}>
                {DPI_CHOICES.map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => setDpiText(String(d))}
                    style={[styles.chip, dpi === d && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: dpi === d }}>
                    <Text style={[styles.chipLabel, dpi === d && styles.chipLabelSelected]}>{d}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {sizeError ? (
              <Text style={styles.error}>{sizeError}</Text>
            ) : (
              <Text style={styles.result}>
                <Text style={styles.resultStrong}>
                  {pxW} × {pxH} px
                </Text>
                {physical ? `  ·  ${physical}` : ''}
              </Text>
            )}
          </Section>

          <Section title="Background">
            <View style={styles.bgRow}>
              <BackgroundOption label="White" selected={bgKind === 'white'} onPress={() => setBgKind('white')}>
                <View style={[styles.bgSwatch, { backgroundColor: '#ffffff' }]} />
              </BackgroundOption>
              <BackgroundOption label="Transparent" selected={bgKind === 'transparent'} onPress={() => setBgKind('transparent')}>
                <Canvas style={styles.bgSwatch}>
                  <Rect x={0} y={0} width={44} height={44}>
                    <ImageShader image={getCheckerTile()} tx="repeat" ty="repeat" fit="fill" x={0} y={0} width={16} height={16} />
                  </Rect>
                </Canvas>
              </BackgroundOption>
              <BackgroundOption label="Custom" selected={bgKind === 'custom'} onPress={() => setBgKind('custom')}>
                <View style={[styles.bgSwatch, { backgroundColor: customHex ?? colors.panelRaised }]} />
              </BackgroundOption>
            </View>
            {bgKind === 'custom' ? (
              <View style={styles.customBox}>
                <View style={styles.swatches}>
                  {CUSTOM_SWATCHES.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setCustomText(c)}
                      style={[styles.swatch, { backgroundColor: c }, customHex === c && styles.swatchSelected]}
                      accessibilityRole="button"
                      accessibilityLabel={`Colour ${c}`}
                    />
                  ))}
                </View>
                <View style={styles.hexRow}>
                  <Text style={styles.fieldLabel}>Hex</Text>
                  <TextInput
                    value={customText}
                    onChangeText={setCustomText}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={7}
                    style={[styles.input, styles.hexInput, !customHex && styles.inputError]}
                    accessibilityLabel="Custom background colour, hex"
                  />
                </View>
                {!customHex ? <Text style={styles.error}>Enter a colour like #f6efe2.</Text> : null}
              </View>
            ) : null}
          </Section>

          <Section title="Timelapse">
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Record timelapse</Text>
                <Text style={styles.toggleHint}>Only changed areas are saved. You can change this later from Export › Timelapse.</Text>
              </View>
              <Switch
                value={recordTimelapse}
                onValueChange={setRecordTimelapse}
                trackColor={{ true: colors.accent, false: colors.panelRaised }}
                accessibilityLabel="Record timelapse for this artwork"
              />
            </View>
          </Section>

          {estimate ? (
            <View style={[styles.memory, { borderColor: LEVEL_COLORS[estimate.level] }]} accessibilityLiveRegion="polite">
              <View style={styles.memoryHeader}>
                <Ionicons
                  name={estimate.level === 'ok' ? 'hardware-chip-outline' : 'warning-outline'}
                  size={18}
                  color={LEVEL_COLORS[estimate.level]}
                />
                <Text style={styles.memoryTitle}>Estimated memory</Text>
              </View>
              <Text style={styles.memoryStats}>
                ≈ {formatBytes(estimate.layerBytes)} per layer · ≈ {formatBytes(estimate.baseBytes)} to open
              </Text>
              <Text style={[styles.memoryMessage, estimate.level !== 'ok' && { color: LEVEL_COLORS[estimate.level] }]}>
                {estimate.message}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PresetGrid({
  presets,
  selected,
  onSelect,
}: {
  presets: CanvasPreset[];
  selected: CanvasPreset | undefined;
  onSelect: (p: CanvasPreset) => void;
}) {
  return (
    <View style={styles.presets}>
      {presets.map((p) => {
        const isSelected = selected?.id === p.id;
        const aspect = p.width / p.height;
        const box = 28;
        return (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p)}
            style={[styles.preset, isSelected && styles.presetSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${p.label}, ${p.detail}`}>
            <View style={styles.presetIconBox}>
              <View
                style={[
                  styles.presetIcon,
                  { width: aspect >= 1 ? box : box * aspect, height: aspect >= 1 ? box / aspect : box },
                  isSelected && styles.presetIconSelected,
                ]}
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.presetLabel}>{p.label}</Text>
              <Text style={styles.presetDetail}>{p.detail}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.id}
          onPress={() => onChange(o.id)}
          style={[styles.segment, value === o.id && styles.segmentSelected]}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === o.id }}>
          <Text style={[styles.segmentLabel, value === o.id && styles.segmentLabelSelected]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NumberField({
  label,
  value,
  unit,
  integer,
  compact,
  onChange,
}: {
  label: string;
  value: string;
  unit?: Unit;
  integer?: boolean;
  compact?: boolean;
  onChange: (v: string) => void;
}) {
  const decimals = !integer && unit !== undefined && unit !== 'px';
  return (
    <View style={compact ? styles.fieldCompact : styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.numberBox}>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(decimals ? t.replace(/[^0-9.,]/g, '') : t.replace(/[^0-9]/g, ''))}
          keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
          maxLength={7}
          style={styles.numberInput}
          accessibilityLabel={unit ? `${label} in ${unit}` : label}
        />
        {unit ? <Text style={styles.suffix}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function BackgroundOption({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.bgOption, selected && styles.bgOptionSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} background`}>
      {children}
      <Text style={styles.bgLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
  },
  barButton: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.md },
  barCancel: { color: colors.text, fontSize: 15 },
  barTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '700' },
  createButton: { backgroundColor: colors.accent },
  createLabel: { color: colors.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, gap: spacing.xl, paddingBottom: 48 },
  section: { gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.text, fontSize: 15 },
  toggleHint: { color: colors.textDim, fontSize: 12 },
  sectionTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    color: colors.text,
    fontSize: 16,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  inputError: { borderColor: colors.danger },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  comicOptions: { gap: spacing.sm, marginTop: spacing.sm },
  comicHint: { color: colors.textDim, fontSize: 12 },
  layoutRow: { gap: spacing.sm },
  preset: {
    flexGrow: 1,
    flexBasis: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  presetSelected: { borderColor: colors.accent, backgroundColor: colors.panelRaised },
  presetIconBox: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  presetIcon: { borderRadius: 3, borderWidth: 1.5, borderColor: colors.textDim },
  presetIconSelected: { borderColor: colors.accent },
  presetLabel: { color: colors.text, fontWeight: '600' },
  presetDetail: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.panel },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: colors.panelRaised },
  segmentLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  segmentLabelSelected: { color: colors.text },
  sizeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  swap: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.panelRaised },
  field: { flex: 1, gap: spacing.xs },
  fieldCompact: { width: 110, gap: spacing.xs },
  fieldLabel: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  numberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  numberInput: { flex: 1, color: colors.text, fontSize: 16, fontVariant: ['tabular-nums'], paddingVertical: spacing.sm },
  suffix: { color: colors.textDim, fontSize: 13 },
  dpiRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  dpiChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 36, minWidth: 48, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panel },
  chipSelected: { backgroundColor: colors.accentDim },
  chipLabel: { color: colors.textDim, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chipLabelSelected: { color: colors.accent },
  result: { color: colors.textDim, fontSize: 13 },
  resultStrong: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  error: { color: colors.danger, fontSize: 13 },
  bgRow: { flexDirection: 'row', gap: spacing.sm },
  bgOption: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bgOptionSelected: { borderColor: colors.accent, backgroundColor: colors.panelRaised },
  bgSwatch: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  bgLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  customBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.panel },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  swatchSelected: { borderWidth: 3, borderColor: colors.accent },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  hexInput: { flex: 1, fontVariant: ['tabular-nums'] },
  memory: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.panel },
  memoryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memoryTitle: { color: colors.text, fontWeight: '700' },
  memoryStats: { color: colors.text, fontVariant: ['tabular-nums'] },
  memoryMessage: { color: colors.textDim, fontSize: 13 },
}));
