import { Ionicons } from '@expo/vector-icons';
import { Canvas, Image, ImageShader, Rect } from '@shopify/react-native-skia';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DrawingDocument, EditResult } from '@/engine/document/DrawingDocument';
import type { LayerPropsPatch } from '@/engine/history/commands';
import { stackItems } from '@/engine/layers/layerGroups';
import type { RasterLayer } from '@/engine/layers/RasterLayer';
import type { LayerGroupMeta } from '@/engine/types';
import { blendModeLabel } from '@/engine/render/blendModes';
import { getCheckerTile } from '@/engine/render/checker';
import { BlendModePicker } from '@/features/editor/BlendModePicker';
import { useDocumentVersion } from '@/features/editor/useEditorSession';
import { useToolStore } from '@/state/toolStore';
import { ActionSheet, type ActionSheetOption } from '@/ui/ActionSheet';
import { IconButton } from '@/ui/IconButton';
import { PromptDialog } from '@/ui/PromptDialog';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed } from '@/ui/theme';

const THUMB = 44;

/** Shows why an edit was refused; successful edits speak for themselves on the canvas. */
function report<T>(title: string, result: EditResult<T>): void {
  if (!result.ok) Alert.alert(title, result.reason);
}

/**
 * Layer manager. The active layer (the one brushes paint on) is marked with an accent bar and
 * highlight; its properties and actions sit below the list. "Select" mode picks several layers
 * for merging. Every change goes through the document, so all of it is undoable.
 */
