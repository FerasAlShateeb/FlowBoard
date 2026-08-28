import {
  themeDocumentSchema,
  type SharedThemeTokens,
  type ThemeColorTokens,
  type ThemeDocument,
} from '@flowboard/shared';

/**
 * The FlowBoard token system: the default theme document, and the runtime
 * writer that turns one into CSS custom properties on `<html>`.
 *
 * These values are the byte-for-byte twins of the `:root` / `.dark` blocks in
 * `src/index.css`. The stylesheet exists so the FIRST paint (before any JS)
 * already looks right; this module exists so the Theme Studio can change the
 * same tokens live. Edit one without the other and the pre-paint frame will not
 * match the post-mount one — which reads to a user as a flash.
 *
 * Design direction (plan §Design): Linear-style minimal, dark-first, muted
 * deep-neutral surfaces, subtle borders, ONE strong accent — a refined
 * indigo/violet in OKLCH.
 */

/**
 * The document CONTRACT lives in `@flowboard/shared` (`theme.schema.ts`) — the
 * studio's JSON export is a payload that crosses a boundary, so it is defined
 * once and parsed with zod on every read. Re-exported here so theme consumers
 * have one import site for the schema, the types and the default preset.
 */
export { themeDocumentSchema };
export type { ThemeDocument, SharedThemeTokens, ThemeColorTokens };

/** Light palette — cool near-neutrals carrying a whisper of the accent hue. */
const LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.524 0.187 276.2)',
  primaryFg: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.958 0.004 275)',
  accent: 'oklch(0.585 0.126 232)',
  bg: 'oklch(0.985 0.002 275)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.972 0.003 275)',
  border: 'oklch(0.914 0.005 275)',
  text: 'oklch(0.215 0.014 275)',
  textMuted: 'oklch(0.545 0.014 275)',
  success: 'oklch(0.588 0.136 150)',
  warning: 'oklch(0.702 0.152 74)',
  danger: 'oklch(0.577 0.211 26)',
  info: 'oklch(0.598 0.132 240)',
  sidebarBg: 'oklch(0.968 0.003 275)',
  sidebarActive: 'oklch(0.928 0.024 276)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.524 0.187 276.2)',
  chart2: 'oklch(0.598 0.132 240)',
  chart3: 'oklch(0.702 0.152 74)',
  chart4: 'oklch(0.588 0.136 150)',
  chart5: 'oklch(0.577 0.185 12)',
};

/** Dark palette — the DEFAULT mode. Deep neutrals, low-contrast hairlines. */
const DARK: ThemeColorTokens = {
  primary: 'oklch(0.662 0.166 278)',
  primaryFg: 'oklch(0.16 0.028 278)',
  secondary: 'oklch(0.248 0.009 275)',
  accent: 'oklch(0.742 0.116 220)',
  bg: 'oklch(0.163 0.007 275)',
  surface: 'oklch(0.193 0.008 275)',
  surfaceRaised: 'oklch(0.229 0.009 275)',
  border: 'oklch(0.281 0.009 275)',
  text: 'oklch(0.934 0.004 275)',
  textMuted: 'oklch(0.652 0.012 275)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.147 0.007 275)',
  sidebarActive: 'oklch(0.264 0.031 278)',
  topbar: 'oklch(0.163 0.007 275)',
  chart1: 'oklch(0.662 0.166 278)',
  chart2: 'oklch(0.732 0.121 236)',
  chart3: 'oklch(0.812 0.146 79)',
  chart4: 'oklch(0.742 0.152 152)',
  chart5: 'oklch(0.702 0.164 8)',
};

/**
 * Shared defaults.
 *
 * `'IBM Plex Sans Arabic'` rides every stack as the fallback AFTER the Latin
 * family. Font fallback is PER GLYPH, so Latin keeps resolving from Inter /
 * JetBrains Mono and only the Arabic glyphs — which neither covers — fall
 * through. Mirrored in `index.css`; change both together.
 */
const SHARED: SharedThemeTokens = {
  fontBody: "'Inter', 'IBM Plex Sans Arabic', ui-sans-serif, system-ui, sans-serif",
  fontHead: "'Inter', 'IBM Plex Sans Arabic', ui-sans-serif, system-ui, sans-serif",
  fontMono: "'JetBrains Mono', 'IBM Plex Sans Arabic', ui-monospace, monospace",
  hWeight: 600,
  fsBase: 13.5,
  lh: 1.5,
  ls: -0.006,
  radius: 6,
  cardRadius: 8,
  btnRadius: 6,
  inputRadius: 6,
  sidebarW: 232,
  sidebarWc: 56,
  topbarH: 48,
  contentMax: 1600,
  pagePad: 20,
  cardPad: 16,
  gap: 12,
  rowPad: 8,
  shadowLevel: 1,
  speed: 130,
  density: 'comfortable',
  chartStyle: 'filled',
};

/** The one preset shipped in Wave 1. The gallery arrives in WP4.5. */
export const DEFAULT_THEME: ThemeDocument = {
  light: LIGHT,
  dark: DARK,
  shared: SHARED,
  themePreset: 'Default',
  fontPreset: 'Inter',
};

/**
 * Token key → CSS custom property. The single mapping table: the Theme Studio's
 * colour editors iterate it, and `applyTheme` writes through it, so a new token
 * is added HERE, in the schema, and in `index.css` — nowhere else.
 */
