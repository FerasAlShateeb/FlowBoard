import { describe, expect, it } from 'vitest';

import {
  DAILY_UP_TO_DAYS,
  DEFAULT_HOURLY_UP_TO_DAYS,
  DEFAULT_RANGE,
  RANGE_PRESETS,
  WEEKLY_UP_TO_DAYS,
  intervalForSpan,
  parseRangeDay,
  rangeLabel,
  windowFor,
  type RangeValue,
} from '@/components/dashboard/range';

/**
 * The window math behind every dashboard range control.
 *
 * ── WHY THE THRESHOLD CASES GO THROUGH `intervalForSpan` ───────────────────
 *
 * A custom range covers whole LOCAL calendar days, so its span in milliseconds
 * is an hour short (or an hour long) across a DST transition. A suite that
 * asserted the 45- and 200-day edges by picking calendar days would therefore
 * pass or fail depending on the machine's time zone and the months it happened
 * to span. `intervalForSpan` is a pure function of a NUMBER, so the edges are
 * asserted exactly there, and `windowFor` is asserted on the things only it can
 * get wrong: what a preset spans, what a lone `from` means, and that a preset
 * re-resolves against the clock.
 */

const DAY_MS = 86_400_000;

const spanDays = (value: RangeValue, hourly?: number): number => {
  const window = windowFor(value, hourly);
  return (Date.parse(window.to) - Date.parse(window.from)) / DAY_MS;
};

describe('intervalForSpan()', () => {
  it('keeps HOUR buckets up to the caller knob, and not one day further', () => {
    expect(intervalForSpan(2)).toBe('hour');
    expect(intervalForSpan(2.0001)).toBe('day');
    expect(intervalForSpan(7, 7)).toBe('hour');
    expect(intervalForSpan(7.0001, 7)).toBe('day');
  });

  it('coarsens from day to WEEK past 45 days', () => {
    expect(intervalForSpan(DAILY_UP_TO_DAYS)).toBe('day');
    expect(intervalForSpan(DAILY_UP_TO_DAYS + 0.0001)).toBe('week');
  });

  it('coarsens from week to MONTH past 200 days', () => {
    expect(intervalForSpan(WEEKLY_UP_TO_DAYS)).toBe('week');
    expect(intervalForSpan(WEEKLY_UP_TO_DAYS + 0.0001)).toBe('month');
  });

  it('moves the HOUR boundary only — the coarse thresholds are shared', () => {
    expect(intervalForSpan(90, 7)).toBe('week');
    expect(intervalForSpan(365, 7)).toBe('month');
  });

  it('defaults the knob to two days', () => {
    expect(DEFAULT_HOURLY_UP_TO_DAYS).toBe(2);
    expect(intervalForSpan(2)).toBe(intervalForSpan(2, DEFAULT_HOURLY_UP_TO_DAYS));
  });
});

