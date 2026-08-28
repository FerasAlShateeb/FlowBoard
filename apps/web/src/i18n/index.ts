import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en';
import { getLangPref, subscribeLang, type Lang } from '@/lib/lang-policy';

/**
 * The i18next runtime — one default instance, created SYNCHRONOUSLY at import.
 *
 * Two rules shape this file:
 *
 * 1. **English is bundled, Arabic is not.** `fallbackLng: 'en'` means the
 *    English catalog must be present before the first `t()` call, so it is a
 *    static import. Arabic is a dynamic `import()` fired only when the language
 *    is (or becomes) `ar`, registered namespace-by-namespace with
 *    `addResourceBundle` — an English-only session never downloads it.
 * 2. **`lib/lang-policy` is UPSTREAM of this module, never downstream.** The
 *    policy owns the preference, the storage key and the `<html lang|dir>`
 *    stamp; i18next merely FOLLOWS it via {@link subscribeLang}. Importing
 *    i18next from the policy would invert that and drag the whole library into
 *    every module that only wants to know which way the page runs.
 *
 * Importing this module is enough to get a usable English instance — which is
 * what the unit-test setup relies on, and why `initI18n()` is only needed where
 * Arabic might be the STARTING language (i.e. `main.tsx`).
 */

/** The namespace list, derived from the catalog so the two cannot drift. */
export const NAMESPACES = Object.keys(en) as (keyof typeof en)[];

export const DEFAULT_NS = 'common';

void i18n.use(initReactI18next).init({
  resources: { en },
  lng: getLangPref(),
  fallbackLng: 'en',
  defaultNS: DEFAULT_NS,
  ns: NAMESPACES as string[],
  // React already escapes everything it renders — double-escaping would turn an
  // apostrophe in a display name into `&#39;` on screen.
  interpolation: { escapeValue: false },
  // Keeps `t()` in `string` territory, so a missing key renders the key rather
  // than blowing up a `ReactNode` slot with `null`.
  returnNull: false,
});

/** Arabic is fetched at most once per session, even under rapid toggling. */
let arabicLoad: Promise<void> | null = null;

async function loadArabic(): Promise<void> {
  arabicLoad ??= import('@/locales/ar').then(
    (mod) => {
      for (const [ns, bundle] of Object.entries(mod.default)) {
        // `deep`/`overwrite` false: a bundle is registered once, and English
        // stays the fallback for anything Arabic has not translated yet.
        i18n.addResourceBundle('ar', ns, bundle, false, false);
      }
    },
    (error: unknown) => {
      // A rejected promise must NOT stay memoized: `??=` would pin the failure
      // and every later switch to Arabic would re-await the same rejection.
      // Clearing it lets the next attempt fetch again — the chunk may load fine
      // after a transient network blip.
      arabicLoad = null;
      throw error;
    },
  );
  await arabicLoad;
}

/** Loads whatever `lang` needs, THEN switches — never the other way round. */
async function applyLang(lang: Lang): Promise<void> {
  if (lang === 'ar') await loadArabic();
  // Re-check AFTER the await: a fast en→ar→en double-toggle leaves this call's
  // `lang` stale by the time the Arabic chunk resolves, and committing it would
  // desync i18next from the policy (`<html>` and localStorage already say `en`).
  if (getLangPref() !== lang) return;
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}

/**
 * Brings the instance up on `lang` before the first render.
 *
 * `main.tsx` awaits this so an Arabic session never paints English first — the
 * catalog is in place by the time React mounts. Safe to call more than once.
 */
export async function initI18n(lang: Lang): Promise<void> {
  await applyLang(lang);
}

// Follow the policy for the rest of the session. Registered at MODULE SCOPE
// (not inside `initI18n`) so importing this module is all it takes to keep the
// instance in step — including in tests that never call `initI18n`.
subscribeLang(() => {
  void applyLang(getLangPref());
});

export default i18n;