export const COLOR_VARS: Record<keyof ThemeColorTokens, string> = {
  primary: '--primary',
  primaryFg: '--primary-fg',
  secondary: '--secondary',
  accent: '--accent',
  bg: '--bg',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  border: '--border',
  text: '--text',
  textMuted: '--text-muted',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
  sidebarBg: '--sidebar-bg',
  sidebarActive: '--sidebar-active',
  topbar: '--topbar',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
};

/** `shadowLevel` (0–3) → `[--shadow-1, --shadow-2]`, per mode. */
const SHADOWS_LIGHT: ReadonlyArray<readonly [string, string]> = [
  ['none', 'none'],
  ['0 1px 2px 0 oklch(0 0 0 / 0.05)', '0 8px 24px -8px oklch(0 0 0 / 0.14)'],
  ['0 1px 3px 0 oklch(0 0 0 / 0.10)', '0 12px 28px -8px oklch(0 0 0 / 0.18)'],
  ['0 4px 10px -2px oklch(0 0 0 / 0.15)', '0 22px 44px -14px oklch(0 0 0 / 0.28)'],
];

/**
 * The dark ramp is SEPARATE, not the light one reused. A black drop shadow on
 * a near-black surface is invisible, so dark elevation leans on much higher
 * alpha over a longer blur to read at all.
 */
const SHADOWS_DARK: ReadonlyArray<readonly [string, string]> = [
  ['none', 'none'],
  ['0 1px 2px 0 oklch(0 0 0 / 0.28)', '0 12px 32px -10px oklch(0 0 0 / 0.6)'],
  ['0 2px 5px 0 oklch(0 0 0 / 0.38)', '0 16px 40px -12px oklch(0 0 0 / 0.68)'],
  ['0 6px 14px -3px oklch(0 0 0 / 0.5)', '0 28px 56px -16px oklch(0 0 0 / 0.78)'],
];

/**
 * Compact density multiplier, applied to the SPACING tokens only.
 *
 * Font size, radii and the sidebar width are deliberately untouched: shrinking
 * type hurts legibility and shrinking radii changes the visual language, while
 * shrinking padding/gaps is exactly what "fit more rows on screen" means.
 */
export const DENSITY_SCALE: Record<SharedThemeTokens['density'], number> = {
  comfortable: 1,
  compact: 0.72,
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/**
 * Writes every theme token as an inline CSS custom property on `<html>`,
 * toggles the `dark` class the `@custom-variant` keys off, and sets
 * `color-scheme` (which is what makes native form controls, the caret and the
 * scrollbar chrome match the palette).
 *
 * IT NO LONGER STAMPS `data-density` (removed WP5.6). Density is already
 * expressed the way the app consumes it — {@link DENSITY_SCALE} multiplies the
 * four spacing tokens below, and every component reads those. The attribute was
 * a second, parallel channel that nothing in `index.css` or `src/` ever
 * selected on: an API with no callers, which reads as a supported hook the next
 * person is entitled to build on. If a stylesheet ever genuinely needs to
 * branch on density rather than scale with it, stamping it back is one line —
 * with a selector to justify it.
 *
 * Inline style beats the stylesheet, so this always wins over `index.css`.
 * Called at MODULE SCOPE by `stores/useThemeStore`, which `main.tsx` imports
 * before `createRoot` — that is what makes the theme pre-paint.
 *
 * Safe to call on every change: it only ever sets properties, never removes
 * them, so there is no intermediate frame with a token missing.
 */
export function applyTheme(theme: ThemeDocument, dark: boolean): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const colors = dark ? theme.dark : theme.light;
  const s = theme.shared;
  const setVar = (name: string, value: string) => root.style.setProperty(name, value);
  const px = (n: number) => `${Math.round(n)}px`;

  for (const key of Object.keys(COLOR_VARS) as Array<keyof ThemeColorTokens>) {
    setVar(COLOR_VARS[key], colors[key]);
  }

  const density = DENSITY_SCALE[s.density];

  setVar('--font-body', s.fontBody);
  setVar('--font-head', s.fontHead);
  setVar('--font-mono', s.fontMono);
  setVar('--h-weight', String(s.hWeight));
  setVar('--fs-base', `${s.fsBase}px`);
  setVar('--lh', String(s.lh));
  setVar('--ls', `${s.ls}em`);
  setVar('--radius', px(s.radius));
  setVar('--card-radius', px(s.cardRadius));
  setVar('--btn-radius', px(s.btnRadius));
  setVar('--input-radius', px(s.inputRadius));
  setVar('--sidebar-w', px(s.sidebarW));
  setVar('--sidebar-wc', px(s.sidebarWc));
  setVar('--topbar-h', px(s.topbarH));
  setVar('--content-max', px(s.contentMax));
  setVar('--page-pad', px(s.pagePad * density));
  setVar('--card-pad', px(s.cardPad * density));
  setVar('--gap', px(s.gap * density));
  setVar('--row-pad', px(s.rowPad * density));

  const ramp = dark ? SHADOWS_DARK : SHADOWS_LIGHT;
  const shadows = ramp[clamp(Math.round(s.shadowLevel), 0, ramp.length - 1)];
  if (shadows) {
    setVar('--shadow-1', shadows[0]);
    setVar('--shadow-2', shadows[1]);
  }
  setVar('--speed', `${s.speed}ms`);

  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}
