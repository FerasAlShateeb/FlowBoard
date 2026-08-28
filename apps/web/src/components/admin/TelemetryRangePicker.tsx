import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { TELEMETRY_PRESETS, type TelemetryFilterPreset } from './telemetry-range';

/**
 * The window control: three chips (four on the event feed), no calendars.
 *
 * See the header of `telemetry-range.ts` for why an operator's question is
 * always one of "now", "today", "this month" and never "the fortnight of the
 * 3rd". The reports dashboard, which DOES get that question, has the calendar
 * pair instead.
 *
 * `aria-pressed` rather than `role="tab"`: these buttons do not switch panels,
 * they retune the data in the panels already on screen — which is a set of
 * toggles, and announcing them as tabs would promise a navigation that never
 * happens.
 */
export function TelemetryRangePicker({
  value,
  onChange,
  presets = TELEMETRY_PRESETS,
  className,
}: {
  value: TelemetryFilterPreset;
  onChange: (next: TelemetryFilterPreset) => void;
  /** Defaults to the three chart windows; the feed passes the "all" set too. */
  presets?: readonly TelemetryFilterPreset[];
  className?: string;
}) {
  const { t } = useTranslation(['admin']);

  /**
   * Literal keys, one per case.
   *
   * `t('admin:range.' + preset)` would type-check as a plain string and lose
   * the catalog's compile-time key checking — the whole reason the locale files
   * are TypeScript modules.
   */
  const label = (preset: TelemetryFilterPreset): string => {
    switch (preset) {
      case 'all':
        return t('admin:range.all');
      case '24h':
        return t('admin:range.24h');
      case '7d':
        return t('admin:range.7d');
      default:
        return t('admin:range.30d');
    }
  };

  return (
    <div
      role="group"
      aria-label={t('admin:range.label')}
      data-testid="telemetry-range-picker"
      className={cn(
        'flex items-center gap-0.5 rounded-[var(--radius)] border border-border p-0.5',
        className,
      )}
    >
      {presets.map((preset) => (
        <Button
          key={preset}
          type="button"
          size="xs"
          variant={value === preset ? 'secondary' : 'ghost'}
          aria-pressed={value === preset}
          onClick={() => {
            onChange(preset);
          }}
        >
          {label(preset)}
        </Button>
      ))}
    </div>
  );
}

export default TelemetryRangePicker;
