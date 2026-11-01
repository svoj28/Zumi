import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatBytes, layerMemoryBudget } from '@/engine/memory';
import { listModels, SUGGESTED_MODELS } from '@/features/assistant/groq';
import { useAssistantStore } from '@/state/assistantStore';
import { useGalleryStore } from '@/state/galleryStore';
import { MAX_STABILIZATION, useSettingsStore, type PressureCurve } from '@/state/settingsStore';
import { APP_BACKUP_FOLDER_NAME, pickBackupFolder } from '@/storage/backupService';
import { deleteGroqKey, getGroqKey, maskKey, setGroqKey } from '@/storage/secrets';
import { clearTemporaryFiles, getStorageStats, type StorageStats } from '@/storage/storageStats';
import { IconButton } from '@/ui/IconButton';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed, TOUCH_TARGET, type ThemePreference } from '@/ui/theme';

const TWO_COLUMN_WIDTH = 820;

const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];
const CURVE_CHOICES: { value: PressureCurve; label: string }[] = [
  { value: 'soft', label: 'Soft' },
  { value: 'linear', label: 'Linear' },
  { value: 'firm', label: 'Firm' },
];
const HOLD_DELAYS = [
  { value: 300, label: 'Short' },
  { value: 450, label: 'Medium' },
  { value: 750, label: 'Long' },
];
const AUTOSAVE_CHOICES = [
  { value: 0, label: 'Off' },
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
];
const QUICKSHAPE_DELAYS = [
  { value: 400, label: 'Short' },
  { value: 600, label: 'Medium' },
  { value: 900, label: 'Long' },
];
const BACKGROUNDS = ['#ffffff', 'transparent', '#f6efe2', '#e8eef4', '#8f8f95', '#1c1c20'];

/**
 * App-wide preferences: canvas & gestures, brush input, interface and storage. Everything is
 * stored locally and applies immediately. On wide screens the sections flow into two columns.
 */
