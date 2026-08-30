import { useSyncExternalStore } from 'react';

/**
 * Motion policy — the app's single answer to "should this animate?".
 *
 * Nothing else in the codebase reads `prefers-reduced-motion` directly. The OS
 * signal is a blunt instrument (Windows' Accessibility → "Animation effects"
 * toggle flips it system-wide, and some remote-desktop and power-saving setups
 * assert it without anyone asking), so honoring it unconditionally would kill
 * every transition FlowBoard has with no way to opt back in. The preference
 * lives here instead: device-local under `fb-motion-v1`, **default `full`**, and
 * it consults the OS ONLY when the user explicitly picks `system`.
 *
 * The effective value is stamped on `<html data-motion="full|reduced">`, which
 * is what the CSS gates on (`:where(html[data-motion='full']) …`). A bare media
 * query could not be overridden from inside the app, which is the whole reason
 * the stamp exists rather than `@media (prefers-reduced-motion)` alone.
 *
 * THIS MODULE IS THE BASE OF THE MOTION STACK, exactly as `lib/lang-policy.ts`
 * is the base of the i18n stack, and it is deliberately shaped the same way:
 * lazily-read module state, a listener set, a `<html>` stamp applied before
 * React mounts, and a `useSyncExternalStore` hook on top. Keep it free of
 * component and `motion` imports so a policy read is always cheap and
 * synchronous — {@link prefersReducedMotion} is called from render paths and
 * from `chart-theme.ts`, where a hook would not be available.
 *
 * ── THE MOTION STACK, END TO END (W1.0 seam → W1.5 fill) ────────────────────
 * W1.0 ported the POLICY so `main.tsx` (a frozen stitch file) could call
 * {@link initMotionPolicy} from the first commit of the wave, and so W2.1–W2.4
 * could import {@link prefersReducedMotion} without waiting on anyone. W1.5
 * completed the stack around it; the exported signatures below are unchanged
 * and are what everything downstream builds against:
 *
 *   1. THIS MODULE decides, and stamps `<html data-motion>`.
 *   2. `index.css`'s **motion gate layer** (the last block in the file) reads
 *      the stamp: `reduced` floors the `tw-animate-css` enter/exit animations
 *      on the shadcn primitives and freezes `animate-pulse`; `full` is where
 *      Round 2's own keyframes (`fb-badge-pop`, `fb-drawer-in`, `fb-scrim-in`)
 *      are declared, so `reduced` never starts them at all.
 *   3. `components/common/MotionCard.tsx` on `/me` sets the preference.
 *   4. JS-driven motion — the `motion` registry, `chart-theme.ts`,
 *      `RouteSkeleton` — calls {@link prefersReducedMotion} directly, because
 *      a WAAPI/JS animation is immune to a CSS gate.
 *
 * `motion-policy.test.ts` is the contract for step 1.
 */

/** What the user chose. `system` is the only value that defers to the OS. */
export type MotionPref = 'full' | 'reduced' | 'system';

/** What `<html data-motion>` actually carries — the resolved answer. */
export type EffectiveMotion = 'full' | 'reduced';

/** Motion preference key (house convention: `fb-<name>-v1`). */
export const MOTION_STORAGE_KEY = 'fb-motion-v1';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

const PREFS: readonly MotionPref[] = ['full', 'reduced', 'system'];

/** Lazily read from storage, so a call before `initMotionPolicy()` still works. */
let pref: MotionPref | null = null;
/** The OS listener is attached once for the app's lifetime (see init below). */
let watching = false;
const listeners = new Set<() => void>();

/** Anything unrecognised (or no storage at all) falls back to `full`. */
function readStoredPref(): MotionPref {
  try {
    const raw = localStorage.getItem(MOTION_STORAGE_KEY);
    return PREFS.includes(raw as MotionPref) ? (raw as MotionPref) : 'full';
  } catch {
    // No localStorage (node tests) or blocked storage — non-fatal.
    return 'full';
  }
}

/** True when the OS/browser asks for reduced motion. Only consulted for `system`. */
function osPrefersReduce(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.(REDUCE_QUERY).matches === true;
}

function stamp(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = effectiveMotion();
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The stored preference (`full` when nothing valid is saved). */
export function getMotionPref(): MotionPref {
  pref ??= readStoredPref();
  return pref;
}

/** The preference resolved against the OS — what `data-motion` carries. */
export function effectiveMotion(): EffectiveMotion {
  const current = getMotionPref();
  if (current === 'system') return osPrefersReduce() ? 'reduced' : 'full';
  return current;
}

/**
 * The one predicate every animated surface asks before it animates.
 *
 * A plain function rather than a hook on purpose: the motion registry's entries
 * are reached from render bodies, from imperative drag handlers and from
 * `chart-theme.ts`, and only the first of those could call a hook.
 */
export function prefersReducedMotion(): boolean {
  return effectiveMotion() === 'reduced';
}

/** Persists the choice, restamps `data-motion`, and wakes every subscriber. */
export function setMotionPref(next: MotionPref): void {
  pref = next;
  try {
    localStorage.setItem(MOTION_STORAGE_KEY, next);
  } catch {
    // Storage full / unavailable — the in-memory preference still applies.
  }
  stamp();
  notify();
}

/** Subscribe to preference changes. Returns the unsubscribe function. */
export function subscribeMotion(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Applies the stored preference before first paint. Idempotent: re-reading and
 * re-stamping is cheap, but the OS listener is only ever attached once.
 *
 * That listener stays live at all times and simply does nothing unless the
 * preference is `system` — `full` and `reduced` deliberately outrank the OS.
 *
 * ── THE ORDERING GUARANTEE (verified against `main.tsx`) ────────────────────
 * `bootstrap()` runs, in order: `initLangPolicy()` → `initMotionPolicy()` →
 * `initFaviconUpdater()` → `await initI18n(…)` → `createRoot(…).render(…)`.
 * The stamp therefore lands SYNCHRONOUSLY, before the first `await` and long
 * before React mounts, so `<html data-motion>` is already correct for the very
 * first painted frame. (The theme is earlier still — `stores/useThemeStore` is
 * a side-effect import at module scope, above `bootstrap` itself.)
 *
 * That order is load-bearing, not incidental: `index.css`'s gate layer keys
 * every rule off this attribute, so a stamp applied after mount would let the
 * first overlay or route transition of the session play at the wrong setting —
 * exactly the flash the pre-paint stamp exists to prevent. `main.tsx` is a
 * frozen stitch file; if this call ever moves below the `await`, that is the
 * bug, not this comment.
 */
export function initMotionPolicy(): void {
  pref = readStoredPref();
  stamp();

  if (watching || typeof window === 'undefined') return;
  const query = window.matchMedia?.(REDUCE_QUERY);
  if (!query?.addEventListener) return;
  watching = true;
  query.addEventListener('change', () => {
    if (getMotionPref() !== 'system') return;
    stamp();
    notify();
  });
}

/** Subscribes a component to the preference (the Appearance card, and any gate). */
export function useMotionPref(): MotionPref {
  return useSyncExternalStore(subscribeMotion, getMotionPref, getMotionPref);
}
