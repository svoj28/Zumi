import { Ionicons } from '@expo/vector-icons';
import { Canvas, Image } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { MAX_CANVAS_SIDE, MIN_CANVAS_SIDE, type CanvasAnchor, type DrawingDocument, type EditResult } from '@/engine/document/DrawingDocument';
import { renderTextImage, TEXT_FONTS, type TextAlignment, type TextFont, type TextSpec } from '@/engine/render/text';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

/** Centred card over a dimmed backdrop; gestures (sliders) need their own root in a Modal. */
function Dialog({ visible, title, subtitle, onClose, children }: { visible: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={`Close ${title}`}>
          <Pressable style={styles.card} onPress={() => {}}>
            <ScrollView contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              {visible ? children : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.segment, selected && styles.segmentSelected]} accessibilityRole="radio" accessibilityState={{ selected }}>
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Actions({ onCancel, onConfirm, confirmLabel, disabled }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; disabled?: boolean }) {
  return (
    <View style={styles.actions}>
      <Pressable style={styles.button} onPress={onCancel} accessibilityRole="button">
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
      <Pressable
        style={[styles.button, styles.primary, disabled && styles.disabled]}
        onPress={onConfirm}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}>
        <Text style={styles.primaryLabel}>{confirmLabel}</Text>
      </Pressable>
    </View>
  );
}

// ---- text ------------------------------------------------------------------------------------

let lastText: Omit<TextSpec, 'text' | 'color'> = {
  font: 'sans',
  size: 64,
  bold: true,
  italic: false,
  align: 'center',
  outline: null,
  lineHeight: 1.15,
};

/** Text tool: type lettering, pick font and style; it is added as a new layer to place. */
export function TextDialog({
  visible,
  color,
  canvasSide,
  onAdd,
  onClose,
}: {
  visible: boolean;
  color: string;
  canvasSide: number;
  onAdd: (spec: TextSpec) => void;
  onClose: () => void;
}) {
  return (
    <Dialog visible={visible} title="Add text" subtitle="The text becomes a new layer you can then move, resize and rotate." onClose={onClose}>
      <TextBody color={color} canvasSide={canvasSide} onAdd={onAdd} onClose={onClose} />
    </Dialog>
  );
}

