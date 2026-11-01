import * as Device from 'expo-device';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { configureMemoryBudget } from '@/engine/memory';
import { useSettingsStore } from '@/state/settingsStore';
import { cleanRestoreStaging } from '@/storage/backupService';
// Registers the loader for picture brush tips with the brush engine.
import '@/storage/brushTips';
import { AnimatedSplash } from '@/ui/AnimatedSplash';
import { useResolvedTheme } from '@/ui/ThemeBoundary';
import { applyTheme, paletteFor } from '@/ui/theme';
import { TooltipHost } from '@/ui/Tooltip';

// Size the layer memory budget to this device's RAM before any canvas is created.
configureMemoryBudget(Device.totalMemory);

// A restore interrupted by a crash leaves an unpublished staging copy behind; drop it.
try {
  cleanRestoreStaging();
} catch (error) {
  console.warn('[startup] Could not clean restore staging', error);
}

export default function RootLayout() {
  const preference = useSettingsStore((s) => s.theme);
  const theme = useResolvedTheme();
  // Before any screen renders, so their styles are built for this palette.
  applyTheme(theme);
  const palette = paletteFor(theme);
  const [splashDone, setSplashDone] = useState(false);

  // Native UI (alerts, pickers, keyboard) follows the app's choice; "system" hands it back.
  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.backdrop).catch(() => {});
  }, [palette.backdrop]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.backdrop }}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.backdrop },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="references" />
        <Stack.Screen name="assistant" />
        {/* Swipe-back would fight with drawing near the screen edge. */}
        <Stack.Screen name="canvas/[id]" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
      {/* Long-press tooltips for buttons, above every screen. */}
      <TooltipHost />
      {/* Over the stack so the first screen is already rendered when the splash fades away. */}
      {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
    </GestureHandlerRootView>
  );
}
