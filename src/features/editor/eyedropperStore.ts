import type { SkImage } from '@shopify/react-native-skia';
import { create } from 'zustand';

/**
 * Colour and magnified preview under the eyedropper while the user drags. Kept in its own tiny
 * store so only the loupe re-renders during sampling, not the canvas.
 */
interface EyedropperState {
  color: string | null;
  preview: SkImage | null;
  update: (color: string | null, preview: SkImage | null) => void;
  clear: () => void;
}

export const useEyedropperStore = create<EyedropperState>()((set) => ({
  color: null,
  preview: null,
  update: (color, preview) => set({ color, preview }),
  clear: () => set({ color: null, preview: null }),
}));
