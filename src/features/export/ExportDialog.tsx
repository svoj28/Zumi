import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  DEFAULT_EXPORT_OPTIONS,
  FORMAT_INFO,
  type ExportImageFormat,
  type ExportOptions,
} from '@/storage/exportService';
import { isVideoExportAvailable } from '@/storage/timelapseExport';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

/** Remembered for the rest of the app session, so repeated exports keep the same settings. */
let lastOptions: ExportOptions = DEFAULT_EXPORT_OPTIONS;

/** Still images, moving images (GIF, MP4 when this build has the video encoder) and layered PSD. */
const formats = (): ExportImageFormat[] => ['png', 'jpeg', 'webp', 'gif', ...(isVideoExportAvailable() ? (['mp4'] as const) : []), 'psd'];

const FORMAT_HINTS: Record<ExportImageFormat, string> = {
  png: 'Lossless still image.',
  jpeg: 'Small still image for sharing.',
  webp: 'Modern still image, small files.',
  gif: 'Still image as a GIF. Up to 1080 px, 256 colours.',
  mp4: 'A short video (2 s) of the artwork. Up to 1080 px.',
  psd: 'Layered file for Photoshop, Clip Studio, Krita and Procreate (still).',
};

interface Props {
  visible: boolean;
  /** Shown under the title, e.g. the canvas size. */
  subtitle?: string;
  onSaveToDevice: (options: ExportOptions) => void;
  onShare: (options: ExportOptions) => void;
  onClose: () => void;
}

/**
 * Image export settings: format, quality (lossy formats) and transparency (formats with alpha),
 * then "Save to device" (photo library) or "Share" (native share sheet).
 */
export function ExportDialog(props: Props) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
      supportedOrientations={['portrait', 'landscape']}>
      {/* Gesture handlers inside a Modal need their own root view on Android. */}
      <GestureHandlerRootView style={styles.flex}>{props.visible ? <ExportBody {...props} /> : null}</GestureHandlerRootView>
    </Modal>
  );
}

function ExportBody({ subtitle, onSaveToDevice, onShare, onClose }: Props) {
  const available = formats();
  const [options, setOptions] = useState<ExportOptions>(() =>
    available.includes(lastOptions.format) ? lastOptions : { ...lastOptions, format: 'png' },
  );
  const info = FORMAT_INFO[options.format];

  const update = (patch: Partial<ExportOptions>) => {
    setOptions((o) => {
      const next = { ...o, ...patch };
      lastOptions = next;
      return next;
    });
  };

  const summary = [
    info.lossy ? `${info.label}, quality ${options.quality}` : options.format === 'psd' ? 'PSD, all layers' : `${info.label}, lossless`,
    info.alpha ? (options.transparent ? 'transparent background' : 'with paper colour') : 'no transparency',
  ].join(' · ');

  return (
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close export">
      <Pressable style={styles.card} onPress={() => {}}>
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <View>
            <Text style={styles.title} accessibilityRole="header">
              Export image
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>

          <View style={styles.segmented} accessibilityRole="radiogroup">
            {available.map((format) => {
              const selected = options.format === format;
              return (
                <Pressable
                  key={format}
                  onPress={() => update({ format })}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}>
                  <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{FORMAT_INFO[format].label}</Text>
                </Pressable>
              );
            })}
          </View>

          {info.lossy ? (
            <Slider
              label="Quality"
              value={options.quality}
              min={10}
              max={100}
              step={1}
              onChange={(quality) => update({ quality: Math.round(quality) })}
            />
          ) : null}

          <Text style={styles.hint}>{FORMAT_HINTS[options.format]}</Text>

          {options.format === 'psd' ? null : info.alpha ? (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Transparent background</Text>
                <Text style={styles.hint}>Leaves out the paper colour; empty areas stay see-through.</Text>
              </View>
              <Switch
                value={options.transparent}
                onValueChange={(transparent) => update({ transparent })}
                trackColor={{ true: colors.accent, false: colors.panelRaised }}
                accessibilityLabel="Transparent background"
              />
            </View>
          ) : (
            <Text style={styles.hint}>{info.label} has no transparency — empty areas become white.</Text>
          )}

          <Text style={styles.hint}>{summary}. Hidden layers, reference images and guides are not included.</Text>

          <View style={styles.actions}>
            <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.secondary]} onPress={() => onSaveToDevice(options)} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>Save to device</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.primary]} onPress={() => onShare(options)} accessibilityRole="button">
              <Text style={styles.primaryLabel}>Share</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { width: '100%', maxWidth: 440, maxHeight: '92%', borderRadius: radius.lg, backgroundColor: colors.panel },
  content: { padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, padding: 3, borderRadius: radius.md, backgroundColor: colors.backdrop },
  segment: { flexGrow: 1, flexBasis: '30%', minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: colors.panelRaised },
  segmentLabel: { color: colors.textDim, fontWeight: '600' },
  segmentLabelSelected: { color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 15 },
  hint: { color: colors.textDim, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
  cancel: { color: colors.text, fontWeight: '600' },
  secondary: { backgroundColor: colors.panelRaised },
  secondaryLabel: { color: colors.text, fontWeight: '700' },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
}));
