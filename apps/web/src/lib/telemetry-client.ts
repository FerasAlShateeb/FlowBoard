/**
 * The browser's half of FlowBoard's own analytics.
 *
 * ── WHY THIS MODULE DOES NOT WRITE TO THE DATABASE ──────────────────────────
 * `telemetry_events` is written SERVER-SIDE, inside the transaction that
 * performed the thing being recorded (`services/telemetry.service.record()`).
 * That is what makes `task_completed` mean "a task was completed" rather than
 * "a browser said so". But three events have no server-side moment to hang off
 * — a route change, a theme switch and a CSV export all happen entirely in the
 * tab — so the API exposes ONE narrow door for them:
 *
 *     POST /api/telemetry/events   { type, orgId?, projectId?, payload? }
 *     → 204, requires a Bearer token, accepts ONLY
 *       `page_view` | `theme_changed` | `export_csv`
 *
 * The actor is taken from the token and the body has no field for it, so a page
 * view can never be attributed to somebody else. The server rejects every other
 * event type with a 422 — see `validation/admin-telemetry.validation.ts`.
 *
 * ── FIRE AND FORGET, ON BOTH SIDES ──────────────────────────────────────────
 * Every function here returns `void` and swallows every failure. Analytics that
 * can surface an error toast, block a navigation, or reject a promise a caller
 * forgot to catch is analytics that will eventually break the product it is
 * measuring. There is no retry and no queue: a dropped page view is a rounding
 * error in a number nobody makes a decision on at single-event resolution.
 *
 * ── THE PATH IS A TEMPLATE, NEVER A URL ─────────────────────────────────────
 * {@link normalizePath} turns `/o/acme/p/FB/board/t/FB-142` into
 * `/o/:orgSlug/p/:projectKey/board/t/:taskKey` before it is sent. Two reasons,
 * and the second is the one that matters:
 *
 *   1. CARDINALITY. `page_view` grouped by raw path is one bucket per task, per
 *      project, per org — a "top pages" table that is a list of ids.
 *   2. PRIVACY. An org slug and a task key are the names of real customers and
 *      real work. They have no business in an append-only analytics stream that
 *      a global admin browses; the ids that DO matter (`orgId`, `projectId`)
 *      have their own foreign-keyed columns, where they can be joined and,
 *      crucially, deleted with the row they point at.
 *
 * ── DISABLED UNDER TEST ─────────────────────────────────────────────────────
 * A suite that renders a page must not open a network connection, and a suite
 * that asserts on `fetch` must not find a stray telemetry POST in its mock's
 * call list. {@link isTelemetryEnabled} is `false` whenever Vite's `MODE` is
 * `test`, which covers every vitest run in this workspace.
 */
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';

/** The three events a browser is allowed to report. Mirrors the server's subset. */
export type ClientTelemetryEventType = 'page_view' | 'theme_changed' | 'export_csv';

/** The entity dimensions an event may be stamped with. Never the actor. */
export interface TelemetryContext {
  orgId?: string | null;
  projectId?: string | null;
}

/** The ingest route, relative to `lib/api`'s `/api` base. */
const INGEST_PATH = '/telemetry/events';

// ───────────────────────────────────────────────────────────────────────────
// Path normalization — a PURE function, and the unit the tests care about
// ───────────────────────────────────────────────────────────────────────────

/**
 * The segments that introduce a parameter: seeing `o` means the NEXT segment is
 * an org slug, `p` a project key, and so on. Driving the rewrite off the
 * route table's own prefixes is what keeps this correct as pages are added —
 * the alternative, a regex per route, drifts the moment someone adds a view.
 */
const PARAM_AFTER: Readonly<Record<string, string>> = {
  o: ':orgSlug',
  p: ':projectKey',
  t: ':taskKey',
  invite: ':token',
};

/**
 * Every literal segment the route table contains (`routes/index.tsx`).
 *
 * A segment that is NOT in here and is NOT introduced by {@link PARAM_AFTER}
 * becomes `:id`. That default is the safety net: an unrecognised path — a route
 * added after this file, a deep link from an email, a 404 — must never leak an
 * identifier into telemetry just because nobody remembered to update a list.
 */
const STATIC_SEGMENTS: ReadonlySet<string> = new Set([
  'login',
  'invite',
  'o',
  'p',
  't',
  'teams',
  'members',
  'settings',
  'board',
  'backlog',
  'roadmap',
  'table',
  'calendar',
  'dashboard',
  'workflow',
  'labels',
  'notifications',
  'me',
  'theme',
  'admin',
  'users',
  'telemetry',
  'events',
  'requests',
]);

/**
 * A concrete pathname → the route TEMPLATE it matched.
 *
 * @example
 *   normalizePath('/o/acme/p/FB/board');            // '/o/:orgSlug/p/:projectKey/board'
 *   normalizePath('/o/acme/p/FB/board/t/FB-142');   // '…/board/t/:taskKey'
 *   normalizePath('/admin/telemetry/events?x=1');   // '/admin/telemetry/events'
 *   normalizePath('/something/9f3a');               // '/:id/:id'
 */