export function LayersPanel({
  doc,
  onPaste,
  onVectorize,
  onTransform,
}: {
  doc: DrawingDocument;
  onPaste: () => void;
  /** Opens "Convert to vector" (trace) for the active layer. */
  onVectorize?: () => void;
  /** Starts transform mode (move, resize, rotate, distort, warp) on the active layer. */
  onTransform?: () => void;
}) {
  useDocumentVersion(doc);
  const color = useToolStore((s) => s.color);
  const setColor = useToolStore((s) => s.setColor);
  const active = doc.layers.active;
  const opacityBefore = useRef<LayerPropsPatch | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blendOpen, setBlendOpen] = useState(false);
  const [renaming, setRenaming] = useState<RasterLayer | null>(null);
  // A layer group (folder) whose properties are shown instead of the active layer's.
  const [groupFocus, setGroupFocus] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<LayerGroupMeta | null>(null);
  const [groupBlendOpen, setGroupBlendOpen] = useState(false);
  const groupOpacityBefore = useRef(1);
  const focusedGroup = groupFocus ? (doc.groups.get(groupFocus) ?? null) : null;

  // Display top first, as painters expect: folders as header rows with their layers beneath.
  type Row = { kind: 'group'; group: LayerGroupMeta; count: number } | { kind: 'layer'; layer: RasterLayer; inGroup: boolean };
  const rows: Row[] = [];
  for (const item of [...stackItems(doc.layers.list, doc.groups)].reverse()) {
    if (item.kind === 'folder') {
      rows.push({ kind: 'group', group: item.group, count: item.layers.length });
      if (!item.group.collapsed) for (const layer of [...item.layers].reverse()) rows.push({ kind: 'layer', layer, inGroup: true });
    } else {
      for (const layer of [...item.layers].reverse()) rows.push({ kind: 'layer', layer, inGroup: false });
    }
  }
  const activeIndex = active ? doc.layers.indexOf(active.meta.id) : -1;
  // Undo can remove picked layers; only count the ones that still exist.
  const pickedIds = picked.filter((id) => doc.layers.get(id));

  const addLayer = () => {
    if (!doc.addLayer()) {
      Alert.alert('Layer limit reached', `This canvas size supports up to ${doc.maxLayers} layers on this device.`);
    }
  };

  const startSelecting = () => {
    setPicked(active ? [active.meta.id] : []);
    setSelecting(true);
  };

  const togglePicked = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const mergePicked = () => {
    const result = doc.mergeLayers(pickedIds);
    report('Can’t merge', result);
    if (result.ok) setSelecting(false);
  };

  const groupPicked = () => {
    const result = doc.groupLayers(pickedIds);
    report('Can’t group', result);
    if (result.ok) {
      setSelecting(false);
      setGroupFocus(result.value);
    }
  };

  const flatten = () =>
    Alert.alert(
      'Flatten artwork?',
      'All visible layers become one layer and hidden layers are removed. You can undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Flatten', style: 'destructive', onPress: () => report('Can’t flatten', doc.flatten()) },
      ],
    );

  const isMask = !!active?.meta.mask;
  const toggleClip = () => active && report('Can’t clip', doc.setClipping(active.meta.id, !active.meta.clip));
  const addMask = () => active && report('Can’t add a mask', doc.addMask(active.meta.id));
  const fill = () => active && report('Can’t fill', doc.fillLayer(active.meta.id, color));

  const menuOptions: ActionSheetOption[] = active
    ? [
        { label: 'Rename…', icon: 'pencil-outline', onPress: () => setRenaming(active) },
        {
          label: 'Reference layer (bucket & wand use its lines)',
          icon: 'git-network-outline',
          selected: !!active.meta.reference,
          onPress: () => doc.setLayerProps(active.meta.id, { reference: !active.meta.reference }),
        },
        { label: 'Select layer content', icon: 'scan-outline', onPress: () => report('Nothing selected', doc.selectLayerContent(active.meta.id)) },
        {
          label: active.meta.groupId ? 'Group: move into a new group' : 'Put in a new group',
          icon: 'folder-outline',
          onPress: () => {
            const result = doc.groupLayers([active.meta.id]);
            report('Can’t group', result);
            if (result.ok) setGroupFocus(result.value);
          },
        },
        ...(onTransform
          ? [{ label: 'Transform (move, resize, rotate, warp)', icon: 'move-outline' as const, onPress: onTransform }]
          : []),
        ...(isMask
          ? [
              { label: 'Invert mask', icon: 'contrast-outline' as const, onPress: () => report('Can’t invert', doc.invertMask(active.meta.id)) },
              { label: 'Apply mask (erase hidden parts)', icon: 'checkmark-done-outline' as const, onPress: () => report('Can’t apply the mask', doc.applyMask(active.meta.id)) },
            ]
          : [
              { label: 'Clipping mask (clip to layer below)', icon: 'return-down-forward-outline' as const, selected: !!active.meta.clip, onPress: toggleClip },
              { label: doc.selection ? 'Add mask from selection' : 'Add layer mask', icon: 'eye-off-outline' as const, onPress: addMask },
              { label: doc.selection ? 'Fill selection with colour' : 'Fill layer with colour', icon: 'color-fill-outline' as const, onPress: fill },
            ]),
        active.vector
          ? { label: 'Rasterize layer (vector → pixels)', icon: 'grid-outline', onPress: () => report('Can’t rasterize', doc.rasterizeLayer(active.meta.id)) }
          : { label: 'Convert to vector layer…', icon: 'shapes-outline', onPress: () => onVectorize?.() },
        { label: 'New vector layer', icon: 'create-outline', onPress: () => report('Can’t add a layer', doc.addVectorLayer()) },
        { label: 'Duplicate', icon: 'duplicate-outline', onPress: () => report('Can’t duplicate', doc.duplicateLayer(active.meta.id)) },
        { label: 'Merge down', icon: 'git-merge-outline', onPress: () => report('Can’t merge', doc.mergeDown(active.meta.id)) },
        { label: 'Merge layers…', icon: 'checkbox-outline', onPress: startSelecting },
        { label: 'Flatten artwork', icon: 'layers-outline', onPress: flatten },
        // Named "layer" on purpose: this changes pixels, unlike "Flip view" in the top bar.
        {
          label: doc.selection ? 'Flip selection horizontally' : 'Flip layer horizontally',
          icon: 'swap-horizontal',
          onPress: () => report('Can’t flip', doc.flipContent('x')),
        },
        {
          label: doc.selection ? 'Flip selection vertically' : 'Flip layer vertically',
          icon: 'swap-vertical-outline',
          onPress: () => report('Can’t flip', doc.flipContent('y')),
        },
        ...(doc.canPaste ? [{ label: 'Paste as new layer', icon: 'clipboard-outline' as const, onPress: onPaste }] : []),
        {
          label: 'Alpha lock',
          icon: 'invert-mode-outline',
          selected: active.meta.alphaLocked,
          onPress: () => doc.setLayerProps(active.meta.id, { alphaLocked: !active.meta.alphaLocked }),
        },
        {
          label: 'Lock',
          icon: 'lock-closed',
          selected: active.meta.locked,
          onPress: () => doc.setLayerProps(active.meta.id, { locked: !active.meta.locked }),
        },
        { label: 'Clear layer', icon: 'backspace-outline', onPress: () => report('Can’t clear', doc.clearLayer(active.meta.id)) },
        ...(doc.layers.count > 1
          ? [{ label: 'Delete layer', icon: 'trash-outline' as const, destructive: true, onPress: () => doc.removeLayer(active.meta.id) }]
          : []),
      ]
    : [];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.heading}>
          Layers <Text style={styles.count}>{doc.layers.count}/{doc.maxLayers}</Text>
        </Text>
        <View style={styles.headerActions}>
          <IconButton icon="add" label="Add layer" onPress={addLayer} disabled={selecting} />
          <IconButton
            icon="checkbox-outline"
            label={selecting ? 'Stop selecting layers' : 'Select layers to merge'}
            active={selecting}
            onPress={() => (selecting ? setSelecting(false) : startSelecting())}
          />
          <IconButton icon="ellipsis-horizontal" label="Layer actions" onPress={() => setMenuOpen(true)} disabled={selecting || !active} />
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {rows.map((row) =>
          row.kind === 'group' ? (
            <GroupRow
              key={row.group.id}
              group={row.group}
              count={row.count}
              focused={row.group.id === groupFocus}
              onPress={() => !selecting && setGroupFocus(row.group.id === groupFocus ? null : row.group.id)}
              onLongPress={() => !selecting && setRenamingGroup(row.group)}
              onToggleCollapsed={() => doc.setGroupProps(row.group.id, { collapsed: !row.group.collapsed })}
              onToggleVisible={() => doc.setGroupProps(row.group.id, { visible: !row.group.visible })}
            />
          ) : (
            <LayerRow
              key={row.layer.meta.id}
              layer={row.layer}
              doc={doc}
              indent={row.inGroup}
              active={row.layer.meta.id === active?.meta.id && !groupFocus}
              picking={selecting}
              picked={pickedIds.includes(row.layer.meta.id)}
              onPress={() => {
                if (selecting) {
                  togglePicked(row.layer.meta.id);
                  return;
                }
                setGroupFocus(null);
                doc.setActiveLayer(row.layer.meta.id);
              }}
              onLongPress={() => !selecting && setRenaming(row.layer)}
            />
          ),
        )}
      </ScrollView>

      {selecting ? (
        <View style={styles.footer}>
          <Text style={styles.pickHint}>
            {pickedIds.length === 0 ? 'Tap layers to merge or group them' : `${pickedIds.length} ${pickedIds.length === 1 ? 'layer' : 'layers'} selected`}
          </Text>
          <View style={styles.footerRow}>
            <Pressable style={styles.textButton} onPress={() => setSelecting(false)} accessibilityRole="button">
              <Text style={styles.textButtonLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.textButton, styles.secondary, pickedIds.length < 1 && styles.disabled]}
              disabled={pickedIds.length < 1}
              onPress={groupPicked}
              accessibilityRole="button"
              accessibilityState={{ disabled: pickedIds.length < 1 }}>
              <Text style={styles.textButtonLabel}>Group</Text>
            </Pressable>
            <Pressable
              style={[styles.textButton, styles.primary, pickedIds.length < 2 && styles.disabled]}
              disabled={pickedIds.length < 2}
              onPress={mergePicked}
              accessibilityRole="button"
              accessibilityState={{ disabled: pickedIds.length < 2 }}>
              <Text style={styles.primaryLabel}>Merge</Text>
            </Pressable>
          </View>
        </View>
      ) : focusedGroup ? (
        <View style={styles.footer}>
          <Text style={styles.maskHint} numberOfLines={1}>
            Group: {focusedGroup.name}
          </Text>
          <View style={styles.featureRow}>
            <FeatureButton icon="pencil-outline" label="Rename" onPress={() => setRenamingGroup(focusedGroup)} />
            <FeatureButton
              icon="folder-open-outline"
              label="Ungroup"
              onPress={() => {
                report('Can’t ungroup', doc.ungroup(focusedGroup.id));
                setGroupFocus(null);
              }}
            />
            <FeatureButton
              icon="git-merge-outline"
              label="Merge"
              onPress={() => {
                const result = doc.mergeGroup(focusedGroup.id);
                report('Can’t merge', result);
                if (result.ok) setGroupFocus(null);
              }}
            />
            <FeatureButton
              icon="trash-outline"
              label="Delete"
              onPress={() =>
                Alert.alert(`Delete “${focusedGroup.name}”?`, 'The group and all its layers are removed. You can undo this.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      report('Can’t delete', doc.deleteGroup(focusedGroup.id));
                      setGroupFocus(null);
                    },
                  },
                ])
              }
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.blendButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Group blend mode ${blendModeLabel(focusedGroup.blendMode)}`}
            onPress={() => setGroupBlendOpen(true)}>
            <Text style={styles.blendLabel}>Blend</Text>
            <View style={styles.blendValueRow}>
              <Text style={styles.blendValue}>{blendModeLabel(focusedGroup.blendMode)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </View>
          </Pressable>
          <Slider
            label="Group opacity"
            value={focusedGroup.opacity}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChangeStart={() => {
              groupOpacityBefore.current = focusedGroup.opacity;
            }}
            onChange={(opacity) => doc.setGroupProps(focusedGroup.id, { opacity }, { transient: true })}
            onChangeEnd={() => doc.commitGroupOpacity(focusedGroup.id, groupOpacityBefore.current)}
          />
        </View>
      ) : active ? (
        <View style={styles.footer}>
          {isMask ? (
            <View style={styles.maskBox}>
              <Text style={styles.maskHint}>Editing mask: paint black to hide, white to show again.</Text>
              <View style={styles.featureRow}>
                <FeatureButton icon="ellipse" label="Hide (black)" active={color.toLowerCase() === '#000000'} onPress={() => setColor('#000000')} />
                <FeatureButton icon="ellipse-outline" label="Show (white)" active={color.toLowerCase() === '#ffffff'} onPress={() => setColor('#ffffff')} />
                <FeatureButton icon="contrast-outline" label="Invert" onPress={() => report('Can’t invert', doc.invertMask(active.meta.id))} />
              </View>
            </View>
          ) : (
            <View style={styles.featureRow}>
              <FeatureButton
                icon="return-down-forward-outline"
                label="Clip"
                active={!!active.meta.clip}
                disabled={activeIndex <= 0}
                onPress={toggleClip}
              />
              <FeatureButton icon="eye-off-outline" label="Mask" onPress={addMask} />
              {onTransform ? <FeatureButton icon="move-outline" label="Transform" onPress={onTransform} /> : null}
              <FeatureButton icon="color-fill-outline" label="Fill" onPress={fill} />
            </View>
          )}
          <View style={styles.actions}>
            <IconButton
              icon="duplicate-outline"
              label="Duplicate layer"
              size={20}
              onPress={() => report('Can’t duplicate', doc.duplicateLayer(active.meta.id))}
            />
            <IconButton
              icon="git-merge-outline"
              label="Merge down"
              size={20}
              disabled={activeIndex <= 0}
              onPress={() => report('Can’t merge', doc.mergeDown(active.meta.id))}
            />
            <IconButton
              icon="backspace-outline"
              label="Clear layer"
              size={20}
              onPress={() => report('Can’t clear', doc.clearLayer(active.meta.id))}
            />
            <IconButton
              icon="invert-mode-outline"
              label={active.meta.alphaLocked ? 'Turn off alpha lock' : 'Alpha lock: paint only where there are pixels'}
              size={20}
              active={active.meta.alphaLocked}
              onPress={() => doc.setLayerProps(active.meta.id, { alphaLocked: !active.meta.alphaLocked })}
            />
            <IconButton
              icon="arrow-up"
              label="Move layer up"
              size={20}
              onPress={() => doc.moveLayer(active.meta.id, activeIndex + 1)}
              disabled={activeIndex >= doc.layers.count - 1}
            />
            <IconButton
              icon="arrow-down"
              label="Move layer down"
              size={20}
              onPress={() => doc.moveLayer(active.meta.id, activeIndex - 1)}
              disabled={activeIndex <= 0}
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.blendButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Blend mode ${blendModeLabel(active.meta.blendMode)}. Opens all blend modes.`}
            onPress={() => setBlendOpen(true)}>
            <Text style={styles.blendLabel}>Blend</Text>
            <View style={styles.blendValueRow}>
              <Text style={styles.blendValue}>{blendModeLabel(active.meta.blendMode)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </View>
          </Pressable>
          <Slider
            label="Layer opacity"
            value={active.meta.opacity}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChangeStart={() => {
              opacityBefore.current = { opacity: active.meta.opacity };
            }}
            onChange={(opacity) => doc.setLayerProps(active.meta.id, { opacity }, { transient: true })}
            onChangeEnd={(opacity) =>
              doc.setLayerProps(active.meta.id, { opacity }, { before: opacityBefore.current ?? undefined })
            }
          />
        </View>
      ) : null}

      {active ? (
        <BlendModePicker
          visible={blendOpen}
          layerName={active.meta.name}
          value={active.meta.blendMode}
          onChange={(blendMode) => doc.setLayerProps(active.meta.id, { blendMode })}
          onClose={() => setBlendOpen(false)}
        />
      ) : null}

      {focusedGroup ? (
        <BlendModePicker
          visible={groupBlendOpen}
          layerName={focusedGroup.name}
          value={focusedGroup.blendMode}
          onChange={(blendMode) => doc.setGroupProps(focusedGroup.id, { blendMode })}
          onClose={() => setGroupBlendOpen(false)}
        />
      ) : null}
      <PromptDialog
        visible={renamingGroup !== null}
        title="Rename group"
        initialValue={renamingGroup?.name}
        confirmLabel="Rename"
        maxLength={60}
        onSubmit={(name) => {
          if (renamingGroup && name.trim()) doc.setGroupProps(renamingGroup.id, { name: name.trim() });
          setRenamingGroup(null);
        }}
        onCancel={() => setRenamingGroup(null)}
      />
      <ActionSheet
        visible={menuOpen}
        title={active?.meta.name}
        options={menuOptions}
        onClose={() => setMenuOpen(false)}
      />
      <PromptDialog
        visible={renaming !== null}
        title="Rename layer"
        initialValue={renaming?.meta.name}
        confirmLabel="Rename"
        maxLength={60}
        onSubmit={(name) => {
          if (renaming) doc.renameLayer(renaming.meta.id, name);
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
      />
    </View>
  );
}

