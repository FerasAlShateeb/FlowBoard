import { afterEach, describe, expect, it } from 'vitest';

import {
  DAYS_PER_WEEK,
  MONTH_GRID_DAYS,
  addDayKeys,
  compareDayKeys,
  diffDayKeys,
  formatDayNumber,
  formatMonthYear,
  gridDays,
  isDayKey,
  isSameMonth,
  isWithinRange,
  monthGridDays,
  monthGridWeeks,
  parseDayKey,
  rangeOf,
  shiftCursor,
  toDayKey,
  todayKey,
  weekGridDays,
  weekStartFor,
  weekdayNames,
} from '@/components/calendar/calendar-dates';

/**
 * The grid generator, exercised where calendars actually break: month
 * boundaries, leap days, and daylight-saving transitions.
 *
 * The DST cases pin `process.env.TZ` so they test the transition rather than
 * whatever zone the machine happens to sit in — a suite that only ever runs in
 * UTC would pass with a midnight-anchored implementation that duplicates a day
 * every spring for half the planet.
 */

/**
 * The Node environment, reached through `globalThis` and typed locally.
 *
 * `apps/web` compiles with `"types": []` — it is a browser bundle and must not
 * see Node's globals — so a bare `process.env.TZ` does not type-check even in a
 * test. Setting `TZ` at runtime is a documented Node behaviour: it invalidates
 * the cached timezone, so every `Date` built after it uses the new zone.
 */
const nodeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
  ?.env;

const originalTimeZone = nodeEnv?.TZ;

afterEach(() => {
  if (nodeEnv) nodeEnv.TZ = originalTimeZone;
});

/** Runs `fn` with the process pinned to `timeZone`. */
function inTimeZone<T>(timeZone: string, fn: () => T): T {
  if (nodeEnv) nodeEnv.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (nodeEnv) nodeEnv.TZ = originalTimeZone;
  }
}

/** True when every key is exactly one day after the one before it. */
function isContiguous(days: readonly string[]): boolean {
  return days.every((day, index) => index === 0 || diffDayKeys(day, days[index - 1] ?? day) === 1);
}

