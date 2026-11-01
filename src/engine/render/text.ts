import { Platform } from 'react-native';
import { Skia, PaintStyle, StrokeJoin, TextAlign, type SkImage, type SkParagraph } from '@shopify/react-native-skia';

/**
 * Text tool: lettering rendered with the system fonts (Skia paragraphs), optionally with an
 * outline (manga sound effects, speech text over busy art). The text becomes a normal layer,
 * which the editor then lets the user place with Transform.
 */

export type TextFont = 'sans' | 'serif' | 'mono' | 'condensed' | 'rounded' | 'script';
export type TextAlignment = 'left' | 'center' | 'right';

export interface TextSpec {
  text: string;
  font: TextFont;
  /** Font size in canvas pixels. */
  size: number;
  bold: boolean;
  italic: boolean;
  align: TextAlignment;
  /** CSS colour. */
  color: string;
  /** Outline around the letters (drawn behind the fill), or null. */
  outline: { color: string; width: number } | null;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
}

export const TEXT_FONTS: { id: TextFont; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'condensed', label: 'Condensed' },
  { id: 'rounded', label: 'Casual' },
  { id: 'script', label: 'Script' },
];

/** System font families per platform, best first (the system falls back if one is missing). */
const FAMILIES: Record<TextFont, string[]> = Platform.select({
  ios: {
    sans: ['Helvetica Neue', 'Helvetica'],
    serif: ['Georgia', 'Times New Roman'],
    mono: ['Menlo', 'Courier New'],
    condensed: ['Avenir Next Condensed', 'Helvetica Neue'],
    rounded: ['Chalkboard SE', 'Marker Felt'],
    script: ['Snell Roundhand', 'Savoye LET'],
  },
  default: {
    sans: ['sans-serif', 'Roboto'],
    serif: ['serif', 'Noto Serif'],
    mono: ['monospace'],
    condensed: ['sans-serif-condensed'],
    rounded: ['casual', 'sans-serif'],
    script: ['cursive', 'serif'],
  },
});

const ALIGN: Record<TextAlignment, TextAlign> = { left: TextAlign.Left, center: TextAlign.Center, right: TextAlign.Right };

function paragraph(spec: TextSpec, stroke: boolean): SkParagraph {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  if (stroke && spec.outline) {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(spec.outline.width * 2);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setColor(Skia.Color(spec.outline.color));
  } else {
    paint.setColor(Skia.Color(spec.color));
  }
  const builder = Skia.ParagraphBuilder.Make({ textAlign: ALIGN[spec.align] });
  builder.pushStyle(
    {
      fontFamilies: FAMILIES[spec.font],
      fontSize: spec.size,
      heightMultiplier: spec.lineHeight,
      fontStyle: { weight: spec.bold ? 700 : 400, slant: spec.italic ? 1 : 0 },
    },
    paint,
  );
  builder.addText(spec.text);
  const p = builder.build();
  p.layout(100000);
  return p;
}

/**
 * Renders the text into a tightly sized image (with room for the outline), or null for empty
 * text or when memory runs out.
 */
export function renderTextImage(spec: TextSpec): SkImage | null {
  if (!spec.text.trim()) return null;
  const fill = paragraph(spec, false);
  const outline = spec.outline ? paragraph(spec, true) : null;
  const pad = Math.ceil((spec.outline?.width ?? 0) + 4);
  const textWidth = Math.ceil(fill.getLongestLine());
  const width = Math.max(1, textWidth + pad * 2);
  const height = Math.max(1, Math.ceil(fill.getHeight()) + pad * 2);
  if (width > 8192 || height > 8192) return null;
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  // Paragraphs are laid out on a very wide line; shift so the text block starts at the padding.
  const shift = spec.align === 'left' ? 0 : spec.align === 'center' ? (100000 - textWidth) / 2 : 100000 - textWidth;
  outline?.paint(canvas, pad - shift, pad);
  fill.paint(canvas, pad - shift, pad);
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return image;
}