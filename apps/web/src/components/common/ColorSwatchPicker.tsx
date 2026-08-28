import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { LabelColorPreset } from '@/lib/label-colors';

/**
 * The fixed-palette colour picker, shared by labels and workflow statuses.
 *
 * WHY A PALETTE AND NOT A FREE HEX FIELD. Both consumers render their colour as
 * an 8px dot on a dense board. A free picker reliably produces one value that
 * is invisible in dark mode and another that is invisible in light, and a
 * board's labels are only useful if they can be told apart at a glance. Ten
 * swatches, chosen for mutual distinguishability at that size, is the whole
 * decision — see `lib/label-colors.ts`.
 *
 * A `radiogroup`, not a listbox: ten mutually exclusive options is exactly what
 * radio semantics describe, and it gives arrow-key traversal for free with no
 * keyboard handling of our own.
 */
export function ColorSwatchPicker({
  value,
  onChange,
  presets,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange: (color: string) => void;
  presets: readonly LabelColorPreset[];
  /** Accessible name for the group — already translated. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['settings']);

  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {presets.map((preset) => {
        const selected = value === preset.value;
        const name = t(`settings:colors.${preset.nameKey}`);

        return (
          <button
            key={preset.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t('settings:labels.colorPick', { name })}
            title={name}
            disabled={disabled}
            onClick={() => {
              onChange(preset.value);
            }}
            className={cn(
              'relative inline-flex size-7 items-center justify-center rounded-[var(--btn-radius)] border transition-colors duration-[var(--speed)]',
              'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
              'disabled:pointer-events-none disabled:opacity-50',
              selected ? 'border-foreground' : 'border-transparent hover:border-border',
            )}
          >
            {/* The swatch is DATA (a persisted hex), so it can only arrive as an
                inline style — see `LabelDot` for why that is not a token
                violation. */}
            <span
              aria-hidden
              className="size-4 rounded-full"
              style={{ backgroundColor: preset.value }}
            />
            {/* `mix-blend-difference` so the tick reads on any swatch — a fixed
                foreground colour disappears on half of them. */}
            {selected ? (
              <Check aria-hidden className="absolute size-3 text-background mix-blend-difference" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default ColorSwatchPicker;
