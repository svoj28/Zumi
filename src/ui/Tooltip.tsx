import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { colors, radius, spacing, themed } from '@/ui/theme';

/** Window rectangle of the element a tooltip points at. */
export interface TooltipAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TooltipState {
  tip: { text: string; anchor: TooltipAnchor; id: number } | null;
  show: (text: string, anchor: TooltipAnchor) => void;
  /** Hides the tooltip after `delayMs` (unless another one was shown meanwhile). */
  hide: (delayMs?: number) => void;
}

/** How long a tooltip stays up after the finger lifts. */
export const TOOLTIP_LINGER_MS = 1200;

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;

export const useTooltipStore = create<TooltipState>((set, get) => ({
  tip: null,
  show: (text, anchor) => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    set({ tip: { text, anchor, id: nextId++ } });
  },
  hide: (delayMs = 0) => {
    const id = get().tip?.id;
    if (id === undefined) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (get().tip?.id === id) set({ tip: null });
    }, delayMs);
  },
}));

const GAP = 8;
const EDGE = 8;

/**
 * Renders the current tooltip right next to the element it describes — below it in the top half
 * of the screen, above it in the bottom half — always inside the safe area. Mount once, over the
 * whole app; it never takes touches.
 */
export function TooltipHost() {
  const tip = useTooltipStore((s) => s.tip);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // A new tooltip is measured first (invisible), then placed. Sizes are keyed by tooltip id,
  // so a stale measurement is never used for the next tooltip.
  const [size, setSize] = useState<{ id: number; w: number; h: number } | null>(null);

  if (!tip) return null;
  const measured = size && size.id === tip.id ? size : null;
  const { anchor } = tip;
  let left = 0;
  let top = 0;
  if (measured) {
    // The visible area: never under the notch / status bar, home indicator or side cut-outs.
    const minX = insets.left + EDGE;
    const maxX = screenW - insets.right - EDGE;
    const minY = insets.top + EDGE;
    const maxY = screenH - insets.bottom - EDGE;
    left = Math.min(maxX - measured.w, Math.max(minX, anchor.x + anchor.width / 2 - measured.w / 2));

    const above = anchor.y - measured.h - GAP;
    const below = anchor.y + anchor.height + GAP;
    const fitsAbove = above >= minY;
    const fitsBelow = below + measured.h <= maxY;
    // Point toward the middle of the screen: top-bar buttons get the tip below them, bottom
    // toolbar buttons above them. Fall back to the other side, then clamp into view.
    const preferAbove = anchor.y + anchor.height / 2 > screenH / 2;
    if (preferAbove ? fitsAbove : !fitsBelow && fitsAbove) top = above;
    else if (fitsBelow) top = below;
    else top = above;
    top = Math.min(maxY - measured.h, Math.max(minY, top));
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        key={tip.id}
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(150)}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (!measured) setSize({ id: tip.id, w: width, h: height });
        }}
        style={[styles.bubble, { left, top, opacity: measured ? 1 : 0 }]}
        accessibilityLiveRegion="polite">
        <Text style={styles.text}>{tip.text}</Text>
      </Animated.View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  bubble: {
    position: 'absolute',
    maxWidth: 260,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.sm,
    backgroundColor: colors.text,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  text: { color: colors.panel, fontSize: 13, fontWeight: '600' },
}));
