import { create } from 'zustand';
import {
  analyticsEngagementSchema,
  analyticsGrowthSchema,
  analyticsTrafficSchema,
  analyticsWorkSchema,
  type AnalyticsDomain,
  type AnalyticsEngagement,
  type AnalyticsGrowth,
  type AnalyticsTraffic,
  type AnalyticsWork,
} from '@flowboard/shared';
import type { ZodType } from 'zod';

import { api } from '@/lib/api';
import {
  DEFAULT_RANGE,
  windowFor,
  type AnalyticsWindow,
  type RangeValue,
} from '@/components/dashboard/range';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The four analytics dashboards' store.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Backend contract:
 *   GET /api/admin/analytics/{engagement,work,traffic,growth}?from&to&interval
 *
 * ═══ ONE STORE FOR FOUR PAGES, BECAUSE OF THE ONE SHARED FACT ════════════
 *
 * The window. An operator who narrows to last Tuesday on Traffic and clicks
 * through to Work is asking about the same Tuesday, and a per-page range would
 * silently reset it — the reader would not notice, and would compare two
 * different weeks believing they had compared one. So `range` lives here, and
 * the same Tuesday follows you across every domain and into the drill-downs the
 * dashboards link to.
 *
 * Each domain still keeps its OWN slot: the pages are independent round trips,
 * and a traffic query timing out must not blank the engagement dashboard an
 * admin already has open. WITHIN one domain the payload is all-or-nothing (one
 * endpoint, one parse) — deliberately unlike the legacy `/admin/telemetry/*`
 * surface's five-way per-tile degradation, which is exactly the thing this
 * console replaces.
 *
 * ═══ WHY A STORE AND NOT TANSTACK QUERY ══════════════════════════════════
 *
 * FlowBoard reaches for TanStack Query everywhere else, and W2.1's admin
 * overview uses it through `qk.analytics.domain()`. These four pages do not,
 * for one reason: the console needs COLD-vs-WARM to be a first-class fact.
 * `isPending` is false during a background refetch, so a query-driven page
 * cannot tell "I have never had data" from "I have last minute's data and am
 * re-reading" without a second piece of state — and that distinction is what
 * decides between a skeleton and leaving the numbers on screen while an
 * auto-refresh ticks. {@link rangeKeyOf} is exported so the two caches
 * serialize a window identically anyway.
 *
 * ═══ THE CACHE KEY IS THE PRESET, NOT THE RESOLVED WINDOW ════════════════
 *
 * `windowFor()` reads the clock at REQUEST time (see `dashboard/range.ts`), so
 * a `30d` window's `from`/`to` are different milliseconds on every call. Keying
 * the cache on those would miss on literally every render and turn a page visit
 * into an infinite refetch loop. The key is `preset|from|to` — the PICKER's
 * value, which only changes when a human changes it.
 *
 * ═══ AN OUT-OF-ORDER RESPONSE NEVER WINS ═════════════════════════════════
 *
 * `loadSeq` is a monotonic token per domain. Widen 7d → 30d → 90d quickly and
 * three requests are in flight; without the token the slowest one to return
 * paints last, and the page shows 30d under a 90d pill. The token is module
 * scope rather than store state on purpose: it is not something a component
 * should ever read or render, and putting it in the state would wake every
 * subscriber twice per load.
 *
 * ═══ THE ERROR IS THE ERROR, NOT A SENTENCE ══════════════════════════════
 *
 * GameDash's port stores a pre-localized string. FlowBoard stores the raw
 * `unknown` and lets `components/common/ErrorState` localize it through the
 * `ApiError.code` → catalog ladder every other surface uses — which means the
 * message follows a language switch instead of freezing in whichever language
 * was active when the request failed, and the store needs no i18next import.
 */

export type AnalyticsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DomainSlot<T> {
  status: AnalyticsStatus;
  /** The raw failure, for `ErrorState` to localize. `null` when there is none. */
  error: unknown;
  data: T | null;
  /** The range key `data` was loaded for — a range change forces a refetch. */
  loadedKey: string;
}

/** Domain → the payload its endpoint returns. */
export interface AnalyticsPayloads {
  engagement: AnalyticsEngagement;
  work: AnalyticsWork;
  traffic: AnalyticsTraffic;
  growth: AnalyticsGrowth;
}

export type DomainSlots = { [D in AnalyticsDomain]: DomainSlot<AnalyticsPayloads[D]> };

const emptySlot = <T,>(): DomainSlot<T> => ({
  status: 'idle',
  error: null,
  data: null,
  loadedKey: '',
});

/**
 * How long each domain keeps HOUR buckets before coarsening to days.
 *
 * Traffic is the one domain read while something is on fire, so it holds hourly
 * resolution across a whole week — an outage is a shape you need the hours to
 * see. The other three switch to days past 48 hours: a 168-point sign-up chart
 * is noise, not detail.
 */
export const HOURLY_UP_TO_DAYS: Record<AnalyticsDomain, number> = {
  engagement: 2,
  work: 2,
  traffic: 7,
  growth: 2,
};

