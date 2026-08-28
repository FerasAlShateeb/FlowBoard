import { describe, expect, it } from 'vitest';

import {
  RANGE_PRESETS,
  addDays,
  defaultRange,
  detectPreset,
  isValidRange,
  normalizeRange,
  parseIsoDate,
  presetRange,
  rangeKey,
  toIsoDate,
} from '@/components/reports/report-range';

/**
 * The report window.
 *
 * The whole module exists to keep a `YYYY-MM-DD` string away from UTC, so the
 * tests that matter most are the round-trip ones: a day that goes in as the
 * 27th has to come back as the 27th regardless of the machine's zone, and a
 * preset counted back across a month or year boundary has to land on a real
 * date.
 */

/** A fixed "today" so the preset assertions are not calendar-dependent. */
const TODAY = new Date(2026, 7, 27); // 2026-08-27, local

describe('parseIsoDate / toIsoDate', () => {
  it('round-trips a calendar day through LOCAL midnight', () => {
    const date = parseIsoDate('2026-08-27');
    expect(date.getFullYear()).toBe(2026);
    // Local, not UTC: `new Date('2026-08-27')` would be the 26th west of UTC.
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(27);
    expect(toIsoDate(date)).toBe('2026-08-27');
  });

  it('pads single-digit months and days', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('rejects a malformed string and a day that does not exist', () => {
    expect(Number.isNaN(parseIsoDate('27-08-2026').getTime())).toBe(true);
    expect(Number.isNaN(parseIsoDate('').getTime())).toBe(true);
    // Would silently roll over to March 3 if built naively.
    expect(Number.isNaN(parseIsoDate('2026-02-31').getTime())).toBe(true);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('passes an unparseable input through untouched', () => {
    expect(addDays('nonsense', 3)).toBe('nonsense');
  });
});

describe('presetRange', () => {
  it('counts back INCLUSIVE of today', () => {
    // 14 days ending today means 13 days back, not 14.
    expect(presetRange('2w', TODAY)).toEqual({ from: '2026-08-14', to: '2026-08-27' });
    expect(presetRange('4w', TODAY)).toEqual({ from: '2026-07-31', to: '2026-08-27' });
    expect(presetRange('8w', TODAY)).toEqual({ from: '2026-07-03', to: '2026-08-27' });
  });

  it('produces a valid range for every preset', () => {
    for (const preset of RANGE_PRESETS) {
      expect(isValidRange(presetRange(preset, TODAY))).toBe(true);
    }
  });

  it('opens the dashboard on the four-week window', () => {
    expect(defaultRange(TODAY)).toEqual(presetRange('4w', TODAY));
  });
});

describe('detectPreset', () => {
  it('recognises each preset window', () => {
    for (const preset of RANGE_PRESETS) {
      expect(detectPreset(presetRange(preset, TODAY), TODAY)).toBe(preset);
    }
  });

  it('falls back to `custom` for a hand-picked window', () => {
    expect(detectPreset({ from: '2026-01-01', to: '2026-03-15' }, TODAY)).toBe('custom');
  });

  it('does not match a preset-length window that ended in the past', () => {
    // Same 14-day span, but ending yesterday: not "last 2 weeks".
    expect(detectPreset({ from: '2026-08-13', to: '2026-08-26' }, TODAY)).toBe('custom');
  });
});

describe('isValidRange / normalizeRange', () => {
  it('accepts a single-day window', () => {
    expect(isValidRange({ from: '2026-08-27', to: '2026-08-27' })).toBe(true);
  });

  it('rejects a reversed window and swaps it', () => {
    const reversed = { from: '2026-08-27', to: '2026-08-14' };
    expect(isValidRange(reversed)).toBe(false);
    expect(normalizeRange(reversed)).toEqual({ from: '2026-08-14', to: '2026-08-27' });
  });

  it('leaves an already-ordered window alone (same object)', () => {
    const ordered = { from: '2026-08-14', to: '2026-08-27' };
    expect(normalizeRange(ordered)).toBe(ordered);
  });

  it('does not try to swap when an endpoint is unparseable', () => {
    const broken = { from: 'nope', to: '2026-08-27' };
    expect(normalizeRange(broken)).toBe(broken);
  });
});

describe('rangeKey', () => {
  it('is stable and distinguishes windows', () => {
    expect(rangeKey({ from: '2026-08-14', to: '2026-08-27' })).toBe('2026-08-14..2026-08-27');
    expect(rangeKey({ from: '2026-08-14', to: '2026-08-27' })).not.toBe(
      rangeKey({ from: '2026-08-15', to: '2026-08-27' }),
    );
  });
});
