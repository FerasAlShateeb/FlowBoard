/**
 * The seed's rank generator is the one piece of it that can be wrong silently:
 * a board whose cards come back in the wrong order looks like a UI bug, not a
 * seed bug. These tests pin the ordering property that `ORDER BY board_rank`
 * relies on.
 */
import { describe, expect, it } from 'vitest';

import { addDays, chunk, createRandom, createRankAllocator, isoDate, rankAt } from './seed-utils';

describe('rankAt', () => {
  it('produces strictly ascending keys across the a→b magnitude boundary', () => {
    const keys = Array.from({ length: 200 }, (_, index) => rankAt(index));
    for (let i = 1; i < keys.length; i += 1) {
      const previous = keys[i - 1];
      const current = keys[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      // Plain string comparison — the same one Postgres does.
      expect(previous! < current!).toBe(true);
    }
  });

  it('uses the fractional-indexing magnitude prefixes', () => {
    expect(rankAt(0)).toBe('a0');
    expect(rankAt(9)).toBe('a9');
    expect(rankAt(10)).toBe('aA');
    expect(rankAt(61)).toBe('az');
    expect(rankAt(62)).toBe('b00');
  });

  it('refuses a negative index rather than emitting a broken key', () => {
    expect(() => rankAt(-1)).toThrow();
  });
});

describe('createRankAllocator', () => {
  it('numbers each bucket independently', () => {
    const next = createRankAllocator();
    expect(next('column-a')).toBe('a0');
    expect(next('column-b')).toBe('a0');
    expect(next('column-a')).toBe('a1');
    expect(next('column-b')).toBe('a1');
  });
});

describe('createRandom', () => {
  it('is deterministic for a given seed', () => {
    const first = createRandom(42);
    const second = createRandom(42);
    const drawA = Array.from({ length: 10 }, () => first.int(0, 1000));
    const drawB = Array.from({ length: 10 }, () => second.int(0, 1000));
    expect(drawA).toEqual(drawB);
  });

  it('keeps int() inside the inclusive bounds', () => {
    const random = createRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const value = random.int(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('shuffle keeps every element exactly once', () => {
    const random = createRandom(11);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect([...random.shuffle(input)].sort((a, b) => a - b)).toEqual(input);
  });

  it('throws instead of returning undefined when picking from nothing', () => {
    expect(() => createRandom(1).pick([])).toThrow();
  });
});

describe('date helpers', () => {
  it('addDays shifts by whole days in both directions', () => {
    const base = new Date('2026-03-01T12:00:00.000Z');
    expect(isoDate(addDays(base, 1))).toBe('2026-03-02');
    expect(isoDate(addDays(base, -1))).toBe('2026-02-28');
  });

  it('isoDate emits the YYYY-MM-DD shape the date columns expect', () => {
    expect(isoDate(new Date('2026-12-31T23:00:00.000Z'))).toBe('2026-12-31');
  });
});

describe('chunk', () => {
  it('splits without losing or duplicating items', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
