import * as SecureStore from 'expo-secure-store';

/**
 * Secrets (API keys) live in the platform keychain / keystore via expo-secure-store — never in
 * the JSON settings files, backups or exports.
 */

const GROQ_KEY = 'zumi.groq_api_key';

export async function getGroqKey(): Promise<string | null> {
  try {
    const key = await SecureStore.getItemAsync(GROQ_KEY);
    return key && key.trim() ? key.trim() : null;
  } catch (error) {
    console.warn('[secrets] Could not read the Groq key', error);
    return null;
  }
}

export async function setGroqKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(GROQ_KEY, key.trim());
}

export async function deleteGroqKey(): Promise<void> {
  await SecureStore.deleteItemAsync(GROQ_KEY);
}

/** "gsk_…abcd" — enough to recognise the key without showing it. */
export function maskKey(key: string): string {
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}
