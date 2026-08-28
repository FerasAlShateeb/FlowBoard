/**
 * Surviving a deploy that lands under an open tab.
 *
 * THE FAILURE. Every page in this app is a `React.lazy` import, so navigating
 * fetches a hashed chunk (`/assets/BoardPage-<hash>.js`) on demand. When a new
 * build is published the PREVIOUS build's hashed files stop existing — but
 * nginx's SPA catch-all (`try_files $uri /index.html`) still answers for their
 * paths, with `index.html` at **200 text/html**. The browser then tries to
 * evaluate HTML as an ES module and the dynamic import rejects. A tab left open
 * across a deploy therefore explodes on its very next navigation.
 *
 * THE RECOVERY. The fix for a stale document is to fetch a fresh one, so this
 * module reloads the page ONCE. The once-ness matters more than the reload: if
 * the chunk is genuinely gone for another reason (a bad deploy, a broken CDN
 * path), an unguarded reload-on-error is an infinite refresh loop no user can
 * escape. `sessionStorage` holds the timestamp of the last attempt and refuses
 * a second inside a 60s window; past that, `RouteErrorScreen` shows a branded
 * error card instead.
 *
 * WHY sessionStorage AND NOT A MODULE VARIABLE: the reload wipes the JS heap,
 * so the guard has to outlive the document. It is per-TAB (not localStorage) so
 * one wedged tab cannot suppress a legitimate recovery in another.
 *
 * TWO ENTRY POINTS, both needed:
 *   1. `vite:preloadError` — Vite fires this on `window` when its preload
 *      helper cannot fetch a dynamic-import chunk. Catching it here means most
 *      stale imports never even reach React.
 *   2. `RouteErrorScreen` — react-router's `errorElement`, for anything that
 *      got past the listener (an error thrown while rendering a freshly loaded
 *      module, Suspense surfacing the rejection).
 *
 * Imported for its side effect from `routes/index.tsx`, which is in the ENTRY
 * graph — so the listener exists before any lazy import can be attempted.
 */

/** sessionStorage key holding the epoch-ms of the last recovery reload. */
export const CHUNK_RELOAD_KEY = 'fb-chunk-reload-v1';

/** Refuse a second recovery reload within this window (the loop guard). */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * The three browser phrasings of "I could not load that module". Chromium says
 * "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", Safari "Importing a module script failed".
 * Matched case-insensitively because the casing has changed between versions.
 */
const STALE_CHUNK_MESSAGE =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

/** Pull a message string out of whatever react-router / Vite handed us. */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string') return message;
  }
  return '';
}

/**
 * True when `error` is the "a hashed chunk from the previous deploy is gone"
 * failure. Message matching is the only signal available — none of the three
 * engines expose a distinguishable error type or code for it.
 */
export function isStaleChunkError(error: unknown): boolean {
  return STALE_CHUNK_MESSAGE.test(messageOf(error));
}

/**
 * Read the last recovery timestamp. `null` means the STORAGE ITSELF is
 * unreadable — distinct from "no attempt recorded" (0) — because without a
 * working store the guard cannot remember anything across documents, and a
 * remembered attempt is the only thing between a broken deploy and an infinite
 * refresh loop. Callers must fail closed on `null`.
 */
function lastReloadAt(): number | null {
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return null;
  }
}

/**
 * Reload the page to pick up the current build — at most once per
 * {@link CHUNK_RELOAD_WINDOW_MS}.
 *
 * Returns `true` when a reload was initiated (the caller should render a
 * transient "updating" state and expect the document to go away), `false` when
 * the guard refused (the caller must show a real error instead).
 *
 * A stored timestamp in the FUTURE (a clock change between loads) also refuses:
 * failing closed costs one error card, failing open costs a refresh loop.
 */
export function tryRecoveryReload(): boolean {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  const last = lastReloadAt();

  // Unreadable storage (private mode / blocked): FAIL CLOSED. A reload we
  // cannot record is a reload we would repeat on every future document.
  if (last === null) return false;
  if (last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;

  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // The read succeeded but the write failed — same reasoning as `null`.
    return false;
  }

  window.location.reload();
  return true;
}

// Install the Vite-level net before any lazy route can be requested. Guarded on
// `window` so the module stays importable from the node unit suites.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    // Only swallow the error when we are actually replacing the document;
    // otherwise let it through so RouteErrorScreen can show the card.
    if (tryRecoveryReload()) event.preventDefault();
  });
}
