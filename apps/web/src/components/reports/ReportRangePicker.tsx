import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useChartFormat } from './chart-format';
import {
  RANGE_PRESETS,
  detectPreset,
  normalizeRange,
  parseIsoDate,
  presetRange,
  toIsoDate,
  type DateRange,
  type RangePreset,
} from './report-range';

/**
 * The window the cumulative-flow and cycle-time cards are drawn for.
 *
 * THREE PRESETS PLUS TWO CALENDARS. The presets cover what a standup or a
 * retro actually asks for; the pair of date popovers is the escape hatch for
 * "what did the quarter look like". Which chip is lit is DERIVED from the range
 * (`detectPreset`) rather than stored beside it — one source of truth, so a
 * range that happens to equal "last 4 weeks" lights that chip no matter how it
 * was set.
 *
 * THE RANGE IS TWO `YYYY-MM-DD` STRINGS, never Dates: both endpoints bucket by
 * calendar day and a `Date` here would drag a timezone into a value that has
 * none (see `report-range.ts`).
 *
 * A hand-picked pair is normalized on the way out, so setting `to` before
 * `from` swaps rather than firing a request for an inverted window the API
 * would reject.
 *
 * ── WHY THIS SURVIVED W3.1's RANGE-PICKER CONSOLIDATION ─────────────────────
 *
 * `components/dashboard/RangePicker` supersedes the ADMIN console's bespoke
 * chips, and W2.2/W3.1 migrated those. It does not supersede this one, and the
 * difference is not cosmetic:
 *
 *   • **Different units.** This picker counts in SPRINTS — 2w/4w/8w, the spans a
 *     standup and a retro actually ask about. The console counts in reporting
 *     periods — 7d/30d/90d/12m. Swapping in the console's presets would give a
 *     burndown a "last 12 months" chip and take away "the last two weeks".
 *   • **Different value.** The console's control edits a `{preset, from?, to?}`
 *     that is resolved against the clock at request time (`range.ts`: a `7d`
 *     view re-read an hour later must still mean the last seven days). This one
 *     edits a resolved `{from, to}` pair of `YYYY-MM-DD` strings, because a
 *     sprint report is an artefact of a FIXED window — a burndown that silently
 *     slides forward while you read it is not a burndown.
 *   • **Different control.** Two independent single-day fields, so an endpoint
 *     can be nudged without re-picking the other; the console has one range
 *     calendar, which is right for exploring and wrong for adjusting.
 *
 * Migrating would therefore be a redesign of the reports dashboard's window
 * semantics, not a substitution — so it was left alone, and the duplication is
 * bounded: `range.ts` and `report-range.ts` are the only two, and each says in
 * its header which question it answers.
 */
export function ReportRangePicker({
  range,
  onChange,
  className,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
}) {
  const { t } = useTranslation(['reports']);
  const selection = detectPreset(range);

  /** Literal keys — see the note in `SprintPicker`. */
  const presetLabel = (preset: RangePreset): string => {
    switch (preset) {
      case '2w':
        return t('reports:toolbar.rangePreset.2w');
      case '4w':
        return t('reports:toolbar.rangePreset.4w');
      default:
        return t('reports:toolbar.rangePreset.8w');
    }
  };

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="report-range-picker"
    >
      <div
        role="group"
        aria-label={t('reports:toolbar.rangeLabel')}
        className="flex items-center gap-0.5 rounded-[var(--radius)] border border-border p-0.5"
      >
        {RANGE_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="xs"
            variant={selection === preset ? 'secondary' : 'ghost'}
            aria-pressed={selection === preset}
            onClick={() => onChange(presetRange(preset))}
          >
            {presetLabel(preset)}
          </Button>
        ))}
      </div>

      <DateField
        label={t('reports:toolbar.rangeFrom')}
        value={range.from}
        onChange={(from) => onChange(normalizeRange({ ...range, from }))}
      />
      <span aria-hidden className="text-xs text-muted-foreground">
        –
      </span>
      <DateField
        label={t('reports:toolbar.rangeTo')}
        value={range.to}
        onChange={(to) => onChange(normalizeRange({ ...range, to }))}
      />
    </div>
  );
}

/**
 * One end of the window: a button showing the chosen day, opening a calendar.
 *
 * The accessible name carries BOTH the field's role and its current value
 * ("From, Aug 27, 2026") — a button reading only "Aug 27, 2026" leaves a
 * screen-reader user to guess which end of the range they are on.
 */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** `YYYY-MM-DD`. */
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  const selected = parseIsoDate(value);
  const isValid = !Number.isNaN(selected.getTime());

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${label}, ${isValid ? format.dayFull(value) : t('reports:toolbar.pickDate')}`}
          className="[font-variant-numeric:tabular-nums]"
        >
          <CalendarDays aria-hidden />
          {isValid ? format.dayFull(value) : t('reports:toolbar.pickDate')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={isValid ? selected : undefined}
          defaultMonth={isValid ? selected : undefined}
          onSelect={(next) => {
            if (next) onChange(toIsoDate(next));
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export default ReportRangePicker;
