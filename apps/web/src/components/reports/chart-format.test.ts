import { afterEach, describe, expect, it } from 'vitest';

import { getIntlLocale, setLangPref } from '@/lib/lang-policy';
import {
  __clearFormatterCacheForTests,
  formatCount,
  formatDayFull,
  formatDayTick,
  formatDecimal,
  formatInstantTick,
} from '@/components/reports/chart-format';

/**
 * Axis and tooltip formatting.
 *
 * THE LOAD-BEARING ASSERTION IS THE DIGITS. FlowBoard's Arabic locale is
 * `ar-u-nu-latn` precisely so numerals stay Western on surfaces read next to
 * task keys and point totals; a chart axis is the most fragile of those,
 * because a digit swap breaks `tabular-nums` column alignment as well as the
 * comparison the reader is making. Losing the `-u-nu-latn` subtag is a
 * one-character regression, so it is asserted directly.
 */

afterEach(() => {
  setLangPref('en');
  __clearFormatterCacheForTests();
});

describe('formatDayTick', () => {
  it('renders a short, month-named day label', () => {
    expect(formatDayTick('2026-08-27', 'en-US')).toBe('Aug 27');
  });

  it('reads the calendar day LOCALLY — never one day early', () => {
    // The bug this guards: `new Date('2026-01-01')` is UTC midnight, which
    // prints as December 31 anywhere west of Greenwich.
    expect(formatDayTick('2026-01-01', 'en-US')).toBe('Jan 1');
  });

  it('keeps LATIN digits in Arabic while localizing the month name', () => {
    const label = formatDayTick('2026-08-27', 'ar-u-nu-latn');
    expect(label).toContain('27');
    expect(label).not.toMatch(/[٠-٩]/);
    // The month word itself IS localized — otherwise this is just English.
    expect(label).not.toBe('Aug 27');
  });

  it('passes an unparseable value through rather than printing `Invalid Date`', () => {
    expect(formatDayTick('not-a-day', 'en-US')).toBe('not-a-day');
  });
});

describe('formatDayFull', () => {
  it('carries the year, because a window can straddle one', () => {
    expect(formatDayFull('2026-08-27', 'en-US')).toBe('Aug 27, 2026');
  });
});

describe('formatInstantTick', () => {
  it('formats an isoDateTime instant', () => {
    // Midday UTC, so the label is the 27th in every plausible test zone.
    expect(formatInstantTick('2026-08-27T12:00:00.000Z', 'en-US')).toBe('Aug 27');
  });

  it('falls back to the raw value when the instant is unparseable', () => {
    expect(formatInstantTick('whenever', 'en-US')).toBe('whenever');
  });
});

describe('number formatting', () => {
  it('groups counts and rounds points to one decimal', () => {
    expect(formatCount(1234, 'en-US')).toBe('1,234');
    expect(formatDecimal(3.456, 'en-US')).toBe('3.5');
    expect(formatDecimal(8, 'en-US')).toBe('8');
  });

  it('keeps Arabic numerals Latin', () => {
    expect(formatCount(1234, 'ar-u-nu-latn')).not.toMatch(/[٠-٩]/);
  });

  it('renders a non-finite value as an em dash instead of `NaN`', () => {
    expect(formatDecimal(Number.NaN, 'en-US')).toBe('—');
    expect(formatCount(Number.POSITIVE_INFINITY, 'en-US')).toBe('—');
  });
});

describe('locale policy', () => {
  it('asks Intl for Latin numerals when the UI is Arabic', () => {
    setLangPref('ar');
    expect(getIntlLocale()).toBe('ar-u-nu-latn');
  });
});
