import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExportDialog } from '@/features/export/ExportDialog';
import { FolderBar, type GallerySelection } from '@/features/gallery/FolderBar';
import { queryProjects, SORT_LABELS, type GallerySort } from '@/features/gallery/galleryQuery';
import { ProjectCard } from '@/features/gallery/ProjectCard';
import { OnboardingTips } from '@/features/onboarding/OnboardingTips';
import { useGalleryStore } from '@/state/galleryStore';
import { useSettingsStore } from '@/state/settingsStore';
import type { ExportOptions } from '@/storage/exportService';
import type { Folder } from '@/storage/libraryRepository';
import { TRASH_RETENTION_DAYS, type ProjectSummary, type TrashedProject } from '@/storage/projectRepository';
import { ActionSheet, type ActionSheetOption } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { IconButton } from '@/ui/IconButton';
import { PromptDialog } from '@/ui/PromptDialog';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';
import { errorText } from '@/utils/errors';

const CARD_MIN_WIDTH = 170;

type Sheet =
  | { type: 'project'; project: ProjectSummary }
  | { type: 'trashed'; project: TrashedProject }
  | { type: 'move'; project: ProjectSummary }
  | { type: 'folder'; folder: Folder }
  | { type: 'sort' };

type Prompt =
  | { type: 'renameProject'; project: ProjectSummary }
  | { type: 'newFolder'; moveProjectId?: string }
  | { type: 'renameFolder'; folder: Folder };

