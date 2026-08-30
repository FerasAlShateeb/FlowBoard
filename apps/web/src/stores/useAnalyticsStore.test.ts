import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import {
  HOURLY_UP_TO_DAYS,
  rangeKeyOf,
  useAnalyticsStore,
} from '@/stores/useAnalyticsStore';

/**
 * The console's cache, asserted against a mocked `fetch`.
 *
 * Four properties, and each one is a bug that has shipped somewhere before:
 *
 *  1. **The key is the PRESET, not the resolved window.** `windowFor()` reads
 *     the clock, so keying on `from`/`to` misses on every render and a page
 *     visit becomes an infinite refetch loop.
 *  2. **A stale response never wins.** Widen 7d → 30d → 90d quickly and three
 *     requests are in flight; without the monotonic token the slowest to return
 *     paints last and the page shows 30d under a 90d pill.
 *  3. **A refresh keeps the drawn numbers.** Only a slot that has never
 *     resolved shows skeletons — otherwise the 30-second auto-refresh is a page
 *     that blinks twice a minute.
 *  4. **One range, four domains.** The shared window is the whole reason these
 *     four pages share a store.
 */

const ENGAGEMENT = {
  mau: 12,
  dauSeries: [{ t: '2026-08-01T00:00:00.000Z', value: 4 }],
  signupsSeries: [{ t: '2026-08-01T00:00:00.000Z', value: 1 }],
  stickinessSeries: [{ t: '2026-08-01T00:00:00.000Z', value: 0.3333 }],
  activityByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, value: hour })),
  eventsByType: [{ type: 'auth_login', count: 3 }],
};

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A response that resolves only when the test says so. */
function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let fetchMock: ReturnType<typeof vi.fn>;

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  useAnalyticsStore.getState().reset();
  // A FRESH `Response` per call, never one shared instance: a body can only be
  // read once, so `mockResolvedValue(ok(...))` makes every call after the first
  // throw "body already read" — which the store dutifully records as an error,
  // and every assertion about a second load silently measures the wrong branch.
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok(ENGAGEMENT)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════════════════
// The window
// ═══════════════════════════════════════════════════════════════════════════

describe('rangeKeyOf', () => {
  it('serializes a preset without its (absent) custom days', () => {
    expect(rangeKeyOf({ preset: '30d' })).toBe('30d||');
  });

  it('distinguishes two custom windows', () => {
    expect(rangeKeyOf({ preset: 'custom', from: '2026-01-01', to: '2026-01-31' })).toBe(
      'custom|2026-01-01|2026-01-31',
    );
    expect(rangeKeyOf({ preset: 'custom', from: '2026-01-01' })).toBe('custom|2026-01-01|');
  });
});

describe('windowFor', () => {
  it('gives Traffic hourly buckets across a week and the others daily', () => {
    // The one honest disagreement between the domains: traffic is read while
    // something is on fire.
    expect(HOURLY_UP_TO_DAYS).toEqual({ engagement: 2, work: 2, traffic: 7, growth: 2 });

    useAnalyticsStore.getState().setRange({ preset: '7d' });
    expect(useAnalyticsStore.getState().windowFor('traffic').interval).toBe('hour');
    expect(useAnalyticsStore.getState().windowFor('engagement').interval).toBe('day');
  });

  it('coarsens with the span, identically for every domain past the cut-off', () => {
    useAnalyticsStore.getState().setRange({ preset: '90d' });
    expect(useAnalyticsStore.getState().windowFor('traffic').interval).toBe('week');
    useAnalyticsStore.getState().setRange({ preset: '12m' });
    expect(useAnalyticsStore.getState().windowFor('growth').interval).toBe('month');
  });
});

