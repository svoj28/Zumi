import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GalleryView } from '@/features/gallery/galleryQuery';
import type { ProjectSummary } from '@/storage/projectRepository';
import { formatDaysLeft, formatModified } from '@/ui/format';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

interface Props {
  project: ProjectSummary & { expiresAt?: number };
  variant: GalleryView;
  onPress: () => void;
  onMore: () => void;
}

/** Gallery entry: thumbnail, name, canvas size and last-modified date (or time left in trash). */
export function ProjectCard({ project, variant, onPress, onMore }: Props) {
  const dims = `${project.width} × ${project.height}`;
  const when = project.expiresAt !== undefined ? formatDaysLeft(project.expiresAt) : formatModified(project.updatedAt);
  const a11y = `${project.name}, ${project.width} by ${project.height} pixels, ${when}`;
  const aspect = Math.max(0.5, Math.min(2, project.width / project.height));

  const thumbnail = project.thumbnailUri ? (
    <Image source={{ uri: project.thumbnailUri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />
  ) : (
    <Ionicons name="image-outline" size={24} color={colors.border} />
  );

  const more = (
    <Pressable
      onPress={onMore}
      hitSlop={8}
      style={styles.more}
      accessibilityRole="button"
      accessibilityLabel={`More actions for ${project.name}`}>
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.textDim} />
    </Pressable>
  );

  if (variant === 'list') {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onMore}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Long press for more actions">
        <View style={styles.rowThumb}>{thumbnail}</View>
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {dims} · {when}
          </Text>
        </View>
        {more}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Long press for more actions">
      <View style={[styles.cardThumb, { aspectRatio: aspect }]}>{thumbnail}</View>
      <View style={styles.cardFooter}>
        <View style={styles.cardText}>
          <Text style={styles.name} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {dims}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {when}
          </Text>
        </View>
        {more}
      </View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  pressed: { opacity: 0.75 },
  card: { flex: 1, padding: spacing.sm, gap: spacing.xs },
  cardThumb: {
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFooter: { flexDirection: 'row', alignItems: 'flex-start' },
  cardText: { flex: 1, gap: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  name: { color: colors.text, fontWeight: '600', fontSize: 14 },
  meta: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  more: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
}));
