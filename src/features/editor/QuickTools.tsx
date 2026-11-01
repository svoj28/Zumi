import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useBrushStore, useToolBrush, useTypedSizeMax } from '@/state/brushStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useToolStore } from '@/state/toolStore';
import { COMPACT_TARGET, IconButton } from '@/ui/IconButton';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';
import { PERCENT_ENTRY, SIZE_ENTRY } from '@/ui/valueEntry';
import { VerticalSlider } from '@/ui/VerticalSlider';

export type EditorPanel = 'brush' | 'color' | 'layers' | 'guides' | 'symmetry' | 'settings';

interface ToolProps {
  panel: EditorPanel | null;
  onTogglePanel: (panel: EditorPanel) => void;
}

/** Brush / eraser / eyedropper buttons. Tapping the active tool opens its settings. */
function useToolActions({ onTogglePanel }: ToolProps) {
  const tool = useToolStore((s) => s.tool);
  const interaction = useToolStore((s) => s.interaction);
  const setTool = useToolStore((s) => s.setTool);
  const setInteraction = useToolStore((s) => s.setInteraction);
  const painting = interaction === 'paint';

  return {
    brushActive: painting && tool === 'brush',
    eraserActive: painting && tool === 'eraser',
    eyedropperActive: interaction === 'eyedropper',
    shapeActive: interaction === 'shape',
    toggleShape: () => setInteraction(interaction === 'shape' ? 'paint' : 'shape'),
    selectBrush: () => (painting && tool === 'brush' ? onTogglePanel('brush') : setTool('brush')),
    selectEraser: () => (painting && tool === 'eraser' ? onTogglePanel('brush') : setTool('eraser')),
    toggleEyedropper: () => setInteraction(interaction === 'eyedropper' ? 'paint' : 'eyedropper'),
  };
}

function ColorButton({ onPress, active }: { onPress: () => void; active: boolean }) {
  const color = useToolStore((s) => s.color);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.colorButton, active && styles.colorButtonActive]}
      accessibilityRole="button"
      accessibilityLabel={`Colour ${color}`}
      accessibilityState={{ selected: active }}>
      <View style={[styles.colorDot, { backgroundColor: color }]} />
    </Pressable>
  );
}

