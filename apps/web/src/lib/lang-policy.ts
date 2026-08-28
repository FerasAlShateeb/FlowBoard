import { useSyncExternalStore } from 'react';

/**
 * Language policy — the app's single answer to "what language is this, and
 * which way does it run?".
 *
 * Nothing else in the codebase reads `navigator.language` or writes
 * `<html lang>` / `<html dir>`. The preference is device-local under
 * `fb-lang-v1`, defaults to the browser's own language on a first visit, and is
 * stamped BEFORE React mounts — a JS-only signal would leave the first paint
 * mirrored the wrong way, and a zustand field could not answer the question at
 * all until the tree had rendered.
 *
 * The stamped `<html lang|dir>` is what the CSS logical properties (`ms-*`,
 * `inset-inline-*`), the `html[lang='ar']` typography rules in `index.css`, and
 * Radix's `Direction.Provider` all gate on.
 *
 * THIS MODULE IS THE BASE OF THE I18N STACK: `src/i18n` depends on it (it drives
 * `changeLanguage` off {@link subscribeLang}), never the reverse. Keep it free
 * of i18next imports so a policy read is always cheap and synchronous.
 */

export type Lang = 'en' | 'ar';

/** Language preference key (conventions: `fb-<name>-v1`). */
export const LANG_STORAGE_KEY = 'fb-lang-v1';

const LANGS: readonly Lang[] = ['en', 'ar'];

/** Lazily read from storage, so a call before `initLangPolicy()` still works. */
let lang: Lang | null = null;
const listeners = new Set<() => void>();

/**
 * First-visit default: follow the browser. Anything whose primary subtag is
 * `ar` (`ar`, `ar-SA`, `ar-EG`, …) starts Arabic; everything else — including a
 * missing `navigator` (node tests) — starts English.
 */
function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** Anything unrecognised (or no storage at all) falls back to the detection. */
function readStoredLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    return LANGS.includes(raw as Lang) ? (raw as Lang) : detectLang();
  } catch {
    // No localStorage (node tests) or blocked storage — non-fatal.
    return detectLang();
  }
}

function stamp(): void {
  if (typeof document === 'undefined') return;
  const current = getLangPref();
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The stored language (browser-detected when nothing valid is saved). */
export function getLangPref(): Lang {
  lang ??= readStoredLang();
  return lang;
}

/** True for the right-to-left languages — today that is Arabic alone. */
export function isRTL(): boolean {
  return getLangPref() === 'ar';
}

/**
 * The BCP-47 tag every `Intl` formatter in the app is built with.
 *
 * Arabic deliberately carries `-u-nu-latn`: FlowBoard's numerals stay WESTERN
 * (`1,234`, not `١٬٢٣٤`) because task keys (`FB-142`), story points, sprint
 * numbers and dates are read side by side with Latin identifiers, and most of
 * the surfaces that show them — the table, the burndown axis, the Gantt time
 * axis — are `tabular-nums` grids where a digit swap breaks column alignment.
 * The words localize; the digits do not.
 */
export function getIntlLocale(): string {
  return intlLocaleFor(getLangPref());
}

/**
 * The same rule as a PURE function of a language code.
 *
 * Exists for the formatters that already subscribe to the language through
 * `useLang()` and hold the value: they must derive the tag from THAT value, not
 * re-read the store, or a formatter memoized on `lang` could be built from a
 * newer preference than the one it is keyed to. It also stops the rule being
 * re-spelled by hand — `components/tasks/task-dates.ts` inlined
 * `lang === 'ar' ? 'ar-u-nu-latn' : lang` three times before WP3.8, which
 * quietly produced `en` rather than `en-US` for English.
 */
export function intlLocaleFor(lang: string): string {
  return lang === 'ar' ? 'ar-u-nu-latn' : 'en-US';
}

/** Persists the choice, restamps `<html lang|dir>`, and wakes every subscriber. */
export function setLangPref(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // Storage full / unavailable — the in-memory language still applies.
  }
  stamp();
  notify();
}

/** Subscribe to language changes. Returns the unsubscribe function. */
export function subscribeLang(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Applies the stored language before first paint. Idempotent: re-reading and
 * re-stamping is cheap. Called from `main.tsx` AHEAD of `initI18n()`, so the
 * document is already in the right direction while the Arabic catalog is still
 * in flight — and stays so even if that import fails.
 */
export function initLangPolicy(): void {
  lang = readStoredLang();
  stamp();
}

/** Subscribes a component to the language (Topbar, providers, calendar). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLangPref, getLangPref);
}
