import { Canvas, Image, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, PixelRatio, Pressable, ScrollView, SectionList, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  BRUSH_CATEGORIES,
  type BrushPreset,
  type BrushPresetPatch,
  type BrushTexture,
  type BrushTip,
  isCircleTone,
  isToneTexture,
  type TiltMode,
} from '@/engine/brush/brushPreset';
import { peekBrushPreview, renderBrushPreview, requestBrushPreview } from '@/engine/brush/brushPreview';
import { BrushStudio } from '@/features/editor/BrushStudio';
import { pickBrushFile, pickTipImage, shareBrushes } from '@/storage/brushTips';
import { toneCellSize } from '@/engine/brush/tips';
import { BUILT_IN_BRUSHES } from '@/engine/brush/builtInBrushes';
import type { ToolId } from '@/engine/types';
import { presetFrom, useBrushStore, useSlotPreset, useToolBrush, useTypedSizeMax } from '@/state/brushStore';
import { useToolStore } from '@/state/toolStore';
import { ActionSheet, type ActionSheetOption } from '@/ui/ActionSheet';
import { PromptDialog } from '@/ui/PromptDialog';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed } from '@/ui/theme';
import { PERCENT_ENTRY, SIZE_ENTRY } from '@/ui/valueEntry';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} px`;

/** Brush library + settings of the active tool's preset. */
export function BrushPanel() {
  const tool = useToolStore((s) => s.tool);
  const [tab, setTab] = useState<'library' | 'settings'>('library');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.heading}>{tool === 'eraser' ? 'Eraser' : 'Brushes'}</Text>
        <Chips
          options={[
            { id: 'library', label: 'Library' },
            { id: 'settings', label: 'Settings' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'library' ? <BrushLibrary tool={tool} onEdit={() => setTab('settings')} /> : <BrushSettings tool={tool} />}
    </View>
  );
}

// ---- library -------------------------------------------------------------------------------

type LibraryFilter = 'all' | 'favorites' | 'recent';

function BrushLibrary({ tool, onEdit }: { tool: ToolId; onEdit: () => void }) {
  const custom = useBrushStore((s) => s.custom);
  const overrides = useBrushStore((s) => s.overrides);
  const favorites = useBrushStore((s) => s.favorites);
  const recent = useBrushStore((s) => s.recent);
  const eraserLinked = useBrushStore((s) => tool === 'eraser' && s.eraserUsesBrush);
  const activeId = useBrushStore((s) => s.slots[tool].presetId);
  const store = useBrushStore.getState;
  const [menuFor, setMenuFor] = useState<BrushPreset | null>(null);
  const [renaming, setRenaming] = useState<BrushPreset | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  // Brush studio: open with null to make a new brush, or a preset to edit (custom) / copy (built-in).
  const [studio, setStudio] = useState<{ initial: BrushPreset | null } | null>(null);

  const all = useMemo(
    () => [...BUILT_IN_BRUSHES.map((b) => presetFrom(b.id, custom, overrides[b.id])), ...custom],
    [custom, overrides],
  );

  const menuOptions: ActionSheetOption[] = menuFor
    ? [
        {
          label: menuFor.builtIn ? 'Make my own brush from this' : 'Edit in Brush Studio',
          icon: 'color-wand-outline',
          // A built-in brush is copied (new id), so saving never changes the original.
          onPress: () => setStudio({ initial: menuFor.builtIn ? { ...menuFor, id: '', name: `My ${menuFor.name}` } : menuFor }),
        },
        {
          label: 'Edit settings',
          icon: 'options-outline',
          onPress: () => {
            store().selectPreset(tool, menuFor.id);
            onEdit();
          },
        },
        { label: 'Duplicate', icon: 'copy-outline', onPress: () => store().selectPreset(tool, store().duplicatePreset(menuFor.id)) },
        {
          label: 'Share brush…',
          icon: 'share-outline',
          onPress: () => {
            shareBrushes([menuFor], menuFor.name).catch((error: unknown) => Alert.alert('Can’t share', (error as Error).message));
          },
        },
        ...(menuFor.builtIn
          ? overrides[menuFor.id]
            ? [{ label: 'Reset to default', icon: 'refresh-outline' as const, onPress: () => store().resetPreset(menuFor.id) }]
            : []
          : [
              { label: 'Rename', icon: 'create-outline' as const, onPress: () => setRenaming(menuFor) },
              {
                label: 'Delete',
                icon: 'trash-outline' as const,
                destructive: true,
                onPress: () =>
                  Alert.alert(`Delete "${menuFor.name}"?`, 'This brush will be removed from this device.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => store().deletePreset(menuFor.id) },
                  ]),
              },
            ]),
      ]
    : [];

  const { sections, empty } = librarySections(all, filter, query, favorites, recent);

  const header = (
    <View style={styles.libraryHeader}>
      {tool === 'eraser' ? <EraserCard /> : null}

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.textDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search brushes"
            placeholderTextColor={colors.textDim}
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Search brushes by name"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={colors.textDim} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setStudio({ initial: null })}
          style={styles.newButton}
          accessibilityRole="button"
          accessibilityLabel="Create your own brush">
          <Ionicons name="add" size={22} color={colors.accent} />
        </Pressable>
        <Pressable
          onPress={() => {
            pickBrushFile()
              .then((brushes) => {
                if (!brushes) return;
                const added = store().importPresets(brushes);
                Alert.alert('Brushes imported', `${added} ${added === 1 ? 'brush was' : 'brushes were'} added to My Brushes.`);
              })
              .catch((error: unknown) => Alert.alert('Can’t import', (error as Error).message));
          }}
          style={styles.newButton}
          accessibilityRole="button"
          accessibilityLabel="Import brushes from a .zumibrush file">
          <Ionicons name="download-outline" size={20} color={colors.text} />
        </Pressable>
        {custom.length > 0 ? (
          <Pressable
            onPress={() => {
              shareBrushes(custom, 'My Brushes').catch((error: unknown) => Alert.alert('Can’t share', (error as Error).message));
            }}
            style={styles.newButton}
            accessibilityRole="button"
            accessibilityLabel="Share all my brushes as a file">
            <Ionicons name="share-outline" size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {tool === 'brush' ? (
        <Pressable
          onPress={() => setStudio({ initial: null })}
          style={({ pressed }) => [styles.createCard, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Create your own brush in Brush Studio">
          <Ionicons name="color-wand-outline" size={22} color={colors.accent} />
          <View style={styles.createText}>
            <Text style={styles.createTitle}>Create your own brush</Text>
            <Text style={styles.createHint}>Pick a starting point, shape it and try it on a test pad.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </Pressable>
      ) : null}
      <Chips
        options={[
          { id: 'all', label: 'All' },
          { id: 'favorites', label: 'Favourites' },
          { id: 'recent', label: 'Recent' },
        ]}
        value={filter}
        onChange={setFilter}
      />
    </View>
  );

  return (
    <>
      {/* Virtualized: only the rows on screen (plus a small window) are mounted and rendered. */}
      <SectionList
        sections={sections}
        keyExtractor={(preset) => preset.id}
        renderItem={({ item: preset }) => (
          <BrushRow
            preset={preset}
            selected={!eraserLinked && preset.id === activeId}
            edited={!!overrides[preset.id]}
            favorite={favorites.includes(preset.id)}
            onToggleFavorite={() => store().toggleFavorite(preset.id)}
            onPress={() => store().selectPreset(tool, preset.id)}
            onLongPress={() => setMenuFor(preset)}
          />
        )}
        renderSectionHeader={({ section }) => (section.title ? <Text style={styles.categoryTitle}>{section.title}</Text> : null)}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.hint}>{empty}</Text>}
        ListFooterComponent={<Text style={[styles.hint, styles.footerHint]}>Long-press a brush to edit, duplicate, rename, reset or delete it.</Text>}
        stickySectionHeadersEnabled={false}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.libraryContent}
      />
      <ActionSheet visible={menuFor !== null} title={menuFor?.name} options={menuOptions} onClose={() => setMenuFor(null)} />
      <BrushStudio
        visible={studio !== null}
        initial={studio?.initial ?? null}
        onClose={() => setStudio(null)}
        onSaved={(id) => {
          setStudio(null);
          if (tool !== 'brush') store().selectPreset(tool, id);
        }}
      />
      <PromptDialog
        visible={renaming !== null}
        title="Rename brush"
        initialValue={renaming?.name ?? ''}
        confirmLabel="Rename"
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          if (renaming) store().renamePreset(renaming.id, name);
          setRenaming(null);
        }}
      />
    </>
  );
}

/** Brushes grouped by category, or a flat favourites/recent list, filtered by the search text. */
interface LibrarySection {
  key: string;
  title?: string;
  data: BrushPreset[];
}

function librarySections(
  all: BrushPreset[],
  filter: LibraryFilter,
  query: string,
  favorites: string[],
  recent: string[],
): { sections: LibrarySection[]; empty: string } {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (p: BrushPreset) => !needle || p.name.toLocaleLowerCase().includes(needle);

  if (filter !== 'all') {
    const ids = filter === 'favorites' ? favorites : recent;
    const data = ids.map((id) => all.find((p) => p.id === id)).filter((p): p is BrushPreset => !!p && matches(p));
    return {
      sections: data.length ? [{ key: filter, data }] : [],
      empty: filter === 'favorites' ? 'Tap the star on a brush to add it to your favourites.' : 'Brushes you use appear here.',
    };
  }

  const sections = BRUSH_CATEGORIES.map((category) => ({
    key: category.id,
    title: category.label,
    data: all.filter((p) => p.category === category.id && matches(p)),
  })).filter((g) => g.data.length > 0);
  return { sections, empty: `No brushes match “${query.trim()}”.` };
}

function RowGap() {
  return <View style={styles.rowGap} />;
}

const ROW_PREVIEW_W = 132;
const ROW_PREVIEW_H = 40;

function BrushRow({
  preset,
  selected,
  edited,
  favorite,
  onToggleFavorite,
  onPress,
  onLongPress,
}: {
  preset: BrushPreset;
  selected: boolean;
  edited: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${preset.name}${edited ? ', edited' : ''}`}
      accessibilityHint="Long press for more options">
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {preset.name}
        </Text>
        {edited ? <Text style={styles.badge}>Edited</Text> : null}
      </View>
      <BrushPreview preset={preset} width={ROW_PREVIEW_W} height={ROW_PREVIEW_H} deferred />
      <Pressable
        onPress={onToggleFavorite}
        hitSlop={8}
        style={styles.star}
        accessibilityRole="button"
        accessibilityLabel={favorite ? `Remove ${preset.name} from favourites` : `Add ${preset.name} to favourites`}>
        <Ionicons name={favorite ? 'star' : 'star-outline'} size={18} color={favorite ? colors.accent : colors.textDim} />
      </Pressable>
    </Pressable>
  );
}

