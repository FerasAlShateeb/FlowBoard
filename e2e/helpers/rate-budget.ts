import type { BrowserContext } from '@playwright/test';

/**
 * Keeping the suite inside the API's request ceiling.
 *
 * ── The ceiling, and why it is one bucket ───────────────────────────────────
 *
 * `/api` carries a general limiter of **300 requests per minute**
 * (`middlewares/rate-limit.ts`). It is written to key by user id when the
 * request is authenticated and to fall back to the client IP otherwise — but it
 * is mounted as `app.use('/api', defaultRateLimit, apiRouter)`, ahead of every
 * router and therefore ahead of `requireAuth`. `req.user` is still undefined
 * when the key is computed, so in practice EVERY request keys by IP. (That is a
 * product bug; it has been reported. Its user-visible cost is that an office
 * behind one egress IP shares a single 300-per-minute budget.)
 *
 * For this suite it means one thing: all forty-one tests, every browser context
 * and every API helper call share ONE bucket, and no amount of signing in as
 * different people changes that.
 *
 * ── Why a 429 here is so expensive ──────────────────────────────────────────
 *
 * `helpers/api.ts` retries its own 429s, so the test process heals itself. The
 * BROWSER does not: a rejected mutation rolls its optimistic update back and
 * shows a toast, and a rejected query renders "…did not load". Both look exactly
 * like the feature being broken, in whichever spec happened to be running when
 * the minute filled up — which is the worst possible failure mode, because it
 * points away from the cause.
 *
 * ── What this does ──────────────────────────────────────────────────────────
 *
 * One page load of this app costs eight to ten requests, so a run is ~1 100 of
 * them. Spread evenly that is ~190 a minute and comfortably legal; the measured
 * problem was distribution, not volume — three consecutive minutes at 266-284
 * followed by quiet ones. So every API request the suite makes, from the browser
 * or from `helpers/api.ts`, is counted, and each test waits at the starting line
 * until the last minute has room for what it is about to spend. That smooths the
 * peaks into the troughs: it costs almost no wall-clock time, because the run was
 * already above the floor this implies, and it removes an entire class of
 * misattributed failure.
 *
 * It is not an arbitrary sleep. It is the client half of a documented server
 * limit — the same shape as `reserveAuthSlot` in `helpers/api.ts`, which does
 * this for the stricter credential limiter.
 */

/** The rolling window the server measures over. */
const WINDOW_MS = 60_000;

/**
 * What the suite allows itself, against the server's 300.
 *
 * The gap is headroom for anything already in flight when the gate releases and
 * for the handful of requests that escape counting. Undercounting is the only
 * dangerous direction, so there is a margin — but it does not need to be huge,
 * because the gate below reserves each test's expected burst before it starts.
 */
const SELF_LIMIT = 260;

const calls: number[] = [];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Note that one API request has been sent. */
export function recordApiCall(): void {
  calls.push(Date.now());
}

/** How many API requests the suite has sent in the last minute. */
export function callsInWindow(): number {
  const cutoff = Date.now() - WINDOW_MS;
  while (calls.length > 0 && (calls[0] ?? cutoff) < cutoff) calls.shift();
  return calls.length;
}

/** What a typical test spends: one page load, a few interactions, a poll or two. */
export const TYPICAL_TEST_COST = 70;

/**
 * What the two lifecycle specs spend. `task.spec` alone creates a task, edits
 * five fields, adds a subtask, builds a dependency chain, comments, uploads,
 * toggles a watcher, reads an activity feed, deletes — with three full reloads.
 */
export const LIFECYCLE_TEST_COST = 170;

/**
 * Hold until the window has room for a burst of `reserve` requests.
 *
 * ── Why the reservation, and why not per-request ────────────────────────────
 *
 * A flat "wait until the last minute is under N" gate between tests was the
 * first attempt, and it failed in exactly the two places you would predict:
 * `task.spec` and `sprint.spec` each spend well over a hundred requests inside a
 * SINGLE test, so the gate let them start against a nearly-full window and the
 * minute overflowed mid-test.
 *
 * Gating every individual request was the second attempt, through
 * `context.route`. It is worse than it looks: interception makes the test
 * process a proxy for every API call, and holding a route open while the page
 * navigates loses the request. The observable result was pages rendering with no
 * content at all and 20% of the traffic disappearing from the server's own
 * request log — a suite that breaks the thing it is measuring.
 *
 * So: passive observation, and a gate that knows what the test about to run is
 * going to cost. The bound is `SELF_LIMIT` and it holds for both the common case
 * (190 in the window + 70 spent = 260) and the lifecycle specs (90 + 170 = 260),
 * which leaves the server's remaining 40 as headroom for anything uncounted.
 */
export async function awaitApiCapacity(reserve: number = TYPICAL_TEST_COST): Promise<void> {
  for (;;) {
    if (callsInWindow() + reserve <= SELF_LIMIT) return;
    const oldest = calls[0];
    if (oldest === undefined) return;
    await sleep(Math.max(WINDOW_MS - (Date.now() - oldest) + 100, 100));
  }
}

/**
 * Declare that the test about to run is a heavy one.
 *
 * Called at the top of the two lifecycle specs. Everything else gets
 * {@link TYPICAL_TEST_COST} automatically from the fixture in `helpers/test.ts`.
 */
export async function reserveApiBudget(reserve: number): Promise<void> {
  await awaitApiCapacity(reserve);
}

/**
 * Count a context's API traffic — OBSERVING it, never intercepting it.
 *
 * `context.on('request')` rather than `page.on('request')` so a second tab
 * opened inside the same context (`diagnostics.spec`) is counted without having
 * to remember it. `realtime.spec` builds its own contexts and calls this itself.
 */
export function observeApiCalls(context: BrowserContext): void {
  context.on('request', (request) => {
    if (request.url().includes('/api/')) recordApiCall();
  });
}
