import type { ThemeDocument } from '@flowboard/shared';

import { colorToHex } from '@/components/theme/color';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The live favicon: a brand mark generated from the RUNNING theme.
 *
 * `index.html` ships no icon, and a static one could not tell the truth anyway
 * — eight presets × two modes is sixteen different `--primary` values, and the
 * tab is often the only part of FlowBoard a user can see while they are in
 * another app. So the mark is rebuilt as an SVG data-URI whenever the theme or
 * the mode changes, and the `<link rel="icon">` href is swapped.
 *
 * The shape is the geometric twin of `components/common/BrandMark.tsx`: a
 * rounded tile in `--primary` carrying an `F` in `--primary-fg`. The letter is
 * drawn as three rounded RECTS rather than `<text>` — an SVG favicon is
 * rasterised without the page's font stack, so a `<text>` mark would render in
 * whatever the browser considers a default face, or not at all.
 *
 * COLOURS ARE CONVERTED TO HEX. `oklch()` inside an SVG data-URI is a much
 * newer capability than SVG favicons themselves, and a favicon that silently
 * fails to paint in one browser is worse than one that is a hair off in
 * gamut-mapped sRGB. The conversion is `components/theme/color.ts`; an
 * unconvertible value (a hand-imported `lab()`) falls through as-is.
 */

export interface FaviconColors {
  primary: string;
  primaryFg: string;
}

/** The two brand channels of the ACTIVE mode. */
export function resolveFaviconColors(theme: ThemeDocument, dark: boolean): FaviconColors {
  const colors = dark ? theme.dark : theme.light;
  return { primary: colors.primary, primaryFg: colors.primaryFg };
}

/** `oklch(…)` → `#rrggbb` where possible; anything else is passed through. */
const toPaint = (color: string): string => colorToHex(color) ?? color;

/**
 * The 64×64 mark as a standalone SVG string.
 *
 * Geometry mirrors `BrandMark`: a `rx=14` tile (≈0.22 of the side, the same
 * ratio as the component's 8-of-32) and a 36px-tall `F` inset from it.
 */
export function buildFaviconSvg({ primary, primaryFg }: FaviconColors): string {
  const tile = toPaint(primary);
  const glyph = toPaint(primaryFg);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
    `<rect width="64" height="64" rx="14" fill="${tile}"/>` +
    `<g fill="${glyph}">` +
    '<rect x="20" y="14" width="8" height="36" rx="4"/>' +
    '<rect x="20" y="14" width="26" height="8" rx="4"/>' +
    '<rect x="20" y="29" width="19" height="8" rx="4"/>' +
    '</g>' +
    '</svg>'
  );
}

/**
 * The mark as a `data:image/svg+xml,…` URI.
 *
 * `encodeURIComponent`, not base64: it keeps the payload readable in devtools
 * and is what makes the `#` of a hex colour survive — an unencoded `#` inside a
 * data URI starts a fragment and truncates the SVG at the first fill.
 */
export const buildFaviconDataUri = (colors: FaviconColors): string =>
  `data:image/svg+xml,${encodeURIComponent(buildFaviconSvg(colors))}`;

/** Find-or-create `<link rel="icon">` and point it at `href`. No-op without a DOM. */
export function applyFavicon(href: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = href;
}

const hrefFor = (theme: ThemeDocument, dark: boolean): string =>
  buildFaviconDataUri(resolveFaviconColors(theme, dark));

// Module-level guard: idempotent across React 19 StrictMode double-invokes and
// HMR re-imports, both of which would otherwise stack duplicate subscriptions.
let initialized = false;

/**
 * Paint the favicon from the current theme, then keep it in step.
 *
 * THE INTEGRATOR CALLS THIS from `main.tsx` (which this work package does not
 * own), after the `@/stores/useThemeStore` side-effect import:
 *
 *     import { initFaviconUpdater } from '@/components/theme/favicon-updater';
 *     initFaviconUpdater();
 *
 * It is deliberately NOT invoked at module scope here: importing a module must
 * not mutate `<head>`, or a unit test that imports the builder gets a favicon
 * as a side effect. Safe to call more than once.
 */
export function initFaviconUpdater(): void {
  if (initialized) return;
  initialized = true;

  const { theme, dark } = useThemeStore.getState();
  applyFavicon(hrefFor(theme, dark));

  useThemeStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme || state.dark !== previous.dark) {
      applyFavicon(hrefFor(state.theme, state.dark));
    }
  });
}

/** Test seam: forget that {@link initFaviconUpdater} ever ran. */
export function resetFaviconUpdaterForTests(): void {
  initialized = false;
}