export function GalleryScreen() {
  const store = useGalleryStore();
  const sort = useSettingsStore((s) => s.gallerySort);
  const view = useSettingsStore((s) => s.galleryView);
  const setSort = useSettingsStore((s) => s.setGallerySort);
  const setView = useSettingsStore((s) => s.setGalleryView);

  const params = useLocalSearchParams<{ view?: string }>();
  const [selection, setSelection] = useState<GallerySelection>(params.view === 'trash' ? { kind: 'trash' } : { kind: 'all' });
  // Settings → "View" Recently Deleted navigates here with ?view=trash (adjusted during render,
  // so arriving again with the same param after switching away still works).
  const [seenView, setSeenView] = useState(params.view);
  if (params.view !== seenView) {
    setSeenView(params.view);
    if (params.view === 'trash') setSelection({ kind: 'trash' });
  }
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [exporting, setExporting] = useState<ProjectSummary | null>(null);

  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const columns = view === 'list' ? 1 : Math.max(2, Math.floor((width - spacing.lg) / (CARD_MIN_WIDTH + spacing.lg)));

  const { refresh, error, clearError } = store;
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (!error) return;
    clearError();
    Alert.alert(error.title, errorText(error));
  }, [error, clearError]);

  // A deleted collection falls back to "All artwork".
  const activeFolder =
    selection.kind === 'folder' ? store.folders.find((f) => f.id === selection.id) ?? null : null;
  const effective: GallerySelection = selection.kind === 'folder' && !activeFolder ? { kind: 'all' } : selection;
  const inTrash = effective.kind === 'trash';
  const targetFolderId = activeFolder?.id ?? null;

  const items = useMemo(() => {
    if (inTrash) return queryProjects(store.trash, { folderId: null, search, sort: 'updated' }).sort((a, b) => b.deletedAt - a.deletedAt);
    return queryProjects(store.projects, { folderId: targetFolderId, search, sort });
  }, [inTrash, store.trash, store.projects, targetFolderId, search, sort]);

  const open = (id: string) => router.push({ pathname: '/canvas/[id]', params: { id } });

  // ---- sheets --------------------------------------------------------------------------------

  const sheetContent = ((): { title?: string; message?: string; options: ActionSheetOption[] } => {
    if (!sheet) return { options: [] };
    switch (sheet.type) {
      case 'project': {
        const p = sheet.project;
        return {
          title: p.name,
          options: [
            { label: 'Open', icon: 'brush-outline', onPress: () => open(p.id) },
            { label: 'Rename', icon: 'create-outline', onPress: () => setPrompt({ type: 'renameProject', project: p }) },
            { label: 'Duplicate', icon: 'copy-outline', onPress: () => store.duplicate(p.id) },
            { label: 'Move to collection…', icon: 'folder-open-outline', onPress: () => setSheet({ type: 'move', project: p }) },
            { label: 'Export image…', icon: 'share-outline', onPress: () => setExporting(p) },
            { label: 'Save .zumi file (editable)', icon: 'download-outline', onPress: () => void saveZumi(p) },
            { label: 'Share .zumi file…', icon: 'archive-outline', onPress: () => void store.backup(p.id) },
            { label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => store.trashProject(p.id) },
          ],
        };
      }
      case 'trashed': {
        const p = sheet.project;
        return {
          title: p.name,
          options: [
            { label: 'Restore', icon: 'arrow-undo-outline', onPress: () => store.restore(p.id) },
            {
              label: 'Delete permanently',
              icon: 'close-circle-outline',
              destructive: true,
              onPress: () =>
                Alert.alert(`Delete "${p.name}" permanently?`, 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => store.deleteForever(p.id) },
                ]),
            },
          ],
        };
      }
      case 'move': {
        const p = sheet.project;
        return {
          title: `Move "${p.name}"`,
          options: [
            { label: 'No collection', icon: 'apps-outline', selected: p.folderId === null, onPress: () => store.move(p.id, null) },
            ...store.folders.map<ActionSheetOption>((f) => ({
              label: f.name,
              icon: 'folder-outline',
              selected: p.folderId === f.id,
              onPress: () => store.move(p.id, f.id),
            })),
            { label: 'New collection…', icon: 'add', onPress: () => setPrompt({ type: 'newFolder', moveProjectId: p.id }) },
          ],
        };
      }
      case 'folder': {
        const f = sheet.folder;
        return {
          title: f.name,
          options: [
            { label: 'Rename collection', icon: 'create-outline', onPress: () => setPrompt({ type: 'renameFolder', folder: f }) },
            {
              label: 'Delete collection',
              icon: 'trash-outline',
              destructive: true,
              onPress: () =>
                Alert.alert(`Delete "${f.name}"?`, 'The artwork inside is kept and moved to All artwork.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => store.deleteFolder(f.id) },
                ]),
            },
          ],
        };
      }
      case 'sort':
        return {
          title: 'Sort by',
          options: (Object.keys(SORT_LABELS) as GallerySort[]).map((key) => ({
            label: SORT_LABELS[key],
            selected: sort === key,
            onPress: () => setSort(key),
          })),
        };
    }
  })();

  // ---- export & backup -----------------------------------------------------------------------

  const exportToPhotos = async (p: ProjectSummary, options: ExportOptions) => {
    setExporting(null);
    const result = await store.exportToPhotos(p.id, options);
    if (result === 'saved') Alert.alert('Saved to Photos', `"${p.name}" was saved to your photo library.`);
    else if (result === 'denied') {
      Alert.alert('Permission needed', 'Allow Zumi to add photos in your device settings to export artwork.');
    }
  };

  const saveZumi = async (p: ProjectSummary) => {
    const saved = await store.saveBackup(p.id);
    if (saved) Alert.alert('Saved', `“${saved.fileName}” was saved to ${saved.folderName}. Change the folder in Settings › Storage.`);
  };

  /** Rebuilds a damaged artwork from its readable layers and opens the result. */
  const recoverDamaged = async (id: string) => {
    const newId = await store.recoverDamaged(id);
    if (!newId) return;
    Alert.alert(
      'Artwork recovered',
      'The readable layers were saved as “Recovered artwork”. Layer order, names and settings may differ from the original.',
      [{ text: 'Open', onPress: () => open(newId) }, { text: 'OK' }],
    );
  };

  /** Validates a picked backup first; only then asks (on a clash) and adds it. Never overwrites. */
  const restoreBackup = async () => {
    const prepared = await store.pickRestore();
    if (!prepared) return;
    const finish = () => {
      const id = store.finishRestore(prepared);
      if (id) Alert.alert('Backup restored', `"${prepared.manifest.name}" was added to your gallery.`);
    };
    if (!prepared.conflict) {
      finish();
      return;
    }
    Alert.alert(
      `"${prepared.manifest.name}" is already on this device`,
      'The backup will be added as a separate copy. Your existing artwork is not changed.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => store.cancelRestore(prepared) },
        { text: 'Add as copy', onPress: finish },
      ],
      { cancelable: true, onDismiss: () => store.cancelRestore(prepared) },
    );
  };

  // ---- prompts -------------------------------------------------------------------------------

  const promptConfig = ((): { title: string; initial: string; confirm: string; submit: (v: string) => void } | null => {
    if (!prompt) return null;
    switch (prompt.type) {
      case 'renameProject':
        return { title: 'Rename artwork', initial: prompt.project.name, confirm: 'Rename', submit: (v) => store.rename(prompt.project.id, v) };
      case 'renameFolder':
        return { title: 'Rename collection', initial: prompt.folder.name, confirm: 'Rename', submit: (v) => store.renameFolder(prompt.folder.id, v) };
      case 'newFolder':
        return {
          title: 'New collection',
          initial: '',
          confirm: 'Create',
          submit: (v) => {
            const folder = store.createFolder(v);
            if (!folder) return;
            if (prompt.moveProjectId) store.move(prompt.moveProjectId, folder.id);
            else setSelection({ kind: 'folder', id: folder.id });
          },
        };
    }
  })();

  // ---- render --------------------------------------------------------------------------------

  const emptyText = search.trim()
    ? `No artwork matches “${search.trim()}”`
    : inTrash
      ? 'Nothing in Recently Deleted'
      : activeFolder
        ? 'This collection is empty'
        : 'No artwork yet';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          My Artwork
        </Text>
        <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => router.push({ pathname: '/new', params: targetFolderId ? { folderId: targetFolderId } : {} })}
          accessibilityRole="button"
          accessibilityLabel="New artwork">
          <Ionicons name="add" size={20} color={colors.onAccent} />
          <Text style={styles.primaryLabel}>{width >= 420 ? 'New Artwork' : 'New'}</Text>
        </Pressable>
      </View>

      {/* Labelled secondary actions get their own row, so the title never has to wrap. */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => router.push('/references')}
          accessibilityRole="button"
          accessibilityLabel="References: import, group and use reference images">
          <Ionicons name="albums-outline" size={18} color={colors.text} />
          <Text style={styles.secondaryLabel} numberOfLines={1}>
            References
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => void store.importImage(targetFolderId)}
          accessibilityRole="button"
          accessibilityLabel="Import image as a new artwork">
          <Ionicons name="image-outline" size={18} color={colors.text} />
          <Text style={styles.secondaryLabel} numberOfLines={1}>
            Import Image
          </Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.textDim} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={inTrash ? 'Search Recently Deleted' : 'Search artwork'}
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            accessibilityLabel="Search artwork by name"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={colors.textDim} />
            </Pressable>
          ) : null}
        </View>
        {!inTrash ? <IconButton icon="archive-outline" label="Import Zumi File" onPress={() => void restoreBackup()} /> : null}
        {!inTrash ? (
          <IconButton icon="swap-vertical" label={`Sort: ${SORT_LABELS[sort]}`} onPress={() => setSheet({ type: 'sort' })} />
        ) : null}
        <IconButton
          icon={view === 'grid' ? 'list-outline' : 'grid-outline'}
          label={view === 'grid' ? 'Show as list' : 'Show as grid'}
          onPress={() => setView(view === 'grid' ? 'list' : 'grid')}
        />
      </View>

      <View>
        <FolderBar
          folders={store.folders}
          selection={effective}
          trashCount={store.trash.length}
          onSelect={setSelection}
          onFolderLongPress={(folder) => setSheet({ type: 'folder', folder })}
          onNewFolder={() => setPrompt({ type: 'newFolder' })}
        />
      </View>

      {inTrash ? (
        <View style={styles.trashBanner}>
          <Text style={styles.trashText}>
            Artwork here is permanently deleted after {TRASH_RETENTION_DAYS} days. It never leaves this device.
          </Text>
          {store.trash.length > 0 ? (
            <Pressable
              onPress={() =>
                Alert.alert('Empty Recently Deleted?', `${store.trash.length} artwork will be permanently deleted.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Empty', style: 'destructive', onPress: () => store.emptyTrash() },
                ])
              }
              style={styles.emptyButton}
              accessibilityRole="button">
              <Text style={styles.emptyButtonLabel}>Empty</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!inTrash
        ? store.damaged.map((d) => (
            <View key={d.id} style={styles.trashBanner} accessibilityRole="alert">
              <Ionicons name="warning-outline" size={20} color={colors.warning} />
              <Text style={styles.trashText}>
                An artwork could not be opened because its project file is damaged. {d.layerFileCount}{' '}
                {d.layerFileCount === 1 ? 'layer' : 'layers'} can be recovered into a new artwork.
              </Text>
              <Pressable
                onPress={() => void recoverDamaged(d.id)}
                style={styles.emptyButton}
                accessibilityRole="button"
                accessibilityLabel="Recover damaged artwork">
                <Text style={styles.recoverLabel}>Recover</Text>
              </Pressable>
              <IconButton
                icon="trash-outline"
                label="Delete damaged artwork"
                tint={colors.danger}
                onPress={() =>
                  Alert.alert('Delete damaged artwork?', 'Its layers will be permanently deleted. This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => store.deleteDamaged(d.id) },
                  ])
                }
              />
            </View>
          ))
        : null}

      <FlatList
        key={`${view}-${columns}`}
        data={items}
        numColumns={columns}
        keyExtractor={(p) => p.id}
        // Room at the end so the assistant button never covers the last artwork.
        contentContainerStyle={[view === 'grid' ? styles.grid : styles.list, styles.listEnd]}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          store.loaded ? (
            <View style={styles.empty}>
              <Ionicons name={inTrash ? 'trash-outline' : 'color-palette-outline'} size={44} color={colors.textDim} />
              <Text style={styles.emptyTitle}>{emptyText}</Text>
              {!inTrash && !search ? (
                <Text style={styles.emptyText}>Everything you create is stored only on this device.</Text>
              ) : null}
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View style={view === 'grid' ? { width: `${100 / columns}%` } : undefined}>
            <ProjectCard
              project={item}
              variant={view}
              onPress={() => (inTrash ? setSheet({ type: 'trashed', project: item as TrashedProject }) : open(item.id))}
              onMore={() =>
                setSheet(inTrash ? { type: 'trashed', project: item as TrashedProject } : { type: 'project', project: item })
              }
            />
          </View>
        )}
      />

      {!inTrash ? (
        <Pressable
          style={({ pressed }) => [styles.assistantFab, { bottom: insets.bottom + spacing.lg }, pressed && styles.pressed]}
          onPress={() => router.push('/assistant')}
          accessibilityRole="button"
          accessibilityLabel="AI assistant: ideas, themes, palettes and drawing help">
          <Ionicons name="sparkles" size={22} color={colors.onAccent} />
          <Text style={styles.assistantFabLabel}>Ask AI</Text>
        </Pressable>
      ) : null}

      <OnboardingTips />

      <ActionSheet
        visible={sheet !== null}
        title={sheetContent.title}
        message={sheetContent.message}
        options={sheetContent.options}
        onClose={() => setSheet(null)}
      />

      <PromptDialog
        visible={promptConfig !== null}
        title={promptConfig?.title ?? ''}
        initialValue={promptConfig?.initial ?? ''}
        confirmLabel={promptConfig?.confirm}
        onCancel={() => setPrompt(null)}
        onSubmit={(value) => {
          promptConfig?.submit(value);
          setPrompt(null);
        }}
      />

      <ExportDialog
        visible={exporting !== null}
        subtitle={exporting ? `${exporting.name} · ${exporting.width} × ${exporting.height} px` : undefined}
        onClose={() => setExporting(null)}
        onSaveToDevice={(options) => exporting && void exportToPhotos(exporting, options)}
        onShare={(options) => {
          const p = exporting;
          setExporting(null);
          if (p) void store.share(p.id, options);
        }}
      />

      <BusyOverlay label={store.busy} />
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop },
  pressed: { opacity: 0.75 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { flex: 1, color: colors.text, fontSize: 28, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.panelRaised,
  },
  secondaryLabel: { color: colors.text, fontWeight: '600' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: spacing.sm },
  trashBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
  },
  trashText: { flex: 1, color: colors.textDim, fontSize: 13 },
  emptyButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.panelRaised },
  emptyButtonLabel: { color: colors.danger, fontWeight: '700' },
  recoverLabel: { color: colors.accent, fontWeight: '700' },
  grid: { padding: spacing.sm, flexGrow: 1 },
  list: { paddingVertical: spacing.xs, flexGrow: 1 },
  listEnd: { paddingBottom: 96 },
  assistantFab: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  assistantFabLabel: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl, marginTop: 60 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.textDim, textAlign: 'center' },
}));