/** Eraser options: its own size/opacity/hardness, optionally shaped by the current brush. */
function EraserCard() {
  const linked = useBrushStore((s) => s.eraserUsesBrush);
  const brushName = useSlotPreset('brush').name;
  const eraser = useToolBrush('eraser');
  const typedMax = useTypedSizeMax(eraser);
  const store = useBrushStore.getState;
  return (
    <View style={styles.eraserCard}>
      <Toggle
        label={`Erase with current brush (${brushName})`}
        hint="Uses the brush's shape, texture and dynamics. Erasing only affects the active layer."
        value={linked}
        onChange={(v) => store().setEraserUsesBrush(v)}
      />
      <Slider label="Size" value={eraser.size} min={eraser.minSize} max={eraser.maxSize} curve="quadratic" format={px} entry={{ ...SIZE_ENTRY, max: typedMax }} onChange={(v) => store().setSize('eraser', v)} />
      <CanvasSizedToggle />
      <Slider label="Opacity" value={eraser.opacity} min={0.01} max={1} format={percent} entry={PERCENT_ENTRY} onChange={(v) => store().setOpacity('eraser', v)} />
      <Slider label="Hardness" value={eraser.hardness} min={0} max={1} format={percent} onChange={(v) => store().setHardness('eraser', v)} />
      {!linked ? <Text style={styles.hint}>Or pick an eraser shape below.</Text> : null}
    </View>
  );
}

