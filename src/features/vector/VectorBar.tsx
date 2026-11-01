import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ContextBar, Divider, TextButton } from '@/features/editor/WorkspaceChrome';
import type { useVectorTool } from '@/features/vector/useVectorTool';
import { IconButton } from '@/ui/IconButton';
import { colors, radius, spacing, themed } from '@/ui/theme';

/** Stroke widths cycled by the width button (canvas pixels). */
const WIDTHS = [2, 4, 6, 10, 16, 24, 40];

type Tool = ReturnType<typeof useVectorTool>;

/** Context bar of the vector pen tool. */
export function VectorBar({ tool, onNewLayer, onConvert, onDone }: { tool: Tool; onNewLayer: () => void; onConvert: () => void; onDone: () => void }) {
  if (!tool.isVectorLayer) {
    return (
      <ContextBar hint="The pen draws on vector layers. Add one, or convert this layer (its pixels can be traced into shapes).">
        <TextButton label="New vector layer" onPress={onNewLayer} />
        <TextButton label="Convert layer…" onPress={onConvert} />
        <TextButton label="Done" onPress={onDone} primary />
      </ContextBar>
    );
  }
  const nextWidth = () => WIDTHS[(WIDTHS.indexOf(tool.strokeWidth) + 1) % WIDTHS.length] ?? WIDTHS[0];
  const { actions, selected } = tool;
  const hint =
    tool.mode === 'pen'
      ? tool.hasDraft
        ? 'Tap to add points · drag for curves · tap the first point to close'
        : 'Pen: tap to place points, drag to make curves · fill and stroke use the current colour'
      : selected
        ? 'Drag points or handles to reshape · drag the shape to move it'
        : 'Tap a shape to select it';

  return (
    <ContextBar hint={hint}>
      <IconButton icon="create-outline" label="Pen (draw shapes)" active={tool.mode === 'pen'} onPress={() => tool.setMode('pen')} />
      <IconButton icon="hand-left-outline" label="Edit (select and reshape)" active={tool.mode === 'edit'} onPress={() => tool.setMode('edit')} />
      <Divider />
      {tool.mode === 'pen' ? (
        <>
          <IconButton icon="color-fill-outline" label="Fill closed shapes" active={tool.fillOn} onPress={() => tool.setFillOn(!tool.fillOn)} />
          <IconButton icon="brush-outline" label="Stroke (outline) shapes" active={tool.strokeOn} onPress={() => tool.setStrokeOn(!tool.strokeOn)} />
          <WidthButton width={tool.strokeWidth} onPress={() => actions.setShapeStrokeWidth(nextWidth())} />
          {tool.hasDraft ? (
            <>
              <Divider />
              <IconButton icon="close-circle-outline" label="Cancel this shape" onPress={actions.cancelPath} />
              <IconButton icon="radio-button-off-outline" label="Close the shape" onPress={actions.closePath} />
              <IconButton icon="checkmark-done-outline" label="Finish as an open line" onPress={actions.finishPath} />
            </>
          ) : null}
        </>
      ) : selected ? (
        <>
          <IconButton icon="color-fill-outline" label="Fill with current colour" onPress={actions.fillWithColor} />
          <IconButton icon="brush-outline" label="Outline with current colour" onPress={actions.strokeWithColor} />
          <IconButton icon="square-outline" label="No fill" disabled={!selected.fill} onPress={actions.removeFill} />
          <IconButton icon="remove-circle-outline" label="No outline" disabled={!selected.stroke} onPress={actions.removeStroke} />
          <WidthButton width={selected.stroke ? selected.strokeWidth : tool.strokeWidth} onPress={() => actions.setShapeStrokeWidth(nextWidth())} />
          <Divider />
          <IconButton
            icon="git-merge-outline"
            label="Make the selected point smooth / corner"
            disabled={tool.selectedNode === null}
            onPress={actions.toggleNodeSmooth}
          />
          <IconButton icon="backspace-outline" label="Delete the selected point" disabled={tool.selectedNode === null} onPress={actions.deleteNode} />
          <Divider />
          <IconButton icon="arrow-up-circle-outline" label="Bring forward" onPress={() => actions.reorder('up')} />
          <IconButton icon="arrow-down-circle-outline" label="Send backward" onPress={() => actions.reorder('down')} />
          <IconButton icon="copy-outline" label="Duplicate shape" onPress={actions.duplicateShape} />
          <IconButton icon="trash-outline" label="Delete shape" onPress={actions.deleteShape} />
        </>
      ) : null}
      <TextButton label="Done" onPress={onDone} primary />
    </ContextBar>
  );
}

function WidthButton({ width, onPress }: { width: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.width} accessibilityRole="button" accessibilityLabel={`Outline width ${width} pixels. Tap to change.`}>
      <Text style={styles.widthText}>{Math.round(width)} px</Text>
    </Pressable>
  );
}

/** Shown while a pixel tool is chosen on a vector layer: switch to the pen. */
export function VectorLayerHint({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.hint}
      accessibilityRole="button"
      accessibilityLabel="Vector layer: brushes paint on pixel layers. Tap to use the vector pen.">
      <Ionicons name="create-outline" size={15} color={colors.text} />
      <Text style={styles.hintText} numberOfLines={2}>
        Vector layer · tap to use the pen
      </Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  width: { minWidth: 48, height: 32, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.panelRaised },
  widthText: { color: colors.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Top centre of the canvas: the bottom is taken by the toolbar on phones, and the top corners
  // by the reference / pose-figure buttons.
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    top: spacing.sm,
    maxWidth: '72%',
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
  hintText: { color: colors.text, fontSize: 12, fontWeight: '600' },
}));