export function normalizePath(pathname: string): string {
  // Defensive: callers pass `location.pathname`, but a full href or a path with
  // a query string must not survive into the payload.
  const path = pathname.split('#')[0]?.split('?')[0] ?? '';
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return '/';

  const out: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? '';
    const previous = index === 0 ? undefined : segments[index - 1];
    const parameter = previous === undefined ? undefined : PARAM_AFTER[previous];

    if (parameter !== undefined) {
      out.push(parameter);
      continue;
    }
    out.push(STATIC_SEGMENTS.has(segment) ? segment : ':id');
  }

  return `/${out.join('/')}`;
}

// ───────────────────────────────────────────────────────────────────────────
// The transport
// ───────────────────────────────────────────────────────────────────────────

/**
 * Whether events are sent at all.
 *
 * Two gates, both necessary. `MODE === 'test'` keeps every vitest suite off the
 * network. The token check keeps the sign-in screen from firing 401s at a route
 * that requires authentication — an anonymous page view is not recordable, and
 * pretending otherwise just fills the log ring with noise.
 */
export function isTelemetryEnabled(): boolean {
  if (import.meta.env.MODE === 'test') return false;
  return useAuthStore.getState().accessToken !== null;
}

/**
 * POST one event, dropping every failure on the floor.
 *
 * Not `async`, and it returns `void` on purpose: an `async` signature invites a
 * caller to `await` a thing that must never be on the critical path, and a
 * returned promise is a promise somebody can forget to catch.
 */
function send(
  type: ClientTelemetryEventType,
  payload?: Record<string, unknown>,
  context: TelemetryContext = {},
): void {
  if (!isTelemetryEnabled()) return;

  const body = {
    type,
    ...(context.orgId ? { orgId: context.orgId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(payload ? { payload } : {}),
  };

  try {
    void api.post(INGEST_PATH, body).catch(() => {
      // Offline, rate-limited, signed out mid-flight — all fine. Telemetry
      // never surfaces its own failure.
    });
  } catch {
    // A synchronous throw (a malformed base URL) must not take the caller's
    // navigation or export with it.
  }
}

/** `page_view` for an ALREADY-NORMALIZED template path. */
export function trackPageView(path: string, context?: TelemetryContext): void {
  send('page_view', { path }, context);
}

/** `theme_changed` — the Theme Studio's preset switch and the light/dark toggle. */
export function trackThemeChanged(theme: string, context?: TelemetryContext): void {
  send('theme_changed', { theme }, context);
}

/** `export_csv` — the table view's download. `rows` is what makes it interesting. */
export function trackExportCsv(source: string, rows: number, context?: TelemetryContext): void {
  send('export_csv', { source, rows }, context);
}

// ───────────────────────────────────────────────────────────────────────────
// Route subscription
// ───────────────────────────────────────────────────────────────────────────

/**
 * How long a navigation must settle before it counts as a page view.
 *
 * Redirects are the reason: `/` → `/o/acme` → `/o/acme/p/FB/board` is ONE
 * navigation as far as the user is concerned, and three as far as the router
 * is. Debouncing collapses the chain to the destination the user actually
 * landed on.
 */
export const PAGE_VIEW_DEBOUNCE_MS = 400;

/** The last RAW path reported — a repeated notification for it is not a new view. */
let lastReportedPath: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Queue a page view for `pathname`, coalescing a redirect chain into one event.
 *
 * Exported because both entry points below funnel through it, and because it is
 * the seam a test drives directly.
 */
export function reportPageView(pathname: string, context?: TelemetryContext): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (pathname === lastReportedPath) return;
    lastReportedPath = pathname;
    trackPageView(normalizePath(pathname), context);
  }, PAGE_VIEW_DEBOUNCE_MS);
}

/**
 * The minimum a react-router `Router` has to look like for this module.
 *
 * A structural type rather than `import type { Router } from 'react-router-dom'`:
 * it documents exactly what is consumed (a current location and a subscription),
 * and it lets a test drive the whole subscription path with a six-line fake
 * instead of a real browser router.
 */
export interface RouterLike {
  state: { location: { pathname: string } };
  subscribe: (listener: (state: { location: { pathname: string } }) => void) => () => void;
}

/**
 * Subscribe to a router and emit a debounced `page_view` per navigation.
 *
 * The IMPERATIVE entry point, for a composition root that holds the router
 * object (`main.tsx`). A React tree that is already inside `RouterProvider`
 * should mount {@link TelemetryBridge} instead — pick ONE, not both, or every
 * navigation is counted twice.
 *
 * @returns the unsubscribe function.
 */
export function initTelemetryClient(router: RouterLike): () => void {
  // The first location never arrives through `subscribe` — the router is
  // already there — so the landing page would otherwise go unrecorded.
  reportPageView(router.state.location.pathname);

  return router.subscribe((state) => {
    reportPageView(state.location.pathname);
  });
}

/** TEST SEAM — forgets the debounce timer and the last-reported path. */
export function __resetTelemetryClientForTests(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
  lastReportedPath = null;
}