/**
 * A stroke drawn with the preset. `deferred` previews (library rows) show a cached image at once
 * or render on a later frame, so opening the library never blocks on ~100 stroke renders.
 */
function BrushPreview({
  preset,
  width,
  height,
  color = colors.text,
  deferred = false,
}: {
  preset: BrushPreset;
  width: number;
  height: number;
  color?: string;
  deferred?: boolean;
}) {
  const scale = PixelRatio.get();
  const w = width * scale;
  const h = height * scale;
  const ready = useMemo(
    () => (deferred ? peekBrushPreview(preset, color, w, h) : renderBrushPreview(preset, color, w, h)),
    [deferred, preset, color, w, h],
  );
  const [late, setLate] = useState<{ preset: BrushPreset; color: string; image: SkImage | null } | null>(null);
  useEffect(() => {
    if (ready !== undefined) return;
    return requestBrushPreview(preset, color, w, h, (result) => setLate({ preset, color, image: result }));
  }, [ready, preset, color, w, h]);
  const image = ready !== undefined ? ready : late?.preset === preset && late.color === color ? late.image : null;
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      {image ? <Image image={image} x={0} y={0} width={width} height={height} fit="fill" /> : null}
    </Canvas>
  );
}

// ---- settings ------------------------------------------------------------------------------

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
  { id: 'none', label: 'None' },
  { id: 'paper', label: 'Paper' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'grain', label: 'Grain' },
  { id: 'tone-dots', label: 'Tone (dots)' },
  { id: 'tone-rings', label: 'Tone (rings)' },
  { id: 'tone-stipple', label: 'Tone (sand)' },
  { id: 'tone-lines', label: 'Tone (lines)' },
  { id: 'tone-crosshatch', label: 'Tone (crosshatch)' },
];
/** Quick screentone angles (degrees, as strings for the chips). */
const TONE_ANGLES: { id: string; label: string }[] = [
  { id: '0', label: 'Straight' },
  { id: '45', label: 'Diagonal ╲' },
  { id: '-45', label: 'Diagonal ╱' },
  { id: '90', label: 'Vertical' },
];
const TILT_MODES: { id: TiltMode; label: string }[] = [
  { id: 'none', label: 'Off' },
  { id: 'size', label: 'Size' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'angle', label: 'Angle' },
];

