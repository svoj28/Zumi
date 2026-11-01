import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SHAPES, type ShapeKind } from '@/engine/brush/shapes';
import type { MeshMode } from '@/engine/layers/meshWarp';
import type { SaveStatus } from '@/features/editor/useEditorSession';
import type { FillSettings, GradientSettings, LiquifyMode, LiquifySettings, SelectCombine, SelectShape } from '@/state/toolStore';
import { IconButton } from '@/ui/IconButton';
import { colors, radius, spacing, themed } from '@/ui/theme';

// ---- top toolbar ---------------------------------------------------------------------------

interface TopBarProps {
  title: string;
  saveStatus: SaveStatus;
  compact: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Labels of the steps undo/redo would affect, for assistive tech. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** The view is rotated, so "reset rotation" is offered. */
  rotated: boolean;
  /** The display is mirrored (view only). */
  viewMirrored: boolean;
  transformActive: boolean;
  selectActive: boolean;
  symmetryActive: boolean;
  guidesActive: boolean;
  settingsActive: boolean;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onResetRotation: () => void;
  onFlipView: () => void;
  onTransform: () => void;
  onSelect: () => void;
  onSymmetry: () => void;
  onGuides: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  /** Phones: overflow menu containing flip view/symmetry/guides/import/export/settings. */
  onMore: () => void;
}

/** Slim top bar: history and view on the left, workspace tools on the right. */
export function TopBar(p: TopBarProps) {
  return (
    <View style={styles.topBar}>
      <IconButton icon="chevron-back" label="Back to gallery" onPress={p.onBack} />
      <IconButton icon="arrow-undo" label={p.undoLabel ? `Undo ${p.undoLabel}` : 'Undo'} onPress={p.onUndo} disabled={!p.canUndo} />
      <IconButton icon="arrow-redo" label={p.redoLabel ? `Redo ${p.redoLabel}` : 'Redo'} onPress={p.onRedo} disabled={!p.canRedo} />
      <IconButton icon="contract-outline" label="Fit canvas to screen" onPress={p.onFit} />
      {p.rotated ? <IconButton icon="compass-outline" label="Reset canvas rotation" onPress={p.onResetRotation} /> : null}
      <View style={styles.titleBlock}>
        {p.compact ? null : (
          <Text style={styles.title} numberOfLines={1}>
            {p.title}
          </Text>
        )}
        <SaveIndicator status={p.saveStatus} />
      </View>
      <IconButton
        icon="move-outline"
        label="Transform layer or selection (changes the artwork)"
        active={p.transformActive}
        onPress={p.onTransform}
      />
      <IconButton icon="scan-outline" label="Selection" active={p.selectActive} onPress={p.onSelect} />
      {p.compact ? (
        <IconButton icon="ellipsis-horizontal" label="More" onPress={p.onMore} />
      ) : (
        <>
          <IconButton
            icon="swap-horizontal-outline"
            label={p.viewMirrored ? 'Unflip view' : 'Flip view horizontally (display only, artwork unchanged)'}
            active={p.viewMirrored}
            onPress={p.onFlipView}
          />
          <IconButton icon="flower-outline" label="Symmetry" active={p.symmetryActive} onPress={p.onSymmetry} />
          <IconButton icon="grid-outline" label="Guides" active={p.guidesActive} onPress={p.onGuides} />
          <IconButton icon="image-outline" label="Import or reference image" onPress={p.onImport} />
          <IconButton icon="share-outline" label="Export" onPress={p.onExport} />
          <IconButton icon="settings-outline" label="Settings" active={p.settingsActive} onPress={p.onSettings} />
          {/* Fill, gradient, text, adjustments, liquify, canvas size, history, animation, … */}
          <IconButton icon="ellipsis-horizontal" label="More tools" onPress={p.onMore} />
        </>
      )}
    </View>
  );
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Edited',
  error: 'Not saved',
};

/** Unobtrusive autosave state under the title; announced politely to screen readers. */
function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <Text
      style={[styles.saveStatus, status === 'error' && styles.saveStatusError]}
      numberOfLines={1}
      accessibilityLiveRegion="polite"
      accessibilityLabel={status === 'error' ? 'Autosave failed. Check free storage space.' : SAVE_LABELS[status]}>
      {SAVE_LABELS[status]}
    </Text>
  );
}

