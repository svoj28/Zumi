import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

interface Props {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  keyboardType?: KeyboardTypeOptions;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Single-line text prompt (Alert.prompt is iOS-only). Submits the trimmed, non-empty value. */
export function PromptDialog(props: Props) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onCancel}
      supportedOrientations={['portrait', 'landscape']}>
      {/* Mounted only while visible so the text resets to `initialValue` on every open. */}
      {props.visible ? <PromptBody {...props} /> : null}
    </Modal>
  );
}

function PromptBody({
  title,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  maxLength = 80,
  keyboardType,
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue);

  const trimmed = value.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          autoFocus
          selectTextOnFocus
          maxLength={maxLength}
          keyboardType={keyboardType}
          returnKeyType="done"
          onSubmitEditing={submit}
          style={styles.input}
          accessibilityLabel={title}
        />
        <View style={styles.actions}>
          <Pressable style={styles.button} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primary, !trimmed && styles.disabled]}
            onPress={submit}
            disabled={!trimmed}
            accessibilityRole="button">
            <Text style={styles.primaryLabel}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { width: '100%', maxWidth: 400, padding: spacing.xl, gap: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.panel },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  input: {
    color: colors.text,
    fontSize: 16,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backdrop,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  button: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md },
  cancel: { color: colors.text, fontWeight: '600' },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.4 },
}));
