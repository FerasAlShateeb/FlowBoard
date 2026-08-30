import { useEffect } from 'react';
import type { AnalyticsDomain } from '@flowboard/shared';

import type { WindowInterval, RangeValue } from '@/components/dashboard/range';
import {
  useAnalyticsStore,
  type AnalyticsPayloads,
  type AnalyticsStatus,
} from '@/stores/useAnalyticsStore';

/**
 * The four dashboards' shared wiring, in one hook.
 *
 * Every domain page opens the same way — read the shared range, load my domain
 * when the range key changes, work out whether I am cold — and repeating that
 * in four files is how the four pages start disagreeing about what "cold"
 * means. It is a hook rather than a component so each page keeps its own
 * layout, which is the part that genuinely differs.
 *
 * ═══ THE EFFECT DEPENDS ON THE RANGE KEY, NOT THE RANGE ══════════════════
 *
 * `RangeValue` is an object literal minted by the picker, so depending on it
 * would refetch whenever a parent re-rendered. The KEY is a string and changes
 * exactly when the window a human chose changes — and it is the same string the
 * store compares `loadedKey` against, so the effect and the cache can never
 * disagree about whether a load is needed. `load()` is itself idempotent for a
 * key it already holds, which makes a duplicate call under React 18's
 * double-invoked effects a no-op rather than a second request.
 *
 * ═══ COLD IS "I HAVE NEVER HAD DATA" ═════════════════════════════════════
 *
 * Not "a request is in flight". A refresh over an already-drawn window keeps
 * the numbers on screen (see the store's header); only a slot that has never
 * resolved gets skeletons. Every page threads this single boolean into its KPI
 * row and its charts, so a card and the tile above it can never be in different
 * states.
 */
export interface AnalyticsDomainView<D extends AnalyticsDomain> {
  range: RangeValue;
  setRange: (range: RangeValue) => void;
  /** The domain's payload, or `null` until the first successful load. */
  data: AnalyticsPayloads[D] | null;
  status: AnalyticsStatus;
  /** The raw failure, for `ErrorState`. `null` when there is none. */
  error: unknown;
  /** True only when nothing has ever loaded — the skeleton gate. */
  cold: boolean;
  /** The bucket size this domain's window resolves to, for chart captions. */
  interval: WindowInterval;
  /** Re-read now, even if the window has not moved (retry, auto-refresh). */
  reload: () => void;
}

export function useAnalyticsDomain<D extends AnalyticsDomain>(
  domain: D,
): AnalyticsDomainView<D> {
  const range = useAnalyticsStore((state) => state.range);
  const setRange = useAnalyticsStore((state) => state.setRange);
  const load = useAnalyticsStore((state) => state.load);
  const slot = useAnalyticsStore((state) => state.domains[domain]);
  // A primitive selector: `windowFor` mints a fresh object every call (it reads
  // the clock), so selecting the object itself would re-render on every store
  // touch. The interval is the only part a page renders.
  const interval = useAnalyticsStore((state) => state.windowFor(domain).interval);
  const rangeKey = useAnalyticsStore((state) => state.rangeKey());

  useEffect(() => {
    void load(domain);
  }, [load, domain, rangeKey]);

  return {
    range,
    setRange,
    data: slot.data,
    status: slot.status,
    error: slot.error,
    cold: slot.data === null && slot.status !== 'error',
    interval,
    reload: () => {
      void load(domain, true);
    },
  };
}
