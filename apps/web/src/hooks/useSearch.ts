import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchResponseSchema, type SearchResult } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/**
 * Org-wide task search — the command palette's second lane.
 *
 * ═══ THE THREE GATES, AND WHY EACH ONE EXISTS ══════════════════════════════
 *
 * 1. **Three characters.** The server's floor is TWO
 *    (`searchQuerySchema`), which is the point below which a trigram scan stops
 *    being an index lookup. The palette's floor is deliberately one higher: two
 *    characters match a large fraction of an org's titles, so the row the user
 *    wants is never on screen anyway, and every keystroke on the way to a real
 *    needle would cost a round trip and a `search_performed` telemetry row.
 *
 * 2. **250ms of keystroke silence.** Typing "authentication" is fourteen
 *    renders; without the debounce it is twelve requests (and twelve telemetry
 *    rows) whose answers are all superseded before they paint.
 *
 * 3. **`enabled`.** No org in scope — the signed-in user is on `/me` or
 *    `/notifications` — means there is nothing to search, and the query never
 *    fires rather than firing against an empty id.
 *
 * ═══ WHY THE DEBOUNCE IS A VALUE, NOT A CALLBACK ═══════════════════════════
 *
 * The debounced NEEDLE feeds the query key, so TanStack Query owns everything
 * that follows: dedupe, cancellation on unmount (`signal`), the 30s
 * `staleTime` that makes backspacing to a previous needle instant, and the
 * cache entry each needle keeps. A debounced `fetch` callback would have to
 * re-implement all four, plus the stale-response guard that stops an older
 * answer overwriting a newer one.
 *
 * ═══ STALE ROWS OVER AN EMPTY LIST ═════════════════════════════════════════
 *
 * `placeholderData` keeps the previous needle's rows on screen while the next
 * request is in flight, with `isSearching` true beside them. The alternative —
 * blanking the lane on every keystroke — makes the list flash white through a
 * whole word.
 */

/** The palette's own floor. Deliberately above the contract's 2. */
export const SEARCH_MIN_CHARS = 3;

/** Keystroke-idle window before a needle becomes a request. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Rows asked of the server. Well under the contract's `MAX_SEARCH_RESULTS`
 * (25): the palette shows the task lane under the navigation lane in a list
 * that scrolls at about a dozen rows, and past that a user refines the needle
 * rather than scrolling.
 */
export const SEARCH_LIMIT = 10;

/** The needle as the server will see it. Exported so the gate is testable. */
export function normalizeSearchQuery(query: string): string {
  return query.trim();
}

/** Does this needle clear the palette's floor? Pure. */
export function isSearchable(query: string): boolean {
  return normalizeSearchQuery(query).length >= SEARCH_MIN_CHARS;
}

/**
 * `value`, delayed until it has stopped changing for `delayMs`.
 *
 * The FIRST value passes through on the initial render (the effect's timeout
 * fires against a state that already holds it), so a palette reopened on an
 * existing needle does not wait a quarter second to show its rows.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (Object.is(debounced, value)) return;
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
    // `debounced` is read only to skip a no-op timer; including it is correct
    // and cannot loop (the effect's own write makes the two equal).
  }, [value, delayMs, debounced]);

  return debounced;
}

export interface OrgSearchState {
  /** Hits for the needle currently on screen. Empty below the floor. */
  results: readonly SearchResult[];
  /** True while the lane owes the user an answer — debouncing OR in flight. */
  isSearching: boolean;
  /** The lane is open at all: the live needle clears the floor. */
  isActive: boolean;
  isError: boolean;
  error: unknown;
  /** The needle the current `results` answer. */
  needle: string;
}

/**
 * `GET /orgs/:orgId/search?q=&limit=` — cross-project task hits.
 *
 * The response is zod-parsed at the boundary (`searchResponseSchema`) and
 * unwrapped to the array, because every caller wants the rows and none of them
 * wants the envelope. The server records `search_performed` telemetry itself;
 * nothing here has to.
 */
export function useOrgSearch(orgId: string | null | undefined, query: string): OrgSearchState {
  const needle = normalizeSearchQuery(query);
  const debounced = useDebouncedValue(needle, SEARCH_DEBOUNCE_MS);

  const laneOpen = isSearchable(needle);
  const enabled = Boolean(orgId) && isSearchable(debounced);

  const result = useQuery({
    queryKey: qk.orgs.search(orgId ?? '', debounced),
    queryFn: ({ signal }) =>
      api
        .get(`/orgs/${orgId ?? ''}/search`, {
          schema: searchResponseSchema,
          query: { q: debounced, limit: SEARCH_LIMIT },
          signal,
        })
        .then((response) => response.results),
    enabled,
    // A task's title and key do not move while someone is typing; 30s makes
    // backspacing through a word a cache walk rather than a request per key.
    staleTime: 30_000,
    // Keep the previous needle's rows under the new one until it answers.
    placeholderData: (previous) => previous,
  });

  return {
    results: laneOpen ? (result.data ?? []) : [],
    // Below the floor nothing is owed, so no spinner: the lane is simply shut.
    isSearching: laneOpen && (debounced !== needle || result.isFetching),
    isActive: laneOpen,
    isError: result.isError,
    error: result.error,
    needle: debounced,
  };
}
