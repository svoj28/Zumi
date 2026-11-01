import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex, type HSV } from '@/engine/color/colorMath';
import { HARMONIES, harmony, type HarmonyKind } from '@/engine/color/paletteGen';
import { decodeImportedImage } from '@/engine/render/imageDecode';
import { paletteFromImage } from '@/engine/render/imagePalette';
import { ColorWheel } from '@/features/color/ColorWheel';
import { usePaletteStore, type Palette } from '@/state/paletteStore';
import { useToolStore } from '@/state/toolStore';
import { pickImageFile } from '@/storage/importService';
import { ActionSheet } from '@/ui/ActionSheet';
import { PromptDialog } from '@/ui/PromptDialog';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

type Tab = 'wheel' | 'sliders' | 'palettes';

const WHEEL_SIZE = 220;
const RAINBOW = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const int = (v: number) => String(Math.round(v));

/**
 * Colour interface: wheel, HSV/RGB/alpha sliders, hex entry, current vs previous colour,
 * recent colours (from painting), saved colours and custom palettes.
 */
export function ColorPanel() {
  const color = useToolStore((s) => s.color);
  const alpha = useToolStore((s) => s.alpha);
  const previous = useToolStore((s) => s.previousColor);
  const tools = useToolStore.getState;

  // HSV is kept locally so hue survives while saturation or value is 0 (where hex loses it).
  const [edit, setEdit] = useState<{ hex: string; hsv: HSV }>(() => ({ hex: color, hsv: hexToHsv(color) }));
  if (edit.hex !== color) {
    // The colour changed elsewhere (eyedropper, swatch, undoable swap): re-derive HSV.
    const next = hexToHsv(color);
    setEdit({ hex: color, hsv: next.s === 0 || next.v === 0 ? { ...next, h: edit.hsv.h } : next });
  }
  const hsv = edit.hsv;
  const rgb = hexToRgb(color);
  const [tab, setTab] = useState<Tab>('wheel');
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const editStart = useRef<string | null>(null);

  const applyHsv = (next: HSV) => {
    const hex = hsvToHex(next);
    setEdit({ hex, hsv: next });
    tools().setColor(hex);
  };
  const applyHex = (hex: string) => tools().setColor(hex);

  // Continuous edits record a single "previous colour" when they finish.
  const beginEdit = () => {
    editStart.current = tools().color;
  };
  const endEdit = () => {
    if (editStart.current) tools().commitColor(editStart.current);
    editStart.current = null;
  };
  /** Discrete pick (swatch, hex entry). */
  const pickColor = (hex: string) => {
    const from = tools().color;
    tools().setColor(hex);
    tools().commitColor(from);
  };

  const sliderProps = { onChangeStart: beginEdit, onChangeEnd: endEdit };
  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const hexText = hexDraft ?? color;
  const hexValid = normalizeHex(hexText);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Colour</Text>

      <View style={styles.headerRow}>
        <View style={styles.swatchPair} accessibilityLabel={`Current colour ${color}, previous colour ${previous}`}>
          <View style={[styles.currentSwatch, { backgroundColor: color, opacity: Math.max(0.15, alpha) }]} />
          <Pressable
            style={[styles.previousSwatch, { backgroundColor: previous }]}
            onPress={() => tools().swapWithPrevious()}
            accessibilityRole="button"
            accessibilityLabel="Swap with previous colour"
          />
        </View>
        <View style={styles.hexBox}>
          <Text style={styles.fieldLabel}>HEX</Text>
          <TextInput
            value={hexText}
            onChangeText={setHexDraft}
            onSubmitEditing={() => {
              if (hexValid) pickColor(hexValid);
              setHexDraft(null);
            }}
            onBlur={() => {
              if (hexValid && hexValid !== color) pickColor(hexValid);
              setHexDraft(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            returnKeyType="done"
            style={[styles.hexInput, !hexValid && styles.invalid]}
            accessibilityLabel="Colour hex code"
          />
        </View>
      </View>

      <Tabs value={tab} onChange={setTab} />

      {tab === 'wheel' ? (
        <View style={styles.wheelBlock}>
          <ColorWheel
            size={WHEEL_SIZE}
            h={hsv.h}
            s={hsv.s}
            v={hsv.v}
            onStart={beginEdit}
            onEnd={endEdit}
            onChange={(h, s) => applyHsv({ h, s, v: hsv.v === 0 ? 1 : hsv.v })}
          />
          <View style={styles.full}>
            <Slider label="Brightness" value={hsv.v} min={0} max={1} format={pct} gradient={['#000000', hsvToHex({ ...hsv, v: 1 })]} onChange={(v) => applyHsv({ ...hsv, v })} {...sliderProps} />
            <Slider label="Opacity" value={alpha} min={0.01} max={1} format={pct} gradient={['rgba(0,0,0,0)', color]} onChange={(a) => tools().setAlpha(a)} />
          </View>
        </View>
      ) : null}

      {tab === 'sliders' ? (
        <View style={styles.sliders}>
          <Slider label="Hue" value={hsv.h} min={0} max={360} format={(v) => `${Math.round(v)}°`} gradient={RAINBOW} onChange={(h) => applyHsv({ ...hsv, h })} {...sliderProps} />
          <Slider label="Saturation" value={hsv.s} min={0} max={1} format={pct} gradient={[hsvToHex({ ...hsv, s: 0 }), hsvToHex({ ...hsv, s: 1 })]} onChange={(s) => applyHsv({ ...hsv, s })} {...sliderProps} />
          <Slider label="Brightness" value={hsv.v} min={0} max={1} format={pct} gradient={['#000000', hsvToHex({ ...hsv, v: 1 })]} onChange={(v) => applyHsv({ ...hsv, v })} {...sliderProps} />
          <View style={styles.divider} />
          <Slider label="Red" value={rgb.r} min={0} max={255} step={1} format={int} gradient={[rgbToHex({ ...rgb, r: 0 }), rgbToHex({ ...rgb, r: 255 })]} onChange={(r) => applyHex(rgbToHex({ ...rgb, r }))} {...sliderProps} />
          <Slider label="Green" value={rgb.g} min={0} max={255} step={1} format={int} gradient={[rgbToHex({ ...rgb, g: 0 }), rgbToHex({ ...rgb, g: 255 })]} onChange={(g) => applyHex(rgbToHex({ ...rgb, g }))} {...sliderProps} />
          <Slider label="Blue" value={rgb.b} min={0} max={255} step={1} format={int} gradient={[rgbToHex({ ...rgb, b: 0 }), rgbToHex({ ...rgb, b: 255 })]} onChange={(b) => applyHex(rgbToHex({ ...rgb, b }))} {...sliderProps} />
          <View style={styles.divider} />
          <Slider label="Opacity" value={alpha} min={0.01} max={1} format={pct} gradient={['rgba(0,0,0,0)', pureHue]} onChange={(a) => tools().setAlpha(a)} />
        </View>
      ) : null}

      {tab === 'palettes' ? <PalettesTab color={color} onPick={pickColor} /> : null}
    </ScrollView>
  );
}

function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: 'wheel', label: 'Wheel' },
    { id: 'sliders', label: 'Sliders' },
    { id: 'palettes', label: 'Palettes' },
  ];
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {items.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onChange(t.id)}
          style={[styles.tab, value === t.id && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === t.id }}>
          <Text style={[styles.tabLabel, value === t.id && styles.tabLabelActive]}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PalettesTab({ color, onPick }: { color: string; onPick: (hex: string) => void }) {
  const recent = useToolStore((s) => s.recentColors);
  const saved = usePaletteStore((s) => s.savedColors);
  const palettes = usePaletteStore((s) => s.palettes);
  const activeId = usePaletteStore((s) => s.activePaletteId);
  const store = usePaletteStore.getState;
  const active = palettes.find((p) => p.id === activeId) ?? palettes[0];
  const [prompt, setPrompt] = useState<{ mode: 'new' } | { mode: 'rename'; palette: Palette } | null>(null);
  const [menuFor, setMenuFor] = useState<Palette | null>(null);

  return (
    <View style={styles.palettes}>
      <Section title="Recent">
        {recent.length ? (
          <Swatches values={recent} selected={color} onSelect={onPick} />
        ) : (
          <Text style={styles.hint}>Colours you paint with appear here.</Text>
        )}
      </Section>

      <Section
        title="Saved"
        action={<SmallButton icon="add" label="Save current colour" onPress={() => store().saveColor(color)} />}>
        {saved.length ? (
          <Swatches
            values={saved}
            selected={color}
            onSelect={onPick}
            onLongPress={(c) =>
              Alert.alert('Remove saved colour?', c, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => store().removeSavedColor(c) },
              ])
            }
          />
        ) : (
          <Text style={styles.hint}>Tap + to keep the current colour here.</Text>
        )}
      </Section>

      <Section title="Palettes" action={<SmallButton icon="add-circle-outline" label="New palette" onPress={() => setPrompt({ mode: 'new' })} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paletteChips}>
          {palettes.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => store().setActivePalette(p.id)}
              onLongPress={() => setMenuFor(p)}
              style={[styles.chip, p.id === active.id && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: p.id === active.id }}
              accessibilityHint="Long press to rename or delete">
              <Text style={[styles.chipLabel, p.id === active.id && styles.chipLabelActive]} numberOfLines={1}>
                {p.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.swatches}>
          {active.colors.map((c, i) => (
            <SwatchButton
              key={`${c}-${i}`}
              color={c}
              selected={c === color}
              onPress={() => onPick(c)}
              onLongPress={() =>
                Alert.alert('Remove from palette?', c, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => store().removeFromPalette(active.id, i) },
                ])
              }
            />
          ))}
          <Pressable
            onPress={() => store().addToPalette(active.id, color)}
            style={[styles.swatch, styles.addSwatch]}
            accessibilityRole="button"
            accessibilityLabel={`Add current colour to ${active.name}`}>
            <Ionicons name="add" size={20} color={colors.textDim} />
          </Pressable>
        </View>
        <Text style={styles.hint}>Long-press a colour to remove it.</Text>
      </Section>

      <GenerateSection color={color} onPick={onPick} />

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.name}
        options={
          menuFor
            ? [
                { label: 'Rename palette', icon: 'create-outline', onPress: () => setPrompt({ mode: 'rename', palette: menuFor }) },
                {
                  label: 'Delete palette',
                  icon: 'trash-outline',
                  destructive: true,
                  onPress: () =>
                    Alert.alert(`Delete "${menuFor.name}"?`, 'Its colours will be removed from this device.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => store().deletePalette(menuFor.id) },
                    ]),
                },
              ]
            : []
        }
        onClose={() => setMenuFor(null)}
      />
      <PromptDialog
        visible={prompt !== null}
        title={prompt?.mode === 'rename' ? 'Rename palette' : 'New palette'}
        initialValue={prompt?.mode === 'rename' ? prompt.palette.name : ''}
        confirmLabel={prompt?.mode === 'rename' ? 'Rename' : 'Create'}
        onCancel={() => setPrompt(null)}
        onSubmit={(name) => {
          if (prompt?.mode === 'rename') store().renamePalette(prompt.palette.id, name);
          else store().createPalette(name);
          setPrompt(null);
        }}
      />
    </View>
  );
}

