import { useEffect } from 'react';

import ZumiKeyboard, { type KeyPress } from '../../../modules/zumi-keyboard';

/**
 * Hardware keyboard shortcuts for the editor (tablets with keyboards). The mapping is pure (and
 * unit-tested); `useKeyPresses` delivers presses from the native module.
 */

export type ShortcutAction =
  | 'undo'
  | 'redo'
  | 'brush'
  | 'eraser'
  | 'select'
  | 'transform'
  | 'fill'
  | 'gradient'
  | 'text'
  | 'eyedropper'
  | 'sizeDown'
  | 'sizeUp'
  | 'fit'
  | 'resetRotation'
  | 'flipView'
  | 'swapColors'
  | 'selectAll'
  | 'deselect'
  | 'invertSelection'
  | 'newLayer'
  | 'duplicateLayer'
  | 'mergeDown'
  | 'save'
  | 'cancel'
  | 'help';

/** One line per shortcut, for the help sheet. */
export const SHORTCUTS: { keys: string; action: ShortcutAction; label: string }[] = [
  { keys: '⌘/Ctrl Z', action: 'undo', label: 'Undo' },
  { keys: '⌘/Ctrl ⇧ Z  ·  Ctrl Y', action: 'redo', label: 'Redo' },
  { keys: 'B', action: 'brush', label: 'Brush' },
  { keys: 'E', action: 'eraser', label: 'Eraser' },
  { keys: 'S', action: 'select', label: 'Selection' },
  { keys: 'V', action: 'transform', label: 'Transform' },
  { keys: 'F', action: 'fill', label: 'Paint bucket' },
  { keys: 'G', action: 'gradient', label: 'Gradient' },
  { keys: 'T', action: 'text', label: 'Text' },
  { keys: 'I', action: 'eyedropper', label: 'Eyedropper' },
  { keys: '[  ]', action: 'sizeUp', label: 'Brush smaller / bigger' },
  { keys: '⌘/Ctrl 0', action: 'fit', label: 'Fit canvas to screen' },
  { keys: 'R', action: 'resetRotation', label: 'Reset canvas rotation' },
  { keys: 'H', action: 'flipView', label: 'Flip view' },
  { keys: 'X', action: 'swapColors', label: 'Swap with previous colour' },
  { keys: '⌘/Ctrl A', action: 'selectAll', label: 'Select all' },
  { keys: '⌘/Ctrl D', action: 'deselect', label: 'Deselect' },
  { keys: '⌘/Ctrl ⇧ I', action: 'invertSelection', label: 'Invert selection' },
  { keys: '⌘/Ctrl ⇧ N', action: 'newLayer', label: 'New layer' },
  { keys: '⌘/Ctrl J', action: 'duplicateLayer', label: 'Duplicate layer' },
  { keys: '⌘/Ctrl E', action: 'mergeDown', label: 'Merge down' },
  { keys: '⌘/Ctrl S', action: 'save', label: 'Save now' },
  { keys: 'Esc', action: 'cancel', label: 'Back to painting' },
  { keys: '?', action: 'help', label: 'Show shortcuts' },
];

/** The editor action for a key press, or null if the press is not a shortcut. */
export function shortcutFor(press: KeyPress): ShortcutAction | null {
  const key = press.key.toLowerCase();
  const command = press.ctrl || press.meta;
  if (command) {
    if (key === 'z') return press.shift ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === '0') return 'fit';
    if (key === 'a') return 'selectAll';
    if (key === 'd') return 'deselect';
    if (key === 'i' && press.shift) return 'invertSelection';
    if (key === 'n' && press.shift) return 'newLayer';
    if (key === 'j') return 'duplicateLayer';
    if (key === 'e') return 'mergeDown';
    if (key === 's') return 'save';
    return null;
  }
  if (press.alt) return null;
  switch (key) {
    case 'b':
      return 'brush';
    case 'e':
      return 'eraser';
    case 's':
      return 'select';
    case 'v':
      return 'transform';
    case 'f':
      return 'fill';
    case 'g':
      return 'gradient';
    case 't':
      return 'text';
    case 'i':
      return 'eyedropper';
    case '[':
      return 'sizeDown';
    case ']':
      return 'sizeUp';
    case 'r':
      return 'resetRotation';
    case 'h':
      return 'flipView';
    case 'x':
      return 'swapColors';
    case 'escape':
      return 'cancel';
    case '?':
    case '/':
      return press.shift || key === '?' ? 'help' : null;
    default:
      return null;
  }
}

/** Calls `onAction` for each shortcut pressed while mounted (Android; iOS uses KeyCaptureView). */
export function useKeyPresses(onPress: (press: KeyPress) => void): void {
  useEffect(() => {
    if (!ZumiKeyboard) return;
    const subscription = ZumiKeyboard.addListener('onKey', onPress);
    return () => subscription.remove();
  }, [onPress]);
}