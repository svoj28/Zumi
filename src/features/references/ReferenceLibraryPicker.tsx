import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReferenceBrowser, validFilter } from '@/features/references/ReferenceBrowser';
import { useReferenceLibraryStore } from '@/state/referenceLibraryStore';
import { filterImages, type LibraryImage, type ReferenceFilter } from '@/storage/referenceIndex';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { IconButton } from '@/ui/IconButton';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

interface Props {
  visible: boolean;
  /** How many more references the artwork can take. */
  room: number;
  onUse: (images: LibraryImage[]) => void;
  onClose: () => void;
}

/**
 * Editor: choose one or several images from the reference library (by group) to open in the
 * reference window. The library is refreshed by whoever opens this.
 */
export function ReferenceLibraryPicker({ visible, room, onUse, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      {visible ? <PickerBody room={room} onUse={onUse} onClose={onClose} /> : null}
    </Modal>
  );
}

function PickerBody({ room, onUse, onClose }: Omit<Props, 'visible'>) {
  const index = useReferenceLibraryStore((s) => s.index);
  const busy = useReferenceLibraryStore((s) => s.busy);
  const importImages = useReferenceLibraryStore((s) => s.importImages);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rawFilter, setFilter] = useState<ReferenceFilter>({ kind: 'all' });
  // Kept in tap order, so the reference window shows them in the order chosen.
  const [order, setOrder] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const filter = validFilter(index, rawFilter);
  const visible = filterImages(index, filter);
  const selected = new Set(order);
  const limitNote = room === 0 ? 'This artwork already has the most reference images it can hold.' : `You can add ${room} more to this artwork.`;

  const toggle = (image: LibraryImage) => {
    if (selected.has(image.id)) {
      setOrder(order.filter((id) => id !== image.id));
      setNote(null);
    } else if (order.length >= room) {
      setNote(limitNote);
    } else {
      setOrder([...order, image.id]);
    }
  };

  const shownSelected = visible.filter((i) => selected.has(i.id)).length;
  const allShown = visible.length > 0 && shownSelected === visible.length;
  const toggleAllShown = () => {
    if (allShown) {
      const shown = new Set(visible.map((i) => i.id));
      setOrder(order.filter((id) => !shown.has(id)));
      setNote(null);
      return;
    }
    const next = [...order];
    for (const image of visible) {
      if (next.length >= room) break;
      if (!selected.has(image.id)) next.push(image.id);
    }
    if (next.length - order.length < visible.length - shownSelected) setNote(limitNote);
    setOrder(next);
  };

  const use = () => {
    const byId = new Map(index.images.map((i) => [i.id, i]));
    onUse(order.flatMap((id) => byId.get(id) ?? []));
  };

  const groupId = filter.kind === 'group' ? filter.id : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconButton icon="close" label="Close" onPress={onClose} />
        <Text style={styles.title} numberOfLines={1}>
          Reference library
        </Text>
        <IconButton icon="add-circle-outline" label="Import images into the library" onPress={() => void importImages(groupId)} />
        {visible.length > 0 ? (
          <IconButton
            icon={allShown ? 'remove-circle-outline' : 'checkmark-done-outline'}
            label={allShown ? 'Select none shown' : 'Select all shown'}
            onPress={toggleAllShown}
          />
        ) : null}
      </View>
      <Text style={styles.hint}>{note ?? 'Tap images to choose them · pick a group above to narrow the list'}</Text>

      <ReferenceBrowser
        index={index}
        filter={filter}
        onFilter={setFilter}
        width={width}
        selected={selected}
        selecting
        onPressImage={toggle}
        emptyTitle={index.images.length === 0 ? 'Your reference library is empty' : 'Nothing in this group'}
        emptyText={index.images.length === 0 ? 'Tap + to import images, or add them from the home screen (References).' : undefined}
        bottomPadding={insets.bottom + 80}
      />

      <View style={[styles.footer, { bottom: insets.bottom + spacing.md }]}>
        <Text style={styles.count}>{order.length} selected</Text>
        <Pressable
          onPress={use}
          disabled={order.length === 0}
          style={({ pressed }) => [styles.useButton, order.length === 0 && styles.disabled, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ disabled: order.length === 0 }}>
          <Text style={styles.useLabel}>{order.length > 1 ? `Use ${order.length} references` : 'Use reference'}</Text>
        </Pressable>
      </View>
      <BusyOverlay label={busy} />
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.textDim, fontSize: 12, paddingHorizontal: spacing.lg },
  footer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingLeft: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.floating,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  count: { flex: 1, color: colors.text, fontWeight: '600' },
  useButton: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  useLabel: { color: colors.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
}));
