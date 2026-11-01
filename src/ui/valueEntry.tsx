import { PromptDialog } from '@/ui/PromptDialog';

/**
 * Typed entry for a slider (opened by double-tapping it). Values are shown and typed in display
 * units: `scale` converts (e.g. opacity 0..1 is typed as 0..100 %).
 */
export interface ValueEntry {
  unit: string;
  scale?: number;
  /** Decimals kept when typing (default 1). */
  decimals?: number;
  /** Largest value that may be typed, when it may go beyond the slider's range. */
  max?: number;
}

export const SIZE_ENTRY: ValueEntry = { unit: 'px', decimals: 1 };
export const PERCENT_ENTRY: ValueEntry = { unit: '%', scale: 100, decimals: 0 };

function round(v: number, decimals: number): number {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

/** Parses typed text ("12", "12.5 px", "40%", "0,5") into a value clamped to [min, max]. */
export function parseEntry(text: string, entry: ValueEntry, min: number, max: number): number | null {
  const match = text.replace(',', '.').match(/-?\d*\.?\d+/);
  if (!match) return null;
  const typed = Number(match[0]);
  if (!Number.isFinite(typed)) return null;
  const value = round(typed, entry.decimals ?? 1) / (entry.scale ?? 1);
  return Math.min(max, Math.max(min, value));
}

export function ValueEntryDialog({
  label,
  value,
  min,
  max,
  entry,
  onSubmit,
  onClose,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  entry: ValueEntry;
  onSubmit: (value: number) => void;
  onClose: () => void;
}) {
  const scale = entry.scale ?? 1;
  const decimals = entry.decimals ?? 1;
  const show = (v: number) => String(round(v * scale, decimals));
  const limit = Math.max(max, entry.max ?? max);
  return (
    <PromptDialog
      visible
      title={`${label} (${show(min)}–${show(limit)} ${entry.unit})`}
      initialValue={show(value)}
      confirmLabel="Set"
      maxLength={10}
      keyboardType="decimal-pad"
      onSubmit={(text) => {
        const next = parseEntry(text, entry, min, limit);
        if (next !== null) onSubmit(next);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
