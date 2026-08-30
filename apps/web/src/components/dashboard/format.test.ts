import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LANG_STORAGE_KEY, initLangPolicy, setLangPref } from '@/lib/lang-policy';
import { __clearFormatterCache } from '@/lib/format';
import {
  NO_VALUE,
  __clearDashboardFormatterCache,
  bucketLabel,
  formatCount,
  formatDay,
  formatDelta,
  formatMs,
  formatPercent,
  formatShare,
} from '@/components/dashboard/format';

/**
 * The dashboard's number and tick shapes.
 *
 * The language is switched through the POLICY rather than by stubbing a locale,
 * because that is the only path the app itself takes — and it is what proves
 * the formatter cache is keyed by locale rather than frozen at first use. Both
 * caches are cleared around every case for the same reason.
 */

beforeEach(() => {
  localStorage.setItem(LANG_STORAGE_KEY, 'en');
  initLangPolicy();
  __clearDashboardFormatterCache();
  __clearFormatterCache();
});

afterEach(() => {
  setLangPref('en');
  __clearDashboardFormatterCache();
  __clearFormatterCache();
});

describe('formatCount()', () => {
  it('groups a long number and leaves a short one alone', () => {
    expect(formatCount(7)).toBe('7');
    expect(formatCount(1234)).toBe('1,234');
  });

  it('compacts on request, for axes and tiles that have no room', () => {
    expect(formatCount(1234, true)).toBe('1.2K');
    expect(formatCount(1_500_000, true)).toBe('1.5M');
  });

  it('keeps WESTERN digits in Arabic, so a tabular column stays aligned', () => {
    setLangPref('ar');
    expect(formatCount(1234)).toContain('1');
    expect(formatCount(1234)).not.toContain('١');
  });

  it('answers the placeholder for a number that is not one', () => {
    expect(formatCount(Number.NaN)).toBe(NO_VALUE);
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe(NO_VALUE);
  });
});

describe('formatMs()', () => {
  it('rounds to whole milliseconds and appends the unit it is handed', () => {
    expect(formatMs(128.4, 'ms')).toBe('128 ms');
    expect(formatMs(1234.6, 'ms')).toBe('1,235 ms');
  });

  it('takes the unit from the caller, so it can be translated', () => {
    expect(formatMs(5, 'مث')).toBe('5 مث');
  });

  it('answers the placeholder for a non-finite duration', () => {
    expect(formatMs(Number.NaN, 'ms')).toBe(NO_VALUE);
  });
});

describe('percent shapes', () => {
  it('formatDelta signs the positive side, because a trend is a movement', () => {
    expect(formatDelta(12.34)).toBe('+12.3%');
    expect(formatDelta(-3)).toBe('-3.0%');
    expect(formatDelta(0)).toBe('0.0%');
  });

  it('formatPercent states a LEVEL already in percent units', () => {
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(12.34, 0)).toBe('12%');
  });

  it('formatShare scales a 0–1 rate, which is the other half of the trap', () => {
    expect(formatShare(0.732)).toBe('73%');
    expect(formatShare(0.732, 1)).toBe('73.2%');
    expect(formatShare(0)).toBe('0%');
  });

  it('all three answer the placeholder rather than printing NaN%', () => {
    expect(formatDelta(Number.NaN)).toBe(NO_VALUE);
    expect(formatPercent(Number.NaN)).toBe(NO_VALUE);
    expect(formatShare(Number.NaN)).toBe(NO_VALUE);
  });
});

describe('bucketLabel()', () => {
  const iso = '2026-07-20T15:00:00.000Z';

  it('adds the clock for an hour bucket', () => {
    expect(bucketLabel(iso, 'hour')).toMatch(/Jul/);
    expect(bucketLabel(iso, 'hour').length).toBeGreaterThan(bucketLabel(iso, 'day').length);
  });

  it('drops the day for a month bucket', () => {
    expect(bucketLabel(iso, 'month')).toBe('Jul 26');
  });

  it('labels a week bucket by the day it starts on', () => {
    expect(bucketLabel(iso, 'week')).toBe(bucketLabel(iso, 'day'));
  });

  it('follows the language, and rebuilds its formatters when it changes', () => {
    const english = bucketLabel(iso, 'day');
    setLangPref('ar');
    expect(bucketLabel(iso, 'day')).not.toBe(english);
    setLangPref('en');
    expect(bucketLabel(iso, 'day')).toBe(english);
  });

  it('returns an unparseable stamp verbatim rather than "Invalid Date"', () => {
    expect(bucketLabel('nope', 'day')).toBe('nope');
  });
});

describe('formatDay()', () => {
  it('applies the active locale to a calendar day', () => {
    expect(formatDay('2026-03-12')).toBe('Mar 12, 2026');
  });

  it('is empty for a missing or unparseable day', () => {
    expect(formatDay(null)).toBe('');
    expect(formatDay('2026-02-31')).toBe('');
  });
});
