// Theme Studio contract: the token document `applyTheme()` writes onto `<html>`
// as CSS custom properties, and that the studio imports/exports as JSON.
//
// The document is DEVICE-LOCAL (localStorage `fb-theme-v1`), not a server
// resource — but it still lives here, because it is a payload that crosses a
// boundary (the import/export JSON file) and it is parsed on every read so a
// hand-edited or version-skewed payload degrades to the default preset instead
// of taking the app down at boot.
//
// TWO SHAPES OF TOKEN, and the split is deliberate:
//   - COLORS are CSS color STRINGS, because FlowBoard's palette is authored in
//     **OKLCH** — a perceptually uniform space, which is what makes "one
//     lightness step" look like the same step across hues and keeps the light
//     and dark ramps consistent. A hex-only token would have forced the whole
//     palette into sRGB.
//   - DIMENSIONS are NUMBERS (px / ms / em), not CSS strings, because the Theme
//     Studio's sliders bind to them and `applyTheme()` multiplies the spacing
//     ones by the density factor. Serializing the unit happens at the one place
//     that writes the custom property.
//
// Runtime-neutral: zod only, no DOM/Node globals. `applyTheme()` itself lives in
// `apps/web/src/components/theme/theme-tokens.ts`, since it touches the DOM.
import { z } from 'zod';

/**
 * A CSS color token. Accepts hex AND the modern function forms (`oklch()`,
 * `oklab()`, `lch()`, `lab()`, `rgb()`, `hsl()`, `color()`).
 *
 * The character class is the guard that matters: these strings are written
 * straight into `element.style.setProperty()`, so `;`, `{` and `}` must never
 * appear or a stored theme could inject arbitrary declarations.
 */
export const themeColorSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:oklch|oklab|lch|lab|rgb|rgba|hsl|hsla|color)\([^;{}]*\))$/,
    'Expected a hex colour (#4f46e5) or a CSS colour function (oklch(...)).',
  );
export type ThemeColor = z.infer<typeof themeColorSchema>;

/**
 * The per-mode color palette. Light and dark each supply a COMPLETE set — there
 * is no inheritance between them, because a token that falls back to the other
 * mode is exactly how a half-finished dark theme ships.
 *
 * `chart1`-`chart5` are the only colors the Recharts components may use; charts
 * reading anything else is what the design checklist audits for.
 */
export const themeColorTokensSchema = z.object({
  primary: themeColorSchema,
  /** Foreground ON `primary` — a pair, so contrast survives a hue change. */
  primaryFg: themeColorSchema,
  secondary: themeColorSchema,
  accent: themeColorSchema,
  bg: themeColorSchema,
  surface: themeColorSchema,
  /** One step above `surface`: popovers, dialogs, the drag overlay. */
  surfaceRaised: themeColorSchema,
  border: themeColorSchema,
  text: themeColorSchema,
  textMuted: themeColorSchema,
  success: themeColorSchema,
  warning: themeColorSchema,
  danger: themeColorSchema,
  info: themeColorSchema,
  sidebarBg: themeColorSchema,
  sidebarActive: themeColorSchema,
  topbar: themeColorSchema,
  chart1: themeColorSchema,
  chart2: themeColorSchema,
  chart3: themeColorSchema,
  chart4: themeColorSchema,
  chart5: themeColorSchema,
});
export type ThemeColorTokens = z.infer<typeof themeColorTokensSchema>;

/**
 * Mode-independent tokens: typography, geometry, spacing, motion. The shape does
 * not change with light/dark, so it is declared once.
 *
 * Fonts are full CSS stacks because the Arabic fallback has to be interposed
 * inside each one (font fallback is per-glyph, so Latin keeps resolving from
 * Inter and only the Arabic glyphs fall through).
 */
