import { describe, expect, it } from 'vitest';

import { addDaysIso, formatDay } from '@/components/backlog/backlog-dates';

/**
 * Calendar-day handling.
 *
 * Both functions exist to avoid ONE bug — a `YYYY-MM-DD` parsed as UTC midnight
 * and read back in local time, which moves a sprint boundary by a day for
 * everyone west of Greenwich. The assertions below are the shape of that bug.
 */

// `todayIso` is re-exported from `lib/format`; its cases live in
// `lib/format.test.ts` rather than being asserted once per re-exporter.

describe('addDaysIso', () => {
  it('adds whole days', () => {
    expect(addDaysIso('2026-01-01', 13)).toBe('2026-01-14');
  });

  it('crosses a month boundary', () => {
    expect(addDaysIso('2026-01-25', 10)).toBe('2026-02-04');
  });

  it('crosses a leap day', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('crosses a spring-forward date without losing an hour’s worth of day', () => {
    // The US DST switch. Done in local time this lands on 22:00 of the 7th.
    expect(addDaysIso('2027-03-13', 1)).toBe('2027-03-14');
  });

  it('returns anything that is not a calendar day untouched', () => {
    expect(addDaysIso('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('formatDay', () => {
  it('does not shift the day when formatting', () => {
    expect(formatDay('2026-01-01', 'en-US')).toBe('Jan 1');
  });

  it('keeps Western digits under Arabic', () => {
    expect(formatDay('2026-01-09', 'ar-u-nu-latn')).toMatch(/9/);
  });
});
