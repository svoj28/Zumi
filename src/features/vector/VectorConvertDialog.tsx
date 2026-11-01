import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TraceDetail } from '@/engine/vector/traceLayer';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

export interface TraceChoice {
  colors: number;
  detail: TraceDetail;
  smooth: boolean;
}

const COLOR_COUNTS = [4, 6, 8, 12, 16];
const DETAILS: { id: TraceDetail; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

/**
 * Converting a layer to vector: trace its pixels into flat-colour shapes (colours, detail,
 * sharp facets or smooth curves), or start the vector layer empty.
 */
export function VectorConvertDialog({
  visible,
  layerName,
  onConvert,
  onClose,
}: {
  visible: boolean;
  layerName: string;
  /** null: convert without tracing (an empty vector layer). */
  onConvert: (choice: TraceChoice | null) => void;
  onClose: () => void;
}) {
  const [count, setCount] = useState(8);
  const [detail, setDetail] = useState<TraceDetail>('medium');
  const [smooth, setSmooth] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Convert “{layerName}” to vector</Text>
          <Text style={styles.hint}>
            Trace turns the layer’s picture into flat-colour shapes you can reshape and recolour (pop-art / WPAP style). Undo brings
            the pixels back.
          </Text>
          <Row label="Colours">
            {COLOR_COUNTS.map((c) => (
              <Chip key={c} label={String(c)} selected={count === c} onPress={() => setCount(c)} />
            ))}
          </Row>
          <Row label="Detail">
            {DETAILS.map((d) => (
              <Chip key={d.id} label={d.label} selected={detail === d.id} onPress={() => setDetail(d.id)} />
            ))}
          </Row>
          <Row label="Corners">
            <Chip label="Sharp (facets)" selected={!smooth} onPress={() => setSmooth(false)} />
            <Chip label="Smooth (curves)" selected={smooth} onPress={() => setSmooth(true)} />
          </Row>
          <View style={styles.actions}>
            <Pressable onPress={() => onConvert(null)} style={styles.button} accessibilityRole="button">
              <Text style={styles.buttonLabel}>Empty vector layer</Text>
            </Pressable>
            <Pressable onPress={() => onConvert({ colors: count, detail, smooth })} style={[styles.button, styles.primary]} accessibilityRole="button">
              <Text style={styles.primaryLabel}>Trace & convert</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { width: '100%', maxWidth: 460, gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.panel },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12 },
  row: { gap: spacing.xs },
  rowLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.panelRaised },
  chipSelected: { backgroundColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipLabelSelected: { color: colors.onAccent },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' },
  button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.panelRaised },
  buttonLabel: { color: colors.text, fontWeight: '600' },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
}));