const DOMAIN_SCHEMAS: { [D in AnalyticsDomain]: ZodType<AnalyticsPayloads[D]> } = {
  engagement: analyticsEngagementSchema,
  work: analyticsWorkSchema,
  traffic: analyticsTrafficSchema,
  growth: analyticsGrowthSchema,
};

/** Monotonic tokens, one per domain. See the header. */
const loadSeq: Record<AnalyticsDomain, number> = {
  engagement: 0,
  work: 0,
  traffic: 0,
  growth: 0,
};

/**
 * The cache key for a picker value.
 *
 * Exported because `qk.analytics.domain(domain, rangeKey)` — the admin
 * overview's TanStack key — must serialize a window the same way this store
 * does, or the two halves of the console would disagree about what "the same
 * range" means.
 */
export function rangeKeyOf(range: RangeValue): string {
  return `${range.preset}|${range.from ?? ''}|${range.to ?? ''}`;
}

/**
 * Replaces one domain's slot.
 *
 * The single cast in this module, and it is here rather than at four call
 * sites: TypeScript widens a computed key over a generic `D extends
 * AnalyticsDomain` into an index signature, so the spread result is not
 * assignable to the mapped type it demonstrably is. The narrow `next` parameter
 * is what keeps the cast honest — a wrong payload for the domain is still a
 * compile error at the call site.
 */
function patchSlot<D extends AnalyticsDomain>(
  slots: DomainSlots,
  domain: D,
  next: DomainSlot<AnalyticsPayloads[D]>,
): DomainSlots {
  return { ...slots, [domain]: next } as DomainSlots;
}

export interface AnalyticsState {
  /** The ONE window every dashboard and every drill-down entry point reads. */
  range: RangeValue;
  domains: DomainSlots;

  /** The resolved `?from=&to=&interval=` a domain would request right now. */
  windowFor: (domain: AnalyticsDomain) => AnalyticsWindow;
  /** The current cache key — what `loadedKey` is compared against. */
  rangeKey: () => string;
  setRange: (range: RangeValue) => void;
  /** Loads a domain; `force` re-reads even when the window has not changed. */
  load: <D extends AnalyticsDomain>(domain: D, force?: boolean) => Promise<void>;
  reset: () => void;
}

const initial = (): Pick<AnalyticsState, 'range' | 'domains'> => ({
  range: DEFAULT_RANGE,
  domains: {
    engagement: emptySlot<AnalyticsEngagement>(),
    work: emptySlot<AnalyticsWork>(),
    traffic: emptySlot<AnalyticsTraffic>(),
    growth: emptySlot<AnalyticsGrowth>(),
  },
});

export const useAnalyticsStore = create<AnalyticsState>()((set, get) => ({
  ...initial(),

  windowFor: (domain) => windowFor(get().range, HOURLY_UP_TO_DAYS[domain]),

  rangeKey: () => rangeKeyOf(get().range),

  setRange: (range) => {
    // Every slot is stale the moment the window moves — but only the domain the
    // admin is LOOKING at refetches (its page's effect fires on the key
    // change), so switching pages later does not replay four requests up front.
    // Nothing is invalidated here: a stale `loadedKey` is already a miss.
    set({ range });
  },

  load: async (domain, force = false) => {
    const key = get().rangeKey();
    const slot = get().domains[domain];
    if (!force && slot.status === 'ready' && slot.loadedKey === key) return;

    const id = ++loadSeq[domain];
    const win = get().windowFor(domain);

    // Keep whatever is on screen while refreshing; ONLY a cold slot (no data at
    // all) shows skeletons. This is what makes the 30-second auto-refresh
    // readable instead of a page that blinks twice a minute.
    set((state) => ({
      domains: patchSlot(state.domains, domain, {
        ...state.domains[domain],
        status: slot.data === null ? 'loading' : slot.status,
        error: null,
      }),
    }));

    try {
      const data = await api.get<AnalyticsPayloads[typeof domain]>(
        `/admin/analytics/${domain}`,
        {
          schema: DOMAIN_SCHEMAS[domain],
          query: { from: win.from, to: win.to, interval: win.interval },
        },
      );
      if (id !== loadSeq[domain]) return;
      set((state) => ({
        domains: patchSlot(state.domains, domain, {
          status: 'ready',
          error: null,
          data,
          loadedKey: key,
        }),
      }));
    } catch (error) {
      if (id !== loadSeq[domain]) return;
      set((state) => ({
        domains: patchSlot(state.domains, domain, {
          ...state.domains[domain],
          status: 'error',
          error,
        }),
      }));
    }
  },

  reset: () => {
    // The tokens move FORWARD rather than back to zero: a request in flight
    // when a reset lands must still lose, and a counter that restarted at 0
    // would let it win the next comparison.
    for (const domain of Object.keys(loadSeq) as AnalyticsDomain[]) loadSeq[domain] += 1;
    set(initial());
  },
}));

/** TEST SEAM: the module-scope tokens outlive `reset()` by design. */
export function __analyticsLoadSeq(domain: AnalyticsDomain): number {
  return loadSeq[domain];
}
