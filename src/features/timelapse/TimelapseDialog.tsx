import type { File } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { DrawingDocument } from '@/engine/document/DrawingDocument';
import { formatBytes } from '@/engine/memory';
import { TIMELAPSE_DURATIONS } from '@/engine/timelapse/timelapseFormat';
import { useDocumentVersion } from '@/features/editor/useEditorSession';
import { MAX_WATERMARK_LENGTH, useSettingsStore } from '@/state/settingsStore';
import { assertSharing, saveFileToPhotos, shareFile } from '@/storage/exportService';
import {
  isVideoExportAvailable,
  renderTimelapse,
  TIMELAPSE_FILE_TYPES,
  TimelapseCancelled,
  timelapseOutputSize,
  type TimelapseFormat,
  type WatermarkCorner,
} from '@/storage/timelapseExport';
import {
  deleteTimelapse,
  loadTimelapse,
  timelapseLayers,
  type TimelapseLayerInfo,
  type TimelapseRecorder,
} from '@/storage/timelapseRepository';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';
import { describeError, errorText } from '@/utils/errors';

interface Props {
  visible: boolean;
  doc: DrawingDocument;
  getRecorder: () => TimelapseRecorder | null;
  onClose: () => void;
}

const CORNERS: { id: WatermarkCorner; label: string }[] = [
  { id: 'topLeft', label: 'Top left' },
  { id: 'topRight', label: 'Top right' },
  { id: 'bottomLeft', label: 'Bottom left' },
  { id: 'bottomRight', label: 'Bottom right' },
];

const FORMATS: { id: TimelapseFormat; label: string }[] = [
  { id: 'mp4', label: 'MP4 video' },
  { id: 'gif', label: 'GIF' },
];

/** Remembered for the rest of the app session (the watermark text is saved in settings). */
let lastFormat: TimelapseFormat = 'mp4';
let lastSeconds = 15;
let lastCorner: WatermarkCorner = 'bottomRight';
let lastWatermarkOn = false;
const lastHidden = new Map<string, string[]>();

/**
 * Timelapse for one artwork: whether it records, and export as MP4 or GIF with a chosen length,
 * chosen layers and an optional watermark; then "Save to Photos" or "Share". Also deletes the
 * recording on request.
 */
export function TimelapseDialog(props: Props) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose} supportedOrientations={['portrait', 'landscape']}>
      {props.visible ? <TimelapseBody {...props} /> : null}
    </Modal>
  );
}

type Phase =
  | { kind: 'options' }
  | { kind: 'rendering'; progress: number }
  | { kind: 'done'; file: File; format: TimelapseFormat };

interface Summary {
  frames: number;
  bytes: number;
  layers: TimelapseLayerInfo[];
}

function readSummary(doc: DrawingDocument, recorder: TimelapseRecorder | null): Summary | null {
  // Include the latest edits, which may still be waiting for their debounced capture.
  try {
    recorder?.capture();
  } catch (error) {
    console.warn('[timelapse] Capture failed', error);
  }
  const recording = loadTimelapse(doc.info.id);
  if (!recording) return null;
  return {
    frames: recording.frames.length,
    bytes: recording.state.bytes,
    layers: timelapseLayers(recording, doc.layers.list.map((l) => l.meta.id)),
  };
}