/** Labelled shortcut for the most used layer features. */
function FeatureButton({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [styles.feature, active && styles.featureOn, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.text} />
      <Text style={[styles.featureLabel, active && styles.featureLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A layer group (folder) header: fold, show/hide, tap for its properties. */
function GroupRow({
  group,
  count,
  focused,
  onPress,
  onLongPress,
  onToggleCollapsed,
  onToggleVisible,
}: {
  group: LayerGroupMeta;
  count: number;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onToggleCollapsed: () => void;
  onToggleVisible: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, styles.groupRow, focused && styles.rowActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: focused, expanded: !group.collapsed }}
      accessibilityLabel={`Group ${group.name}, ${count} layers`}
      accessibilityHint="Shows the group's properties. Long press to rename.">
      <View style={[styles.activeBar, focused && styles.activeBarOn]} />
      <IconButton
        icon={group.collapsed ? 'chevron-forward' : 'chevron-down'}
        label={group.collapsed ? `Show layers of ${group.name}` : `Fold ${group.name}`}
        size={18}
        onPress={onToggleCollapsed}
      />
      <Ionicons name={group.collapsed ? 'folder-outline' : 'folder-open-outline'} size={22} color={colors.accent} />
      <View style={styles.rowText}>
        <Text style={[styles.rowName, !group.visible && styles.dim]} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[`${count} ${count === 1 ? 'layer' : 'layers'}`, group.blendMode !== 'srcOver' ? blendModeLabel(group.blendMode) : null, `${Math.round(group.opacity * 100)}%`]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <IconButton
        icon={group.visible ? 'eye-outline' : 'eye-off-outline'}
        label={group.visible ? `Hide ${group.name}` : `Show ${group.name}`}
        size={18}
        tint={group.visible ? colors.text : colors.textDim}
        onPress={onToggleVisible}
      />
    </Pressable>
  );
}

function LayerRow({
  layer,
  doc,
  indent = false,
  active,
  picking,
  picked,
  onPress,
  onLongPress,
}: {
  layer: RasterLayer;
  doc: DrawingDocument;
  /** Inside a group: shown indented under its header. */
  indent?: boolean;
  active: boolean;
  picking: boolean;
  picked: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { id, name, visible, locked, alphaLocked, opacity, blendMode, clip, mask, reference } = layer.meta;
  const aspect = layer.width / layer.height;
  const w = aspect >= 1 ? THUMB : THUMB * aspect;
  const h = aspect >= 1 ? THUMB / aspect : THUMB;
  const details = [blendMode !== 'srcOver' ? blendModeLabel(blendMode) : null, `${Math.round(opacity * 100)}%`]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}${active ? ', active layer' : ''}${picking ? (picked ? ', selected for merge' : ', not selected') : ''}`}
      accessibilityHint={picking ? 'Toggles selection for merging' : 'Makes this the active layer. Long press to rename.'}
      accessibilityState={{ selected: picking ? picked : active }}
      style={[styles.row, indent && styles.indented, active && styles.rowActive]}>
      {/* Active-layer indicator: an accent bar, visible even with the row's colours muted. */}
      <View style={[styles.activeBar, active && styles.activeBarOn]} />
      {clip || mask ? (
        // Attached to the layer below: indented under it, like other painting apps.
        <Ionicons name="return-down-forward" size={16} color={colors.accent} accessibilityLabel={mask ? 'Mask of the layer below' : 'Clipped to the layer below'} />
      ) : null}
      {picking ? (
        <Ionicons name={picked ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={picked ? colors.accent : colors.textDim} />
      ) : null}
      <View style={[styles.thumbBox, !visible && styles.faded]}>
        <Canvas style={{ width: w, height: h }}>
          {/* Layers are previewed alone, over a checkerboard, so their own transparency is visible. */}
          <Rect x={0} y={0} width={w} height={h}>
            <ImageShader image={getCheckerTile()} tx="repeat" ty="repeat" fit="fill" x={0} y={0} width={8} height={8} />
          </Rect>
          <Image image={layer.image} x={0} y={0} width={w} height={h} fit="fill" />
        </Canvas>
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, !visible && styles.dim]} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.rowMetaLine}>
          {active ? <Text style={styles.activeBadge}>Editing</Text> : null}
          {layer.vector ? <Text style={styles.activeBadge}>Vector</Text> : null}
          {clip ? <Text style={styles.activeBadge}>Clip</Text> : null}
          {mask ? <Text style={styles.activeBadge}>Mask</Text> : null}
          {reference ? <Text style={styles.activeBadge}>Ref</Text> : null}
          <Text style={styles.rowMeta} numberOfLines={1}>
            {details}
          </Text>
          {alphaLocked ? (
            <Ionicons name="invert-mode-outline" size={12} color={colors.accent} accessibilityLabel="Alpha locked" />
          ) : null}
        </View>
      </View>
      {picking ? null : (
        <>
          <IconButton
            icon={locked ? 'lock-closed' : 'lock-open-outline'}
            label={locked ? `Unlock ${name}` : `Lock ${name}`}
            size={18}
            tint={locked ? colors.accent : colors.textDim}
            onPress={() => doc.setLayerProps(id, { locked: !locked })}
          />
          <IconButton
            icon={visible ? 'eye-outline' : 'eye-off-outline'}
            label={visible ? `Hide ${name}` : `Show ${name}`}
            size={18}
            tint={visible ? colors.text : colors.textDim}
            onPress={() => doc.setLayerProps(id, { visible: !visible })}
          />
        </>
      )}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  // Grows into the panel from its content size (not `flex: 1`, whose zero basis collapses the
  // panel to nothing in a container without a definite height).
  root: { flexGrow: 1, flexShrink: 1, minHeight: 0, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row' },
  heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  count: { color: colors.textDim, fontSize: 12, fontWeight: '500' },
  // The list takes the space left by the header and footer, but always shows at least a row.
  list: { flexGrow: 1, flexShrink: 1, minHeight: THUMB + spacing.md * 2 },
  listContent: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  rowActive: { backgroundColor: colors.panelRaised, borderColor: colors.accent },
  groupRow: { backgroundColor: colors.backdrop },
  indented: { marginLeft: spacing.lg },
  secondary: { backgroundColor: colors.panelRaised },
  activeBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'transparent' },
  activeBarOn: { backgroundColor: colors.accent },
  thumbBox: {
    width: THUMB,
    height: THUMB,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.backdrop,
    overflow: 'hidden',
  },
  faded: { opacity: 0.4 },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowMeta: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  activeBadge: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dim: { color: colors.textDim },
  footer: {
    flexShrink: 0,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  featureRow: { flexDirection: 'row', gap: spacing.xs },
  feature: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.panelRaised,
  },
  featureOn: { backgroundColor: colors.accentDim },
  featureLabel: { color: colors.text, fontSize: 11, fontWeight: '600' },
  featureLabelOn: { color: colors.accent },
  maskBox: { gap: spacing.xs },
  maskHint: { color: colors.textDim, fontSize: 12 },
  blendButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panelRaised,
  },
  blendLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  blendValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  blendValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  pickHint: { color: colors.textDim, fontSize: 13 },
  footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  textButton: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
  textButtonLabel: { color: colors.text, fontWeight: '600' },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.4 },
}));
