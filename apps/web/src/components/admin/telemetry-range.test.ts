import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TELEMETRY_PRESET,
  TELEMETRY_FILTER_PRESETS,
  filterWindow,
  presetBucket,
  presetWindow,
  windowKey,
} from '@/components/admin/telemetry-range';

/**
 * The telemetry window — instants, not calendar days.
 *
 * Every case pins `now`, because the whole module exists to turn a preset and a
 * clock into two exact ISO strings; a test that used the real clock could only
 * assert that the result "looks like a date".
 */

/** A fixed instant with a non-zero time of day, so a truncation bug shows. */
const NOW = new Date('2026-08-27T13:45:30.000Z');

describe('presetWindow', () => {
  it('counts back from `now` in exact hours, keeping the time of day', () => {
    expect(presetWindow('24h', NOW)).toEqual({
      from: '2026-08-26T13:45:30.000Z',
      to: '2026-08-27T13:45:30.000Z',
    });
    expect(presetWindow('7d', NOW).from).toBe('2026-08-20T13:45:30.000Z');
    expect(presetWindow('30d', NOW).from).toBe('2026-07-28T13:45:30.000Z');
  });

  it('crosses a month boundary correctly', () => {
    // Not arithmetic on a `2026-08-27` string: the window is a pair of
    // instants, so this is plain millisecond subtraction and February cannot
    // surprise it.
    expect(presetWindow('7d', new Date('2026-03-03T00:00:00.000Z')).from).toBe(
      '2026-02-24T00:00:00.000Z',
    );
  });
});

describe('presetBucket', () => {
  it('reads short windows hourly and the month daily', () => {
    // 30 days of hourly points is 720 marks on a 600-pixel canvas; 24 hours of
    // daily points is one.
    expect(presetBucket('24h')).toBe('hour');
    expect(presetBucket('7d')).toBe('hour');
    expect(presetBucket('30d')).toBe('day');
  });

  it('never defaults to `minute`', () => {
    // It exists in the contract for a live incident view, and the API refuses a
    // window wide enough to make it expensive.
    for (const preset of ['24h', '7d', '30d'] as const) {
      expect(presetBucket(preset)).not.toBe('minute');
    }
  });
});

describe('windowKey', () => {
  it('puts the BUCKET in the key, so a granularity toggle refetches', () => {
    const window = presetWindow('7d', NOW);
    // Same URL path, same window, different payload: a key that ignored the
    // bucket would serve the daily series to the hourly chart, which looks
    // exactly like a chart that has stopped updating.
    expect(windowKey(window, 'hour')).not.toBe(windowKey(window, 'day'));
  });

  it('omits the bucket for the endpoints table, which has none', () => {
    const window = presetWindow('7d', NOW);
    expect(windowKey(window)).toBe(`${window.from}..${window.to}`);
  });

  it('separates two different windows', () => {
    expect(windowKey(presetWindow('24h', NOW))).not.toBe(windowKey(presetWindow('7d', NOW)));
  });
});

describe('filterWindow', () => {
  it('is `undefined` for "all", which is what "no range filter" means', () => {
    // The feed is the ONE endpoint with no implicit window — see the note in
    // `admin-telemetry.service.ts`.
    expect(filterWindow('all', NOW)).toBeUndefined();
  });

  it('matches `presetWindow` for every other preset', () => {
    expect(filterWindow('7d', NOW)).toEqual(presetWindow('7d', NOW));
  });

  it('offers "all" first, then the three chart windows', () => {
    expect(TELEMETRY_FILTER_PRESETS).toEqual(['all', '24h', '7d', '30d']);
    expect(DEFAULT_TELEMETRY_PRESET).toBe('24h');
  });
});