describe('day keys', () => {
  it('round-trips a key through a Date without shifting the day', () => {
    for (const key of ['2026-01-01', '2024-02-29', '2026-03-08', '2026-12-31']) {
      expect(toDayKey(parseDayKey(key))).toBe(key);
    }
  });

  it('anchors at local noon, so a ±1h DST shift cannot cross midnight', () => {
    const anchor = parseDayKey('2026-03-08');
    expect(anchor.getHours()).toBe(12);
  });

  it('recognises well-formed keys only', () => {
    expect(isDayKey('2026-03-08')).toBe(true);
    expect(isDayKey('2026-3-8')).toBe(false);
    expect(isDayKey(20260308)).toBe(false);
  });

  it('orders and compares keys as plain strings', () => {
    expect(compareDayKeys('2026-03-08', '2026-03-09')).toBe(-1);
    expect(compareDayKeys('2026-03-09', '2026-03-08')).toBe(1);
    expect(compareDayKeys('2026-03-08', '2026-03-08')).toBe(0);
    expect(isSameMonth('2026-03-01', '2026-03-31')).toBe(true);
    expect(isSameMonth('2026-03-31', '2026-04-01')).toBe(false);
    expect(isWithinRange('2026-03-08', { from: '2026-03-01', to: '2026-03-31' })).toBe(true);
    expect(isWithinRange('2026-04-01', { from: '2026-03-01', to: '2026-03-31' })).toBe(false);
  });

  it('adds and subtracts days across a spring-forward transition', () => {
    inTimeZone('America/New_York', () => {
      // 2026-03-08 is the US spring-forward day: 02:00 never happens.
      expect(addDayKeys('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDayKeys('2026-03-08', 1)).toBe('2026-03-09');
      expect(addDayKeys('2026-03-09', -1)).toBe('2026-03-08');
      expect(diffDayKeys('2026-03-09', '2026-03-07')).toBe(2);
    });
  });

  it('adds and subtracts days across a fall-back transition', () => {
    inTimeZone('America/New_York', () => {
      // 2026-11-01: 01:00 happens twice.
      expect(addDayKeys('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDayKeys('2026-11-01', 1)).toBe('2026-11-02');
      expect(diffDayKeys('2026-11-02', '2026-10-31')).toBe(2);
    });
  });

  it('adds days across a month and a leap-year boundary', () => {
    expect(addDayKeys('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDayKeys('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDayKeys('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDayKeys('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('reports today from the clock it is given', () => {
    expect(todayKey(new Date(2026, 7, 27, 9, 30))).toBe('2026-08-27');
  });
});

describe('week start policy', () => {
  it('opens on Sunday in English and Saturday in Arabic', () => {
    expect(weekStartFor('en')).toBe(0);
    expect(weekStartFor('ar')).toBe(6);
  });

  it('labels the weekdays in grid order for each start', () => {
    expect(weekdayNames(0, 'en-US').at(0)).toBe('Sun');
    expect(weekdayNames(6, 'en-US').at(0)).toBe('Sat');
    expect(weekdayNames(6, 'en-US').at(1)).toBe('Sun');
    expect(weekdayNames(0, 'en-US')).toHaveLength(DAYS_PER_WEEK);
  });
});

describe('month grid', () => {
  it('is always 42 contiguous days that contain the whole month', () => {
    for (const cursor of ['2026-02-15', '2026-03-15', '2026-08-01', '2027-01-31']) {
      const days = monthGridDays(cursor, 0);
      expect(days).toHaveLength(MONTH_GRID_DAYS);
      expect(isContiguous(days)).toBe(true);
      expect(new Set(days).size).toBe(MONTH_GRID_DAYS);
      expect(days).toContain(`${cursor.slice(0, 7)}-01`);
    }
  });

  it('starts on the week-start weekday, in both policies', () => {
    // 2026-03-01 is a Sunday, so a Sunday grid starts on it and a Saturday grid
    // starts the day before.
    expect(monthGridDays('2026-03-20', 0).at(0)).toBe('2026-03-01');
    expect(monthGridDays('2026-03-20', 6).at(0)).toBe('2026-02-28');
  });

  it('stays contiguous across a DST transition', () => {
    inTimeZone('America/New_York', () => {
      const march = monthGridDays('2026-03-15', 0);
      expect(isContiguous(march)).toBe(true);
      expect(new Set(march).size).toBe(MONTH_GRID_DAYS);
      expect(march).toContain('2026-03-08');

      const november = monthGridDays('2026-11-15', 0);
      expect(isContiguous(november)).toBe(true);
      expect(new Set(november).size).toBe(MONTH_GRID_DAYS);
    });
  });

  it('splits into six rows of seven', () => {
    const weeks = monthGridWeeks('2026-03-15', 0);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === DAYS_PER_WEEK)).toBe(true);
    expect(weeks.flat()).toEqual(monthGridDays('2026-03-15', 0));
  });

  it('covers a February that starts exactly on the week start', () => {
    // 2026-02-01 is a Sunday: the first row is the month itself, and the grid
    // still runs six rows into March.
    const days = monthGridDays('2026-02-01', 0);
    expect(days.at(0)).toBe('2026-02-01');
    expect(days.at(-1)).toBe('2026-03-14');
  });
});

describe('week grid and cursor', () => {
  it('returns the seven days of the cursor’s week', () => {
    const days = weekGridDays('2026-03-11', 0);
    expect(days).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
    ]);
    expect(weekGridDays('2026-03-11', 6).at(0)).toBe('2026-03-07');
  });

  it('steps a month without drifting off a 31st', () => {
    expect(shiftCursor('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(shiftCursor(shiftCursor('2026-01-31', 'month', 1), 'month', 1)).toBe('2026-03-01');
    expect(shiftCursor('2026-01-15', 'month', -1)).toBe('2025-12-01');
  });

  it('steps a week by exactly seven days', () => {
    expect(shiftCursor('2026-03-11', 'week', 1)).toBe('2026-03-18');
    expect(shiftCursor('2026-03-11', 'week', -1)).toBe('2026-03-04');
  });

  it('reports the range a view covers', () => {
    expect(rangeOf(gridDays('2026-03-11', 'week', 0))).toEqual({
      from: '2026-03-08',
      to: '2026-03-14',
    });
    expect(rangeOf(gridDays('2026-03-11', 'month', 0))).toEqual({
      from: '2026-03-01',
      to: '2026-04-11',
    });
    expect(() => rangeOf([])).toThrow();
  });
});

describe('Intl formatting', () => {
  it('keeps digits Latin in Arabic', () => {
    expect(formatDayNumber('2026-03-08', 'ar-u-nu-latn')).toBe('8');
    expect(formatMonthYear('2026-03-08', 'ar-u-nu-latn')).toContain('2026');
  });

  it('names the month in the UI language', () => {
    expect(formatMonthYear('2026-03-08', 'en-US')).toBe('March 2026');
  });
});
