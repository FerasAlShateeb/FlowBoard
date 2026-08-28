import { describe, expect, it } from 'vitest';

import {
  formatDateOnly,
  formatRelativeTime,
  fromDateOnly,
  isOverdue,
  toDateOnly,
  todayDateOnly,
} from '@/components/tasks/task-dates';

/**
 * The calendar-day conversions.
 *
 * THE BUG BEING GUARDED AGAINST is a one-day drift. `new Date('2026-03-01')`
 * parses as UTC midnight and `toISOString().slice(0, 10)` converts back through
 * UTC, so a picker round trip shifts the day for every reader outside UTC — in
 * one direction for those west of Greenwich and the other for those east. It
 * looks correct on a machine set to UTC, which is exactly how it reaches
 * production, so the round-trip assertion below is the one that earns its keep.
 */

describe('toDateOnly / fromDateOnly', () => {
  it('round-trips a calendar day without drifting', () => {
    expect(toDateOnly(fromDateOnly('2026-03-01') as Date)).toBe('2026-03-01');
    expect(toDateOnly(fromDateOnly('2026-12-31') as Date)).toBe('2026-12-31');
    expect(toDateOnly(fromDateOnly('2026-01-01') as Date)).toBe('2026-01-01');
  });

  it('builds a LOCAL date, not a UTC instant', () => {
    const date = fromDateOnly('2026-03-01');
    expect(date?.getFullYear()).toBe(2026);
    // `getMonth` is zero-based; the point is that the LOCAL accessors agree with
    // the string, which `new Date('2026-03-01')` would not west of Greenwich.
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(1);
    expect(date?.getHours()).toBe(0);
  });

  it('pads single-digit months and days', () => {
    expect(toDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('returns undefined for null, undefined and a malformed value', () => {
    expect(fromDateOnly(null)).toBeUndefined();
    expect(fromDateOnly(undefined)).toBeUndefined();
    expect(fromDateOnly('not-a-date')).toBeUndefined();
    expect(fromDateOnly('2026-3-1')).toBeUndefined();
  });
});

describe('todayDateOnly / isOverdue', () => {
  const now = new Date(2026, 2, 10, 14, 30);

  it('reads today in the LOCAL zone', () => {
    expect(todayDateOnly(now)).toBe('2026-03-10');
  });

  it('is overdue strictly before today — never on the day itself', () => {
    expect(isOverdue('2026-03-09', now)).toBe(true);
    expect(isOverdue('2026-03-10', now)).toBe(false);
    expect(isOverdue('2026-03-11', now)).toBe(false);
  });

  it('treats "no due date" as not overdue', () => {
    expect(isOverdue(null, now)).toBe(false);
    expect(isOverdue(undefined, now)).toBe(false);
  });
});

describe('formatDateOnly', () => {
  it('renders WESTERN digits in Arabic', () => {
    // FlowBoard shows latin numerals in every locale (i18n.md). The bare `ar`
    // locale would produce Arabic-Indic ones here.
    const arabic = formatDateOnly('2026-03-01', 'ar');
    expect(arabic).toMatch(/2026/u);
    expect(arabic).not.toMatch(/[٠-٩]/u);
  });

  it('renders an empty string rather than "Invalid Date"', () => {
    expect(formatDateOnly(null, 'en')).toBe('');
    expect(formatDateOnly('nonsense', 'en')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');

  it('picks the largest unit that fits', () => {
    expect(formatRelativeTime('2026-03-10T09:00:00.000Z', 'en', now)).toBe('3 hours ago');
    expect(formatRelativeTime('2026-03-09T12:00:00.000Z', 'en', now)).toBe('yesterday');
  });

  it('degrades to an empty string on an unparseable instant', () => {
    expect(formatRelativeTime('not-a-time', 'en', now)).toBe('');
  });
});