function SizeOpacitySliders({ length, bubbleSide }: { length: number; bubbleSide: 'left' | 'right' }) {
  const tool = useToolStore((s) => s.tool);
  const brush = useToolBrush(tool);
  const typedMax = useTypedSizeMax(brush);
  const setSize = useBrushStore((s) => s.setSize);
  const setOpacity = useBrushStore((s) => s.setOpacity);
  return (
    <>
      <VerticalSlider
        label={`${brush.name} · Size`}
        value={brush.size}
        min={brush.minSize}
        max={brush.maxSize}
        curve="quadratic"
        length={length}
        bubbleSide={bubbleSide}
        format={(v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} px`}
        entry={{ ...SIZE_ENTRY, max: typedMax }}
        onChange={(size) => setSize(tool, size)}
      />
      <VerticalSlider
        label="Opacity"
        value={brush.opacity}
        min={0.01}
        max={1}
        length={length}
        bubbleSide={bubbleSide}
        format={(v) => `${Math.round(v * 100)}%`}
        entry={PERCENT_ENTRY}
        onChange={(opacity) => setOpacity(tool, opacity)}
      />
    </>
  );
}

/** Tablet: floating vertical rail with tools and inline size/opacity sliders. */
export function ToolRail({ side, sliderLength = 130, ...props }: ToolProps & { side: 'left' | 'right'; sliderLength?: number }) {
  const a = useToolActions(props);
  return (
    <View style={[styles.rail, side === 'left' ? styles.railLeft : styles.railRight]}>
      <IconButton icon="brush" label="Brush" active={a.brushActive} onPress={a.selectBrush} />
      <IconButton icon="remove-circle-outline" label="Eraser" active={a.eraserActive} onPress={a.selectEraser} />
      <IconButton icon="eyedrop-outline" label="Eyedropper" active={a.eyedropperActive} onPress={a.toggleEyedropper} />
      <IconButton icon="shapes-outline" label="Shapes: line, rectangle, ellipse" active={a.shapeActive} onPress={a.toggleShape} />
      <View style={styles.divider} />
      <SizeOpacitySliders length={sliderLength} bubbleSide={side === 'left' ? 'right' : 'left'} />
      <View style={styles.divider} />
      <ColorButton active={props.panel === 'color'} onPress={() => props.onTogglePanel('color')} />
      <IconButton icon="layers-outline" label="Layers" active={props.panel === 'layers'} onPress={() => props.onTogglePanel('layers')} />
    </View>
  );
}

/** A tool in the toolbar's extra row (shown with the arrow button). */
export interface ExtraTool {
  icon: React.ComponentProps<typeof IconButton>['icon'];
  label: string;
  active?: boolean;
  onPress: () => void;
}

/**
 * Phone: compact floating toolbar at the bottom of the canvas. The arrow at its end shows or
 * hides a second row with more tools, so the everyday bar stays small.
 */
export function PhoneToolbar({ bottomInset, extras = [], ...props }: ToolProps & { bottomInset: number; extras?: readonly ExtraTool[] }) {
  const a = useToolActions(props);
  const [expanded, setExpanded] = useState(false);
  const compact = useSettingsStore((s) => s.compactUi);
  // A horizontal ScrollView grows to fill the height it is offered: pin the row to one button.
  const rowHeight = (compact ? COMPACT_TARGET : TOUCH_TARGET) + spacing.xs * 2;
  return (
    <View style={[styles.phoneDock, { bottom: bottomInset + spacing.sm }]} pointerEvents="box-none">
      {expanded && extras.length > 0 ? (
        <View style={styles.extraBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.extraScroll, { height: rowHeight }]}
            contentContainerStyle={styles.extraRow}>
            {extras.map((t) => (
              <IconButton key={t.label} icon={t.icon} label={t.label} active={t.active} onPress={t.onPress} />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.phoneBar}>
        <IconButton icon="brush" label="Brush" active={a.brushActive} onPress={a.selectBrush} />
        <IconButton icon="remove-circle-outline" label="Eraser" active={a.eraserActive} onPress={a.selectEraser} />
        <IconButton icon="eyedrop-outline" label="Eyedropper" active={a.eyedropperActive} onPress={a.toggleEyedropper} />
        <IconButton icon="shapes-outline" label="Shapes" active={a.shapeActive} onPress={a.toggleShape} />
        <ColorButton active={props.panel === 'color'} onPress={() => props.onTogglePanel('color')} />
        <IconButton icon="layers-outline" label="Layers" active={props.panel === 'layers'} onPress={() => props.onTogglePanel('layers')} />
        {extras.length > 0 ? (
          <IconButton
            icon={expanded ? 'chevron-down' : 'chevron-up'}
            label={expanded ? 'Hide more tools' : 'Show more tools'}
            // While hidden, the arrow lights up if one of the hidden tools is in use.
            active={!expanded && extras.some((t) => t.active)}
            onPress={() => setExpanded((e) => !e)}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Phone: slim size/opacity sliders floating at the screen edge, reachable with a thumb. */
export function PhoneSideSliders({ side }: { side: 'left' | 'right' }) {
  return (
    <View style={[styles.sideSliders, side === 'left' ? styles.railLeft : styles.railRight]} pointerEvents="box-none">
      <SizeOpacitySliders length={110} bubbleSide={side === 'left' ? 'right' : 'left'} />
    </View>
  );
}

const floating = () => ({
  backgroundColor: colors.floating,
  borderColor: colors.border,
  borderWidth: StyleSheet.hairlineWidth,
  shadowColor: '#000',
  shadowOpacity: 0.3,
  shadowRadius: 10,
  elevation: 6,
}) as const;

const styles = themed(() => StyleSheet.create({
  rail: {
    ...floating(),
    position: 'absolute',
    top: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.lg,
  },
  railLeft: { left: spacing.sm },
  railRight: { right: spacing.sm },
  divider: { width: 28, height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  // The dock holds the optional extra row above the main bar; both are centred.
  phoneDock: { position: 'absolute', left: spacing.sm, right: spacing.sm, alignItems: 'center', gap: spacing.xs },
  extraBar: {
    ...floating(),
    maxWidth: '100%',
    flexGrow: 0,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  extraScroll: { flexGrow: 0, flexShrink: 0 },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  phoneBar: {
    ...floating(),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  sideSliders: {
    ...floating(),
    position: 'absolute',
    zIndex: 0,
    elevation: 0,
    top: '28%',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
  },
  colorButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  colorButtonActive: { backgroundColor: colors.accentDim },
  colorDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.text },
}));
