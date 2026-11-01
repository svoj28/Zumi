import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useSettingsStore } from '@/state/settingsStore';
import { Slider } from '@/ui/Slider';
import { colors, radius, spacing, themed } from '@/ui/theme';
import { PERCENT_ENTRY } from '@/ui/valueEntry';

const HOLD_DELAYS = [
  { ms: 300, label: 'Short' },
  { ms: 450, label: 'Medium' },
  { ms: 750, label: 'Long' },
];

const AUTOSAVE_CHOICES = [
  { seconds: 0, label: 'Off' },
  { seconds: 15, label: '15 s' },
  { seconds: 30, label: '30 s' },
  { seconds: 60, label: '1 min' },
];

/** Workspace preferences. Stored locally and applied immediately. */
export function SettingsPanel() {
  const stylusOnly = useSettingsStore((s) => s.stylusOnlyDrawing);
  const setStylusOnly = useSettingsStore((s) => s.setStylusOnlyDrawing);
  const leftHanded = useSettingsStore((s) => s.leftHanded);
  const setLeftHanded = useSettingsStore((s) => s.setLeftHanded);
  const autosave = useSettingsStore((s) => s.autosaveSeconds);
  const setAutosave = useSettingsStore((s) => s.setAutosaveSeconds);
  const hold = useSettingsStore((s) => s.eyedropperHold);
  const setHold = useSettingsStore((s) => s.setEyedropperHold);
  const holdDelay = useSettingsStore((s) => s.eyedropperDelayMs);
  const setHoldDelay = useSettingsStore((s) => s.setEyedropperDelayMs);
  const tapUndo = useSettingsStore((s) => s.twoFingerTapUndo);
  const setTapUndo = useSettingsStore((s) => s.setTwoFingerTapUndo);
  const tapRedo = useSettingsStore((s) => s.threeFingerTapRedo);
  const setTapRedo = useSettingsStore((s) => s.setThreeFingerTapRedo);
  const stabilizer = useSettingsStore((s) => s.stabilizer);
  const setStabilizer = useSettingsStore((s) => s.setStabilizer);
  const strength = useSettingsStore((s) => s.stabilizerStrength);
  const setStrength = useSettingsStore((s) => s.setStabilizerStrength);
  const finish = useSettingsStore((s) => s.stabilizerFinish);
  const setFinish = useSettingsStore((s) => s.setStabilizerFinish);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Settings</Text>
      <Pressable
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.allSettings, pressed && styles.pressed]}
        accessibilityRole="button">
        <Text style={styles.allSettingsLabel}>All settings (theme, pressure, storage…)</Text>
      </Pressable>
      <Toggle
        label="Stabilizer"
        hint="The brush glides after your finger, turning shaky movement into smooth lines and curves. The blue line shows where the brush is while you draw."
        value={stabilizer}
        onChange={setStabilizer}
      />
      {stabilizer ? (
        <>
          <Slider
            label="Strength"
            value={strength}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            entry={PERCENT_ENTRY}
            onChange={setStrength}
          />
          <Toggle
            label="Finish line to finger"
            hint="When you lift, the line glides the rest of the way to where your finger was. Off: it ends where the brush is."
            value={finish}
            onChange={setFinish}
          />
        </>
      ) : null}
      <Toggle
        label="Draw with stylus only"
        hint="Fingers pan the canvas instead of painting (palm rejection)."
        value={stylusOnly}
        onChange={setStylusOnly}
      />
      <Toggle
        label="Press and hold for eyedropper"
        hint="Hold a finger or stylus still on the canvas to pick a colour; lift to confirm without painting."
        value={hold}
        onChange={setHold}
      />
      {hold ? (
        <View style={styles.segmented}>
          {HOLD_DELAYS.map((d) => (
            <Pressable
              key={d.ms}
              onPress={() => setHoldDelay(d.ms)}
              style={[styles.segment, holdDelay === d.ms && styles.segmentSelected]}
              accessibilityRole="button"
              accessibilityLabel={`${d.label} hold, ${d.ms} milliseconds`}
              accessibilityState={{ selected: holdDelay === d.ms }}>
              <Text style={[styles.segmentLabel, holdDelay === d.ms && styles.segmentLabelSelected]}>{d.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Toggle
        label="Two-finger tap to undo"
        hint="A quick tap with two fingers. Pinching, panning or rotating never triggers it."
        value={tapUndo}
        onChange={setTapUndo}
      />
      <Toggle label="Three-finger tap to redo" hint="A quick tap with three fingers." value={tapRedo} onChange={setTapRedo} />
      <Toggle label="Left-handed layout" hint="Moves the tool rail to the right side." value={leftHanded} onChange={setLeftHanded} />
      <View style={styles.group}>
        <Text style={styles.rowLabel}>Autosave</Text>
        <View style={styles.segmented}>
          {AUTOSAVE_CHOICES.map((c) => (
            <Pressable
              key={c.seconds}
              onPress={() => setAutosave(c.seconds)}
              style={[styles.segment, autosave === c.seconds && styles.segmentSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: autosave === c.seconds }}>
              <Text style={[styles.segmentLabel, autosave === c.seconds && styles.segmentLabelSelected]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          Saves a moment after you pause, and at least this often while you keep drawing. Artwork is always saved when you
          leave the editor or switch apps.
        </Text>
      </View>
    </ScrollView>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.group}>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.panelRaised }} />
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  allSettings: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.panelRaised },
  allSettingsLabel: { color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  group: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: colors.text, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.backdrop },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: colors.panelRaised },
  segmentLabel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  segmentLabelSelected: { color: colors.text },
}));
