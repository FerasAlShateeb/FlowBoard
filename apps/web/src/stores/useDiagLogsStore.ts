import { create } from 'zustand';
import { serverLogsSnapshotSchema, type ServerLogRecord } from '@flowboard/shared';

import { api } from '@/lib/api';
import i18n from '@/i18n';
import type { LevelFilter } from '@/components/diagnostics/diag-chrome';

/**
 * The live server-log tail behind the diagnostics drawer.
 *
 * A bounded, in-memory mirror of the API's pino ring buffer
 * (`apps/api/src/utils/log-ring.ts`), filled by 2-second REST polling against
 * `GET /api/admin/logs?sinceId=` — a CURSOR, not a stream.
 *
 * ── Why zustand and not TanStack Query ──────────────────────────────────────
 * Query caches an ANSWER; this store accumulates a CONVERSATION. Each poll
 * returns only what is newer than the cursor, so the useful value is the union
 * of every response so far, not the last one — a shape Query's cache would
 * fight (`select` cannot append, and a refetch would blow away the history).
 * The records are also never rendered by anything except the drawer, so there
 * is no cross-component cache to share.
 *
 * ── Why polling and not the socket ──────────────────────────────────────────
 * Auth is already solved for REST (bearer + `requireGlobalAdmin`); a log stream
 * would need its own admin-gated socket surface for a feature that is only ever
 * open on one screen, and 2 s is plenty for reading a tail with your eyes.
 *
 * ── NOT persisted ───────────────────────────────────────────────────────────
 * Log lines routinely carry user emails and ids — the reason the route is
 * global-admin only. Writing them to localStorage would leave them on the disk
 * of whatever machine an admin happened to debug from, long after the session.
 */

/** Hard cap on retained records. Past this, the OLDEST are dropped. */
export const LOGS_CAP = 1000;

/** Poll cadence for the tail, in ms. */
export const POLL_INTERVAL_MS = 2000;

/**
 * The interval handle, at MODULE scope rather than in state.
 *
 * `startPolling` clears before it sets, so React 19 StrictMode's double mount,
 * an HMR reload, or a re-open while a previous timer is somehow still alive can
 * never leave two loops running against one cursor.
 */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Single-flight guard.
 *
 * Two polls at the SAME cursor both fetch `sinceId=<n>` and both append the
 * same records — a duplicate `key={record.id}` in the list and a doubled tail.
 * That happens more easily than it sounds: StrictMode's double effect, a tick
 * landing on a slow request, or `resume()` racing the loop. While one poll is
 * in flight the rest no-op; the flag is released in `finally`, including on a
 * rejected request.
 */
let pollInFlight = false;

interface DiagLogsState {
  /** The tail, oldest first, capped at {@link LOGS_CAP}. */
  records: ServerLogRecord[];
  /** Highest ring id seen — sent back as the next `sinceId`. */
  lastId: number;
  /** While true the loop keeps ticking but every tick no-ops: no fetch, no append. */
  paused: boolean;
  /** Minimum severity to RENDER. Filtering is a view concern, applied at render. */
  minLevel: LevelFilter;
  /** Last request failure, localized. Cleared by the next successful request. */
  error: string | null;
  /** Whether the loop is scheduled. Exposed for tests and the header. */
  polling: boolean;

  /** Start (or restart) the loop. Idempotent, StrictMode/HMR-safe. */
  startPolling: () => void;
  /** Stop the loop and drop the timer. */
  stopPolling: () => void;
  /** Stop FETCHING (not just rendering) until {@link DiagLogsState.resume}. */
  pause: () => void;
  /** Resume and poll immediately, rather than waiting out the interval. */
  resume: () => void;
  /** Toggle {@link DiagLogsState.paused}. */
  togglePaused: () => void;
  /** Set the render-time minimum level. */
  setMinLevel: (minLevel: LevelFilter) => void;
  /** Empty the view. The cursor is KEPT, so only newer lines stream back. */
  clear: () => void;
  /** One tick: fetch, parse, append. Exported for the loop and the tests. */
  poll: () => Promise<void>;
}

export const useDiagLogsStore = create<DiagLogsState>()((set, get) => ({
  records: [],
  lastId: 0,
  paused: false,
  minLevel: 'all',
  error: null,
  polling: false,

  startPolling: () => {
    // Clear-before-set. See `pollTimer`.
    if (pollTimer) clearInterval(pollTimer);
    set({ polling: true });
    void get().poll();
    pollTimer = setInterval(() => {
      void get().poll();
    }, POLL_INTERVAL_MS);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ polling: false });
  },

  pause: () => {
    set({ paused: true });
  },

  resume: () => {
    set({ paused: false });
    void get().poll();
  },

  togglePaused: () => {
    if (get().paused) get().resume();
    else get().pause();
  },

  setMinLevel: (minLevel) => {
    set({ minLevel });
  },

  clear: () => {
    set({ records: [] });
  },

  poll: async () => {
    if (get().paused || pollInFlight) return;
    pollInFlight = true;
    try {
      const payload = await api.get<unknown>('/admin/logs', { query: { sinceId: get().lastId } });

      // The request itself succeeded — drop a stale failure before parsing, so
      // a recovered feed does not keep showing yesterday's error under a live
      // list. (Guarded so an unchanged `null` never re-renders the drawer.)
      if (get().error !== null) set({ error: null });

      // `safeParse`, not the api client's `schema` option, because a malformed
      // payload here must be DROPPED, not surfaced: the drawer is what an admin
      // debugs a broken deploy with, and turning one bad frame into a red error
      // state would hide the tail that explains it.
      const parsed = serverLogsSnapshotSchema.safeParse(payload);
      if (!parsed.success) return;
      const snapshot = parsed.data;

      set((state) => {
        // A pause can land between the await and here. Honour it.
        if (state.paused) return {};

        // RESTART REWIND. Ring ids restart at 0 when the API process does, so a
        // snapshot whose head sits BELOW our cursor means we are looking at a
        // new generation of the ring. Keeping the old records would collide
        // their ids with the new ones, and keeping the old cursor would filter
        // every incoming record out forever — a tail that silently goes dead.
        // Start over instead; the next tick streams the young ring from 0.
        if (snapshot.lastId < state.lastId) return { records: [], lastId: 0 };

        const lastId = Math.max(state.lastId, snapshot.lastId);

        // Idempotent append: STRICTLY newer only. The single-flight guard stops
        // most overlap; this is what makes a residual duplicate impossible.
        const fresh = snapshot.records.filter((record) => record.id > state.lastId);
        if (fresh.length === 0) return { lastId };

        const merged = [...state.records, ...fresh];
        return {
          lastId,
          records: merged.length > LOGS_CAP ? merged.slice(merged.length - LOGS_CAP) : merged,
        };
      });
    } catch {
      // A store action, so the plain instance rather than the hook — the same
      // posture as `i18n/errors.ts`. The message is frozen at failure time,
      // which is acceptable for a string only an admin sees, in a panel they
      // can close and re-open.
      set({ error: i18n.t('diagnostics:logs.unavailable') });
    } finally {
      pollInFlight = false;
    }
  },
}));

/**
 * TEST SEAM. Drops the module-scoped loop state so one suite's timer or
 * in-flight flag cannot leak into the next file. Not for application code.
 */
export function __resetDiagPollStateForTests(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollInFlight = false;
  useDiagLogsStore.setState({
    records: [],
    lastId: 0,
    paused: false,
    minLevel: 'all',
    error: null,
    polling: false,
  });
}
