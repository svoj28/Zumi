import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, themed } from '@/ui/theme';

/** Blocking progress overlay for slow local work (import, export, rendering). */
export function BusyOverlay({ label }: { label: string | null }) {
  return (
    <Modal visible={label !== null} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop} accessibilityLiveRegion="polite">
        <View style={styles.card}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.label}>{label}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { alignItems: 'center', gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.panel, minWidth: 200 },
  label: { color: colors.text, fontSize: 15 },
}));
