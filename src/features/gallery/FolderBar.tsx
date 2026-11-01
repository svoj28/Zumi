import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import type { Folder } from '@/storage/libraryRepository';
import { colors, radius, spacing, themed } from '@/ui/theme';

export type GallerySelection = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'trash' };

interface Props {
  folders: Folder[];
  selection: GallerySelection;
  trashCount: number;
  onSelect: (selection: GallerySelection) => void;
  onFolderLongPress: (folder: Folder) => void;
  onNewFolder: () => void;
}

/** Horizontal collection switcher: All · collections… · + New · Recently Deleted. */
export function FolderBar({ folders, selection, trashCount, onSelect, onFolderLongPress, onNewFolder }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
      <Chip label="All artwork" icon="apps-outline" selected={selection.kind === 'all'} onPress={() => onSelect({ kind: 'all' })} />
      {folders.map((folder) => (
        <Chip
          key={folder.id}
          label={folder.name}
          icon="folder-outline"
          selected={selection.kind === 'folder' && selection.id === folder.id}
          onPress={() => onSelect({ kind: 'folder', id: folder.id })}
          onLongPress={() => onFolderLongPress(folder)}
          hint="Long press to rename or delete"
        />
      ))}
      <Chip label="New collection" icon="add" onPress={onNewFolder} dashed />
      <Chip
        label={trashCount > 0 ? `Recently Deleted (${trashCount})` : 'Recently Deleted'}
        icon="trash-outline"
        selected={selection.kind === 'trash'}
        onPress={() => onSelect({ kind: 'trash' })}
      />
    </ScrollView>
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
  bar: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
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
}));