function BrushSettings({ tool }: { tool: ToolId }) {
  const preset = useSlotPreset(tool);
  const brush = useToolBrush(tool);
  const typedMax = useTypedSizeMax(brush);
  const color = useToolStore((s) => s.color);
  const edited = useBrushStore((s) => !!s.overrides[preset.id]);
  const store = useBrushStore.getState;
  const update = (patch: BrushPresetPatch) => store().updatePreset(preset.id, patch);

  return (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.previewBox}>
        <Text style={styles.previewName} numberOfLines={1}>
          {preset.name}
          {edited ? '  ·  edited' : ''}
        </Text>
        <BrushPreview preset={brush} width={272} height={64} color={tool === 'eraser' ? colors.text : color} />
      </View>

      <Section title="Size">
        <Slider label="Size" value={brush.size} min={brush.minSize} max={brush.maxSize} curve="quadratic" format={px} entry={{ ...SIZE_ENTRY, max: typedMax }} onChange={(v) => store().setSize(tool, v)} />
        <CanvasSizedToggle />
        <Slider label="Minimum size" value={preset.minSize} min={0.5} max={Math.max(1, preset.maxSize)} curve="quadratic" format={px} onChange={(minSize) => update({ minSize })} />
        <Slider label="Maximum size" value={preset.maxSize} min={Math.max(1, preset.minSize)} max={1000} curve="quadratic" format={px} onChange={(maxSize) => update({ maxSize })} />
      </Section>

      <Section title="Opacity & flow">
        <Slider label="Opacity" value={brush.opacity} min={0.01} max={1} format={percent} entry={PERCENT_ENTRY} onChange={(v) => store().setOpacity(tool, v)} />
        <Slider label="Flow" value={preset.flow} min={0.01} max={1} format={percent} onChange={(flow) => update({ flow })} />
      </Section>

      <Section title="Shape">
        <Chips options={TIPS} value={preset.shape.tip} onChange={(tip) => update({ shape: { tip } })} wrap />
        <Slider label="Hardness" value={preset.hardness} min={0} max={1} format={percent} onChange={(hardness) => update({ hardness })} />
        <Slider label="Roundness" value={preset.shape.roundness} min={0.05} max={1} format={percent} onChange={(roundness) => update({ shape: { roundness } })} />
        <Slider label="Angle" value={preset.rotation.angle} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(angle) => update({ rotation: { angle } })} />
        <Toggle label="Rotate with stroke" value={preset.rotation.followStroke} onChange={(followStroke) => update({ rotation: { followStroke } })} />
        <Pressable
          onPress={() => {
            pickTipImage()
              .then((id) => {
                if (id) update({ shape: { tip: 'image', image: id } });
              })
              .catch((error: unknown) => Alert.alert('Can’t use that picture', (error as Error).message));
          }}
          style={({ pressed }) => [styles.createCard, pressed && styles.pressed]}
          accessibilityRole="button">
          <Ionicons name="image-outline" size={20} color={colors.accent} />
          <Text style={styles.createTitle}>{preset.shape.tip === 'image' ? 'Change the picture tip…' : 'Use a picture as the tip…'}</Text>
        </Pressable>
      </Section>

      {tool === 'brush' ? (
        <Section title="Blending">
          <Slider label="Blend" value={preset.blend} min={0} max={1} format={(v) => (v > 0 ? percent(v) : 'Off')} onChange={(blend) => update({ blend })} />
          <Slider label="Smudge" value={preset.smudge} min={0} max={1} format={(v) => (v > 0 ? percent(v) : 'Off')} onChange={(smudge) => update({ smudge })} />
          <Text style={styles.hint}>Above 0 the brush adds no colour: it mixes the colours already on the layer under the stroke. Higher blends further.</Text>
        </Section>
      ) : null}


      <Section title="Stroke">
        <Slider label="Spacing" value={preset.spacing} min={0.01} max={1} curve="quadratic" format={percent} onChange={(spacing) => update({ spacing })} />
        <Slider label="Smoothing" value={preset.smoothing} min={0} max={1} format={percent} onChange={(smoothing) => update({ smoothing })} />
        <Slider label="Scatter" value={preset.scatter} min={0} max={1} format={percent} onChange={(scatter) => update({ scatter })} />
      </Section>

      <Section title="Jitter">
        <Slider label="Size jitter" value={preset.jitter.size} min={0} max={1} format={percent} onChange={(size) => update({ jitter: { size } })} />
        <Slider label="Opacity jitter" value={preset.jitter.opacity} min={0} max={1} format={percent} onChange={(opacity) => update({ jitter: { opacity } })} />
        <Slider label="Rotation jitter" value={preset.jitter.rotation} min={0} max={1} format={percent} onChange={(rotation) => update({ jitter: { rotation } })} />
      </Section>

      <Section title="Pressure">
        <Slider label="Pressure → size" value={preset.pressure.size} min={0} max={1} format={percent} onChange={(size) => update({ pressure: { size } })} />
        <Slider label="Pressure → opacity" value={preset.pressure.opacity} min={0} max={1} format={percent} onChange={(opacity) => update({ pressure: { opacity } })} />
        <Slider label="Response curve" value={preset.pressure.curve} min={0.3} max={3} format={(v) => v.toFixed(2)} onChange={(curve) => update({ pressure: { curve } })} />
        <Toggle
          label="Speed-sensitive width"
          hint="For fingers and styluses without pressure: faster strokes get thinner."
          value={preset.speedPressure}
          onChange={(speedPressure) => update({ speedPressure })}
        />
      </Section>

      <Section title="Tilt">
        <Chips options={TILT_MODES} value={preset.tilt.mode} onChange={(mode) => update({ tilt: { mode } })} />
        {preset.tilt.mode !== 'none' ? (
          <Slider label="Tilt amount" value={preset.tilt.amount} min={0} max={1} format={percent} onChange={(amount) => update({ tilt: { amount } })} />
        ) : null}
        <Text style={styles.hint}>Applies to styluses that report tilt.</Text>
      </Section>

      <Section title="Texture">
        <Chips options={TEXTURES} value={preset.texture.kind} onChange={(kind) => update({ texture: { kind, strength: kind !== 'none' && preset.texture.strength === 0 ? 0.5 : preset.texture.strength } })} wrap />
        {preset.texture.kind !== 'none' ? (
          <>
            {isToneTexture(preset.texture.kind) ? (
              <>
                <Slider
                  label={isCircleTone(preset.texture.kind) ? 'Circle size' : 'Line spacing'}
                  value={preset.texture.scale}
                  min={0.25}
                  max={4}
                  format={(v) => `${Math.round(toneCellSize(v))} px`}
                  entry={{ unit: 'px', decimals: 0, scale: toneCellSize(1) }}
                  onChange={(scale) => update({ texture: { scale } })}
                />
                <Slider
                  label={isCircleTone(preset.texture.kind) ? 'Density (circle area)' : 'Density (line thickness)'}
                  value={preset.texture.strength}
                  min={0.05}
                  max={1}
                  format={percent}
                  entry={PERCENT_ENTRY}
                  onChange={(strength) => update({ texture: { strength } })}
                />
                {isCircleTone(preset.texture.kind) ? (
                  <Slider
                    label="Circle size variation"
                    value={preset.texture.variation}
                    min={0}
                    max={1}
                    format={(v) => (v > 0 ? percent(v) : 'Same size')}
                    onChange={(variation) => update({ texture: { variation } })}
                  />
                ) : null}
                <Slider
                  label="Pattern angle"
                  value={preset.texture.angle}
                  min={-90}
                  max={90}
                  step={1}
                  format={(v) => `${Math.round(v)}°`}
                  onChange={(angle) => update({ texture: { angle } })}
                />
                <Chips
                  options={TONE_ANGLES}
                  value={String(Math.round(preset.texture.angle))}
                  onChange={(id) => update({ texture: { angle: Number(id) } })}
                  wrap
                />
                <Text style={styles.hint}>Tone is fixed to the canvas, so overlapping strokes line up like real screentone.</Text>
              </>
            ) : (
              <>
                <Slider label="Strength" value={preset.texture.strength} min={0} max={1} format={percent} onChange={(strength) => update({ texture: { strength } })} />
                <Slider label="Scale" value={preset.texture.scale} min={0.25} max={4} format={(v) => `${v.toFixed(2)}×`} onChange={(scale) => update({ texture: { scale } })} />
              </>
            )}
          </>
        ) : null}
      </Section>

      <View style={styles.footer}>
        {preset.builtIn && edited ? (
          <FooterButton label="Reset to default" onPress={() => store().resetPreset(preset.id)} />
        ) : null}
        <FooterButton label="Duplicate" onPress={() => store().selectPreset(tool, store().duplicatePreset(preset.id))} />
      </View>
    </ScrollView>
  );
}

