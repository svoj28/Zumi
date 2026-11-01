import { Fragment, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { useSettingsStore } from '@/state/settingsStore';
import { applyTheme, resolveTheme, type ThemeName } from '@/ui/theme';

/** The theme to render with: the user's choice, or the system appearance for "system". */
export function useResolvedTheme(): ThemeName {
  const preference = useSettingsStore((s) => s.theme);
  const system = useColorScheme();
  return resolveTheme(preference, system);
}

/**
 * Wraps a screen's content so it remounts when the theme changes. Styles and colours are read
 * from the active palette at render time, and memoized components would otherwise keep showing
 * the old one. The navigator itself is not remounted, so navigation state is kept.
 */
export function ThemeBoundary({ children }: { children: ReactNode }) {
  const theme = useResolvedTheme();
  applyTheme(theme);
  return <Fragment key={theme}>{children}</Fragment>;
}