export function SettingsScreen() {
  const s = useSettingsStore();
  const emptyTrash = useGalleryStore((g) => g.emptyTrash);
  const { width } = useWindowDimensions();
  const twoColumns = width >= TWO_COLUMN_WIDTH;

  const [stats, setStats] = useState<StorageStats | null>(null);
  const refreshStats = useCallback(() => {
    // Deferred so the screen paints before the directory walk.
    const timer = setTimeout(() => {
      try {
        setStats(getStorageStats());
      } catch (error) {
        console.warn('[settings] Could not read storage usage', error);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useFocusEffect(refreshStats);

  const clearTemp = () => {
    const freed = clearTemporaryFiles();
    refreshStats();
    Alert.alert('Temporary files cleared', `${formatBytes(freed)} freed. Your artwork was not touched.`);
  };

  const confirmEmptyTrash = () => {
    if (!stats?.trashCount) return;
    Alert.alert('Empty Recently Deleted?', `${stats.trashCount} artwork will be permanently deleted. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty',
        style: 'destructive',
        onPress: () => {
          emptyTrash();
          refreshStats();
        },
      },
    ]);
  };

  const chooseBackupFolder = async () => {
    try {
      const folder = await pickBackupFolder();
      if (folder) s.setBackupFolder(folder);
    } catch (error) {
      console.warn('[settings] Could not choose a folder', error);
      Alert.alert('Couldn’t use that folder', 'Choose another folder, or keep saving to Zumi Backups.');
    }
  };

  const canvas = (
    <Section title="Canvas" icon="brush-outline">
      <Row label="Default background" hint="Preselected when you create new artwork.">
        <View style={styles.swatches}>
          {BACKGROUNDS.map((bg) => {
            const selected = s.defaultBackground === bg;
            return (
              <Pressable
                key={bg}
                onPress={() => s.setDefaultBackground(bg)}
                style={[styles.swatchRing, selected && styles.swatchRingSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={bg === 'transparent' ? 'Transparent' : `Colour ${bg}`}>
                {bg === 'transparent' ? (
                  <View style={[styles.swatch, styles.transparentSwatch]}>
                    <Ionicons name="grid-outline" size={16} color={colors.textDim} />
                  </View>
                ) : (
                  <View style={[styles.swatch, { backgroundColor: bg }]} />
                )}
              </Pressable>
            );
          })}
        </View>
      </Row>
      <Toggle
        label="Rotate with two fingers"
        hint="Turn the canvas like a sheet of paper. It snaps upright near 0°."
        value={s.rotationEnabled}
        onChange={s.setRotationEnabled}
      />
      <Toggle label="Two-finger tap to undo" hint="A quick tap with two fingers." value={s.twoFingerTapUndo} onChange={s.setTwoFingerTapUndo} />
      <Toggle label="Three-finger tap to redo" hint="A quick tap with three fingers." value={s.threeFingerTapRedo} onChange={s.setThreeFingerTapRedo} />
      <Toggle
        label="Press and hold for eyedropper"
        hint="Hold still on the canvas to pick a colour; lifting confirms without painting."
        value={s.eyedropperHold}
        onChange={s.setEyedropperHold}
      />
      {s.eyedropperHold ? (
        <Row label="Eyedropper hold delay">
          <Segmented choices={HOLD_DELAYS} value={s.eyedropperDelayMs} onChange={s.setEyedropperDelayMs} />
        </Row>
      ) : null}
      <Row label="Autosave" hint="Saves a moment after you pause, and at least this often while you keep drawing.">
        <Segmented choices={AUTOSAVE_CHOICES} value={s.autosaveSeconds} onChange={s.setAutosaveSeconds} />
      </Row>
    </Section>
  );

  const brush = (
    <Section title="Brush & stylus" icon="pencil-outline">
      <Row label="Default smoothing" hint="Extra stabilization added to every brush for steadier lines. Higher values make strokes trail the pen.">
        <Slider
          label="Stabilization"
          value={s.stabilization}
          min={0}
          max={MAX_STABILIZATION}
          format={(v) => `${Math.round((v / MAX_STABILIZATION) * 100)}%`}
          onChange={s.setStabilization}
        />
      </Row>
      <Row label="Pressure curve" hint="Soft reaches full size with a light touch; firm needs more pressure.">
        <Segmented choices={CURVE_CHOICES} value={s.pressureCurve} onChange={s.setPressureCurve} />
      </Row>
      <Toggle
        label="QuickShape: hold to snap"
        hint="Hold the pen still at the end of a stroke to turn it into a clean line, circle, ellipse or polygon."
        value={s.quickShape}
        onChange={s.setQuickShape}
      />
      {s.quickShape ? (
        <Row label="QuickShape hold time">
          <Segmented choices={QUICKSHAPE_DELAYS} value={s.quickShapeDelayMs} onChange={s.setQuickShapeDelayMs} />
        </Row>
      ) : null}
      <Toggle
        label="Simulate pressure without a stylus"
        hint="Fingers and styluses without pressure vary the line with speed (for brushes that use it)."
        value={s.simulatePressure}
        onChange={s.setSimulatePressure}
      />
      <Toggle
        label="Automatic palm rejection"
        hint="After a stylus touches the canvas, fingers and palms move the canvas instead of painting, and a palm resting during a pen stroke is ignored."
        value={s.autoPalmRejection}
        onChange={s.setAutoPalmRejection}
      />
      <Toggle
        label="Draw with stylus only"
        hint="Always use fingers for navigation, even before a stylus is detected."
        value={s.stylusOnlyDrawing}
        onChange={s.setStylusOnlyDrawing}
      />
      <Text style={styles.note}>
        Pressure, tilt and palm rejection depend on what your device reports. Many phones and capacitive styluses report
        neither pressure nor pointer type: drawing then uses full (or simulated) pressure, and a palm cannot be told apart from
        a finger.
      </Text>
    </Section>
  );

  const ui = (
    <Section title="Interface" icon="color-palette-outline">
      <Row label="Theme" hint="Dark keeps the focus on your colours.">
        <Segmented choices={THEME_CHOICES} value={s.theme} onChange={s.setTheme} />
      </Row>
      <Toggle
        label="Left-handed layout"
        hint="Moves the tool rail and quick sliders to the right edge."
        value={s.leftHanded}
        onChange={s.setLeftHanded}
      />
      <StatRow label="Welcome tips" value="Gestures and where to find things" actions={[{ label: 'Show again', onPress: () => {
        s.setOnboardingSeen(false);
        router.navigate('/');
      } }]} />
      <Toggle
        label="Compact interface"
        hint="Smaller toolbar buttons; secondary tools move into the ••• menu, leaving more room for the canvas."
        value={s.compactUi}
        onChange={s.setCompactUi}
      />
    </Section>
  );

  const storage = (
    <Section title="Storage" icon="server-outline">
      <Text style={styles.note}>Everything is stored only on this device.</Text>
      <Toggle
        label="Record timelapse by default"
        hint="For new artwork and artwork without its own choice. Only the area that changed after each edit is saved, so recording uses little storage. Each artwork can be switched on or off in Export › Timelapse."
        value={s.recordTimelapse}
        onChange={s.setRecordTimelapse}
      />
      <StatRow
        label="Artwork"
        value={stats ? `${stats.projectCount} ${stats.projectCount === 1 ? 'artwork' : 'artworks'} · ${formatBytes(stats.artworkBytes)}` : '…'}
      />
      <StatRow
        label="Recently deleted"
        value={stats ? `${stats.trashCount} · ${formatBytes(stats.trashBytes)}` : '…'}
        actions={
          stats?.trashCount
            ? [
                { label: 'View', onPress: () => router.navigate({ pathname: '/', params: { view: 'trash' } }) },
                { label: 'Empty', destructive: true, onPress: confirmEmptyTrash },
              ]
            : undefined
        }
      />
      <StatRow
        label="Save .zumi files to"
        value={s.backupFolder?.name ?? APP_BACKUP_FOLDER_NAME}
        actions={[
          { label: 'Choose folder…', onPress: () => void chooseBackupFolder() },
          ...(s.backupFolder ? [{ label: 'Use default', onPress: () => s.setBackupFolder(null) }] : []),
        ]}
      />
      <Text style={styles.note}>
        Export › Save .zumi file (or ••• on an artwork in the gallery) saves an editable copy with all layers here. Restore it
        from the gallery with the backup button.
        {Platform.OS === 'ios'
          ? ' Zumi Backups is in the Files app under On My iPhone › Zumi. A chosen folder may need to be chosen again after the app restarts.'
          : ' The default Zumi Backups folder is inside the app; choose a folder (e.g. Downloads or Documents) to keep files where other apps can see them.'}
      </Text>
      <StatRow label="Temporary files" value={stats ? formatBytes(stats.tempBytes) : '…'} actions={[{ label: 'Clear', onPress: clearTemp }]} />
      <Text style={styles.note}>
        Temporary files are exports, picked images and caches. Clearing them never deletes artwork, Recently Deleted or
        settings.
      </Text>
      <StatRow label="Canvas memory budget" value={formatBytes(layerMemoryBudget())} />
      <Text style={styles.note}>
        Each layer uses width × height × 4 bytes of memory (a 4000 × 4000 layer ≈ 61 MB), so how many layers an artwork can
        have depends on its size and this device.
      </Text>
    </Section>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <Text style={styles.title} accessibilityRole="header">
          Settings
        </Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, twoColumns && styles.contentWide]}>
        {twoColumns ? (
          <View style={styles.columns}>
            <View style={styles.column}>
              {canvas}
              {brush}
            </View>
            <View style={styles.column}>
              {ui}
              <AssistantSettings />
              {storage}
            </View>
          </View>
        ) : (
          <>
            {canvas}
            {brush}
            {ui}
            <AssistantSettings />
            {storage}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- AI assistant ----------------------------------------------------------------------------

/**
 * Groq API key (kept in the device's secure storage) and model for the AI assistant. Saving a
 * key tests it by loading the models it can use.
 */
function AssistantSettings() {
  const model = useAssistantStore((a) => a.model);
  const setModel = useAssistantStore((a) => a.setModel);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    void getGroqKey().then((key) => live && setSaved(key));
    return () => {
      live = false;
    };
  }, []);

  const check = async (key: string) => {
    setChecking(true);
    try {
      const found = await listModels(key);
      setModels(found);
      setStatus({ ok: true, text: `Connected · ${found.length} chat models available` });
    } catch (error) {
      setStatus({ ok: false, text: (error as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    try {
      await setGroqKey(key);
      setSaved(key);
      setDraft('');
      await check(key);
    } catch (error) {
      console.warn('[settings] Could not save the Groq key', error);
      Alert.alert('Couldn’t save the key', 'Secure storage is not available on this device.');
    }
  };

  const remove = () =>
    Alert.alert('Remove the Groq key?', 'The assistant stops working until you add a key again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void deleteGroqKey().then(() => {
            setSaved(null);
            setStatus(null);
            setModels([]);
          });
        },
      },
    ]);

  // Suggested models first, then any others this key can use.
  const choices = [
    ...SUGGESTED_MODELS,
    ...models.filter((id) => !SUGGESTED_MODELS.some((m) => m.id === id)).map((id) => ({ id, label: id })),
    ...(SUGGESTED_MODELS.some((m) => m.id === model) || models.includes(model) ? [] : [{ id: model, label: model }]),
  ];

  return (
    <Section title="AI assistant" icon="sparkles-outline">
      <Row
        label="Groq API key"
        hint={saved ? `Saved: ${maskKey(saved)} (stored in this device’s secure storage)` : 'Needed for the assistant. Create a free key at console.groq.com/keys and paste it here.'}>
        <View style={styles.keyRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={saved ? 'Paste a new key to replace it' : 'gsk_…'}
            placeholderTextColor={colors.textDim}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.keyInput}
            accessibilityLabel="Groq API key"
          />
          <Pressable
            onPress={() => void save()}
            disabled={!draft.trim()}
            style={({ pressed }) => [styles.smallButton, styles.primaryButton, !draft.trim() && styles.dimmed, pressed && styles.pressed]}
            accessibilityRole="button">
            <Text style={styles.primaryLabel}>Save</Text>
          </Pressable>
        </View>
        <View style={styles.keyActions}>
          <Pressable onPress={() => void Linking.openURL('https://console.groq.com/keys')} style={styles.smallButton} accessibilityRole="link">
            <Text style={styles.smallButtonLabel}>Get a key</Text>
          </Pressable>
          {saved ? (
            <>
              <Pressable onPress={() => void check(saved)} disabled={checking} style={styles.smallButton} accessibilityRole="button">
                <Text style={styles.smallButtonLabel}>{checking ? 'Testing…' : 'Test connection'}</Text>
              </Pressable>
              <Pressable onPress={remove} style={styles.smallButton} accessibilityRole="button">
                <Text style={[styles.smallButtonLabel, styles.destructive]}>Remove</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        {status ? <Text style={[styles.hint, { color: status.ok ? colors.success : colors.danger }]}>{status.text}</Text> : null}
      </Row>
      <Row label="Model" hint="GPT-OSS 120B gives the most detailed answers; 20B answers fastest. Test the connection to list every model your key can use.">
        <View style={styles.modelList}>
          {choices.map((c) => {
            const selected = c.id === model;
            return (
              <Pressable
                key={c.id}
                onPress={() => setModel(c.id)}
                style={[styles.modelChip, selected && styles.segmentSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}>
                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]} numberOfLines={1}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Row>
      <Text style={styles.note}>
        When you use the assistant, your questions (and recent messages of the chat) are sent to Groq to get an answer. Your key and
        chats stay on this device otherwise.
      </Text>
    </Section>
  );
}

// ---- building blocks -----------------------------------------------------------------------

function Section({ title, icon, children }: { title: string; icon: ComponentProps<typeof Ionicons>['name']; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={colors.accent} />
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[styles.row, styles.inlineRow]}>
      <View style={styles.inlineText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.panelRaised }}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Segmented<T extends string | number>({
  choices,
  value,
  onChange,
}: {
  choices: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {choices.map((c) => {
        const selected = c.value === value;
        return (
          <Pressable
            key={String(c.value)}
            onPress={() => onChange(c.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}>
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatRow({
  label,
  value,
  actions,
}: {
  label: string;
  value: string;
  actions?: { label: string; destructive?: boolean; onPress: () => void }[];
}) {
  return (
    <View style={[styles.row, styles.inlineRow]}>
      <View style={styles.inlineText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
      {actions?.map((a) => (
        <Pressable
          key={a.label}
          onPress={a.onPress}
          style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${a.label} ${label.toLowerCase()}`}>
          <Text style={[styles.smallButtonLabel, a.destructive && styles.destructive]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backdrop },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    title: { color: colors.text, fontSize: 24, fontWeight: '800' },
    content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
    contentWide: { alignSelf: 'center', width: '100%', maxWidth: 1200 },
    columns: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
    column: { flex: 1, gap: spacing.xl },
    section: { gap: spacing.sm },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
    sectionTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
    card: { borderRadius: radius.lg, backgroundColor: colors.panel, paddingVertical: spacing.xs, overflow: 'hidden' },
    row: {
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    inlineText: { flex: 1, gap: 2 },
    rowLabel: { color: colors.text, fontSize: 15, fontWeight: '500' },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 16 },
    note: { color: colors.textDim, fontSize: 12, lineHeight: 16, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    swatchRing: { padding: 3, borderRadius: radius.pill, borderWidth: 2, borderColor: 'transparent' },
    swatchRingSelected: { borderColor: colors.accent },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    transparentSwatch: { backgroundColor: colors.panelRaised },
    segmented: {
      flexDirection: 'row',
      gap: spacing.xs,
      padding: 3,
      marginTop: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.backdrop,
    },
    segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    segmentSelected: { backgroundColor: colors.panelRaised },
    segmentLabel: { color: colors.textDim, fontWeight: '600' },
    segmentLabelSelected: { color: colors.text },
    statValue: { color: colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
    smallButton: {
      minHeight: TOUCH_TARGET - 8,
      minWidth: TOUCH_TARGET,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.panelRaised,
    },
    smallButtonLabel: { color: colors.text, fontWeight: '600' },
    destructive: { color: colors.danger },
    pressed: { opacity: 0.7 },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    keyInput: {
      flex: 1,
      minHeight: TOUCH_TARGET,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.backdrop,
      color: colors.text,
      fontSize: 15,
    },
    keyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    primaryButton: { backgroundColor: colors.accent },
    primaryLabel: { color: colors.onAccent, fontWeight: '700' },
    dimmed: { opacity: 0.4 },
    modelList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    modelChip: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.backdrop,
    },
  }),
);
