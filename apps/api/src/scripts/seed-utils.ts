/**
 * Pure helpers for `seed.ts` — deterministic randomness, fractional ranks and
 * date arithmetic. Kept separate so the seed file itself reads as data.
 */

/**
 * The base-62 alphabet `fractional-indexing` uses, in ASCII order.
 *
 * ASCII order matters: `'0' < '9' < 'A' < 'Z' < 'a' < 'z'`, so a plain
 * `ORDER BY board_rank` in Postgres (with a C-ish collation on these
 * characters) reproduces the intended sequence. Deviate from this alphabet and
 * the ordering silently stops matching the client's `generateKeyBetween`.
 */
const BASE_62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function digit(value: number): string {
  const char = BASE_62[value];
  if (char === undefined) {
    throw new Error(`seed: base-62 digit out of range: ${value}`);
  }
  return char;
}

/**
 * Nth ascending fractional-index key, hand-rolled.
 *
 * The seed deliberately does NOT call `@flowboard/shared`'s rank wrappers — it
 * runs before that package is guaranteed built, and a seed that depends on the
 * contract layer cannot be used to bootstrap a database for the contract
 * layer's own tests. These are real `fractional-indexing` keys all the same:
 * the `a` prefix means "one integer digit" (`a0`…`az`, 62 slots) and `b` means
 * two (`b00`…`bzz`), and `'a…' < 'b…'` lexicographically, so the sequence keeps
 * ascending across the boundary and `generateKeyBetween` can extend it later.
 */
export function rankAt(index: number): string {
  if (index < 0) {
    throw new Error(`seed: negative rank index ${index}`);
  }
  if (index < 62) {
    return `a${digit(index)}`;
  }
  const rest = index - 62;
  if (rest >= 62 * 62) {
    throw new Error(`seed: rank index ${index} exceeds the hand-written range`);
  }
  return `b${digit(Math.floor(rest / 62))}${digit(rest % 62)}`;
}

/**
 * Hands out ascending ranks per bucket key, e.g. `${projectId}:${statusId}`.
 *
 * Two tasks in the same board column must never share a rank; two tasks in
 * different columns are free to.
 */
export function createRankAllocator(): (bucket: string) => string {
  const nextIndex = new Map<string, number>();
  return (bucket: string): string => {
    const index = nextIndex.get(bucket) ?? 0;
    nextIndex.set(bucket, index + 1);
    return rankAt(index);
  };
}

/**
 * Deterministic PRNG (a plain LCG).
 *
 * `Math.random()` would make every seed run produce different data, which turns
 * "the burndown looks wrong" into an unreproducible bug report and makes
 * screenshots churn. Same seed → same database, every time.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  const int = (minInclusive: number, maxInclusive: number): number =>
    minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));

  const pick = <T>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error('seed: pick() called on an empty array');
    }
    return item;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const a = copy[i];
      const b = copy[j];
      if (a === undefined || b === undefined) {
        throw new Error('seed: shuffle index out of range');
      }
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  };

  /** True with probability `p` (0…1). */
  const chance = (p: number): boolean => next() < p;

  return { next, int, pick, shuffle, chance };
}

export interface Random {
  next: () => number;
  int: (minInclusive: number, maxInclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
  chance: (p: number) => boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shift a date by whole days (negative = into the past). */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/** Shift by minutes — used to spread stream rows inside a day. */
export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60 * 1000);
}

/** `Date` → `YYYY-MM-DD` for the `date` columns (`start_date`, `due_date`). */
export function isoDate(value: Date): string {
  const iso = value.toISOString().slice(0, 10);
  return iso;
}

/** A uniformly random instant in `[from, to]`. */
export function between(random: Random, from: Date, to: Date): Date {
  const span = to.getTime() - from.getTime();
  return new Date(from.getTime() + Math.floor(random.next() * Math.max(span, 1)));
}

/** Split `items` into chunks so a single INSERT stays inside Postgres' parameter limit. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
