import type { ChatMessage } from '@/features/assistant/groq';
import { searchKnowledge } from '@/features/assistant/knowledge';

/** How many earlier messages travel with each question (keeps requests small and fast). */
const HISTORY = 12;

const PERSONA = `You are Zumi Assistant, a warm, encouraging art mentor built into Zumi, a drawing and painting app for phones and tablets.
You can talk about anything, but you shine at art: ideas for what to draw, themes, colour palettes, composition, anatomy, lighting, manga and comics, painting technique, practice plans and how to do things in Zumi.

How to answer:
- Be concrete and practical. Prefer short sections and bullet points; keep most answers under about 250 words unless asked for more.
- When you suggest a colour palette, ALWAYS give 4–7 colours as hex codes on one line starting with "Palette:" (e.g. "Palette: #2b1b4a #6b2d6b #d1495b #f28f3b #ffd166"), then one short line per colour saying where to use it. Include a dark, a mid and a light value.
- When suggesting things to draw, give specific ideas (subject, action, setting, mood, lighting) and, if useful, a matching palette.
- For "how do I…" questions about Zumi, use the Zumi notes below; never invent features or menus that are not described there. If something isn't covered, say so and suggest the closest available tool.
- Use plain text with simple "- " bullets and short headings; no tables, no HTML.
- If you are unsure, say so briefly instead of guessing.`;

/** System prompt plus the relevant knowledge, prior turns and the new question. */
export function buildMessages(history: readonly { role: 'user' | 'assistant'; content: string }[], question: string): ChatMessage[] {
  // Earlier user turns help with follow-ups like "make it darker".
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const entries = searchKnowledge(`${question} ${lastUser}`, 4);
  const notes = entries.length
    ? `\n\nReference notes (from Zumi's knowledge base; use them when relevant):\n${entries.map((e) => `## ${e.title}\n${e.text}`).join('\n\n')}`
    : '';
  return [
    { role: 'system', content: PERSONA + notes },
    ...history.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];
}

/** Hex colours in a reply (#rgb or #rrggbb), expanded, lowercase, de-duplicated, in order. */
export function extractColors(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = match[1].toLowerCase();
    const full = hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
    if (!out.includes(full)) out.push(full);
  }
  return out;
}

/** A palette worth offering to save: three or more distinct colours (at most 16). */
export function paletteFrom(text: string): string[] | null {
  const colors = extractColors(text);
  return colors.length >= 3 ? colors.slice(0, 16) : null;
}

/** Ready-made questions shown as chips, grouped by what people usually want. */
export const QUICK_CHATS: { label: string; prompt: string }[] = [
  { label: '🎨 What should I draw?', prompt: 'Give me 5 specific ideas for what to draw today, each with a mood, setting and lighting. Make them varied.' },
  { label: '🌈 Palette for a mood', prompt: 'Suggest a colour palette for a cozy, nostalgic evening scene and tell me where to use each colour.' },
  { label: '🧙 Theme ideas', prompt: 'Give me 4 drawing themes (like fantasy, cyberpunk, cottagecore) with a subject idea, key motifs and a palette for each.' },
  { label: '🧑‍🎨 Character idea', prompt: 'Invent an original character for me to draw: personality, outfit, shape language, a pose idea and a palette.' },
  { label: '💡 Lighting tips', prompt: 'How do I shade a character with one strong light source? Explain light side, core shadow, reflected light and cast shadow simply.' },
  { label: '📐 Composition check', prompt: 'Give me a quick checklist to improve the composition of my illustration.' },
  { label: '📚 Manga shading', prompt: 'How do I shade a manga page with screentones in Zumi? Include which tones to use where.' },
  { label: '🧩 Clipping & masks', prompt: 'Explain how to use clipping layers and layer masks in Zumi for flats and shading.' },
  { label: '🖌️ Make a brush', prompt: 'Help me create a custom brush in Zumi’s Brush Studio for soft, textured shading.' },
  { label: '😵 Art block', prompt: 'I have art block. Give me 5 quick, low-pressure exercises to get drawing again.' },
  { label: '🏋️ Practice plan', prompt: 'Make me a one-week practice plan (20–30 minutes a day) to improve my drawing fundamentals.' },
  { label: '🎲 Random challenge', prompt: 'Give me a random drawing challenge: a subject, a twist, a limited palette with hex codes and a time limit.' },
];
