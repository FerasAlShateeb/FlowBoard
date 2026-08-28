// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SearchResult } from '@flowboard/shared';

import { api } from '@/lib/api';
import {
  isSearchable,
  normalizeSearchQuery,
  SEARCH_LIMIT,
  SEARCH_MIN_CHARS,
  useOrgSearch,
} from '@/hooks/useSearch';

/**
 * The search lane's three gates — the floor, the debounce, and `enabled` —
 * against a mocked transport.
 *
 * REAL TIMERS, deliberately. Fake timers plus TanStack Query's own scheduling
 * turns every assertion into a question about how many microtask flushes an
 * `advanceTimersByTime` is worth. The debounce is 250ms; waiting it out costs
 * the suite a fraction of a second and tests the thing that actually ships.
 */

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));

const ORG = '11111111-1111-4111-8111-111111111111';

const HIT: SearchResult = {
  taskId: '33333333-3333-4333-8333-333333333333',
  key: 'FLOW-142',
  title: 'Refresh token rotation',
  type: 'bug',
  statusId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: '22222222-2222-4222-8222-222222222222',
  projectKey: 'FLOW',
  projectName: 'FlowBoard',
};

const get = vi.mocked(api.get);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Renders the hook over a needle that the test can change. */
function renderSearch(initial: string, orgId: string | null = ORG) {
  return renderHook(({ query }: { query: string }) => useOrgSearch(orgId, query), {
    wrapper,
    initialProps: { query: initial },
  });
}

/** Waits past the debounce window without asserting anything. */
async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  get.mockReset();
  // The hook unwraps `{ results }` — the endpoint's actual envelope payload.
  get.mockResolvedValue({ results: [HIT] });
});

afterEach(cleanup);

describe('the floor', () => {
  it('is three characters, one above the contract', () => {
    expect(SEARCH_MIN_CHARS).toBe(3);
    expect(isSearchable('ab')).toBe(false);
    expect(isSearchable('abc')).toBe(true);
  });

  it('measures the TRIMMED needle', () => {
    expect(normalizeSearchQuery('  auth  ')).toBe('auth');
    expect(isSearchable('  a  ')).toBe(false);
  });

  it('never fires a request below it', async () => {
    renderSearch('au');
    await settle();
    expect(get).not.toHaveBeenCalled();
  });

  it('reports the lane closed below it', () => {
    const { result } = renderSearch('au');
    expect(result.current.isActive).toBe(false);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.results).toEqual([]);
  });
});

describe('the debounce', () => {
  it('does not fire while the user is still typing', async () => {
    const { rerender } = renderSearch('');
    rerender({ query: 'a' });
    rerender({ query: 'au' });
    rerender({ query: 'aut' });
    rerender({ query: 'auth' });

    // Four keystrokes in one tick: nothing has been asked yet.
    expect(get).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  it('coalesces a typed word into ONE request, for the final needle', async () => {
    const { rerender } = renderSearch('');
    for (const query of ['a', 'au', 'aut', 'auth', 'authe', 'authen']) rerender({ query });

    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1]).toMatchObject({
      query: { q: 'authen', limit: SEARCH_LIMIT },
    });
  });

  it('passes a needle that is ALREADY there straight through, undelayed', async () => {
    // Mounting on an existing needle is a reopened palette, not a keystroke —
    // there is nothing to wait for, so `useDebouncedValue` seeds its state with
    // the first value and the request goes out at once.
    renderSearch('auth');
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  it('sends the needle to the org it was typed in', async () => {
    renderSearch('auth');
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith(`/orgs/${ORG}/search`, expect.anything());
    });
  });

  it('holds `isSearching` from the first keystroke until the answer lands', async () => {
    const { result } = renderSearch('auth');
    // Debouncing counts as searching: the lane owes the user an answer.
    expect(result.current.isSearching).toBe(true);
    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
    });
  });
});

describe('results', () => {
  it('unwraps the envelope to a plain list of hits', async () => {
    const { result } = renderSearch('auth');
    await waitFor(() => {
      expect(result.current.results).toEqual([HIT]);
    });
    expect(result.current.needle).toBe('auth');
  });

  it('shuts the lane the moment the needle drops below the floor', async () => {
    const { result, rerender } = renderSearch('auth');
    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });

    // Backspacing to two characters must empty the lane IMMEDIATELY — not
    // after the debounce, and not leaving the previous needle's rows up.
    rerender({ query: 'au' });
    expect(result.current.results).toEqual([]);
    expect(result.current.isActive).toBe(false);
  });

  it('surfaces a failure instead of an empty list', async () => {
    get.mockRejectedValue(new Error('gateway'));
    const { result } = renderSearch('auth');
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.results).toEqual([]);
  });
});

describe('enabled', () => {
  it('asks nothing without an org in scope', async () => {
    const { result } = renderSearch('auth', null);
    await settle();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });
});
