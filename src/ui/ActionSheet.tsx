import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, themed, TOUCH_TARGET } from '@/ui/theme';

const DISMISS_DELAY_IOS = 350;

export interface ActionSheetOption {
  label: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  selected?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  title?: string;
  message?: string;
  options: ActionSheetOption[];
  onClose: () => void;
}

/** Cross-platform bottom action sheet (Android has no native equivalent to iOS's). */
export function ActionSheet({ visible, title, message, options, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <SafeAreaView edges={['bottom']} style={styles.safe}>
          {/* Inner Pressable swallows taps so they don't close the sheet. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            {title ? (
              <View style={styles.header}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                {message ? <Text style={styles.message}>{message}</Text> : null}
              </View>
            ) : null}
            <ScrollView bounces={false} style={styles.list}>
              {options.map((option) => {
                const tint = option.destructive ? colors.danger : colors.text;
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !!option.selected }}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    onPress={() => {
                      onClose();
                      // iOS drops modals/alerts presented while another modal is dismissing.
                      setTimeout(option.onPress, Platform.OS === 'ios' ? DISMISS_DELAY_IOS : 0);
                    }}>
                    {option.icon ? <Ionicons name={option.icon} size={20} color={tint} /> : null}
                    <Text style={[styles.optionLabel, { color: tint }]}>{option.label}</Text>
                    {option.selected ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  safe: { alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: 560,
    backgroundColor: colors.panel,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.sm,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  message: { color: colors.textDim, fontSize: 13 },
  list: { flexGrow: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET + 8,
    paddingHorizontal: spacing.lg,
  },
  optionPressed: { backgroundColor: colors.panelRaised },
  optionLabel: { flex: 1, fontSize: 15 },
  cancel: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.panelRaised,
  },
  cancelLabel: { color: colors.text, fontWeight: '600' },
}));