describe('the shared range', () => {
  it('is ONE value across all four domains — the same Tuesday follows you', () => {
    useAnalyticsStore.getState().setRange({ preset: '7d' });
    const key = useAnalyticsStore.getState().rangeKey();
    expect(key).toBe('7d||');
    // Every domain resolves its own bucket size, but from the same range.
    for (const domain of ['engagement', 'work', 'traffic', 'growth'] as const) {
      expect(useAnalyticsStore.getState().windowFor(domain).from).toBeTruthy();
    }
  });

  it('opens on 30 days', () => {
    expect(useAnalyticsStore.getState().range).toEqual({ preset: '30d' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loading
// ═══════════════════════════════════════════════════════════════════════════

describe('load', () => {
  it('requests the domain endpoint with the resolved window', async () => {
    await useAnalyticsStore.getState().load('engagement');

    const url = requestedUrls()[0] ?? '';
    expect(url).toContain('/api/admin/analytics/engagement');
    expect(url).toContain('from=');
    expect(url).toContain('to=');
    expect(url).toContain('interval=');
  });

  it('parses the payload and records the range key it was loaded for', async () => {
    await useAnalyticsStore.getState().load('engagement');

    const slot = useAnalyticsStore.getState().domains.engagement;
    expect(slot.status).toBe('ready');
    expect(slot.error).toBeNull();
    expect(slot.data?.mau).toBe(12);
    expect(slot.loadedKey).toBe('30d||');
  });

  it('is a NO-OP for a range it already holds — the preset key is why', async () => {
    await useAnalyticsStore.getState().load('engagement');
    await useAnalyticsStore.getState().load('engagement');
    // Two calls, one request. Keying on the resolved `from`/`to` would miss
    // here, because the clock moved between them.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-reads the SAME window when forced (retry, auto-refresh)', async () => {
    await useAnalyticsStore.getState().load('engagement');
    fetchMock.mockImplementationOnce(() => Promise.resolve(ok({ ...ENGAGEMENT, mau: 77 })));
    await useAnalyticsStore.getState().load('engagement', true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second response actually landed — a call count alone would pass even
    // if the request had failed.
    expect(useAnalyticsStore.getState().domains.engagement.data?.mau).toBe(77);
    expect(useAnalyticsStore.getState().domains.engagement.status).toBe('ready');
  });

  it('refetches when the range moves', async () => {
    await useAnalyticsStore.getState().load('engagement');
    useAnalyticsStore.getState().setRange({ preset: '7d' });
    await useAnalyticsStore.getState().load('engagement');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAnalyticsStore.getState().domains.engagement.loadedKey).toBe('7d||');
  });

  it('leaves the other three domains untouched — four slots, four round trips', async () => {
    await useAnalyticsStore.getState().load('engagement');
    const { domains } = useAnalyticsStore.getState();
    expect(domains.work.status).toBe('idle');
    expect(domains.traffic.data).toBeNull();
    expect(domains.growth.loadedKey).toBe('');
  });
});

describe('cold vs warm', () => {
  it('shows `loading` while COLD', async () => {
    const gate = deferred();
    fetchMock.mockReturnValueOnce(gate.promise);

    const inFlight = useAnalyticsStore.getState().load('engagement');
    expect(useAnalyticsStore.getState().domains.engagement.status).toBe('loading');

    gate.resolve(ok(ENGAGEMENT));
    await inFlight;
  });

  it('KEEPS the drawn data and the `ready` status through a warm refresh', async () => {
    await useAnalyticsStore.getState().load('engagement');

    const gate = deferred();
    fetchMock.mockReturnValueOnce(gate.promise);
    const inFlight = useAnalyticsStore.getState().load('engagement', true);

    const during = useAnalyticsStore.getState().domains.engagement;
    // Neither a skeleton nor a blank: the numbers a reader is mid-sentence on
    // stay exactly where they were.
    expect(during.status).toBe('ready');
    expect(during.data?.mau).toBe(12);

    gate.resolve(ok({ ...ENGAGEMENT, mau: 99 }));
    await inFlight;
    expect(useAnalyticsStore.getState().domains.engagement.data?.mau).toBe(99);
  });

  it('clears a previous error when a new load starts', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await useAnalyticsStore.getState().load('engagement');
    expect(useAnalyticsStore.getState().domains.engagement.status).toBe('error');

    await useAnalyticsStore.getState().load('engagement', true);
    expect(useAnalyticsStore.getState().domains.engagement.status).toBe('ready');
    expect(useAnalyticsStore.getState().domains.engagement.error).toBeNull();
  });
});

describe('loadSeq — an out-of-order response never wins', () => {
  it('drops a SLOW first response when a second has already been issued', async () => {
    const slow = deferred();
    const fast = deferred();
    fetchMock.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = useAnalyticsStore.getState().load('engagement');
    useAnalyticsStore.getState().setRange({ preset: '7d' });
    const second = useAnalyticsStore.getState().load('engagement');

    // The second window resolves FIRST…
    fast.resolve(ok({ ...ENGAGEMENT, mau: 7 }));
    await second;
    expect(useAnalyticsStore.getState().domains.engagement.data?.mau).toBe(7);

    // …and the first, arriving late, must not repaint the page.
    slow.resolve(ok({ ...ENGAGEMENT, mau: 30 }));
    await first;
    expect(useAnalyticsStore.getState().domains.engagement.data?.mau).toBe(7);
    expect(useAnalyticsStore.getState().domains.engagement.loadedKey).toBe('7d||');
  });

  it('drops a stale FAILURE too, so a dead request cannot blank a live page', async () => {
    let rejectSlow!: (reason: unknown) => void;
    const slowPromise = new Promise<Response>((_, reject) => {
      rejectSlow = reject;
    });
    fetchMock.mockReturnValueOnce(slowPromise).mockResolvedValueOnce(ok(ENGAGEMENT));

    const first = useAnalyticsStore.getState().load('engagement');
    useAnalyticsStore.getState().setRange({ preset: '7d' });
    await useAnalyticsStore.getState().load('engagement');

    rejectSlow(new Error('too late'));
    await first;

    expect(useAnalyticsStore.getState().domains.engagement.status).toBe('ready');
    expect(useAnalyticsStore.getState().domains.engagement.data?.mau).toBe(12);
  });
});

describe('errors', () => {
  it('stores the RAW error, not a sentence — the page localizes it', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await useAnalyticsStore.getState().load('engagement');

    const slot = useAnalyticsStore.getState().domains.engagement;
    expect(slot.status).toBe('error');
    // A pre-localized string would freeze in whichever language was active when
    // the request failed; `ErrorState` resolves this through the shared ladder.
    expect(slot.error).toBeInstanceOf(Error);
  });

  it('keeps the previous data visible behind the error', async () => {
    await useAnalyticsStore.getState().load('engagement');
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await useAnalyticsStore.getState().load('engagement', true);

    expect(useAnalyticsStore.getState().domains.engagement.data?.mau).toBe(12);
  });
});

describe('reset', () => {
  it('empties every slot but keeps stale responses losing', async () => {
    const gate = deferred();
    fetchMock.mockReturnValueOnce(gate.promise);
    const inFlight = useAnalyticsStore.getState().load('engagement');

    useAnalyticsStore.getState().reset();
    expect(useAnalyticsStore.getState().domains.engagement.data).toBeNull();
    expect(useAnalyticsStore.getState().range).toEqual({ preset: '30d' });

    // The token moved FORWARD on reset, so the in-flight request cannot win.
    gate.resolve(ok(ENGAGEMENT));
    await inFlight;
    expect(useAnalyticsStore.getState().domains.engagement.data).toBeNull();
  });
});
