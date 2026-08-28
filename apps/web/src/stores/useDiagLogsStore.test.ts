import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerLogRecord, ServerLogsSnapshot } from '@flowboard/shared';

import { api } from '@/lib/api';
import {
  LOGS_CAP,
  POLL_INTERVAL_MS,
  useDiagLogsStore,
  __resetDiagPollStateForTests,
} from '@/stores/useDiagLogsStore';

/**
 * The poll loop's four rules, none of which are visible in a screenshot:
 * append only what is NEW, recover when the ring rewinds under us, never let
 * two polls run at one cursor, and never grow without bound.
 *
 * The HTTP client is mocked at the module boundary rather than `fetch` being
 * stubbed: what this store owes is correct use of `api.get('/admin/logs')`, and
 * the envelope/refresh behaviour underneath already has its own suite
 * (`lib/api.test.ts`).
 */
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));

const apiGet = vi.mocked(api.get);

function record(id: number, overrides: Partial<ServerLogRecord> = {}): ServerLogRecord {
  return {
    id,
    time: 1_780_000_000_000 + id,
    level: 'info',
    msg: `line ${id}`,
    context: {},
    ...overrides,
  };
}

function snapshot(records: ServerLogRecord[], lastId?: number): ServerLogsSnapshot {
  return { records, lastId: lastId ?? records[records.length - 1]?.id ?? 0 };
}

/** Resolves whatever the next call asks for, in order. */
function respondWith(...snapshots: ServerLogsSnapshot[]): void {
  for (const value of snapshots) apiGet.mockResolvedValueOnce(value);
}

beforeEach(() => {
  __resetDiagPollStateForTests();
  apiGet.mockReset();
});

afterEach(() => {
  __resetDiagPollStateForTests();
  vi.useRealTimers();
});

