import { BlendMode, type SkEnum } from '@shopify/react-native-skia';

import type { LayerBlendMode } from '@/engine/types';

/**
 * Layer blend modes. Every mode here maps to a native Skia blend mode, so the on-screen
 * renderer, merges and exports all use the same (real) compositing maths — nothing is
 * approximated in JS. Separable modes follow the W3C Compositing spec on premultiplied
 * colour; "Add" is Skia's `Plus` (linear dodge, clamped).
 */

interface BlendModeInfo {
  mode: LayerBlendMode;
  label: string;
  sk: BlendMode;
  /** Name accepted by the declarative `blendMode` prop. */
  prop: SkEnum<typeof BlendMode>;
}

/** Grouped like most painting apps: normal, darken, lighten, contrast, difference, colour. */
export const BLEND_MODE_GROUPS: readonly (readonly BlendModeInfo[])[] = [
  [{ mode: 'srcOver', label: 'Normal', sk: BlendMode.SrcOver, prop: 'srcOver' }],
  [
    { mode: 'multiply', label: 'Multiply', sk: BlendMode.Multiply, prop: 'multiply' },
    { mode: 'darken', label: 'Darken', sk: BlendMode.Darken, prop: 'darken' },
    { mode: 'colorBurn', label: 'Color Burn', sk: BlendMode.ColorBurn, prop: 'colorBurn' },
  ],
  [
    { mode: 'screen', label: 'Screen', sk: BlendMode.Screen, prop: 'screen' },
    { mode: 'lighten', label: 'Lighten', sk: BlendMode.Lighten, prop: 'lighten' },
    { mode: 'colorDodge', label: 'Color Dodge', sk: BlendMode.ColorDodge, prop: 'colorDodge' },
    { mode: 'add', label: 'Add', sk: BlendMode.Plus, prop: 'plus' },
  ],
  [
    { mode: 'overlay', label: 'Overlay', sk: BlendMode.Overlay, prop: 'overlay' },
    { mode: 'softLight', label: 'Soft Light', sk: BlendMode.SoftLight, prop: 'softLight' },
    { mode: 'hardLight', label: 'Hard Light', sk: BlendMode.HardLight, prop: 'hardLight' },
  ],
  [
    { mode: 'difference', label: 'Difference', sk: BlendMode.Difference, prop: 'difference' },
    { mode: 'exclusion', label: 'Exclusion', sk: BlendMode.Exclusion, prop: 'exclusion' },
  ],
  [
    { mode: 'hue', label: 'Hue', sk: BlendMode.Hue, prop: 'hue' },
    { mode: 'saturation', label: 'Saturation', sk: BlendMode.Saturation, prop: 'saturation' },
    { mode: 'color', label: 'Color', sk: BlendMode.Color, prop: 'color' },
    { mode: 'luminosity', label: 'Luminosity', sk: BlendMode.Luminosity, prop: 'luminosity' },
  ],
];

/** Names of the groups in BLEND_MODE_GROUPS (same order). */
export const BLEND_GROUP_NAMES: readonly string[] = ['Normal', 'Darken', 'Lighten', 'Contrast', 'Difference', 'Color'];

const BY_MODE = new Map<LayerBlendMode, BlendModeInfo>(BLEND_MODE_GROUPS.flat().map((info) => [info.mode, info]));
const NORMAL = BY_MODE.get('srcOver')!;

export const LAYER_BLEND_MODES: readonly LayerBlendMode[] = BLEND_MODE_GROUPS.flat().map((info) => info.mode);

export function toSkBlendMode(mode: LayerBlendMode): BlendMode {
  return (BY_MODE.get(mode) ?? NORMAL).sk;
}

export function blendModeProp(mode: LayerBlendMode): SkEnum<typeof BlendMode> {
  return (BY_MODE.get(mode) ?? NORMAL).prop;
}

export function blendModeLabel(mode: LayerBlendMode): string {
  return (BY_MODE.get(mode) ?? NORMAL).label;
}
