// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import type { PresenceEntry } from '@flowboard/shared';

import { useOthersPresent, usePresenceRoster, usePresenceStore } from '@/stores/usePresenceStore';

/**
 * The presence store: whole-set replacement, per-project isolation, and the two
 * REFERENCE-STABILITY guarantees that keep the avatar row from re-rendering on
 * every unrelated store notification.
 *
 * jsdom, because the two selectors are hooks — zustand v5 reads through
 * `useSyncExternalStore`, and the stability rules only manifest across renders.
 */

const PROJECT = 'p-1';
const OTHER = 'p-2';

function entry(id: string, name: string, taskId: string | null = null): PresenceEntry {
  return { user: { id, name, avatarUrl: null }, taskId };
}

const ADA = entry('u-ada', 'Ada');
const BOB = entry('u-bob', 'Bob');

afterEach(() => {
  act(() => {
    usePresenceStore.getState().clearAll();
  });
});

describe('setRoster', () => {
  it('stores a project s roster', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA, BOB]);
    });

    expect(usePresenceStore.getState().byProject[PROJECT]).toEqual([ADA, BOB]);
  });

  /** `presence:state` is the FULL set every time — never a diff to merge. */
  it('REPLACES rather than merges, so a departure cannot leave a ghost', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA, BOB]);
      usePresenceStore.getState().setRoster(PROJECT, [BOB]);
    });

    expect(usePresenceStore.getState().byProject[PROJECT]).toEqual([BOB]);
  });

  it('keeps two projects independent', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA]);
      usePresenceStore.getState().setRoster(OTHER, [BOB]);
    });

    expect(usePresenceStore.getState().byProject[PROJECT]).toEqual([ADA]);
    expect(usePresenceStore.getState().byProject[OTHER]).toEqual([BOB]);
  });
});

describe('clearing', () => {
  it('clearProject forgets one project and leaves the rest', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA]);
      usePresenceStore.getState().setRoster(OTHER, [BOB]);
      usePresenceStore.getState().clearProject(PROJECT);
    });

    expect(usePresenceStore.getState().byProject).toEqual({ [OTHER]: [BOB] });
  });

  it('clearProject is a no-op for a project that was never present', () => {
    const before = usePresenceStore.getState().byProject;

    act(() => {
      usePresenceStore.getState().clearProject('never-seen');
    });

    expect(usePresenceStore.getState().byProject).toBe(before);
  });

  it('clearAll empties everything', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA]);
      usePresenceStore.getState().clearAll();
    });

    expect(usePresenceStore.getState().byProject).toEqual({});
  });
});

describe('usePresenceRoster', () => {
  it('reads the live roster', () => {
    const { result, rerender } = renderHook(() => usePresenceRoster(PROJECT));
    expect(result.current).toEqual([]);

    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA]);
    });
    rerender();

    expect(result.current).toEqual([ADA]);
  });

  /**
   * The stability rule: an unknown project must return the SAME empty array
   * every time. A fresh `[]` per call makes zustand's reference comparison see
   * a change on every notification and re-render forever.
   */
  it('returns a stable empty array for a project nobody is in', () => {
    const { result, rerender } = renderHook(() => usePresenceRoster('unknown'));
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });

  it('returns a stable empty array for a null project id', () => {
    const { result, rerender } = renderHook(() => usePresenceRoster(null));
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});

describe('useOthersPresent', () => {
  it('drops the reader s own entry', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA, BOB]);
    });

    const { result } = renderHook(() => useOthersPresent(PROJECT, 'u-ada'));

    expect(result.current).toEqual([BOB]);
  });

  it('returns everyone when the reader is not in the roster', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA, BOB]);
    });

    const { result } = renderHook(() => useOthersPresent(PROJECT, 'u-nobody'));

    expect(result.current).toEqual([ADA, BOB]);
  });

  it('returns the whole roster when there is no signed-in id yet', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA]);
    });

    const { result } = renderHook(() => useOthersPresent(PROJECT, null));

    expect(result.current).toEqual([ADA]);
  });

  /** Working alone is the common case, and it must render nothing. */
  it('is empty when the reader is the only person present', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA]);
    });

    const { result } = renderHook(() => useOthersPresent(PROJECT, 'u-ada'));

    expect(result.current).toEqual([]);
  });

  /** The filtered array must be stable between broadcasts, or the avatar row
   *  re-renders on every unrelated store update. */
  it('returns the same filtered array across renders of one roster', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA, BOB]);
    });

    const { result, rerender } = renderHook(() => useOthersPresent(PROJECT, 'u-ada'));
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });

  /** Nothing was dropped, so the roster reference itself is passed through. */
  it('passes the roster reference through when nobody is filtered out', () => {
    act(() => {
      usePresenceStore.getState().setRoster(PROJECT, [ADA, BOB]);
    });

    const { result: raw } = renderHook(() => usePresenceRoster(PROJECT));
    const { result: filtered } = renderHook(() => useOthersPresent(PROJECT, 'u-nobody'));

    expect(filtered.current).toBe(raw.current);
  });
});