describe('useDiagLogsStore.poll', () => {
  it('appends the snapshot and advances the cursor', async () => {
    respondWith(snapshot([record(1), record(2)]));

    await useDiagLogsStore.getState().poll();

    const state = useDiagLogsStore.getState();
    expect(state.records.map((r) => r.id)).toEqual([1, 2]);
    expect(state.lastId).toBe(2);
    expect(apiGet).toHaveBeenCalledWith('/admin/logs', { query: { sinceId: 0 } });
  });

  it('sends the cursor it last saw as `sinceId`', async () => {
    respondWith(snapshot([record(1), record(2)]), snapshot([record(3)]));

    await useDiagLogsStore.getState().poll();
    await useDiagLogsStore.getState().poll();

    expect(apiGet).toHaveBeenNthCalledWith(2, '/admin/logs', { query: { sinceId: 2 } });
    expect(useDiagLogsStore.getState().records.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('is idempotent: a snapshot re-including seen ids appends nothing', async () => {
    respondWith(snapshot([record(1), record(2)]), snapshot([record(1), record(2), record(3)]));

    await useDiagLogsStore.getState().poll();
    await useDiagLogsStore.getState().poll();

    // 1 and 2 are NOT duplicated — which is also what keeps `key={record.id}`
    // unique in the list.
    expect(useDiagLogsStore.getState().records.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('advances the cursor even when the snapshot carries no records', async () => {
    // The API filtered everything out by level, but its ring head still moved.
    respondWith(snapshot([record(1)]), snapshot([], 9));

    await useDiagLogsStore.getState().poll();
    await useDiagLogsStore.getState().poll();

    expect(useDiagLogsStore.getState().lastId).toBe(9);
    expect(useDiagLogsStore.getState().records).toHaveLength(1);
  });

  it('rewinds when the ring restarts below the cursor', async () => {
    respondWith(snapshot([record(40), record(41)]), snapshot([record(1), record(2)], 2));

    await useDiagLogsStore.getState().poll();
    await useDiagLogsStore.getState().poll();

    // The dead process's records are dropped and the cursor is reset, so the
    // NEXT poll streams the young ring from 0 rather than filtering it away.
    const state = useDiagLogsStore.getState();
    expect(state.records).toEqual([]);
    expect(state.lastId).toBe(0);

    respondWith(snapshot([record(1), record(2)], 2));
    await useDiagLogsStore.getState().poll();
    expect(useDiagLogsStore.getState().records.map((r) => r.id)).toEqual([1, 2]);
  });

  it('coalesces overlapping polls into one request (single flight)', async () => {
    let release: ((value: ServerLogsSnapshot) => void) | undefined;
    apiGet.mockReturnValueOnce(
      new Promise<ServerLogsSnapshot>((resolve) => {
        release = resolve;
      }),
    );

    const first = useDiagLogsStore.getState().poll();
    const second = useDiagLogsStore.getState().poll();

    expect(apiGet).toHaveBeenCalledTimes(1);
    release?.(snapshot([record(1)]));
    await Promise.all([first, second]);

    expect(useDiagLogsStore.getState().records.map((r) => r.id)).toEqual([1]);
  });

  it('drops the oldest records past the cap', async () => {
    const overflow = LOGS_CAP + 200;
    respondWith(snapshot(Array.from({ length: overflow }, (_, index) => record(index + 1))));

    await useDiagLogsStore.getState().poll();

    const { records } = useDiagLogsStore.getState();
    expect(records).toHaveLength(LOGS_CAP);
    expect(records[0]?.id).toBe(overflow - LOGS_CAP + 1);
    expect(records[records.length - 1]?.id).toBe(overflow);
  });

  it('does not fetch while paused', async () => {
    useDiagLogsStore.getState().pause();

    await useDiagLogsStore.getState().poll();

    expect(apiGet).not.toHaveBeenCalled();
  });

  it('fetches again the moment it resumes', async () => {
    respondWith(snapshot([record(1)]));
    useDiagLogsStore.getState().pause();
    useDiagLogsStore.getState().resume();
    await vi.waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(1);
    });
    expect(useDiagLogsStore.getState().paused).toBe(false);
  });

  it('surfaces a request failure and clears it on recovery', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    await useDiagLogsStore.getState().poll();
    expect(useDiagLogsStore.getState().error).not.toBeNull();

    respondWith(snapshot([record(1)]));
    await useDiagLogsStore.getState().poll();
    expect(useDiagLogsStore.getState().error).toBeNull();
    expect(useDiagLogsStore.getState().records).toHaveLength(1);
  });

  it('drops a malformed payload silently rather than erroring', async () => {
    apiGet.mockResolvedValueOnce({ records: [{ id: 'not-a-number' }], lastId: 'nope' });

    await useDiagLogsStore.getState().poll();

    const state = useDiagLogsStore.getState();
    expect(state.records).toEqual([]);
    expect(state.error).toBeNull();
  });
});

describe('useDiagLogsStore polling loop', () => {
  it('polls immediately and then on the interval, and stops when told', async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(snapshot([], 0));

    useDiagLogsStore.getState().startPolling();
    expect(useDiagLogsStore.getState().polling).toBe(true);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(apiGet).toHaveBeenCalledTimes(3);

    useDiagLogsStore.getState().stopPolling();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(useDiagLogsStore.getState().polling).toBe(false);
  });

  it('never leaves two loops running (StrictMode double start)', async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(snapshot([], 0));

    useDiagLogsStore.getState().startPolling();
    useDiagLogsStore.getState().startPolling();
    apiGet.mockClear();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    // One tick, one request — not two.
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('a paused loop keeps ticking but never fetches', async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(snapshot([], 0));

    useDiagLogsStore.getState().pause();
    useDiagLogsStore.getState().startPolling();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(apiGet).not.toHaveBeenCalled();
    expect(useDiagLogsStore.getState().polling).toBe(true);
  });
});

describe('useDiagLogsStore view state', () => {
  it('clear() empties the view but KEEPS the cursor', async () => {
    respondWith(snapshot([record(1), record(2)]));
    await useDiagLogsStore.getState().poll();

    useDiagLogsStore.getState().clear();

    expect(useDiagLogsStore.getState().records).toEqual([]);
    // Keeping the cursor is what stops a clear from re-downloading the whole
    // ring on the next tick.
    expect(useDiagLogsStore.getState().lastId).toBe(2);
  });

  it('togglePaused flips both ways', () => {
    expect(useDiagLogsStore.getState().paused).toBe(false);
    useDiagLogsStore.getState().togglePaused();
    expect(useDiagLogsStore.getState().paused).toBe(true);
    useDiagLogsStore.getState().togglePaused();
    expect(useDiagLogsStore.getState().paused).toBe(false);
  });

  it('setMinLevel stores the render filter without touching the records', async () => {
    respondWith(snapshot([record(1), record(2, { level: 'error' })]));
    await useDiagLogsStore.getState().poll();

    useDiagLogsStore.getState().setMinLevel('error');

    expect(useDiagLogsStore.getState().minLevel).toBe('error');
    expect(useDiagLogsStore.getState().records).toHaveLength(2);
  });
});
