import { describe, expect, it } from 'vitest';
import { initialRanks, NEEDS_REBALANCE_LENGTH, needsRebalance, rankBetween } from './rank';

describe('rankBetween', () => {
  it('generates a key that sorts strictly between its neighbours', () => {
    const first = rankBetween(null, null);
    const second = rankBetween(first, null);
    const middle = rankBetween(first, second);

    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);
  });

  it('prepends when the left neighbour is open', () => {
    const first = rankBetween(null, null);
    const before = rankBetween(null, first);

    expect(before < first).toBe(true);
  });

  it('appends when the right neighbour is open', () => {
    const first = rankBetween(null, null);
    const after = rankBetween(first, null);

    expect(first < after).toBe(true);
  });

  it('treats undefined like null, so `array[i - 1]?.rank` needs no guard', () => {
    expect(rankBetween(undefined, undefined)).toBe(rankBetween(null, null));
  });

  it('normalizes reversed neighbours instead of throwing', () => {
    const first = rankBetween(null, null);
    const second = rankBetween(first, null);
    const middle = rankBetween(second, first);

    // fractional-indexing@4 accepts the bounds in either order, so a swapped
    // drag produces a valid key — callers must not use an exception to catch one.
    expect(middle > first).toBe(true);
    expect(middle < second).toBe(true);
  });

  it('throws when both neighbours are the same key — nothing fits between', () => {
    const only = rankBetween(null, null);

    expect(() => rankBetween(only, only)).toThrow();
  });

  it('throws on a rank the alphabet cannot produce', () => {
    expect(() => rankBetween('!!not-a-rank', null)).toThrow();
  });

  it('keeps ordering stable across repeated inserts into the same gap', () => {
    const low = rankBetween(null, null);
    const high = rankBetween(low, null);

    let upper = high;
    const inserted: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      upper = rankBetween(low, upper);
      inserted.push(upper);
    }

    // Each insert lands below the previous one and above the lower bound.
    const sorted = [...inserted].sort();
    expect(sorted).toEqual([...inserted].reverse());
    expect(inserted.every((rank) => rank > low && rank < high)).toBe(true);
  });
});

describe('initialRanks', () => {
  it('returns an ascending run of distinct keys', () => {
    const ranks = initialRanks(5);

    expect(ranks).toHaveLength(5);
    expect(new Set(ranks).size).toBe(5);
    expect([...ranks].sort()).toEqual(ranks);
  });

  it('returns an empty array for zero or negative counts', () => {
    expect(initialRanks(0)).toEqual([]);
    expect(initialRanks(-3)).toEqual([]);
  });

  it('produces keys a subsequent rankBetween can still split', () => {
    const [first, second] = initialRanks(2);
    const middle = rankBetween(first, second);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(middle > (first ?? '')).toBe(true);
    expect(middle < (second ?? '')).toBe(true);
  });
});

describe('needsRebalance', () => {
  it('is false for the short keys normal traffic produces', () => {
    expect(needsRebalance(rankBetween(null, null))).toBe(false);
    expect(needsRebalance(initialRanks(200)[199] ?? '')).toBe(false);
  });

  it('trips exactly at the threshold length', () => {
    expect(needsRebalance('a'.repeat(NEEDS_REBALANCE_LENGTH - 1))).toBe(false);
    expect(needsRebalance('a'.repeat(NEEDS_REBALANCE_LENGTH))).toBe(true);
    expect(needsRebalance('a'.repeat(NEEDS_REBALANCE_LENGTH + 10))).toBe(true);
  });

  it('eventually trips when the same gap is split over and over', () => {
    const low = rankBetween(null, null);
    let upper = rankBetween(low, null);

    for (let index = 0; index < 2000 && !needsRebalance(upper); index += 1) {
      upper = rankBetween(low, upper);
    }

    expect(needsRebalance(upper)).toBe(true);
  });
});
