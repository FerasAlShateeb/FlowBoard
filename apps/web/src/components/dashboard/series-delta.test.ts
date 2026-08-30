import { describe, expect, it } from 'vitest';

import { seriesDelta } from '@/components/dashboard/series-delta';

/**
 * The last-two-buckets trend number. Pure arithmetic with three edge cases that
 * each paint something wrong in the UI when they are missed.
 */
describe('seriesDelta()', () => {
  it('compares the LAST two buckets, ignoring everything before them', () => {
    // A window that fell off a cliff and recovered is UP, not down.
    expect(seriesDelta([{ value: 900 }, { value: 10 }, { value: 20 }])).toBe(100);
  });

  it('reports a rise as positive and a fall as negative', () => {
    expect(seriesDelta([{ value: 80 }, { value: 100 }])).toBeCloseTo(25, 6);
    expect(seriesDelta([{ value: 100 }, { value: 80 }])).toBeCloseTo(-20, 6);
  });

  it('reports an unchanged bucket as exactly flat', () => {
    expect(seriesDelta([{ value: 42 }, { value: 42 }])).toBe(0);
  });

  it('has NO trend to report with fewer than two buckets', () => {
    // `undefined` is the truth ("nothing to compare"); zero would be a claim.
    expect(seriesDelta([])).toBeUndefined();
    expect(seriesDelta([{ value: 7 }])).toBeUndefined();
  });

  it('reports growth from a zero bucket as +100% rather than Infinity', () => {
    // Arithmetic says the change is undefined; the product says "up from
    // nothing", which is the largest move a metric can make.
    expect(seriesDelta([{ value: 0 }, { value: 5 }])).toBe(100);
    expect(seriesDelta([{ value: 0 }, { value: 100_000 }])).toBe(100);
  });

  it('reports zero-to-zero as flat, because it is', () => {
    expect(seriesDelta([{ value: 0 }, { value: 0 }])).toBe(0);
  });

  it('divides by the SIGNED previous bucket, so a negative baseline flips the sign', () => {
    // -10 → -5 rose by 5, but against a baseline of -10 the ratio is -0.5. This
    // is pinned rather than "fixed": no analytics series this kit renders is
    // negative (counts, durations, rates), so a magnitude-relative variant
    // would be untestable guesswork about a case that cannot occur.
    expect(seriesDelta([{ value: -10 }, { value: -5 }])).toBeCloseTo(-50, 6);
  });

  it('refuses non-finite inputs instead of propagating them into the pill', () => {
    expect(seriesDelta([{ value: 1 }, { value: Number.NaN }])).toBeUndefined();
    expect(seriesDelta([{ value: Number.POSITIVE_INFINITY }, { value: 1 }])).toBeUndefined();
  });
});