/** Number of colours taken from an image. */
const IMAGE_PALETTE_SIZE = 8;

/**
 * Palette generator: colour harmonies built from the current colour, or the main colours of a
 * picked image. A preview is shown first; "Save" keeps it as a new palette.
 */
function GenerateSection({ color, onPick }: { color: string; onPick: (hex: string) => void }) {
  const [preview, setPreview] = useState<{ name: string; colors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const showHarmony = (kind: HarmonyKind, label: string) =>
    setPreview({ name: `${label} ${color.toUpperCase()}`, colors: harmony(color, kind) });

  const fromImage = async () => {
    const picked = await pickImageFile();
    if (!picked) return;
    setBusy(true);
    try {
      const image = decodeImportedImage(await new File(picked.uri).bytes());
      if (!image) throw new Error('This image could not be read.');
      const colors = paletteFromImage(image, IMAGE_PALETTE_SIZE);
      image.dispose();
      if (colors.length === 0) throw new Error('No colours found (is the image transparent?).');
      setPreview({ name: picked.name.slice(0, 40), colors });
    } catch (error) {
      Alert.alert('Can’t make a palette', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Generate palette">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paletteChips}>
        {HARMONIES.map((h) => (
          <Pressable
            key={h.id}
            onPress={() => showHarmony(h.id, h.label)}
            style={[styles.chip, preview?.name.startsWith(h.label) && styles.chipActive]}
            accessibilityRole="button"
            accessibilityHint="Builds colours that go with the current colour">
            <Text style={[styles.chipLabel, preview?.name.startsWith(h.label) && styles.chipLabelActive]}>{h.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => void fromImage()}
          disabled={busy}
          style={[styles.chip, styles.chipRow]}
          accessibilityRole="button"
          accessibilityHint="Takes the main colours of an image">
          <Ionicons name="image-outline" size={14} color={colors.textDim} />
          <Text style={styles.chipLabel}>{busy ? 'Reading…' : 'From image…'}</Text>
        </Pressable>
      </ScrollView>
      {preview ? (
        <View style={styles.preview}>
          <Swatches values={preview.colors} selected={color} onSelect={onPick} />
          <View style={styles.previewActions}>
            <Text style={styles.hint} numberOfLines={1}>
              {preview.name}
            </Text>
            <Pressable onPress={() => setPreview(null)} style={styles.textButton} accessibilityRole="button">
              <Text style={styles.textButtonLabel}>Discard</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                usePaletteStore.getState().createPaletteWithColors(preview.name, preview.colors);
                setPreview(null);
              }}
              style={[styles.textButton, styles.textButtonPrimary]}
              accessibilityRole="button">
              <Text style={styles.textButtonPrimaryLabel}>Save palette</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>Pick a harmony for the current colour, or take the colours of an image.</Text>
      )}
    </Section>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function SmallButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.smallButton} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={colors.accent} />
    </Pressable>
  );
}

function Swatches({
  values,
  selected,
  onSelect,
  onLongPress,
}: {
  values: string[];
  selected: string;
  onSelect: (c: string) => void;
  onLongPress?: (c: string) => void;
}) {
  return (
    <View style={styles.swatches}>
      {values.map((c) => (
        <SwatchButton key={c} color={c} selected={c === selected} onPress={() => onSelect(c)} onLongPress={onLongPress ? () => onLongPress(c) : undefined} />
      ))}
    </View>
  );
}

function SwatchButton({ color, selected, onPress, onLongPress }: { color: string; selected: boolean; onPress: () => void; onLongPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Colour ${color}`}
      accessibilityState={{ selected }}
      style={[styles.swatch, { backgroundColor: color }, selected && styles.swatchSelected]}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  swatchPair: { flexDirection: 'row', borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  currentSwatch: { width: 56, height: TOUCH_TARGET + 4 },
  previousSwatch: { width: 32, height: TOUCH_TARGET + 4 },
  hexBox: { flex: 1, gap: spacing.xs },
  fieldLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  hexInput: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backdrop,
  },
  invalid: { borderColor: colors.danger },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.backdrop },
  tab: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.panelRaised },
  tabLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  tabLabelActive: { color: colors.text },
  wheelBlock: { alignItems: 'center', gap: spacing.md },
  full: { alignSelf: 'stretch', gap: spacing.sm },
  sliders: { gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  palettes: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  smallButton: { padding: 2 },
  hint: { color: colors.textDim, fontSize: 12 },
  paletteChips: { gap: spacing.xs },
  chip: { minHeight: 32, maxWidth: 160, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipActive: { backgroundColor: colors.accentDim },
  chipLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  chipLabelActive: { color: colors.accent },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  swatchSelected: { borderWidth: 3, borderColor: colors.accent },
  addSwatch: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', backgroundColor: 'transparent' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  preview: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.backdrop },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  textButton: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.md },
  textButtonLabel: { color: colors.text, fontWeight: '600', fontSize: 13 },
  textButtonPrimary: { backgroundColor: colors.accent, marginLeft: 'auto' },
  textButtonPrimaryLabel: { color: colors.onAccent, fontWeight: '700', fontSize: 13 },
}));
