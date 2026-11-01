import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export interface KeyPress {
  key: string;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

// Not used on the web.
const ZumiKeyboard: null = null;
export default ZumiKeyboard;
export const KeyCaptureView: ComponentType<ViewProps & { onKey: (event: { nativeEvent: KeyPress }) => void }> | null = null;