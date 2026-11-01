/** Canvas size units, conversions and presets. Pure. */

export type Unit = 'px' | 'in' | 'mm' | 'cm';

export const UNITS: { id: Unit; label: string }[] = [
  { id: 'px', label: 'Pixels' },
  { id: 'in', label: 'Inches' },
  { id: 'mm', label: 'mm' },
  { id: 'cm', label: 'cm' },
];

const UNITS_PER_INCH: Record<Exclude<Unit, 'px'>, number> = { in: 1, mm: 25.4, cm: 2.54 };

export function toPixels(value: number, unit: Unit, dpi: number): number {
  if (unit === 'px') return Math.round(value);
  return Math.round((value / UNITS_PER_INCH[unit]) * dpi);
}

export function fromPixels(px: number, unit: Unit, dpi: number): number {
  if (unit === 'px') return px;
  return (px / dpi) * UNITS_PER_INCH[unit];
}

/** Text shown in inputs: whole pixels, or up to 2 decimals for physical units. */
export function formatValue(value: number, unit: Unit): string {
  if (!Number.isFinite(value)) return '';
  if (unit === 'px') return String(Math.round(value));
  return String(Math.round(value * 100) / 100);
}

export function parseValue(text: string): number {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

export interface CanvasPreset {
  id: string;
  label: string;
  detail: string;
  group: 'screen' | 'print';
  width: number;
  height: number;
  unit: Unit;
}

export const PRESETS: CanvasPreset[] = [
  { id: 'hd', label: 'HD', detail: '1920 × 1080', group: 'screen', width: 1920, height: 1080, unit: 'px' },
  { id: 'square', label: 'Square', detail: '2048 × 2048', group: 'screen', width: 2048, height: 2048, unit: 'px' },
  { id: 'post', label: 'Square post', detail: '1080 × 1080', group: 'screen', width: 1080, height: 1080, unit: 'px' },
  { id: 'portrait', label: 'Portrait post', detail: '1080 × 1350', group: 'screen', width: 1080, height: 1350, unit: 'px' },
  { id: 'story', label: 'Story', detail: '1080 × 1920', group: 'screen', width: 1080, height: 1920, unit: 'px' },
  { id: '4k', label: '4K UHD', detail: '3840 × 2160', group: 'screen', width: 3840, height: 2160, unit: 'px' },
  { id: 'a5', label: 'A5', detail: '148 × 210 mm', group: 'print', width: 148, height: 210, unit: 'mm' },
  { id: 'a4', label: 'A4', detail: '210 × 297 mm', group: 'print', width: 210, height: 297, unit: 'mm' },
  { id: 'a3', label: 'A3', detail: '297 × 420 mm', group: 'print', width: 297, height: 420, unit: 'mm' },
  { id: 'letter', label: 'US Letter', detail: '8.5 × 11 in', group: 'print', width: 8.5, height: 11, unit: 'in' },
];

export const DPI_CHOICES = [72, 150, 300, 600];
export const DEFAULT_PRINT_DPI = 300;
