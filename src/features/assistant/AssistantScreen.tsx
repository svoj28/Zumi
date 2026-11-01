import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildMessages, paletteFrom, QUICK_CHATS } from '@/features/assistant/assistantPrompt';
import { chatCompletion, SUGGESTED_MODELS } from '@/features/assistant/groq';
import { useAssistantStore, type AssistantMessage } from '@/state/assistantStore';
import { usePaletteStore } from '@/state/paletteStore';
import { useToolStore } from '@/state/toolStore';
import { getGroqKey } from '@/storage/secrets';
import { IconButton } from '@/ui/IconButton';
import { colors, radius, spacing, themed } from '@/ui/theme';

/**
 * AI assistant (Groq): ask anything — what to draw, themes, palettes, technique, how to use Zumi.
 * Answers are grounded in Zumi's knowledge base (see `knowledge.ts`); palettes in an answer can
 * be saved or picked as the brush colour.
 */
export function AssistantScreen() {
  const messages = useAssistantStore((s) => s.messages);
  const model = useAssistantStore((s) => s.model);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pending = useRef<AbortController | null>(null);

  // Re-checked on focus: the key may have just been added in Settings.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void getGroqKey().then((key) => live && setHasKey(!!key));
      return () => {
        live = false;
      };
    }, []),
  );

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const apiKey = await getGroqKey();
    if (!apiKey) {
      setHasKey(false);
      return;
    }
    const store = useAssistantStore.getState();
    const history = store.messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    store.addMessage({ role: 'user', content: text });
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const reply = await chatCompletion({ apiKey, model: store.model, messages: buildMessages(history, text), signal: controller.signal });
      useAssistantStore.getState().addMessage({ role: 'assistant', content: reply });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        useAssistantStore.getState().addMessage({ role: 'assistant', content: (error as Error)?.message ?? 'Something went wrong.', error: true });
      }
    } finally {
      pending.current = null;
      setBusy(false);
    }
  };

  /** Re-asks the question behind a failed answer. */
  const retry = (failed: AssistantMessage) => {
    const store = useAssistantStore.getState();
    const index = store.messages.findIndex((m) => m.id === failed.id);
    const question = store.messages[index - 1];
    store.removeMessage(failed.id);
    if (question?.role === 'user') {
      store.removeMessage(question.id);
      void ask(question.content);
    }
  };

  const clearChat = () =>
    Alert.alert('Start a new chat?', 'This conversation will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New chat',
        style: 'destructive',
        onPress: () => {
          pending.current?.abort();
          useAssistantStore.getState().clear();
        },
      },
    ]);

  const modelLabel = SUGGESTED_MODELS.find((m) => m.id === model)?.label ?? model;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">
            AI Assistant
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Groq · {modelLabel}
          </Text>
        </View>
        <IconButton icon="create-outline" label="New chat" onPress={clearChat} disabled={messages.length === 0} />
        <IconButton icon="settings-outline" label="Assistant settings" onPress={() => router.push('/settings')} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {hasKey === false ? <KeyCard /> : null}
          {messages.length === 0 ? <Welcome onPick={(p) => void ask(p)} disabled={busy || hasKey === false} /> : null}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onRetry={() => retry(m)} />
          ))}
          {busy ? (
            <View style={[styles.bubble, styles.assistantBubble, styles.thinking]}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.thinkingText}>Thinking…</Text>
            </View>
          ) : null}
        </ScrollView>

        {messages.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow} keyboardShouldPersistTaps="handled">
            {QUICK_CHATS.map((q) => (
              <QuickChip key={q.label} label={q.label} onPress={() => void ask(q.prompt)} disabled={busy || hasKey === false} />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything: ideas, palettes, techniques…"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            multiline
            maxLength={2000}
            accessibilityLabel="Message to the assistant"
          />
          {busy ? (
            <Pressable onPress={() => pending.current?.abort()} style={styles.send} accessibilityRole="button" accessibilityLabel="Stop">
              <Ionicons name="stop" size={18} color={colors.onAccent} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void ask(input)}
              disabled={!input.trim() || hasKey === false}
              style={[styles.send, (!input.trim() || hasKey === false) && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel="Send">
              <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function KeyCard() {
  return (
    <View style={styles.keyCard}>
      <Ionicons name="key-outline" size={22} color={colors.accent} />
      <View style={styles.flex}>
        <Text style={styles.keyTitle}>Add your Groq API key</Text>
        <Text style={styles.keyText}>The assistant uses your own Groq key. Create one at console.groq.com, then paste it in Settings › AI assistant.</Text>
      </View>
      <Pressable onPress={() => router.push('/settings')} style={styles.keyButton} accessibilityRole="button">
        <Text style={styles.keyButtonLabel}>Settings</Text>
      </Pressable>
    </View>
  );
}

function Welcome({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  return (
    <View style={styles.welcome}>
      <View style={styles.welcomeIcon}>
        <Ionicons name="sparkles" size={28} color={colors.accent} />
      </View>
      <Text style={styles.welcomeTitle}>Hi! What shall we make today?</Text>
      <Text style={styles.welcomeText}>
        Ask me anything — ideas for what to draw, themes, colour palettes, lighting, anatomy, manga techniques, or how to do something in Zumi.
      </Text>
      <View style={styles.quickGrid}>
        {QUICK_CHATS.map((q) => (
          <QuickChip key={q.label} label={q.label} onPress={() => onPick(q.prompt)} disabled={disabled} />
        ))}
      </View>
    </View>
  );
}

function QuickChip({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.chip, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button">
      <Text style={styles.chipLabel}>{label}</Text>
    </Pressable>
  );
}

function MessageBubble({ message, onRetry }: { message: AssistantMessage; onRetry: () => void }) {
  const mine = message.role === 'user';
  const palette = !mine && !message.error ? paletteFrom(message.content) : null;
  return (
    <View style={[styles.bubble, mine ? styles.userBubble : styles.assistantBubble, message.error && styles.errorBubble]}>
      {mine ? (
        <Text style={styles.userText} selectable>
          {message.content}
        </Text>
      ) : (
        <FormattedText text={message.content} />
      )}
      {palette ? <PaletteStrip colors={palette} /> : null}
      {message.error ? (
        <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
          <Ionicons name="refresh" size={14} color={colors.accent} />
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Light formatting for replies: headings, bullets and **bold** markers removed. */
function FormattedText({ text }: { text: string }) {
  const lines = text.replace(/\*\*|__/g, '').split('\n');
  return (
    <View style={styles.formatted}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={styles.gap} />;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <Text key={i} style={styles.heading} selectable>
              {heading[1]}
            </Text>
          );
        }
        const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          const numbered = /^\s*(\d+)[.)]/.exec(line);
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletMark}>{numbered ? `${numbered[1]}.` : '•'}</Text>
              <Text style={styles.assistantText} selectable>
                {bullet[1]}
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={styles.assistantText} selectable>
            {line}
          </Text>
        );
      })}
    </View>
  );
}

/** Swatches found in a reply: tap one to paint with it, or save them all as a palette. */
function PaletteStrip({ colors: list }: { colors: string[] }) {
  const setColor = useToolStore((s) => s.setColor);
  const [saved, setSaved] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <View style={styles.palette}>
      <View style={styles.swatches}>
        {list.map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              setColor(c);
              setPicked(c);
            }}
            style={[styles.swatch, { backgroundColor: c }, picked === c && styles.swatchPicked]}
            accessibilityRole="button"
            accessibilityLabel={`Use colour ${c}`}
          />
        ))}
      </View>
      <View style={styles.paletteActions}>
        <Text style={styles.paletteHint}>{picked ? `Brush colour set to ${picked}` : 'Tap a colour to paint with it'}</Text>
        <Pressable
          onPress={() => {
            usePaletteStore.getState().createPaletteWithColors('AI palette', list);
            setSaved(true);
          }}
          disabled={saved}
          style={[styles.saveButton, saved && styles.disabled]}
          accessibilityRole="button">
          <Ionicons name={saved ? 'checkmark' : 'bookmark-outline'} size={14} color={colors.onAccent} />
          <Text style={styles.saveLabel}>{saved ? 'Saved' : 'Save palette'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    flex: { flex: 1 },
    root: { flex: 1, backgroundColor: colors.backdrop },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    headerText: { flex: 1 },
    title: { color: colors.text, fontSize: 20, fontWeight: '800' },
    subtitle: { color: colors.textDim, fontSize: 12 },
    messages: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
    bubble: { maxWidth: '92%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
    userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: radius.sm },
    assistantBubble: { alignSelf: 'flex-start', backgroundColor: colors.panel, borderBottomLeftRadius: radius.sm },
    errorBubble: { borderWidth: 1, borderColor: colors.danger },
    userText: { color: colors.onAccent, fontSize: 15, lineHeight: 21 },
    assistantText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
    formatted: { gap: 2 },
    gap: { height: spacing.xs },
    heading: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: spacing.xs },
    bulletRow: { flexDirection: 'row', gap: spacing.xs },
    bulletMark: { color: colors.accent, fontSize: 15, lineHeight: 22, minWidth: 14 },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    thinkingText: { color: colors.textDim, fontSize: 14 },
    retry: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32 },
    retryLabel: { color: colors.accent, fontWeight: '700', fontSize: 13 },
    keyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.panel,
    },
    keyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    keyText: { color: colors.textDim, fontSize: 13, marginTop: 2 },
    keyButton: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent },
    keyButtonLabel: { color: colors.onAccent, fontWeight: '700' },
    welcome: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
    welcomeIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDim },
    welcomeTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    welcomeText: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 520 },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
    quickRow: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    chip: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.panelRaised,
    },
    chipLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 140,
      paddingHorizontal: spacing.md,
      paddingTop: 11,
      paddingBottom: 11,
      borderRadius: radius.lg,
      backgroundColor: colors.panel,
      color: colors.text,
      fontSize: 15,
    },
    send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.7 },
    palette: { gap: spacing.xs, marginTop: spacing.xs },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    swatch: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
    swatchPicked: { borderWidth: 3, borderColor: colors.accent },
    paletteActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    paletteHint: { flex: 1, color: colors.textDim, fontSize: 12 },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 32,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    saveLabel: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  }),
);
