/**
 * Minimal client for Groq's OpenAI-compatible chat API
 * (https://console.groq.com/docs — `POST /openai/v1/chat/completions`).
 *
 * Requests go straight from the device to Groq with the user's own key; nothing passes through
 * any other server.
 */

const BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Production chat models at the time of writing (the Llama 3.x models were retired in
 * August 2026). The settings screen can also load the live list from `/models`.
 */
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const SUGGESTED_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (best answers)' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fastest)' },
];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class GroqError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'GroqError';
  }
}

/** A plain-language explanation for an HTTP status (Groq's documented error codes). */
export function describeStatus(status: number, detail?: string): string {
  switch (status) {
    case 401:
      return 'The Groq API key was rejected. Check it in Settings › AI assistant.';
    case 403:
      return 'This Groq key isn’t allowed to use that model.';
    case 404:
      return 'That model isn’t available on Groq any more. Pick another one in Settings › AI assistant.';
    case 413:
      return 'The conversation is too long. Start a new chat.';
    case 429:
      return 'Groq’s rate limit was reached. Wait a moment and try again.';
    case 498:
    case 500:
    case 502:
    case 503:
      return 'Groq is busy or unavailable right now. Try again in a little while.';
    default:
      return detail ? `Groq error ${status}: ${detail}` : `Groq error ${status}.`;
  }
}

async function errorFrom(response: Response): Promise<GroqError> {
  let detail: string | undefined;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message;
  } catch {
    // Not JSON; the status says enough.
  }
  return new GroqError(describeStatus(response.status, detail), response.status);
}

/** Sends a chat and returns the assistant's reply text. */
export async function chatCompletion(params: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: 0.8,
        max_completion_tokens: 2048,
        // GPT-OSS models think before answering; keep that thinking out of the reply.
        ...(params.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'medium', include_reasoning: false } : {}),
      }),
      signal: params.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new GroqError('Couldn’t reach Groq. Check your internet connection.', null);
  }
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GroqError('Groq sent an empty answer. Try asking again.', response.status);
  return text;
}

/** Chat models available to this key (ids), newest list from Groq. */
export async function listModels(apiKey: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new GroqError('Couldn’t reach Groq. Check your internet connection.', null);
  }
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { data?: { id?: string; active?: boolean }[] };
  return (body.data ?? [])
    .filter((m) => typeof m.id === 'string' && m.active !== false)
    .map((m) => m.id as string)
    // Speech, moderation and guard models can't chat.
    .filter((id) => !/whisper|tts|guard|playai|orpheus/i.test(id))
    .sort();
}
