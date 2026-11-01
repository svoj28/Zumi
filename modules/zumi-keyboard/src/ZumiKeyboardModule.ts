import { requireNativeView, requireOptionalNativeModule, type EventSubscription } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

/** A hardware key press (physical keyboard on a tablet or phone). */
export interface KeyPress {
  /** The character without modifiers ('z', '[', ' ') or a name ('Enter', 'Escape', 'ArrowUp'). */
  key: string;
  shift: boolean;
  ctrl: boolean;
  /** Command on iPad keyboards, Meta on Android. */
  meta: boolean;
  alt: boolean;
}

interface ZumiKeyboardNative {
  addListener(event: 'onKey', listener: (press: KeyPress) => void): EventSubscription;
}

/** Null when the running app was built without this module (e.g. Expo Go). */
const ZumiKeyboard = requireOptionalNativeModule<ZumiKeyboardNative>('ZumiKeyboard');
export default ZumiKeyboard;

/**
 * iOS: key presses only reach the focused (first) responder, so an invisible view takes focus
 * while mounted and reports presses through `onKey`. Android delivers them through the module.
 */
export const KeyCaptureView: ComponentType<ViewProps & { onKey: (event: { nativeEvent: KeyPress }) => void }> | null =
  Platform.OS === 'ios' && ZumiKeyboard ? requireNativeView('ZumiKeyboard') : null;