export const sharedThemeTokensSchema = z.object({
  fontBody: z.string().max(200),
  fontHead: z.string().max(200),
  fontMono: z.string().max(200),
  hWeight: z.number().int().min(100).max(900),
  fsBase: z.number().min(10).max(20),
  lh: z.number().min(1).max(2.5),
  /** Letter spacing in EM (not px) — it must scale with the font size. */
  ls: z.number().min(-0.05).max(0.1),
  radius: z.number().min(0).max(24),
  cardRadius: z.number().min(0).max(28),
  btnRadius: z.number().min(0).max(24),
  inputRadius: z.number().min(0).max(24),
  sidebarW: z.number().min(160).max(400),
  sidebarWc: z.number().min(40).max(120),
  topbarH: z.number().min(36).max(80),
  contentMax: z.number().min(800).max(2400),
  pagePad: z.number().min(0).max(64),
  cardPad: z.number().min(0).max(48),
  gap: z.number().min(0).max(48),
  rowPad: z.number().min(0).max(32),
  /** 0–3, indexing the shadow ramp in the web's `theme-tokens.ts`. */
  shadowLevel: z.number().int().min(0).max(3),
  /** Transition duration in ms for all chrome. */
  speed: z.number().int().min(0).max(600),
  /** Row heights and paddings: `compact` is the dense board/table mode. */
  density: z.enum(['comfortable', 'compact']),
  chartStyle: z.enum(['filled', 'line']),
});
export type SharedThemeTokens = z.infer<typeof sharedThemeTokensSchema>;

/**
 * The preset marker — the eight names in the Theme Studio's gallery, plus
 * `'Imported'` for a document that came from the JSON import flow and matches
 * no preset.
 *
 * IT IS A LABEL, NEVER A POINTER. The tokens are always resolved from the
 * document's own `light`/`dark`/`shared` blocks; this field only tells the
 * gallery which card to mark active, and `matchColorPreset()` recomputes that
 * STRUCTURALLY anyway. Which is exactly why widening the enum is safe: a
 * document carrying `themePreset: 'Ocean'` whose colours were then hand-edited
 * renders the edited colours and highlights no card, because the structural
 * match is the authority and the label is a hint.
 *
 * The names are the source strings from the web's `theme-presets.ts`, not
 * localized labels — a persisted document must not change meaning when the
 * reader switches language.
 */
export const themePresetSchema = z.enum([
  'Default',
  'Graphite',
  'Ocean',
  'Forest',
  'Sunset',
  'Rose',
  'Amber',
  'High Contrast',
  'Imported',
]);
export type ThemePreset = z.infer<typeof themePresetSchema>;

/** Same idea for the font-preset picker: the eight families, plus `Imported`. */
export const fontPresetSchema = z.enum([
  'Inter',
  'IBM Plex Sans',
  'Manrope',
  'DM Sans',
  'Space Grotesk',
  'Source Serif 4',
  'JetBrains Mono',
  'IBM Plex Mono',
  'Imported',
]);
export type FontPreset = z.infer<typeof fontPresetSchema>;

/**
 * The complete theme document: what is persisted under `fb-theme-v1`, what the
 * studio exports as a `.json` file, and what `applyTheme()` consumes.
 */
export const themeDocumentSchema = z.object({
  light: themeColorTokensSchema,
  dark: themeColorTokensSchema,
  shared: sharedThemeTokensSchema,
  themePreset: themePresetSchema.optional(),
  fontPreset: fontPresetSchema.optional(),
});
export type ThemeDocument = z.infer<typeof themeDocumentSchema>;

/**
 * Which of the two palettes is active. Stored NEXT TO the document (under
 * `fb-dark-v1`) rather than inside it: a document holds both palettes, so the
 * active mode is a property of the viewer, not of the theme.
 *
 * There is no `system` member on purpose — FlowBoard is dark-first (plan
 * §Design), so an unconfigured visitor gets dark regardless of their OS and only
 * an explicit stored choice overrides it.
 */
export const themeModeSchema = z.enum(['light', 'dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;
