import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  countInGroup,
  filterImages,
  sortedGroups,
  type LibraryImage,
  type ReferenceFilter,
  type ReferenceGroup,
  type ReferenceIndex,
} from '@/storage/referenceIndex';
import { libraryImageUri } from '@/storage/referenceLibrary';
import { colors, radius, spacing, themed } from '@/ui/theme';

const TILE_MIN = 104;

interface Props {
  index: ReferenceIndex;
  filter: ReferenceFilter;
  onFilter: (filter: ReferenceFilter) => void;
  /** Available width, for the number of columns. */
  width: number;
  selected: ReadonlySet<string>;
  /** Show the selection circles on every tile. */
  selecting: boolean;
  onPressImage: (image: LibraryImage) => void;
  onLongPressImage?: (image: LibraryImage) => void;
  onGroupLongPress?: (group: ReferenceGroup) => void;
  onNewGroup?: () => void;
  emptyTitle: string;
  emptyText?: string;
  bottomPadding?: number;
}

/** A group filter whose group was deleted falls back to "All". */
export function validFilter(index: ReferenceIndex, filter: ReferenceFilter): ReferenceFilter {
  return filter.kind === 'group' && !index.groups.some((g) => g.id === filter.id) ? { kind: 'all' } : filter;
}

/** Group chips (All · No group · groups… · + New group) above a grid of reference images. */
export function ReferenceBrowser({
  index,
  filter,
  onFilter,
  width,
  selected,
  selecting,
  onPressImage,
  onLongPressImage,
  onGroupLongPress,
  onNewGroup,
  emptyTitle,
  emptyText,
  bottomPadding = 0,
}: Props) {
  const columns = Math.max(3, Math.floor((width - spacing.sm * 2) / TILE_MIN));
  const images = filterImages(index, filter);
  const ungrouped = countInGroup(index, null);

  return (
    <View style={styles.root}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={`All (${index.images.length})`} icon="images-outline" selected={filter.kind === 'all'} onPress={() => onFilter({ kind: 'all' })} />
          {index.groups.length > 0 && ungrouped > 0 ? (
            <Chip
              label={`No group (${ungrouped})`}
              icon="file-tray-outline"
              selected={filter.kind === 'ungrouped'}
              onPress={() => onFilter({ kind: 'ungrouped' })}
            />
          ) : null}
          {sortedGroups(index).map((g) => (
            <Chip
              key={g.id}
              label={`${g.name} (${countInGroup(index, g.id)})`}
              icon="folder-outline"
              selected={filter.kind === 'group' && filter.id === g.id}
              onPress={() => onFilter({ kind: 'group', id: g.id })}
              onLongPress={onGroupLongPress ? () => onGroupLongPress(g) : undefined}
              hint={onGroupLongPress ? 'Long press to rename or delete' : undefined}
            />
          ))}
          {onNewGroup ? <Chip label="New group" icon="add" onPress={onNewGroup} dashed /> : null}
        </ScrollView>
      </View>
      <FlatList
        key={columns}
        data={images}
        numColumns={columns}
        keyExtractor={(i) => i.id}
        contentContainerStyle={[styles.grid, { paddingBottom: bottomPadding + spacing.sm }]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={44} color={colors.textDim} />
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            {emptyText ? <Text style={styles.emptyText}>{emptyText}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <Tile
            image={item}
            width={`${100 / columns}%`}
            selected={selected.has(item.id)}
            selecting={selecting}
            onPress={() => onPressImage(item)}
            onLongPress={onLongPressImage ? () => onLongPressImage(item) : undefined}
          />
        )}
      />
    </View>
  );
}

function Tile({
  image,
  width,
  selected,
  selecting,
  onPress,
  onLongPress,
}: {
  image: LibraryImage;
  width: `${number}%`;
  selected: boolean;
  selecting: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <View style={[styles.tileCell, { width }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole={selecting ? 'checkbox' : 'imagebutton'}
        accessibilityLabel={image.name}
        accessibilityState={selecting ? { checked: selected } : undefined}
        style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}>
        <Image source={{ uri: libraryImageUri(image) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={100} recyclingKey={image.id} />
        {selecting ? (
          <View style={[styles.check, selected && styles.checkOn]}>
            {selected ? <Ionicons name="checkmark" size={16} color={colors.onAccent} /> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  icon,
  selected,
  dashed,
  hint,
  onPress,
  onLongPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  selected?: boolean;
  dashed?: boolean;
  hint?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const tint = selected ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, dashed && styles.chipDashed, pressed && styles.pressed]}>
      <Ionicons name={icon} size={16} color={tint} />
      <Text style={[styles.chipLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  chipDashed: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  grid: { paddingHorizontal: spacing.sm, flexGrow: 1 },
  tileCell: { padding: 3 },
  tile: {
    aspectRatio: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.panel,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: { borderColor: colors.accent },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl, marginTop: 40 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.textDim, textAlign: 'center' },
}));
