import { buildMessages, extractColors, paletteFrom, QUICK_CHATS } from '@/features/assistant/assistantPrompt';
import { describeStatus } from '@/features/assistant/groq';
import { KNOWLEDGE, searchKnowledge } from '@/features/assistant/knowledge';

describe('knowledge base', () => {
  it('has unique ids and non-empty entries', () => {
    const ids = KNOWLEDGE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of KNOWLEDGE) {
      expect(e.text.length).toBeGreaterThan(100);
      expect(e.tags.length).toBeGreaterThan(2);
    }
  });

  it.each([
    ['give me a colour palette for a spooky night', 'color-mood'],
    ['how do I shade with a core shadow and reflected light', 'light-shadow'],
    ['how do clipping masks work in zumi', 'zumi-layers'],
    ['tips for screentone in my manga', 'manga-tones'],
    ['what should I draw today? I need ideas', 'ideas'],
    ['how many heads tall is an anime character', 'proportions'],
    ['how to make my own brush in brush studio', 'zumi-brushes'],
    ['two point perspective with vanishing points', 'perspective'],
  ])('finds the right entry for "%s"', (query, id) => {
    expect(searchKnowledge(query, 3).map((e) => e.id)).toContain(id);
  });

  it('returns nothing for empty or filler-only questions', () => {
    expect(searchKnowledge('')).toEqual([]);
    expect(searchKnowledge('what is the')).toEqual([]);
  });
});

describe('assistant prompt', () => {
  it('puts the system prompt and relevant notes first, then history, then the question', () => {
    const history = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello!' },
    ];
    const messages = buildMessages(history, 'suggest a sunset palette');
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Palettes by mood and theme');
    expect(messages.slice(1, 3)).toEqual(history);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'suggest a sunset palette' });
  });

  it('keeps only recent history', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    expect(buildMessages(history, 'q').length).toBe(1 + 12 + 1);
  });

  it('every quick chat has a label and a prompt', () => {
    for (const q of QUICK_CHATS) {
      expect(q.label.trim()).not.toBe('');
      expect(q.prompt.length).toBeGreaterThan(20);
    }
  });
});

describe('palette extraction', () => {
  it('finds, expands and de-duplicates hex colours in order', () => {
    expect(extractColors('Palette: #2B1B4A #fff #2b1b4a and #d1495b.')).toEqual(['#2b1b4a', '#ffffff', '#d1495b']);
  });

  it('ignores things that only look like colours', () => {
    expect(extractColors('Issue #12 and #1234567 and #abcd')).toEqual([]);
  });

  it('offers a palette only with three or more colours', () => {
    expect(paletteFrom('use #000 and #fff')).toBeNull();
    expect(paletteFrom('#111111 #222222 #333333')).toEqual(['#111111', '#222222', '#333333']);
  });
});

describe('Groq errors', () => {
  it('explains common statuses in plain language', () => {
    expect(describeStatus(401)).toMatch(/key/i);
    expect(describeStatus(429)).toMatch(/rate limit/i);
    expect(describeStatus(503)).toMatch(/busy|unavailable/i);
    expect(describeStatus(418, 'teapot')).toContain('teapot');
  });
});