function TimelapseBody({ doc, getRecorder, onClose }: Props) {
  useDocumentVersion(doc);
  const recordByDefault = useSettingsStore((s) => s.recordTimelapse);
  const recording = doc.info.recordTimelapse ?? recordByDefault;
  const videoAvailable = isVideoExportAvailable();
  const watermarkText = useSettingsStore((s) => s.timelapseWatermark);
  const setWatermarkText = useSettingsStore((s) => s.setTimelapseWatermark);

  const [summary, setSummary] = useState<Summary | null>(() => readSummary(doc, getRecorder()));
  const [phase, setPhase] = useState<Phase>({ kind: 'options' });
  const [format, setFormat] = useState<TimelapseFormat>(() => (lastFormat === 'mp4' && !videoAvailable ? 'gif' : lastFormat));
  const [seconds, setSeconds] = useState(lastSeconds);
  const [hidden, setHidden] = useState<string[]>(() => lastHidden.get(doc.info.id) ?? []);
  const [watermarkOn, setWatermarkOn] = useState(lastWatermarkOn);
  const [corner, setCorner] = useState<WatermarkCorner>(lastCorner);
  const cancelled = useRef(false);

  useEffect(() => {
    lastFormat = format;
    lastSeconds = seconds;
    lastCorner = corner;
    lastWatermarkOn = watermarkOn;
    lastHidden.set(doc.info.id, hidden);
  }, [format, seconds, corner, watermarkOn, hidden, doc.info.id]);

  // Closing the dialog (or the editor) stops a render in progress.
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const out = timelapseOutputSize(doc.info.width, doc.info.height, format);
  const visibleLayers = summary ? summary.layers.filter((l) => !hidden.includes(l.id)).length : 0;
  const canCreate = summary !== null && visibleLayers > 0 && (!watermarkOn || watermarkText.trim().length > 0);

  const create = async () => {
    cancelled.current = false;
    setPhase({ kind: 'rendering', progress: 0 });
    try {
      const file = await renderTimelapse(
        doc.info.id,
        doc.info.name,
        { format, seconds, hiddenLayerIds: hidden, watermark: watermarkOn ? { text: watermarkText, corner } : null },
        (progress: number) => {
          if (!cancelled.current) setPhase({ kind: 'rendering', progress });
        },
        () => cancelled.current,
      );
      if (!cancelled.current) setPhase({ kind: 'done', file, format });
    } catch (error) {
      if (error instanceof TimelapseCancelled || cancelled.current) return;
      console.error('[timelapse] Export failed', error);
      setPhase({ kind: 'options' });
      const d = describeError(error, 'Timelapse export failed');
      Alert.alert(d.title, errorText(d));
    }
  };

  const cancelRender = () => {
    cancelled.current = true;
    setPhase({ kind: 'options' });
  };

  const runFileAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const d = describeError(error, 'Could not export the timelapse');
      Alert.alert(d.title, errorText(d));
    }
  };

  const saveToPhotos = (file: File, type: TimelapseFormat) =>
    runFileAction(async () => {
      const result = await saveFileToPhotos(file, TIMELAPSE_FILE_TYPES[type]);
      if (result === 'saved') Alert.alert('Saved to Photos', 'The timelapse was added to your photo library.');
      else if (result === 'denied') Alert.alert('Permission needed', 'Allow Zumi to add photos in your device settings to save the timelapse.');
    });

  const share = (file: File, type: TimelapseFormat) =>
    runFileAction(async () => {
      await assertSharing();
      await shareFile(file, TIMELAPSE_FILE_TYPES[type]);
    });

  const deleteRecording = () =>
    Alert.alert('Delete timelapse recording?', 'Your artwork is not affected. Recording starts again from the artwork as it is now.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            const recorder = getRecorder();
            if (recorder) recorder.reset();
            else deleteTimelapse(doc.info.id);
          } catch (error) {
            const d = describeError(error, 'Could not delete the recording');
            Alert.alert(d.title, errorText(d));
          }
          setSummary(readSummary(doc, getRecorder()));
        },
      },
    ]);

  const toggleLayer = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const rendering = phase.kind === 'rendering';

  return (
    <Pressable style={styles.backdrop} onPress={rendering ? undefined : onClose} accessibilityLabel="Close timelapse">
      <Pressable style={styles.card} onPress={() => {}}>
        <ScrollView contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={styles.title} accessibilityRole="header">
              Timelapse
            </Text>
            <Text style={styles.subtitle}>
              {summary
                ? `${summary.frames} recorded ${summary.frames === 1 ? 'step' : 'steps'} · ${formatBytes(summary.bytes)} on this device`
                : 'No recording yet'}
            </Text>
          </View>

          {phase.kind === 'done' ? (
            <>
              {phase.format === 'gif' ? (
                <Image
                  source={{ uri: phase.file.uri }}
                  style={[styles.preview, { aspectRatio: out.width / out.height }]}
                  contentFit="contain"
                  accessibilityLabel="Timelapse preview"
                />
              ) : (
                <View style={styles.videoReady}>
                  <Ionicons name="film-outline" size={36} color={colors.accent} />
                  <Text style={styles.rowLabel}>Video ready</Text>
                  <Text style={styles.hint}>
                    MP4 · {out.width} × {out.height} · {formatBytes(phase.file.size ?? 0)}
                  </Text>
                </View>
              )}
              <View style={styles.actions}>
                <Pressable style={styles.button} onPress={() => setPhase({ kind: 'options' })} accessibilityRole="button">
                  <Text style={styles.cancel}>Back</Text>
                </Pressable>
                <View style={styles.spacer} />
                <Pressable style={[styles.button, styles.secondary]} onPress={() => void saveToPhotos(phase.file, phase.format)} accessibilityRole="button">
                  <Text style={styles.secondaryLabel}>Save to Photos</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.primary]} onPress={() => void share(phase.file, phase.format)} accessibilityRole="button">
                  <Text style={styles.primaryLabel}>Share</Text>
                </Pressable>
              </View>
            </>
          ) : rendering ? (
            <View style={styles.rendering} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.rowLabel}>Creating timelapse… {Math.round(phase.progress * 100)}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(phase.progress * 100)}%` }]} />
              </View>
              <Pressable style={[styles.button, styles.secondary]} onPress={cancelRender} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Record this artwork</Text>
                  <Text style={styles.hint}>
                    {recording
                      ? 'Each change is added to the timelapse (changed areas only).'
                      : 'Recording is paused for this artwork. What was recorded so far can still be exported.'}
                  </Text>
                </View>
                <Switch
                  value={recording}
                  onValueChange={(value) => doc.setRecordTimelapse(value)}
                  trackColor={{ true: colors.accent, false: colors.panelRaised }}
                  accessibilityLabel="Record timelapse for this artwork"
                />
              </View>

              {summary ? (
                <>
                  <View style={styles.group}>
                    <Text style={styles.groupLabel}>Format</Text>
                    <View style={styles.segmented} accessibilityRole="radiogroup">
                      {FORMATS.map((f) => {
                        const selected = format === f.id;
                        const disabled = f.id === 'mp4' && !videoAvailable;
                        return (
                          <Pressable
                            key={f.id}
                            onPress={() => setFormat(f.id)}
                            disabled={disabled}
                            style={[styles.segment, selected && styles.segmentSelected, disabled && styles.disabled]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled }}>
                            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{f.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.hint}>
                      {!videoAvailable
                        ? 'MP4 needs an updated build of the app that includes the video encoder. GIF works everywhere.'
                        : format === 'mp4'
                          ? `Smooth 30 fps video, ${out.width} × ${out.height}. Best for sharing.`
                          : `Animated image, ${out.width} × ${out.height}. Up to 256 colours per frame.`}
                    </Text>
                  </View>

                  <View style={styles.group}>
                    <Text style={styles.groupLabel}>Length</Text>
                    <View style={styles.segmented} accessibilityRole="radiogroup">
                      {TIMELAPSE_DURATIONS.map((s) => {
                        const selected = seconds === s;
                        return (
                          <Pressable
                            key={s}
                            onPress={() => setSeconds(s)}
                            style={[styles.segment, selected && styles.segmentSelected]}
                            accessibilityRole="radio"
                            accessibilityLabel={`${s} seconds`}
                            accessibilityState={{ selected }}>
                            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{s}s</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.group}>
                    <Text style={styles.groupLabel}>Layers in the timelapse</Text>
                    {summary.layers.map((layer) => {
                      const shown = !hidden.includes(layer.id);
                      return (
                        <View key={layer.id} style={styles.row}>
                          <View style={styles.rowText}>
                            <Text style={[styles.rowLabel, !shown && styles.excluded]} numberOfLines={1}>
                              {layer.name}
                            </Text>
                            {!layer.current ? <Text style={styles.hint}>Deleted later — still part of the timelapse</Text> : null}
                          </View>
                          <Switch
                            value={shown}
                            onValueChange={() => toggleLayer(layer.id)}
                            trackColor={{ true: colors.accent, false: colors.panelRaised }}
                            accessibilityLabel={`Show ${layer.name} in timelapse`}
                          />
                        </View>
                      );
                    })}
                    {visibleLayers === 0 ? <Text style={styles.warning}>Show at least one layer.</Text> : null}
                  </View>

                  <View style={styles.group}>
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>Watermark</Text>
                        <Text style={styles.hint}>Your name or handle, shown in a corner of every frame.</Text>
                      </View>
                      <Switch
                        value={watermarkOn}
                        onValueChange={setWatermarkOn}
                        trackColor={{ true: colors.accent, false: colors.panelRaised }}
                        accessibilityLabel="Add watermark"
                      />
                    </View>
                    {watermarkOn ? (
                      <>
                        <TextInput
                          value={watermarkText}
                          onChangeText={setWatermarkText}
                          placeholder="e.g. @yourname"
                          placeholderTextColor={colors.textDim}
                          maxLength={MAX_WATERMARK_LENGTH}
                          style={styles.input}
                          autoCorrect={false}
                          accessibilityLabel="Watermark text"
                        />
                        {!watermarkText.trim() ? <Text style={styles.warning}>Enter the watermark text.</Text> : null}
                        <View style={styles.corners} accessibilityRole="radiogroup">
                          {CORNERS.map((c) => {
                            const selected = corner === c.id;
                            return (
                              <Pressable
                                key={c.id}
                                onPress={() => setCorner(c.id)}
                                style={[styles.corner, selected && styles.segmentSelected]}
                                accessibilityRole="radio"
                                accessibilityState={{ selected }}>
                                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{c.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </>
                    ) : null}
                  </View>

                  <Text style={styles.hint}>
                    Only the areas that changed are recorded, so the recording stays small. The {format === 'mp4' ? 'video' : 'GIF'} is created on this device.
                  </Text>
                </>
              ) : (
                <Text style={styles.hint}>
                  {recording
                    ? 'Zumi records each change while you paint. Paint something, then come back here.'
                    : 'Turn on recording above, then paint to build a timelapse.'}
                </Text>
              )}

              <View style={styles.actions}>
                {summary ? (
                  <Pressable style={styles.button} onPress={deleteRecording} accessibilityRole="button" accessibilityLabel="Delete timelapse recording">
                    <Text style={styles.danger}>Delete recording</Text>
                  </Pressable>
                ) : null}
                <View style={styles.spacer} />
                <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
                  <Text style={styles.cancel}>Close</Text>
                </Pressable>
                {summary ? (
                  <Pressable
                    style={[styles.button, styles.primary, !canCreate && styles.disabled]}
                    onPress={() => void create()}
                    disabled={!canCreate}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canCreate }}>
                    <Text style={styles.primaryLabel}>{format === 'mp4' ? 'Create video' : 'Create GIF'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { width: '100%', maxWidth: 460, maxHeight: '92%', borderRadius: radius.lg, backgroundColor: colors.panel },
  content: { padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  group: { gap: spacing.sm },
  groupLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  segmented: { flexDirection: 'row', gap: spacing.xs, padding: 3, borderRadius: radius.md, backgroundColor: colors.backdrop },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: colors.panelRaised },
  segmentLabel: { color: colors.textDim, fontWeight: '600' },
  segmentLabelSelected: { color: colors.text },
  corners: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, padding: 3, borderRadius: radius.md, backgroundColor: colors.backdrop },
  corner: { flexGrow: 1, flexBasis: '45%', minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 15 },
  excluded: { color: colors.textDim, textDecorationLine: 'line-through' },
  hint: { color: colors.textDim, fontSize: 12 },
  warning: { color: colors.warning, fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backdrop,
    color: colors.text,
    fontSize: 15,
  },
  videoReady: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl, borderRadius: radius.md, backgroundColor: colors.backdrop },
  preview: { width: '100%', borderRadius: radius.md, backgroundColor: colors.backdrop },
  rendering: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  progressTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colors.backdrop, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
  button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
  cancel: { color: colors.text, fontWeight: '600' },
  danger: { color: colors.danger, fontWeight: '600' },
  secondary: { backgroundColor: colors.panelRaised },
  secondaryLabel: { color: colors.text, fontWeight: '700' },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.4 },
}));