function TextBody({ color, canvasSide, onAdd, onClose }: { color: string; canvasSide: number; onAdd: (spec: TextSpec) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [style, setStyle] = useState(lastText);
  const spec: TextSpec = { ...style, text, color };
  const update = (patch: Partial<typeof style>) => setStyle((s) => ({ ...s, ...patch }));
  // A small live preview (the size is scaled down to fit).
  const preview = useMemo(() => {
    const scale = Math.min(1, 40 / Math.max(1, spec.size));
    return renderTextImage({ ...spec, size: spec.size * scale, outline: spec.outline ? { ...spec.outline, width: spec.outline.width * scale } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, style, color]);
  const maxSize = Math.max(200, Math.round(canvasSide / 2));

  return (
    <>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Type your text"
        placeholderTextColor={colors.textDim}
        multiline
        autoFocus
        style={styles.textInput}
        accessibilityLabel="Text"
      />
      <View style={styles.previewBox}>
        {preview ? (
          <Canvas style={{ width: Math.min(300, preview.width()), height: Math.min(140, preview.height()) }} pointerEvents="none">
            <Image image={preview} x={0} y={0} width={Math.min(300, preview.width())} height={Math.min(140, preview.height())} fit="contain" />
          </Canvas>
        ) : (
          <Text style={styles.hint}>Preview</Text>
        )}
      </View>
      <Segmented options={TEXT_FONTS} value={style.font} onChange={(font: TextFont) => update({ font })} />
      <Slider label="Size" value={style.size} min={8} max={maxSize} curve="quadratic" format={(v) => `${Math.round(v)} px`} onChange={(size) => update({ size: Math.round(size) })} />
      <View style={styles.toggles}>
        <ToggleChip icon="text" label="Bold" value={style.bold} onChange={(bold) => update({ bold })} />
        <ToggleChip icon="code-slash-outline" label="Italic" value={style.italic} onChange={(italic) => update({ italic })} />
        <Segmented
          options={[
            { id: 'left', label: 'Left' },
            { id: 'center', label: 'Centre' },
            { id: 'right', label: 'Right' },
          ]}
          value={style.align}
          onChange={(align: TextAlignment) => update({ align })}
        />
      </View>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Outline</Text>
          <Text style={styles.hint}>A white border around the letters, as in manga sound effects.</Text>
        </View>
        <Switch
          value={style.outline !== null}
          onValueChange={(on) => update({ outline: on ? { color: '#ffffff', width: Math.max(2, Math.round(style.size / 12)) } : null })}
          trackColor={{ true: colors.accent, false: colors.panelRaised }}
          accessibilityLabel="Outline"
        />
      </View>
      {style.outline ? (
        <>
          <Slider
            label="Outline width"
            value={style.outline.width}
            min={1}
            max={Math.max(8, style.size / 4)}
            format={(v) => `${Math.round(v)} px`}
            onChange={(width) => update({ outline: { color: style.outline?.color ?? '#ffffff', width } })}
          />
          <Segmented
            options={[
              { id: '#ffffff', label: 'White outline' },
              { id: '#1b1b1f', label: 'Black outline' },
            ]}
            value={style.outline.color === '#1b1b1f' ? '#1b1b1f' : '#ffffff'}
            onChange={(c) => update({ outline: { color: c, width: style.outline?.width ?? 4 } })}
          />
        </>
      ) : null}
      <Slider label="Line spacing" value={style.lineHeight} min={0.8} max={2} format={(v) => `${v.toFixed(2)}×`} onChange={(lineHeight) => update({ lineHeight })} />
      <Text style={styles.hint}>Uses the current colour. Fonts come from your device.</Text>
      <Actions
        onCancel={onClose}
        confirmLabel="Add text"
        disabled={!text.trim()}
        onConfirm={() => {
          lastText = style;
          onAdd(spec);
        }}
      />
    </>
  );
}

function ToggleChip({ icon, label, value, onChange }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.chip, value && styles.chipOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}>
      <Ionicons name={icon} size={16} color={value ? colors.accent : colors.text} />
      <Text style={[styles.chipLabel, value && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

// ---- canvas size -------------------------------------------------------------------------------

type CanvasTab = 'resize' | 'scale' | 'rotate';

const ANCHORS: CanvasAnchor[] = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));

/** Canvas size: resize (crop or extend), scale the whole artwork, or rotate/flip the canvas. */
export function CanvasSizeDialog({
  visible,
  doc,
  onDone,
  onClose,
}: {
  visible: boolean;
  doc: DrawingDocument;
  /** Called with the result; the editor shows errors and re-fits the view. */
  onDone: (result: EditResult) => void;
  onClose: () => void;
}) {
  return (
    <Dialog visible={visible} title="Canvas" subtitle={`Now ${doc.info.width} × ${doc.info.height} px`} onClose={onClose}>
      <CanvasBody doc={doc} onDone={onDone} onClose={onClose} />
    </Dialog>
  );
}

function CanvasBody({ doc, onDone, onClose }: { doc: DrawingDocument; onDone: (result: EditResult) => void; onClose: () => void }) {
  const { width: w0, height: h0 } = doc.info;
  const [tab, setTab] = useState<CanvasTab>('resize');
  const [w, setW] = useState(String(w0));
  const [h, setH] = useState(String(h0));
  const [keepRatio, setKeepRatio] = useState(true);
  const [anchor, setAnchor] = useState<CanvasAnchor>({ x: 0.5, y: 0.5 });
  const width = Math.round(Number(w));
  const height = Math.round(Number(h));
  const valid =
    Number.isFinite(width) && Number.isFinite(height) && width >= MIN_CANVAS_SIDE && height >= MIN_CANVAS_SIDE && width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE;

  const setWidth = (text: string) => {
    setW(text);
    const n = Number(text);
    if (keepRatio && Number.isFinite(n) && n > 0) setH(String(Math.max(1, Math.round((n * h0) / w0))));
  };
  const setHeight = (text: string) => {
    setH(text);
    const n = Number(text);
    if (keepRatio && Number.isFinite(n) && n > 0) setW(String(Math.max(1, Math.round((n * w0) / h0))));
  };

  return (
    <>
      <Segmented
        options={[
          { id: 'resize', label: 'Canvas size' },
          { id: 'scale', label: 'Scale image' },
          { id: 'rotate', label: 'Rotate / flip' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'rotate' ? (
        <View style={styles.grid}>
          <BigButton icon="refresh-outline" label="Rotate 90° right" onPress={() => onDone(doc.rotateCanvas(1))} />
          <BigButton icon="reload-outline" label="Rotate 90° left" onPress={() => onDone(doc.rotateCanvas(3))} />
          <BigButton icon="sync-outline" label="Rotate 180°" onPress={() => onDone(doc.rotateCanvas(2))} />
          <BigButton icon="swap-horizontal" label="Flip horizontally" onPress={() => onDone(doc.flipCanvas('x'))} />
          <BigButton icon="swap-vertical-outline" label="Flip vertically" onPress={() => onDone(doc.flipCanvas('y'))} />
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            {tab === 'resize'
              ? 'Adds empty space or crops the edges; the artwork keeps its size. Choose where the artwork sits.'
              : 'Makes the whole artwork bigger or smaller (every layer is resampled).'}
          </Text>
          <View style={styles.sizeRow}>
            <SizeField label="Width" value={w} onChange={setWidth} />
            <Text style={styles.times}>×</Text>
            <SizeField label="Height" value={h} onChange={setHeight} />
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, styles.rowText]}>Keep proportions</Text>
            <Switch value={keepRatio} onValueChange={setKeepRatio} trackColor={{ true: colors.accent, false: colors.panelRaised }} accessibilityLabel="Keep proportions" />
          </View>
          {tab === 'resize' ? (
            <View style={styles.anchorGrid} accessibilityLabel="Where the artwork sits in the new canvas">
              {ANCHORS.map((a) => {
                const selected = a.x === anchor.x && a.y === anchor.y;
                return (
                  <Pressable
                    key={`${a.x}-${a.y}`}
                    onPress={() => setAnchor(a)}
                    style={[styles.anchorCell, selected && styles.anchorCellOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Anchor ${['top', 'middle', 'bottom'][a.y * 2]} ${['left', 'centre', 'right'][a.x * 2]}`}>
                    {selected ? <Ionicons name="image-outline" size={16} color={colors.onAccent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {!valid ? <Text style={[styles.hint, styles.error]}>Sizes must be between {MIN_CANVAS_SIDE} and {MAX_CANVAS_SIDE} px.</Text> : null}
          <Actions
            onCancel={onClose}
            confirmLabel={tab === 'resize' ? 'Resize canvas' : 'Scale image'}
            disabled={!valid || (width === w0 && height === h0)}
            onConfirm={() => onDone(tab === 'resize' ? doc.resizeCanvas(width, height, anchor) : doc.scaleCanvas(width, height))}
          />
        </>
      )}
    </>
  );
}

function SizeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.sizeField}>
      <Text style={styles.hint}>{label} (px)</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="number-pad" style={styles.numberInput} accessibilityLabel={`${label} in pixels`} selectTextOnFocus />
    </View>
  );
}

function BigButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.bigButton, pressed && styles.pressed]} accessibilityRole="button">
      <Ionicons name={icon} size={22} color={colors.text} />
      <Text style={styles.bigLabel}>{label}</Text>
    </Pressable>
  );
}

// ---- history ---------------------------------------------------------------------------------

/** Undo history: every step, oldest first; tap one to go back (or forward) to it. */
export function HistoryDialog({ visible, doc, onClose }: { visible: boolean; doc: DrawingDocument; onClose: () => void }) {
  const { undo, redo } = doc.history.entries();
  return (
    <Dialog visible={visible} title="History" subtitle="Tap a step to go back to it. Steps after it can be redone until you draw again." onClose={onClose}>
      <View style={styles.historyList}>
        <HistoryRow label="Opened artwork" state={undo.length === 0 ? 'current' : 'past'} onPress={() => doc.undoSteps(undo.length)} />
        {undo.map((label, i) => (
          <HistoryRow key={`u${i}`} label={label} state={i === undo.length - 1 ? 'current' : 'past'} onPress={() => doc.undoSteps(undo.length - 1 - i)} />
        ))}
        {redo.map((label, i) => (
          <HistoryRow key={`r${i}`} label={label} state="future" onPress={() => doc.redoSteps(i + 1)} />
        ))}
      </View>
      <Text style={styles.hint}>Older steps are dropped automatically to save memory.</Text>
      <Pressable style={[styles.button, styles.primary, styles.alignEnd]} onPress={onClose} accessibilityRole="button">
        <Text style={styles.primaryLabel}>Done</Text>
      </Pressable>
    </Dialog>
  );
}

function HistoryRow({ label, state, onPress }: { label: string; state: 'past' | 'current' | 'future'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'current'}
      style={({ pressed }) => [styles.historyRow, state === 'current' && styles.historyCurrent, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: state === 'current' }}>
      <Ionicons
        name={state === 'current' ? 'radio-button-on' : state === 'past' ? 'ellipse' : 'ellipse-outline'}
        size={12}
        color={state === 'future' ? colors.textDim : colors.accent}
      />
      <Text style={[styles.historyLabel, state === 'future' && styles.historyFuture]} numberOfLines={1}>
        {label}
      </Text>
      {state === 'current' ? <Text style={styles.historyBadge}>Now</Text> : null}
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.5)' },
    card: { width: '100%', maxWidth: 460, maxHeight: '92%', borderRadius: radius.lg, backgroundColor: colors.panel },
    content: { padding: spacing.xl, gap: spacing.md },
    title: { color: colors.text, fontSize: 17, fontWeight: '700' },
    subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
    segmented: { flexDirection: 'row', gap: spacing.xs, padding: 3, borderRadius: radius.md, backgroundColor: colors.backdrop, flexGrow: 1 },
    segment: { flex: 1, minHeight: 36, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    segmentSelected: { backgroundColor: colors.panelRaised },
    segmentLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
    segmentLabelSelected: { color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { color: colors.text, fontSize: 15 },
    hint: { color: colors.textDim, fontSize: 12 },
    error: { color: colors.danger },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
    button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
    alignEnd: { alignSelf: 'flex-end' },
    cancel: { color: colors.text, fontWeight: '600' },
    primary: { backgroundColor: colors.accent },
    primaryLabel: { color: colors.onAccent, fontWeight: '700' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.7 },
    textInput: {
      minHeight: 72,
      maxHeight: 160,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.backdrop,
      color: colors.text,
      fontSize: 16,
      textAlignVertical: 'top',
    },
    previewBox: { minHeight: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: '#8f8f95', padding: spacing.sm },
    toggles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.panelRaised },
    chipOn: { backgroundColor: colors.accentDim },
    chipLabel: { color: colors.text, fontWeight: '600', fontSize: 13 },
    chipLabelOn: { color: colors.accent },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    bigButton: {
      width: '47%',
      minHeight: 72,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderRadius: radius.md,
      backgroundColor: colors.panelRaised,
    },
    bigLabel: { color: colors.text, fontWeight: '600', fontSize: 13, textAlign: 'center' },
    sizeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    sizeField: { flex: 1, gap: 4 },
    numberInput: {
      minHeight: TOUCH_TARGET,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.backdrop,
      color: colors.text,
      fontSize: 16,
      fontVariant: ['tabular-nums'],
    },
    times: { color: colors.textDim, fontSize: 18, paddingBottom: 10 },
    anchorGrid: { width: 132, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignSelf: 'center' },
    anchorCell: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' },
    anchorCellOn: { backgroundColor: colors.accent },
    historyList: { gap: 2 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
    historyCurrent: { backgroundColor: colors.accentDim },
    historyLabel: { flex: 1, color: colors.text, fontSize: 14 },
    historyFuture: { color: colors.textDim },
    historyBadge: { color: colors.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  }),
);