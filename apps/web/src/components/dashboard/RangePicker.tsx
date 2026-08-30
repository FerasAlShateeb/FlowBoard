import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { toIsoDate } from '@/lib/format';
import { getIntlLocale } from '@/lib/lang-policy';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsNarrowViewport } from '@/components/diagnostics/useIsNarrowViewport';
import { useRangeChromeCopy } from '@/components/dashboard/chrome-copy';
import { RangePills } from '@/components/dashboard/RangePills';
import { parseRangeDay, rangeLabel, type RangeValue } from '@/components/dashboard/range';

/**
 * The window control every dashboard puts in its header: the four
 * {@link RangePills} presets plus a "Custom…" popover hosting a range calendar.
 *
 * ═══ WHY A CUSTOM WINDOW AT ALL ══════════════════════════════════════════
 *
 * A preset-only control forces an operator investigating "what happened last
 * Tuesday" to widen to 30d and squint. The popover shows two months at once
 * with month + year dropdown captions, so a cross-month or months-ago window is
 * two clicks rather than a paging session.
 *
 * ═══ THE VALUE IS A PRESET, NOT A RESOLVED WINDOW ════════════════════════
 *
 * See the header of `range.ts`: a `7d` view re-read an hour later must mean the
 * last seven days *from now*, so `{ preset, from?, to? }` is what travels and
 * `windowFor()` resolves it at request time. This component never resolves
 * anything — it only edits the value.
 *
 * ═══ TWO MONTHS, BUT ONLY WHERE THEY FIT ═════════════════════════════════
 *
 * Two months side by side is the point of a RANGE calendar — you pick "the 28th
 * to the 3rd" without paging — but `ui/calendar` only lays its months out as a
 * row from `md` up (`months: … md:flex-row`). Below that they would stack into
 * a ~600px-tall popover, so the second month is dropped instead. The breakpoint
 * is read through `useIsNarrowViewport` — the app's single `matchMedia` store
 * for exactly this `md` question — rather than a second query that could drift
 * from the primitive's own.
 *
 * ═══ A LONE `from` IS NOT A BUG ══════════════════════════════════════════
 *
 * `to` is absent between the two clicks of a range drag. `windowFor()` reads a
 * lone `from` as that whole day, so the chart shows one day instead of blanking
 * mid-gesture. Nothing here needs to debounce or guard for it.
 *
 * ═══ COPY ════════════════════════════════════════════════════════════════
 *
 * The preset tokens are Latin in every language (see `RangePills`); the group's
 * accessible name and the "Custom…" word come from `chrome-copy.ts`, which is
 * the one place this kit reads the catalog.
 */

/**
 * Years reachable from the caption's year dropdown.
 *
 * Analytics windows look BACKWARD — there is no telemetry from next March — so
 * the span is five years back through the end of the current year. That keeps
 * the year list short. The bounds cap NAVIGATION; they disable nothing inside
 * the window, so the current year's later months stay selectable.
 */
export const RANGE_YEARS_BACK = 5;

export interface RangePickerProps {
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  /** `data-testid` on the wrapper. The popover internals are portalled. */
  testId?: string;
  className?: string;
}

export function RangePicker({ value, onChange, testId, className }: RangePickerProps) {
  const copy = useRangeChromeCopy();
  const [open, setOpen] = useState(false);
  const narrow = useIsNarrowViewport();

  // Memoised so the bounds keep their identity across renders — a fresh pair
  // would rebuild DayPicker's month/year option lists on every parent render,
  // and `ui/calendar` is explicit that prop identity is load-bearing there.
  const [startMonth, endMonth] = useMemo(() => {
    const year = new Date().getFullYear();
    return [new Date(year - RANGE_YEARS_BACK, 0, 1), new Date(year, 11, 31)] as const;
  }, []);

  const isCustom = value.preset === 'custom';
  const from = parseRangeDay(value.from);
  const selected: DateRange | undefined =
    isCustom && from ? { from, to: parseRangeDay(value.to) ?? undefined } : undefined;

  const label = rangeLabel(value, { customLabel: copy.custom, locale: getIntlLocale() });

  return (
    <div
      data-slot="range-picker"
      data-testid={testId}
      className={className ?? 'flex flex-wrap items-center gap-2'}
    >
      <RangePills
        value={value.preset}
        ariaLabel={copy.groupLabel}
        onChange={(preset) => {
          onChange({ preset });
        }}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={isCustom ? 'default' : 'outline'}
            data-testid="range-custom"
          >
            <CalendarRange className="size-3.5" aria-hidden />
            {isCustom ? label : copy.custom}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            autoFocus
            numberOfMonths={narrow ? 1 : 2}
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            selected={selected}
            onSelect={(next) => {
              onChange({
                preset: 'custom',
                from: next?.from ? toIsoDate(next.from) : undefined,
                to: next?.to ? toIsoDate(next.to) : undefined,
              });
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
