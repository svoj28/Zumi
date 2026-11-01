/**
 * Zumi themes. Dark is the default studio look (low distraction, so artwork colours read
 * accurately); light and "follow the system" are available in Settings.
 *
 * `colors` always reflects the active palette and `themed()` builds a style sheet per palette
 * on first use, so existing `styles.x` / `colors.x` reads stay unchanged. Values are read at
 * render time, which is why screen contents remount when the theme changes (ThemeBoundary):
 * memoized trees then pick up the new palette.
 *
 * Neither may be captured by worklets (they are Proxies) — read values on the JS side first.
 */

export type ThemeName = 'dark' | 'light';
export type ThemePreference = ThemeName | 'system';

const dark = {
  backdrop: '#1a1a1e',
  panel: '#232328',
  panelRaised: '#2d2d34',
  border: '#3a3a43',
  text: '#f3f3f6',
  textDim: '#a3a3ae',
  accent: '#ff8a4c',
  accentDim: '#5a3524',
  /** Text/icons on an accent-filled button. */
  onAccent: '#1a1a1e',
  danger: '#ff5d62',
  success: '#5cc98a',
  warning: '#f0b43c',
  canvasBackdrop: '#2a2a2f',
  /** Translucent panels floating over the canvas. */
  floating: 'rgba(35,35,40,0.94)',
  /** Translucent pills (toasts, badges) over the canvas; text on them uses `text`. */
  overlay: 'rgba(20,20,24,0.72)',
};

export type Palette = { [K in keyof typeof dark]: string };

const light: Palette = {
  backdrop: '#f2f2f5',
  panel: '#ffffff',
  panelRaised: '#e8e8ee',
  border: '#cfcfd8',
  text: '#1c1c21',
  textDim: '#5d5d69',
  accent: '#e0672a',
  accentDim: '#fbd9c6',
  onAccent: '#1a1a1e',
  danger: '#cf2f35',
  success: '#23874f',
  warning: '#a86a00',
  canvasBackdrop: '#d8d8de',
  floating: 'rgba(255,255,255,0.95)',
  overlay: 'rgba(255,255,255,0.9)',
};

const PALETTES: Record<ThemeName, Palette> = { dark, light };

let currentName: ThemeName = 'dark';

export function activeTheme(): ThemeName {
  return currentName;
}

/** Switches the palette used by `colors` and `themed()` styles. Call before rendering. */
export function applyTheme(name: ThemeName): void {
  currentName = name;
}

/** A palette by name — for code that must not depend on the global (e.g. the root layout). */
export function paletteFor(name: ThemeName): Palette {
  return PALETTES[name];
}

export function resolveTheme(preference: ThemePreference, system: string | null | undefined): ThemeName {
  if (preference === 'system') return system === 'light' ? 'light' : 'dark';
  return preference;
}

/** The active palette. Read values at render time; never capture it in a worklet. */
export const colors: Palette = new Proxy({} as Palette, {
  get: (_, key) => PALETTES[currentName][key as keyof Palette],
});

/**
 * Wraps a style-sheet factory so it is built once per palette, on first use:
 *   const styles = themed(() => StyleSheet.create({ ... colors.panel ... }));
 */
export function themed<T extends object>(factory: () => T): T {
  const cache: Partial<Record<ThemeName, T>> = {};
  const current = (): T => (cache[currentName] ??= factory());
  return new Proxy({} as T, {
    get: (_, key) => current()[key as keyof T],
    has: (_, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/** Minimum comfortable touch target (Apple HIG / Material). */
export const TOUCH_TARGET = 44;
