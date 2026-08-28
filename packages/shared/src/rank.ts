// Fractional-index ordering — the mechanism behind `tasks.board_rank` and
// `tasks.backlog_rank`, and the reason a Kanban drop is one UPDATE instead of a
// renumbering pass over the column.
//
// A rank is an opaque, lexicographically-sortable string. Between any two ranks
// another one always exists, so inserting a card between two neighbours writes
// exactly ONE row and every read stays a plain `ORDER BY board_rank`. Both ends
// import these wrappers: the web computes an optimistic key on drag end so the
// card lands instantly, and the API recomputes the authoritative key from the
// neighbour ids inside the move transaction.
//
// WHY WRAPPERS AND NOT THE PACKAGE DIRECTLY:
//   - one import path, so the alphabet (and any future migration off it) is
//     changed in one file rather than in every call site;
//   - `generateKeyBetween` THROWS on invalid input, and the argument order that
//     produces those throws is easy to get wrong under a drag handler;
//   - `fractional-indexing` is ESM-only and the API is CommonJS, so it is
//     bundled into this package's CJS output (`noExternal` in tsup.config.ts) and
//     never imported by `apps/api` directly.
//
// Runtime-neutral: pure string math, no DOM/Node globals.
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Length at which a rank is considered degenerate and its column should be
 * rewritten.
 *
 * Every insert between two adjacent keys makes the new key at least one
 * character longer, so a column that is repeatedly dropped into at the same spot
 * grows keys without bound. 60 characters is far past anything organic drag
 * traffic produces (it takes dozens of insertions into the identical gap) and far
 * short of anything that threatens the text column, which makes it a safe
 * "something pathological is happening" trigger rather than a routine one.
 *
 * When a computed key crosses it, the move transaction rewrites every rank in
 * that column with {@link initialRanks} and answers `rebalanced: true`, which
 * tells clients their other cached ranks are now stale.
 */
export const NEEDS_REBALANCE_LENGTH = 60;

/**
 * Generates a rank that sorts strictly between `a` and `b`.
 *
 * Pass `null`/`undefined` for an open end: `rankBetween(null, first)` prepends,
 * `rankBetween(last, null)` appends, and `rankBetween(null, null)` is the first
 * key in an empty column.
 *
 * ORDER IS FORGIVING, EQUALITY IS NOT. `fractional-indexing@4` normalizes two
 * non-null bounds, so passing them the wrong way round still returns a key
 * between them rather than throwing — do not rely on an exception to catch a
 * swapped drag. Two IDENTICAL keys do throw, because no key exists between them;
 * that is the stale-read signal, and the caller must re-read its neighbours.
 *
 * @throws if `a` and `b` are the same key, or either is not a valid rank.
 *
 * @example
 *   const rank = rankBetween(cards[index - 1]?.boardRank, cards[index]?.boardRank);
 */
export function rankBetween(a: string | null | undefined, b: string | null | undefined): string {
  return generateKeyBetween(a ?? null, b ?? null);
}

/**
 * Generates `count` ranks in ascending order, for seeding a fresh list or
 * rewriting a column during a rebalance.
 *
 * Returns `[]` for `count === 0`.
 *
 * @example
 *   const ranks = initialRanks(tasks.length); // ['a0', 'a1', 'a2', …]
 */
export function initialRanks(count: number): string[] {
  if (count <= 0) return [];
  return generateNKeysBetween(null, null, count);
}

/**
 * Whether a rank has grown past {@link NEEDS_REBALANCE_LENGTH} and its column
 * should be rewritten in the same transaction that produced it.
 */
export function needsRebalance(rank: string): boolean {
  return rank.length >= NEEDS_REBALANCE_LENGTH;
}
