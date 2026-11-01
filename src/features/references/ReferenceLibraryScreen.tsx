import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReferenceBrowser, validFilter } from '@/features/references/ReferenceBrowser';
import { useReferenceLibraryStore } from '@/state/referenceLibraryStore';
import { filterImages, sortedGroups, type LibraryImage, type ReferenceFilter, type ReferenceGroup } from '@/storage/referenceIndex';
import { libraryImageUri } from '@/storage/referenceLibrary';
import { ActionSheet, type ActionSheetOption } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { IconButton } from '@/ui/IconButton';
import { PromptDialog } from '@/ui/PromptDialog';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

type Sheet = { type: 'group'; group: ReferenceGroup } | { type: 'move'; ids: string[] };
type Prompt = { type: 'newGroup'; moveIds?: string[] } | { type: 'renameGroup'; group: ReferenceGroup };

/**
 * Home → References: a library of reference images, organised in groups, that any artwork can
 * open in its reference window. Tap to preview; long press (or Select) to pick several to move
 * into a group or delete.
 */
export function ReferenceLibraryScreen() {
  const store = useReferenceLibraryStore();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rawFilter, setFilter] = useState<ReferenceFilter>({ kind: 'all' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [preview, setPreview] = useState<LibraryImage | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const { refresh } = store;
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const filter = validFilter(store.index, rawFilter);
  const groupId = filter.kind === 'group' ? filter.id : null;
  const visible = filterImages(store.index, filter);
  const activeGroup = groupId ? store.index.groups.find((g) => g.id === groupId) : undefined;

  const toggle = (image: LibraryImage) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      return next;
    });
  };
  const endSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  const confirmDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    Alert.alert(
      ids.length === 1 ? 'Delete this reference?' : `Delete ${ids.length} references?`,
      'They are removed from the library. Artwork already using them keeps its own copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            store.deleteImages(ids);
            setPreview(null);
            endSelection();
          },
        },
      ],
    );
  };

  const sheetContent = ((): { title?: string; options: ActionSheetOption[] } => {
    if (!sheet) return { options: [] };
    if (sheet.type === 'group') {
      const g = sheet.group;
      return {
        title: g.name,
        options: [
          { label: 'Rename group', icon: 'create-outline', onPress: () => setPrompt({ type: 'renameGroup', group: g }) },
          { label: 'Delete group (keep images)', icon: 'folder-open-outline', onPress: () => store.deleteGroup(g.id, false) },
          {
            label: 'Delete group and its images',
            icon: 'trash-outline',
            destructive: true,
            onPress: () =>
              Alert.alert(`Delete “${g.name}” and its images?`, 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => store.deleteGroup(g.id, true) },
              ]),
          },
        ],
      };
    }
    const { ids } = sheet;
    const moveTo = (target: string | null) => {
      store.moveImages(ids, target);
      setPreview(null);
      endSelection();
    };
    return {
      title: ids.length === 1 ? 'Move to group' : `Move ${ids.length} images to group`,
      options: [
        { label: 'No group', icon: 'file-tray-outline', onPress: () => moveTo(null) },
        ...sortedGroups(store.index).map<ActionSheetOption>((g) => ({ label: g.name, icon: 'folder-outline', onPress: () => moveTo(g.id) })),
        { label: 'New group…', icon: 'add', onPress: () => setPrompt({ type: 'newGroup', moveIds: ids }) },
      ],
    };
  })();

  const promptConfig = ((): { title: string; initial: string; confirm: string; submit: (v: string) => void } | null => {
    if (!prompt) return null;
    if (prompt.type === 'renameGroup') {
      return { title: 'Rename group', initial: prompt.group.name, confirm: 'Rename', submit: (v) => store.renameGroup(prompt.group.id, v) };
    }
    return {
      title: 'New group',
      initial: '',
      confirm: 'Create',
      submit: (v) => {
        const group = store.createGroup(v);
        if (!group) return;
        if (prompt.moveIds) {
          store.moveImages(prompt.moveIds, group.id);
          setPreview(null);
          endSelection();
        }
        setFilter({ kind: 'group', id: group.id });
      },
    };
  })();

  const importImages = async () => {
    const added = await store.importImages(groupId);
    if (added > 0 && filter.kind === 'ungrouped') setFilter({ kind: 'all' });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          References
        </Text>
        {store.index.images.length > 0 ? (
          <IconButton
            icon={selecting ? 'close' : 'checkmark-circle-outline'}
            label={selecting ? 'Cancel selection' : 'Select images'}
            onPress={() => (selecting ? endSelection() : setSelecting(true))}
          />
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => void importImages()}
          accessibilityRole="button"
          accessibilityLabel={activeGroup ? `Import images into ${activeGroup.name}` : 'Import images'}>
          <Ionicons name="add" size={20} color={colors.onAccent} />
          <Text style={styles.primaryLabel}>Import</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        Use these while drawing: in an artwork, open Reference images → From library.
        {activeGroup ? ` Imports go into “${activeGroup.name}”.` : ''}
      </Text>

      <ReferenceBrowser
        index={store.index}
        filter={filter}
        onFilter={setFilter}
        width={width}
        selected={selected}
        selecting={selecting}
        onPressImage={(image) => (selecting ? toggle(image) : setPreview(image))}
        onLongPressImage={(image) => {
          setSelecting(true);
          toggle(image);
        }}
        onGroupLongPress={(group) => setSheet({ type: 'group', group })}
        onNewGroup={() => setPrompt({ type: 'newGroup' })}
        emptyTitle={store.loaded ? (filter.kind === 'all' ? 'No references yet' : 'Nothing in this group') : ''}
        emptyText={store.loaded ? 'Tap Import to add images from your photos. They stay on this device.' : undefined}
        bottomPadding={insets.bottom + (selecting ? 72 : 0)}
      />

      {selecting ? (
        <View style={[styles.selectionBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Text style={styles.selectionText}>{selected.size} selected</Text>
          <IconButton
            icon={allVisibleSelected ? 'remove-circle-outline' : 'checkmark-done-outline'}
            label={allVisibleSelected ? 'Select none' : 'Select all shown'}
            onPress={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((i) => i.id)))}
          />
          <IconButton
            icon="folder-open-outline"
            label="Move to group"
            disabled={selected.size === 0}
            onPress={() => setSheet({ type: 'move', ids: [...selected] })}
          />
          <IconButton icon="trash-outline" label="Delete" tint={colors.danger} disabled={selected.size === 0} onPress={() => confirmDelete([...selected])} />
        </View>
      ) : null}

      <Modal visible={preview !== null} transparent animationType="fade" onRequestClose={() => setPreview(null)} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.previewRoot}>
          {preview ? (
            <>
              <Image source={{ uri: libraryImageUri(preview) }} style={styles.previewImage} contentFit="contain" />
              <View style={[styles.previewBar, { paddingTop: insets.top + spacing.sm }]}>
                <IconButton icon="close" label="Close" tint="#fff" onPress={() => setPreview(null)} />
                <Text style={styles.previewName} numberOfLines={1}>
                  {preview.name}
                </Text>
                <IconButton icon="folder-open-outline" label="Move to group" tint="#fff" onPress={() => setSheet({ type: 'move', ids: [preview.id] })} />
                <IconButton icon="trash-outline" label="Delete" tint="#fff" onPress={() => confirmDelete([preview.id])} />
              </View>
            </>
          ) : null}
          {/* Inside the preview's modal, so it shows above it. */}
          <ActionSheet visible={sheet !== null && preview !== null} title={sheetContent.title} options={sheetContent.options} onClose={() => setSheet(null)} />
        </View>
      </Modal>

      <ActionSheet visible={sheet !== null && preview === null} title={sheetContent.title} options={sheetContent.options} onClose={() => setSheet(null)} />

      <PromptDialog
        visible={promptConfig !== null}
        title={promptConfig?.title ?? ''}
        initialValue={promptConfig?.initial ?? ''}
        confirmLabel={promptConfig?.confirm}
        placeholder="Group name (e.g. Hands, Poses, Lighting)"
        onCancel={() => setPrompt(null)}
        onSubmit={(value) => {
          promptConfig?.submit(value);
          setPrompt(null);
        }}
      />

      <BusyOverlay label={store.busy} />
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop },
  pressed: { opacity: 0.75 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.md },
  title: { flex: 1, color: colors.text, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  selectionText: { flex: 1, color: colors.text, fontWeight: '700' },
  previewRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  previewImage: { flex: 1 },
  previewBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  previewName: { flex: 1, color: '#fff', fontWeight: '700' },
}));
