import { beforeEach, describe, expect, it } from 'vitest';

import {
  __clearFormatterCache,
  formatDateTime,
  formatIsoDate,
  formatPoints,
  formatRelative,
  fromIsoDate,
  isOverdue,
  relativeParts,
  toIsoDate,
  todayIso,
} from '@/lib/format';

/**
 * The shared formatting primitives.
 *
 * These cases were LIFTED, not written fresh: they come from
 * `board/board-meta.test.ts`, `backlog/backlog-dates.test.ts`,
 * `backlog/backlog-points.test.ts` and `tasks/task-dates.test.ts`, which each
 * asserted the same properties against their own copy of the same code. They
 * now live once, beside the one implementation.
 */

beforeEach(() => {
  // The `Intl` cache is module-global; a locale case would otherwise be
  // answered by the formatter a previous case built.
  __clearFormatterCache();
});

describe('formatPoints', () => {
  it('renders a fractional estimate as itself, not rounded away', () => {
    expect(formatPoints(0.5, 'en-US')).toBe('0.5');
  });

  it('renders a whole estimate without trailing zeros', () => {
    expect(formatPoints(3, 'en-US')).toBe('3');
  });

  it('renders zero rather than an empty chip', () => {
    expect(formatPoints(0, 'en-US')).toBe('0');
  });

  it('keeps Western digits under the Arabic locale', () => {
    // `ar-u-nu-latn` is the app-wide locale — task keys, points and dates sit
    // beside Latin identifiers and live in tabular columns.
    expect(formatPoints(1.5, 'ar-u-nu-latn')).toBe('1.5');
  });

  it('keeps two fraction digits, so a quarter-point is not silently rounded', () => {
    // The backlog's old copy capped at ONE digit, so `0.25` read as `0.3` on a
    // sprint chip and `0.25` on the card beside it.
    expect(formatPoints(0.25, 'en-US')).toBe('0.25');
  });
});

describe('todayIso / toIsoDate', () => {
  it('reads today from the LOCAL calendar, not UTC', () => {
    // 23:30 local on the 12th is the 13th in UTC for anyone east of Greenwich —
    // and "today" on a date picker means the day the reader is living in.
    expect(todayIso(new Date(2026, 2, 12, 23, 30))).toBe('2026-03-12');
  });

  it('zero-pads month and day', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('round-trips through `fromIsoDate`', () => {
    expect(toIsoDate(fromIsoDate('2026-03-12')!)).toBe('2026-03-12');
  });
});

describe('fromIsoDate', () => {
  it('builds LOCAL midnight, never UTC midnight', () => {
    const date = fromIsoDate('2026-03-12')!;
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(12);
    expect(date.getHours()).toBe(0);
  });

  it('REJECTS a day that does not exist rather than rolling it forward', () => {
    // `new Date(2026, 1, 31)` is 3 March and is not NaN, so a bare
    // constructor-plus-NaN-check turns a typo into a real, wrong due date.
    expect(fromIsoDate('2026-02-31')).toBeNull();
    expect(fromIsoDate('2026-13-01')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(fromIsoDate('2028-02-29')).not.toBeNull();
  });

  it('returns null for null, undefined and anything not `YYYY-MM-DD`', () => {
    expect(fromIsoDate(null)).toBeNull();
    expect(fromIsoDate(undefined)).toBeNull();
    expect(fromIsoDate('')).toBeNull();
    expect(fromIsoDate('12/03/2026')).toBeNull();
    expect(fromIsoDate('2026-03-12T00:00:00Z')).toBeNull();
  });
});

describe('isOverdue', () => {
  it('compares calendar days as strings, with no timezone in the middle', () => {
    expect(isOverdue('2026-03-11', '2026-03-12')).toBe(true);
    expect(isOverdue('2026-03-12', '2026-03-12')).toBe(false);
    expect(isOverdue('2026-03-13', '2026-03-12')).toBe(false);
  });

  it('handles a year boundary', () => {
    expect(isOverdue('2025-12-31', '2026-01-01')).toBe(true);
  });

  it('treats "no due date" as not overdue', () => {
    expect(isOverdue(null, '2026-03-12')).toBe(false);
    expect(isOverdue(undefined, '2026-03-12')).toBe(false);
  });
});

describe('formatIsoDate', () => {
  it('renders a readable day', () => {
    const formatted = formatIsoDate('2026-03-12', 'en-US');
    expect(formatted).toContain('12');
    expect(formatted).toContain('2026');
  });

  it('keeps Western digits under Arabic', () => {
    expect(formatIsoDate('2026-03-12', 'ar-u-nu-latn')).toMatch(/12/);
    expect(formatIsoDate('2026-03-12', 'ar-u-nu-latn')).toMatch(/2026/);
  });

  it('returns an empty string, never "Invalid Date"', () => {
    // An empty cell is a truthful "no value"; the words "Invalid Date" in a
    // table get filed as a bug about data that is merely absent.
    expect(formatIsoDate(null, 'en-US')).toBe('');
    expect(formatIsoDate('nonsense', 'en-US')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('renders an instant with both halves', () => {
    const formatted = formatDateTime('2026-03-12T14:05:00Z', 'en-US');
    expect(formatted).toContain('2026');
    expect(formatted.length).toBeGreaterThan('12 Mar 2026'.length);
  });

  it('returns an empty string for a missing or unparseable instant', () => {
    expect(formatDateTime(null, 'en-US')).toBe('');
    expect(formatDateTime('nonsense', 'en-US')).toBe('');
  });
});

describe('relativeParts', () => {
  const NOW = new Date('2026-03-12T12:00:00Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it('picks the largest unit that fits', () => {
    expect(relativeParts(ago(30_000), NOW).unit).toBe('second');
    expect(relativeParts(ago(5 * 60_000), NOW).unit).toBe('minute');
    expect(relativeParts(ago(5 * 3_600_000), NOW).unit).toBe('hour');
    expect(relativeParts(ago(5 * 86_400_000), NOW).unit).toBe('day');
    expect(relativeParts(ago(60 * 86_400_000), NOW).unit).toBe('month');
    expect(relativeParts(ago(800 * 86_400_000), NOW).unit).toBe('year');
  });

  it('signs the past negative and the future positive', () => {
    expect(relativeParts(ago(5 * 3_600_000), NOW).value).toBe(-5);
    expect(relativeParts(new Date(NOW.getTime() + 5 * 3_600_000), NOW).value).toBe(5);
  });
});

describe('formatRelative', () => {
  it('renders a past instant in words', () => {
    const formatted = formatRelative(
      '2026-03-09T12:00:00Z',
      'en-US',
      new Date('2026-03-12T12:00:00Z'),
    );
    expect(formatted).toMatch(/3 days ago/);
  });

  it('returns an empty string rather than formatting garbage', () => {
    expect(formatRelative('nonsense', 'en-US')).toBe('');
    expect(formatRelative(null, 'en-US')).toBe('');
  });
});