describe('windowFor() — presets', () => {
  it('defaults to 30 days', () => {
    expect(DEFAULT_RANGE.preset).toBe('30d');
    expect(spanDays(DEFAULT_RANGE)).toBeCloseTo(30, 3);
  });

  it('maps each pill to its look-back span', () => {
    expect(spanDays({ preset: '7d' })).toBeCloseTo(7, 3);
    expect(spanDays({ preset: '30d' })).toBeCloseTo(30, 3);
    expect(spanDays({ preset: '90d' })).toBeCloseTo(90, 3);
    expect(spanDays({ preset: '12m' })).toBeCloseTo(365, 3);
  });

  it('emits ISO instants with `from` before `to`', () => {
    const { from, to } = windowFor({ preset: '7d' });
    expect(Number.isNaN(Date.parse(from))).toBe(false);
    expect(Date.parse(from)).toBeLessThan(Date.parse(to));
  });

  it('only ever emits a bucket size the API accepts', () => {
    for (const preset of RANGE_PRESETS) {
      expect(['hour', 'day', 'week', 'month']).toContain(windowFor({ preset }).interval);
    }
  });

  it('gives each preset the bucket its span deserves', () => {
    expect(windowFor({ preset: '7d' }).interval).toBe('day');
    expect(windowFor({ preset: '30d' }).interval).toBe('day');
    expect(windowFor({ preset: '90d' }).interval).toBe('week');
    expect(windowFor({ preset: '12m' }).interval).toBe('month');
  });

  it('honours a caller that wants hourly resolution over a whole week', () => {
    expect(windowFor({ preset: '7d' }, 7).interval).toBe('hour');
    expect(windowFor({ preset: '30d' }, 7).interval).toBe('day');
    expect(windowFor({ preset: '90d' }, 7).interval).toBe('week');
    expect(windowFor({ preset: '12m' }, 7).interval).toBe('month');
  });

  it('re-resolves against the clock, so a preset window SLIDES', async () => {
    const first = windowFor({ preset: '7d' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = windowFor({ preset: '7d' });
    expect(Date.parse(second.to)).toBeGreaterThan(Date.parse(first.to));
  });
});

describe('windowFor() — custom ranges', () => {
  it('covers whole local days, start to end', () => {
    const { from, to } = windowFor({ preset: 'custom', from: '2026-07-10', to: '2026-07-12' });
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(to).getHours()).toBe(23);
    // Three whole days minus a millisecond — comfortably more than two.
    expect(Date.parse(to) - Date.parse(from)).toBeGreaterThan(2 * DAY_MS);
  });

  it('reads a lone `from` as that ONE day, not a zero-width window', () => {
    const { from, to, interval } = windowFor({ preset: 'custom', from: '2026-07-10' });
    expect(Date.parse(to)).toBeGreaterThan(Date.parse(from));
    expect(Date.parse(to) - Date.parse(from)).toBeLessThan(DAY_MS);
    expect(interval).toBe('hour');
  });

  it('buckets a short custom window by the hour and a longer one by the day', () => {
    expect(windowFor({ preset: 'custom', from: '2026-07-20', to: '2026-07-20' }).interval).toBe(
      'hour',
    );
    expect(windowFor({ preset: 'custom', from: '2026-07-01', to: '2026-07-20' }).interval).toBe(
      'day',
    );
  });

  it('falls back to 30 days when a custom range carries no dates yet', () => {
    expect(spanDays({ preset: 'custom' })).toBeCloseTo(30, 3);
  });

  it('ignores an unparseable day rather than emitting NaN', () => {
    const { from, to } = windowFor({ preset: 'custom', from: 'not-a-date' });
    expect(Number.isNaN(Date.parse(from))).toBe(false);
    expect(Number.isNaN(Date.parse(to))).toBe(false);
    expect(spanDays({ preset: 'custom', from: 'not-a-date' })).toBeCloseTo(30, 3);
  });

  it('rejects an OVERFLOWING day instead of rolling it forward', () => {
    // A naive parse turns 31 February into 3 March and the user's typo becomes
    // a real, silently wrong window.
    expect(parseRangeDay('2026-02-31')).toBeNull();
    expect(spanDays({ preset: 'custom', from: '2026-02-31' })).toBeCloseTo(30, 3);
  });

  it('ignores custom days when the preset is NOT custom', () => {
    expect(spanDays({ preset: '7d', from: '2020-01-01', to: '2020-12-31' })).toBeCloseTo(7, 3);
  });
});

describe('rangeLabel()', () => {
  const options = { customLabel: 'Custom', locale: 'en-US' };

  it('shows a preset verbatim — Latin in every language', () => {
    for (const preset of RANGE_PRESETS) {
      expect(rangeLabel({ preset }, options)).toBe(preset);
      expect(rangeLabel({ preset }, { ...options, locale: 'ar-u-nu-latn' })).toBe(preset);
    }
  });

  it('stays the translated placeholder until a day is picked', () => {
    expect(rangeLabel({ preset: 'custom' }, options)).toBe('Custom');
    expect(rangeLabel({ preset: 'custom', from: 'nonsense' }, options)).toBe('Custom');
  });

  it('shows one date for a single day and a span for a range', () => {
    expect(rangeLabel({ preset: 'custom', from: '2026-07-10' }, options)).toBe('Jul 10, 2026');
    expect(rangeLabel({ preset: 'custom', from: '2026-07-10', to: '2026-07-10' }, options)).toBe(
      'Jul 10, 2026',
    );
    expect(
      rangeLabel({ preset: 'custom', from: '2026-07-10', to: '2026-07-12' }, options),
    ).toContain('–');
  });

  it('formats the day stamps in the locale it is handed', () => {
    const arabic = rangeLabel(
      { preset: 'custom', from: '2026-07-10' },
      {
        ...options,
        locale: 'ar-u-nu-latn',
      },
    );
    expect(arabic).not.toBe('Jul 10, 2026');
    // Digits stay Western even in Arabic — `ar-u-nu-latn`, see lang-policy.
    expect(arabic).toContain('2026');
  });
});