// ---- small UI helpers ------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** Lets the size sliders reach the canvas size (shared by all tools). */
function CanvasSizedToggle() {
  const value = useBrushStore((s) => s.canvasSizedBrushes);
  const side = useBrushStore((s) => s.canvasSide);
  return (
    <Toggle
      label="Size up to canvas"
      hint={`Size sliders go up to the canvas's longest side${side > 0 ? ` (${side} px)` : ''} instead of the brush's maximum.`}
      value={value}
      onChange={(v) => useBrushStore.getState().setCanvasSizedBrushes(v)}
    />
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.panelRaised }} />
    </View>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  wrap,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  wrap?: boolean;
}) {
  return (
    <View style={[styles.chips, wrap && styles.chipsWrap]}>
      {options.map((o) => (
        <Pressable
          key={o.id}
          onPress={() => onChange(o.id)}
          style={[styles.chip, value === o.id && styles.chipSelected]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.id }}>
          <Text style={[styles.chipLabel, value === o.id && styles.chipLabelSelected]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function FooterButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={styles.footerLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flexShrink: 1 },
  header: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  libraryContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  libraryHeader: { gap: spacing.md, marginBottom: spacing.xs },
  rowGap: { height: spacing.xs },
  footerHint: { marginTop: spacing.md },
  categoryTitle: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginLeft: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.backdrop,
  },
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.panelRaised },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  badge: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  hint: { color: colors.textDim, fontSize: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backdrop,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: spacing.sm },
  newButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.panelRaised },
  createCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.panelRaised,
  },
  createText: { flex: 1, gap: 2 },
  createTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  createHint: { color: colors.textDim, fontSize: 12 },
  star: { padding: 4 },
  eraserCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.backdrop },
  settingsContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  previewBox: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.backdrop, alignItems: 'center' },
  previewName: { alignSelf: 'flex-start', color: colors.textDim, fontSize: 12, fontWeight: '600' },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.text, fontSize: 14 },
  chips: { flexDirection: 'row', gap: spacing.xs },
  chipsWrap: { flexWrap: 'wrap' },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipSelected: { backgroundColor: colors.accentDim },
  chipLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  chipLabelSelected: { color: colors.accent },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footerButton: { minHeight: 40, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.panelRaised },
  footerLabel: { color: colors.text, fontWeight: '600' },
}));
