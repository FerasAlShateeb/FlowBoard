import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import '@/index.css';
// SIDE-EFFECT IMPORT — the pre-paint theme. `stores/useThemeStore` reads the
// persisted document at MODULE SCOPE and calls `applyTheme()` on the way in, so
// every token and the `dark` class are on <html> before React exists. It sits
// here, above every component import, because import order is evaluation order:
// anything imported earlier would render against the stylesheet defaults.
import '@/stores/useThemeStore';

import { initFaviconUpdater } from '@/components/theme/favicon-updater';
import { getLangPref, initLangPolicy } from '@/lib/lang-policy';
import { initMotionPolicy } from '@/lib/motion-policy';
import { initI18n } from '@/i18n';
import { router } from '@/routes';
import AppProviders from '@/AppProviders';

/**
 * Boot sequence. The ORDER is the whole point of this file:
 *
 *   1. `<html lang|dir>` — stamped from the persisted preference. Synchronous
 *      and first, so an Arabic session is already right-to-left while
 *      everything below is still loading.
 *   1b. `<html data-motion>` — the same shape of decision, and for the same
 *      reason it must be pre-paint: the CSS transitions the shell uses are gated
 *      on this attribute, so stamping it after React mounted would let the first
 *      route transition play at the wrong setting. Default is `full` and it
 *      beats the OS; only an explicit `system` preference consults
 *      `prefers-reduced-motion`. See `lib/motion-policy.ts`.
 *   2. Theme — applied by the side-effect import above, before this function
 *      even runs. No flash of the wrong palette.
 *   2b. Favicon — `initFaviconUpdater()` paints `<head>` from the theme that
 *      step 2 already applied, then subscribes for the life of the tab. It runs
 *      HERE rather than at the theme module's scope on purpose: importing a
 *      module must not mutate the document, or a unit test that imports the
 *      favicon builder grows a side effect. It is idempotent, and it must come
 *      AFTER the store import, since it reads the store's initial state.
 *   3. i18n — AWAITED, and this is the only reason `bootstrap` is async: the
 *      Arabic catalog is a dynamic import, and rendering before it resolves
 *      would paint an English frame and then swap every string on screen.
 *   4. Render.
 *
 * Steps 1 and 2 are deliberately independent of step 3: if the Arabic chunk
 * fails to load, the document is still in the right direction and the right
 * theme, and English (fully bundled, and the `fallbackLng`) carries the page.
 *
 * ── ROUND 2 FREEZE ──────────────────────────────────────────────────────────
 * This entry point is a STITCH FILE. W1.0 added the one line Round 2 needs here
 * (`initMotionPolicy()`), and W3.1 is the only package allowed to edit it
 * again. W1.5 owns the motion policy MODULE and everything downstream of the
 * stamp; it does not need to reopen this file.
 */
async function bootstrap(): Promise<void> {
  initLangPolicy();
  initMotionPolicy();
  initFaviconUpdater();

  try {
    await initI18n(getLangPref());
  } catch {
    // A failed Arabic-catalog fetch must NEVER leave the page blank.
    // `bootstrap()` is fire-and-forget, so an escaping rejection here would
    // mean `root.render` never runs. English is bundled; render with it
    // (i18next falls back per key) and let the next language switch retry —
    // `loadArabic` un-memoizes a rejected load precisely so it can.
  }

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('FlowBoard failed to boot: #root is missing from index.html');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

void bootstrap();