// ---- contextual bars -----------------------------------------------------------------------

export function ContextBar({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View style={styles.contextWrap} pointerEvents="box-none">
      <View style={styles.contextBar}>{children}</View>
      {hint ? <Text style={styles.contextHint}>{hint}</Text> : null}
    </View>
  );
}

export function Divider() {
  return <View style={styles.contextDivider} />;
}

export function TextButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.textButton, primary && styles.textButtonPrimary, pressed && styles.pressed]}
      accessibilityRole="button">
      <Text style={[styles.textButtonLabel, primary && styles.textButtonLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

const TRANSFORM_HINTS: Record<MeshMode, (what: string) => string> = {
  free: (what) => `Transforming ${what} · drag to move · drag a corner to scale · pinch to scale and rotate`,
  distort: (what) => `Distorting ${what} · drag a corner (perspective, skew, stretch) · drag inside to move`,
  warp: (what) => `Warping ${what} · drag corners or the round edge handles to bend · drag inside to move`,
};

export function TransformBar(p: {
  /** Transforming only the selected pixels rather than the whole layer. */
  selection: boolean;
  mode: MeshMode;
  onMode: (mode: MeshMode) => void;
  onFlipX: () => void;
  onFlipY: () => void;
  onRotate: () => void;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const what = p.selection ? 'selection' : 'layer';
  return (
    <ContextBar hint={TRANSFORM_HINTS[p.mode](what)}>
      <IconButton icon="move-outline" label="Free transform (move, scale, rotate)" active={p.mode === 'free'} onPress={() => p.onMode('free')} />
      <IconButton icon="cube-outline" label="Distort (drag corners: perspective, skew, stretch)" active={p.mode === 'distort'} onPress={() => p.onMode('distort')} />
      <IconButton icon="water-outline" label="Warp (bend the edges)" active={p.mode === 'warp'} onPress={() => p.onMode('warp')} />
      <Divider />
      {p.mode === 'free' ? (
        <>
          <IconButton icon="swap-horizontal" label={`Flip ${what} horizontally`} onPress={p.onFlipX} />
          <IconButton icon="swap-vertical-outline" label={`Flip ${what} vertically`} onPress={p.onFlipY} />
          <IconButton icon="refresh-circle-outline" label={`Rotate ${what} 90° clockwise`} onPress={p.onRotate} />
        </>
      ) : null}
      <IconButton icon="refresh" label="Reset transform" onPress={p.onReset} />
      <Divider />
      <TextButton label="Cancel" onPress={p.onCancel} />
      <TextButton label="Apply" onPress={p.onApply} primary />
    </ContextBar>
  );
}

const SELECT_HINTS: Record<SelectShape, string> = {
  rect: 'Drag to select a rectangle · tap to deselect',
  ellipse: 'Drag to select an ellipse · tap to deselect',
  lasso: 'Draw around an area · tap to deselect',
  wand: 'Tap an area to select it (magic wand)',
};

const COMBINE: { mode: SelectCombine; icon: React.ComponentProps<typeof IconButton>['icon']; label: string }[] = [
  { mode: 'replace', icon: 'square-outline', label: 'New selection' },
  { mode: 'add', icon: 'add-circle-outline', label: 'Add to selection' },
  { mode: 'subtract', icon: 'remove-circle-outline', label: 'Subtract from selection' },
  { mode: 'intersect', icon: 'git-commit-outline', label: 'Intersect with selection' },
];

/** Next value in a list, wrapping around (for compact cycling buttons). */
function cycle<T>(list: readonly T[], value: T): T {
  const i = list.indexOf(value);
  return list[(i + 1) % list.length];
}

const SOURCES: readonly FillSettings['source'][] = ['canvas', 'layer', 'reference'];
const SOURCE_LABELS: Record<FillSettings['source'], string> = { canvas: 'All layers', layer: 'This layer', reference: 'Reference' };
const TOLERANCES = [0, 0.05, 0.15, 0.3, 0.5];
const EXPANDS = [0, 1, 2, 4];
const FEATHERS = [0, 4, 12, 32];

/** Paint bucket / magic wand options: which pixels define the area, how loosely, and growth. */
export function FillOptions({ fill, onChange }: { fill: FillSettings; onChange: (patch: Partial<FillSettings>) => void }) {
  return (
    <>
      <TextButton label={`Area: ${SOURCE_LABELS[fill.source]}`} onPress={() => onChange({ source: cycle(SOURCES, fill.source) })} />
      <TextButton
        label={`Tolerance ${Math.round(fill.tolerance * 100)}%`}
        onPress={() => onChange({ tolerance: cycle(TOLERANCES, TOLERANCES.reduce((a, b) => (Math.abs(b - fill.tolerance) < Math.abs(a - fill.tolerance) ? b : a))) })}
      />
      <TextButton label={`Grow ${fill.expand} px`} onPress={() => onChange({ expand: cycle(EXPANDS, fill.expand) })} />
      <IconButton
        icon={fill.contiguous ? 'git-network-outline' : 'globe-outline'}
        label={fill.contiguous ? 'Connected area only (tap for every matching pixel)' : 'Every matching pixel (tap for connected area only)'}
        active={!fill.contiguous}
        onPress={() => onChange({ contiguous: !fill.contiguous })}
      />
    </>
  );
}

export function SelectionBar(p: {
  shape: SelectShape;
  combine: SelectCombine;
  fill: FillSettings;
  feather: number;
  hasSelection: boolean;
  canPaste: boolean;
  onShape: (shape: SelectShape) => void;
  onCombine: (mode: SelectCombine) => void;
  onFill: (patch: Partial<FillSettings>) => void;
  onAll: () => void;
  onInvert: () => void;
  onLayerContent: () => void;
  onGrow: (px: number) => void;
  onFeather: (px: number) => void;
  onCrop: () => void;
  onClear: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDeselect: () => void;
  onDone: () => void;
}) {
  return (
    <ContextBar hint={SELECT_HINTS[p.shape]}>
      <IconButton icon="square-outline" label="Rectangle selection" active={p.shape === 'rect'} onPress={() => p.onShape('rect')} />
      <IconButton icon="ellipse-outline" label="Ellipse selection" active={p.shape === 'ellipse'} onPress={() => p.onShape('ellipse')} />
      <IconButton icon="color-wand-outline" label="Freehand (lasso) selection" active={p.shape === 'lasso'} onPress={() => p.onShape('lasso')} />
      <IconButton icon="sparkles-outline" label="Magic wand: select an area by colour" active={p.shape === 'wand'} onPress={() => p.onShape('wand')} />
      <Divider />
      {COMBINE.map((c) => (
        <IconButton key={c.mode} icon={c.icon} label={c.label} active={p.combine === c.mode} onPress={() => p.onCombine(c.mode)} />
      ))}
      {p.shape === 'wand' ? (
        <>
          <Divider />
          <FillOptions fill={p.fill} onChange={p.onFill} />
        </>
      ) : null}
      <Divider />
      <IconButton icon="expand-outline" label="Select all" onPress={p.onAll} />
      <IconButton icon="layers-outline" label="Select layer content (painted pixels)" onPress={p.onLayerContent} />
      <IconButton icon="contrast-outline" label="Invert selection" onPress={p.onInvert} disabled={!p.hasSelection} />
      <IconButton icon="add-outline" label="Grow selection by 4 px" onPress={() => p.onGrow(4)} disabled={!p.hasSelection} />
      <IconButton icon="remove-outline" label="Shrink selection by 4 px" onPress={() => p.onGrow(-4)} disabled={!p.hasSelection} />
      <TextButton label={p.feather > 0 ? `Feather ${p.feather} px` : 'Feather off'} onPress={() => p.onFeather(cycle(FEATHERS, p.feather))} />
      <IconButton icon="crop-outline" label="Crop canvas to selection" onPress={p.onCrop} disabled={!p.hasSelection} />
      <IconButton icon="close-circle-outline" label="Deselect" onPress={p.onDeselect} disabled={!p.hasSelection} />
      <IconButton icon="trash-outline" label="Clear selected pixels" onPress={p.onClear} disabled={!p.hasSelection} />
      <Divider />
      <IconButton icon="cut-outline" label="Cut (whole layer if nothing is selected)" onPress={p.onCut} />
      <IconButton icon="copy-outline" label="Copy (whole layer if nothing is selected)" onPress={p.onCopy} />
      <IconButton icon="clipboard-outline" label="Paste as new layer" onPress={p.onPaste} disabled={!p.canPaste} />
      <IconButton icon="duplicate-outline" label="Duplicate selection to a new layer" onPress={p.onDuplicate} />
      <TextButton label="Done" onPress={p.onDone} primary />
    </ContextBar>
  );
}

/** Paint bucket: tap an area to fill it with the current colour. */
export function FillBar(p: { fill: FillSettings; onChange: (patch: Partial<FillSettings>) => void; onDone: () => void }) {
  return (
    <ContextBar hint="Tap an area to fill it with the current colour · “Area” decides what borders it (line art on any layer with All layers)">
      <FillOptions fill={p.fill} onChange={p.onChange} />
      <TextButton label="Done" onPress={p.onDone} primary />
    </ContextBar>
  );
}

const CELLS = [6, 10, 16, 24, 36];
const ANGLES = [0, 45, 90, -45];

/** Gradient tool: drag on the canvas from where the colour starts to where it ends. */
export function GradientBar(p: { gradient: GradientSettings; onChange: (patch: Partial<GradientSettings>) => void; onDone: () => void }) {
  const g = p.gradient;
  return (
    <ContextBar
      hint={
        g.kind === 'tone'
          ? 'Drag from dense to light: halftone dots shrink along the drag (manga gradient)'
          : 'Drag from where the colour starts to where it ends'
      }>
      <IconButton icon="trending-up-outline" label="Linear gradient" active={g.kind === 'linear'} onPress={() => p.onChange({ kind: 'linear' })} />
      <IconButton icon="radio-button-on-outline" label="Radial gradient" active={g.kind === 'radial'} onPress={() => p.onChange({ kind: 'radial' })} />
      <IconButton icon="apps-outline" label="Screentone gradient (dots)" active={g.kind === 'tone'} onPress={() => p.onChange({ kind: 'tone' })} />
      <Divider />
      {g.kind === 'tone' ? (
        <>
          <TextButton label={`Dots ${g.cell} px`} onPress={() => p.onChange({ cell: cycle(CELLS, g.cell) })} />
          <TextButton label={`Angle ${g.angle}°`} onPress={() => p.onChange({ angle: cycle(ANGLES, g.angle) })} />
        </>
      ) : (
        <TextButton
          label={g.end === 'transparent' ? 'Colour → transparent' : 'Colour → previous colour'}
          onPress={() => p.onChange({ end: g.end === 'transparent' ? 'previous' : 'transparent' })}
        />
      )}
      <TextButton label="Done" onPress={p.onDone} primary />
    </ContextBar>
  );
}

const LIQUIFY_MODES: { mode: LiquifyMode; icon: React.ComponentProps<typeof IconButton>['icon']; label: string }[] = [
  { mode: 'push', icon: 'hand-left-outline', label: 'Push' },
  { mode: 'twirlRight', icon: 'refresh-outline', label: 'Twirl clockwise' },
  { mode: 'twirlLeft', icon: 'reload-outline', label: 'Twirl counter-clockwise' },
  { mode: 'pinch', icon: 'contract-outline', label: 'Pinch (shrink)' },
  { mode: 'expand', icon: 'expand-outline', label: 'Expand (bloat)' },
  { mode: 'restore', icon: 'bandage-outline', label: 'Restore' },
];
const LIQUIFY_SIZES = [40, 80, 140, 220];
const LIQUIFY_STRENGTHS = [0.3, 0.6, 0.9];

/** Liquify: push, twirl, pinch or expand the layer's pixels with a brush. */
export function LiquifyBar(p: {
  settings: LiquifySettings;
  onChange: (patch: Partial<LiquifySettings>) => void;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const s = p.settings;
  return (
    <ContextBar hint={`Liquify · ${LIQUIFY_MODES.find((m) => m.mode === s.mode)?.label ?? ''} · drag on the layer`}>
      {LIQUIFY_MODES.map((m) => (
        <IconButton key={m.mode} icon={m.icon} label={m.label} active={s.mode === m.mode} onPress={() => p.onChange({ mode: m.mode })} />
      ))}
      <Divider />
      <TextButton
        label={`Size ${Math.round(s.size)}`}
        onPress={() => p.onChange({ size: cycle(LIQUIFY_SIZES, LIQUIFY_SIZES.reduce((a, b) => (Math.abs(b - s.size) < Math.abs(a - s.size) ? b : a))) })}
      />
      <TextButton
        label={`Strength ${Math.round(s.strength * 100)}%`}
        onPress={() => p.onChange({ strength: cycle(LIQUIFY_STRENGTHS, LIQUIFY_STRENGTHS.reduce((a, b) => (Math.abs(b - s.strength) < Math.abs(a - s.strength) ? b : a))) })}
      />
      <IconButton icon="refresh" label="Reset liquify" onPress={p.onReset} />
      <Divider />
      <TextButton label="Cancel" onPress={p.onCancel} />
      <TextButton label="Apply" onPress={p.onApply} primary />
    </ContextBar>
  );
}

export function ShapeBar(p: {
  kind: ShapeKind;
  constrain: boolean;
  onKind: (kind: ShapeKind) => void;
  onConstrain: (constrain: boolean) => void;
  onDone: () => void;
}) {
  return (
    <ContextBar hint="Drag to draw with the current brush, colour, size and opacity">
      {SHAPES.map((s) => (
        <IconButton
          key={s.kind}
          icon={s.icon}
          label={p.constrain ? s.constrainedLabel : s.label}
          active={p.kind === s.kind}
          onPress={() => p.onKind(s.kind)}
        />
      ))}
      <Divider />
      <IconButton
        icon="magnet-outline"
        label={p.kind === 'line' || p.kind === 'arrow' ? 'Snap angle to 15° steps' : 'Keep proportions (square, circle, regular shape)'}
        active={p.constrain}
        onPress={() => p.onConstrain(!p.constrain)}
      />
      <TextButton label="Done" onPress={p.onDone} primary />
    </ContextBar>
  );
}

/** Short-lived message over the canvas (e.g. what a gesture shortcut just undid). */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.toastWrap} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={styles.toast}>{message}</Text>
    </View>
  );
}

/**
 * Persistent reminder that the *view* is mirrored — the artwork is not. Tapping it unflips.
 * Sits bottom-left so it never covers the contextual bars.
 */
export function ViewFlippedBadge({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.flipBadge, { bottom }]}
      accessibilityRole="button"
      accessibilityLabel="View is flipped for checking only; the artwork is unchanged. Tap to unflip.">
      <Ionicons name="swap-horizontal-outline" size={14} color={colors.accent} />
      <Text style={styles.flipBadgeText}>View flipped · artwork unchanged</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.panel,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titleBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.sm },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  saveStatus: { color: colors.textDim, fontSize: 11 },
  saveStatusError: { color: colors.danger, fontWeight: '600' },
  contextWrap: { position: 'absolute', top: spacing.sm, left: 0, right: 0, alignItems: 'center', gap: spacing.xs },
  contextBar: {
    maxWidth: '96%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.lg,
    backgroundColor: colors.floating,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  contextDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.border, marginHorizontal: 2 },
  contextHint: {
    color: colors.text,
    fontSize: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
    overflow: 'hidden',
    maxWidth: '92%',
    textAlign: 'center',
  },
  toastWrap: { position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' },
  toast: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
    overflow: 'hidden',
  },
  flipBadge: {
    position: 'absolute',
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  flipBadgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  textButton: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill },
  textButtonPrimary: { backgroundColor: colors.accent },
  textButtonLabel: { color: colors.text, fontWeight: '600' },
  textButtonLabelPrimary: { color: colors.onAccent, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  hidden: { display: 'none' },
}));
