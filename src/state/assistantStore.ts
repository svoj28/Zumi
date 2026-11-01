import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createId } from '@/engine/ids';
import { DEFAULT_MODEL } from '@/features/assistant/groq';
import { fileStateStorage } from '@/storage/settingsStorage';

/**
 * AI assistant state: the chosen Groq model and the current conversation. Persisted locally in
 * `settings/zumi.assistant.json`. The API key is NOT here — it lives in secure storage.
 */

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Epoch ms. */
  at: number;
  /** A failed request (shown with a retry); never sent back to the model. */
  error?: boolean;
}

/** Older messages are dropped beyond this, so the file stays small. */
const MAX_MESSAGES = 80;

interface AssistantState {
  model: string;
  messages: AssistantMessage[];
  setModel: (model: string) => void;
  addMessage: (message: Omit<AssistantMessage, 'id' | 'at'>) => string;
  removeMessage: (id: string) => void;
  clear: () => void;
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set) => ({
      model: DEFAULT_MODEL,
      messages: [],
      setModel: (model) => set({ model: model.trim() || DEFAULT_MODEL }),
      addMessage: (message) => {
        const id = createId('m_');
        set((s) => ({ messages: [...s.messages, { ...message, id, at: Date.now() }].slice(-MAX_MESSAGES) }));
        return id;
      },
      removeMessage: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
      clear: () => set({ messages: [] }),
    }),
    {
      name: 'zumi.assistant',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: ({ model, messages }) => ({ model, messages }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AssistantState>;
        const messages = Array.isArray(p.messages)
          ? p.messages.filter(
              (m): m is AssistantMessage =>
                !!m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
            )
          : [];
        return {
          ...current,
          model: typeof p.model === 'string' && p.model ? p.model : DEFAULT_MODEL,
          messages: messages.slice(-MAX_MESSAGES),
        };
      },
    },
  ),
);
