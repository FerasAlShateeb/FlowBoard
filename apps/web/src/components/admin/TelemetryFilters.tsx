import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { telemetryEventTypeSchema, type TelemetryEventType } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useEventTypeLabel } from './TelemetryEventBadge';
import TelemetryRangePicker from './TelemetryRangePicker';
import { TELEMETRY_FILTER_PRESETS, type TelemetryFilterPreset } from './telemetry-range';

/**
 * The event feed's filter bar: type, window, and the actor chip.
 *
 * ── THE TYPE LIST COMES FROM THE CONTRACT, NOT FROM A LOCAL ARRAY ───────────
 * `telemetryEventTypeSchema.options` IS the closed enum. Listing the twelve
 * types again here would be a second definition that drifts the first time
 * someone adds an event — and the whole point of the shared zod enum is that
 * adding one is a single change in `packages/shared`.
 *
 * ── ONE TYPE AT A TIME ──────────────────────────────────────────────────────
 * The API accepts a comma-separated list, and the hook passes an array through
 * — but the control is a single `Select`. A multi-select of twelve items is a
 * lot of interface for a question ("show me only the logins") that is
 * overwhelmingly asked about one type. The contract stays multi-value so a
 * future saved-view feature does not need a server change.
 *
 * ── THE ACTOR IS A CHIP, NOT A PICKER ───────────────────────────────────────
 * It is set by clicking a name in the table (see `TelemetryEventsTable`) and
 * cleared here. FlowBoard has no global user directory — the only user list
 * endpoints are org-scoped — and inventing one for a filter that is always
 * "this person, the one I am looking at" would be a lot of API for very little.
 */

/** The `Select`'s sentinel for "no type filter". Radix has no empty-value item. */
const ALL_TYPES = 'all';

export interface TelemetryFiltersValue {
  type: TelemetryEventType | undefined;
  preset: TelemetryFilterPreset;
  /** Set by clicking a row's actor; the chip is the only way back out. */
  userId: string | undefined;
  /** The clicked actor's display name, so the chip is not a raw uuid. */
  userName: string | undefined;
}

export function TelemetryFilters({
  value,
  onChange,
  className,
}: {
  value: TelemetryFiltersValue;
  onChange: (next: TelemetryFiltersValue) => void;
  className?: string;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const label = useEventTypeLabel();

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('admin:events.filter.type')}</span>
        <Select
          value={value.type ?? ALL_TYPES}
          onValueChange={(next) => {
            onChange({
              ...value,
              type: next === ALL_TYPES ? undefined : telemetryEventTypeSchema.parse(next),
            });
          }}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>{t('admin:events.filter.allTypes')}</SelectItem>
            {telemetryEventTypeSchema.options.map((type) => (
              <SelectItem key={type} value={type}>
                {label(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <TelemetryRangePicker
        value={value.preset}
        presets={TELEMETRY_FILTER_PRESETS}
        onChange={(preset) => {
          onChange({ ...value, preset });
        }}
      />

      {value.userId === undefined ? null : (
        <Badge variant="soft-primary" className="gap-1 ps-2">
          <span className="max-w-32 truncate">
            {value.userName ?? t('admin:events.filter.oneUser')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('admin:events.filter.clearUser')}
            onClick={() => {
              onChange({ ...value, userId: undefined, userName: undefined });
            }}
          >
            <X aria-hidden />
          </Button>
        </Badge>
      )}
    </div>
  );
}

export default TelemetryFilters;
