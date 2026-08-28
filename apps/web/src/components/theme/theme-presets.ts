import type { SharedThemeTokens, ThemeColorTokens, ThemeDocument } from '@flowboard/shared';

import { DEFAULT_THEME } from '@/components/theme/theme-tokens';

/**
 * Theme Studio DATA: the eight colour presets, the font presets, and the
 * word-labelled dimension groups.
 *
 * THIS FILE IS FRAMEWORK-FREE ON PURPOSE. No React, no i18next, no DOM — it is
 * a table the studio renders and the tests iterate. Every human-facing word is
 * an i18n KEY (`labelKey`), resolved at render by `theme-labels.ts`; the
 * English string never lives here, so an Arabic session gets Arabic preset and
 * option names without this module knowing that i18n exists.
 *
 * CHECKLIST §6 EXEMPTION. "No hex or raw colour literal outside `index.css` and
 * the theme presets" — this is the theme presets. It and `color.ts` (which
 * holds transfer matrices, not colours) are the only files in `src/` allowed to
 * write a colour value. Components read tokens.
 *
 * HOW THE PALETTES WERE BUILT. Every preset is a complete 22-token light AND
 * dark set authored in OKLCH from one recipe, so the eight of them are the same
 * design at eight hues rather than eight unrelated colour schemes:
 *
 *   - A neutral ramp (`bg` → `surface` → `surfaceRaised` → `border`) at fixed
 *     lightness steps, carrying a trace of the preset's hue so the greys belong
 *     to the family. Lightness is what separates the surfaces; hue only tints.
 *   - `text` / `textMuted` at fixed lightness, which is what makes the contrast
 *     floors below hold at every hue — a hue rotation in OKLCH does not move
 *     lightness, which is the entire reason the palette is not authored in HSL.
 *   - `primary` chosen for its hue, then `primaryFg` picked as whichever end of
 *     the ramp clears 4.5:1 ON it (Amber's is near-black, not white — a white
 *     label on honey is the classic 2.5:1 mistake).
 *   - `chart1`-`chart5` as a coherent spread around the preset's hue. WP3.8
 *     rides the task-type glyphs on `--chart-1..5`, so this ramp restyles every
 *     view's icons, not just the reports dashboard — which is why the ramp is
 *     five DISTINGUISHABLE hues (or, for Graphite, five lightness steps) and
 *     not five shades of the primary.
 *   - The semantic four (`success`/`warning`/`danger`/`info`) stay green / amber
 *     / red / blue in every preset. They encode MEANING; a "Rose" preset whose
 *     success state is pink is a preset that lies.
 *
 * `theme-presets.test.ts` re-checks all of that mechanically: every preset
 * parses the shared schema in both modes and clears the AA-ish contrast floors.
 */

/* -------------------------------------------------------------------------- */
/* Colour presets                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The preset identities. These are STABLE ENGLISH IDs, not display text —
 * `labelKey` carries the display text through i18n.
 *
 * They are also the values `themePresetSchema` accepts: WP4.7 widened it from
 * the Wave-1 `['Default','Imported']` pair to all eight names plus `Imported`,
 * so a document CAN now record `themePreset: 'Ocean'` and survive a reload.
 * (The gap this note used to describe is closed; it outlived the fix by two
 * waves and was still telling readers not to write a name the schema has
 * accepted since.)
 *
 * THE LABEL IS STILL NOT THE AUTHORITY, and that has not changed: the studio
 * resolves the active card STRUCTURALLY ({@link matchColorPreset}), by
 * comparing all 44 colours. Apply Ocean, nudge one token, and the document
 * keeps saying `'Ocean'` while the gallery correctly highlights nothing.
 * Storing the name buys a readable export file, not a shortcut for the UI.
 */
export type ColorPresetName =
  'Default' | 'Graphite' | 'Ocean' | 'Forest' | 'Sunset' | 'Rose' | 'Amber' | 'High Contrast';

/**
 * The i18n key suffix for a preset's name and blurb: `theme:presets.<key>` and
 * `theme:presetHints.<key>`.
 *
 * A LITERAL UNION, not `string`, so `t()` still type-checks the composed key
 * against the English catalog — the same shape `lib/label-colors.ts` uses for
 * its `settings:colors.*` names. A card whose key has no catalog entry is a
 * compile error rather than a `theme:presets.ocean` rendered on screen.
 */
export type ColorPresetKey =
  'default' | 'graphite' | 'ocean' | 'forest' | 'sunset' | 'rose' | 'amber' | 'highContrast';

export interface ColorPreset {
  name: ColorPresetName;
  labelKey: ColorPresetKey;
  light: ThemeColorTokens;
  dark: ThemeColorTokens;
  /** Five representative swatches for the card, drawn FROM the palette. */
  swatches: readonly string[];
}

/** Light + dark → a preset, with the swatch row derived rather than re-authored. */
function preset(
  name: ColorPresetName,
  labelKey: ColorPresetKey,
  light: ThemeColorTokens,
  dark: ThemeColorTokens,
): ColorPreset {
  return {
    name,
    labelKey,
    light,
    dark,
    // Deriving the swatches is what stops a card from advertising a colour the
    // palette no longer contains: it is the palette, sampled.
    swatches: [light.primary, light.accent, light.chart3, dark.primary, dark.bg],
  };
}

/** Indigo-violet — the shipped default, and the twin of `index.css`'s `:root`. */
const DEFAULT_PRESET = preset('Default', 'default', DEFAULT_THEME.light, DEFAULT_THEME.dark);

/** Graphite: a monochrome studio. Chroma near zero; the chart ramp is lightness. */
const GRAPHITE_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.32 0.014 275)',
  primaryFg: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.955 0.0018 275)',
  accent: 'oklch(0.48 0.02 275)',
  bg: 'oklch(0.982 0.0012 275)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.97 0.0015 275)',
  border: 'oklch(0.908 0.0024 275)',
  text: 'oklch(0.215 0.0048 275)',
  textMuted: 'oklch(0.525 0.0042 275)',
  success: 'oklch(0.55 0.14 150)',
  warning: 'oklch(0.66 0.15 70)',
  danger: 'oklch(0.55 0.21 27)',
  info: 'oklch(0.56 0.14 240)',
  sidebarBg: 'oklch(0.965 0.0015 275)',
  sidebarActive: 'oklch(0.925 0.005 275)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.3 0.012 275)',
  chart2: 'oklch(0.42 0.014 275)',
  chart3: 'oklch(0.53 0.016 275)',
  chart4: 'oklch(0.62 0.014 275)',
  chart5: 'oklch(0.7 0.012 275)',
};

const GRAPHITE_DARK: ThemeColorTokens = {
  primary: 'oklch(0.92 0.008 275)',
  primaryFg: 'oklch(0.2 0.012 275)',
  secondary: 'oklch(0.25 0.0035 275)',
  accent: 'oklch(0.75 0.015 275)',
  bg: 'oklch(0.163 0.0028 275)',
  surface: 'oklch(0.196 0.0031 275)',
  surfaceRaised: 'oklch(0.232 0.0035 275)',
  border: 'oklch(0.284 0.0039 275)',
  text: 'oklch(0.934 0.0017 275)',
  textMuted: 'oklch(0.66 0.0045 275)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.146 0.0028 275)',
  sidebarActive: 'oklch(0.29 0.008 275)',
  topbar: 'oklch(0.163 0.0028 275)',
  chart1: 'oklch(0.95 0.006 275)',
  chart2: 'oklch(0.84 0.01 275)',
  chart3: 'oklch(0.72 0.013 275)',
  chart4: 'oklch(0.6 0.015 275)',
  chart5: 'oklch(0.5 0.015 275)',
};

/** Ocean: deep marine blue with a teal accent; cool blue-grey neutrals. */
const OCEAN_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.5 0.145 240)',
  primaryFg: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.955 0.006 235)',
  accent: 'oklch(0.58 0.11 200)',
  bg: 'oklch(0.982 0.004 235)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.97 0.005 235)',
  border: 'oklch(0.908 0.008 235)',
  text: 'oklch(0.215 0.016 235)',
  textMuted: 'oklch(0.525 0.014 235)',
  success: 'oklch(0.55 0.14 150)',
  warning: 'oklch(0.66 0.15 70)',
  danger: 'oklch(0.55 0.21 27)',
  info: 'oklch(0.56 0.14 240)',
  sidebarBg: 'oklch(0.965 0.005 235)',
  sidebarActive: 'oklch(0.925 0.03 240)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.56 0.14 240)',
  chart2: 'oklch(0.56 0.14 200)',
  chart3: 'oklch(0.56 0.14 265)',
  chart4: 'oklch(0.56 0.14 165)',
  chart5: 'oklch(0.56 0.14 95)',
};

const OCEAN_DARK: ThemeColorTokens = {
  primary: 'oklch(0.7 0.135 238)',
  primaryFg: 'oklch(0.17 0.035 245)',
  secondary: 'oklch(0.25 0.01 235)',
  accent: 'oklch(0.79 0.1 198)',
  bg: 'oklch(0.163 0.008 235)',
  surface: 'oklch(0.196 0.009 235)',
  surfaceRaised: 'oklch(0.232 0.01 235)',
  border: 'oklch(0.284 0.011 235)',
  text: 'oklch(0.934 0.005 235)',
  textMuted: 'oklch(0.66 0.013 235)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.146 0.008 235)',
  sidebarActive: 'oklch(0.27 0.035 240)',
  topbar: 'oklch(0.163 0.008 235)',
  chart1: 'oklch(0.75 0.13 238)',
  chart2: 'oklch(0.75 0.13 198)',
  chart3: 'oklch(0.75 0.13 268)',
  chart4: 'oklch(0.75 0.13 165)',
  chart5: 'oklch(0.75 0.13 95)',
};

/** Forest: pine green with a moss accent; neutrals tinted the same green. */
const FOREST_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.48 0.115 155)',
  primaryFg: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.955 0.006 155)',
  accent: 'oklch(0.56 0.13 125)',
  bg: 'oklch(0.982 0.004 155)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.97 0.005 155)',
  border: 'oklch(0.908 0.008 155)',
  text: 'oklch(0.215 0.016 155)',
  textMuted: 'oklch(0.525 0.014 155)',
  success: 'oklch(0.55 0.14 150)',
  warning: 'oklch(0.66 0.15 70)',
  danger: 'oklch(0.55 0.21 27)',
  info: 'oklch(0.56 0.14 240)',
  sidebarBg: 'oklch(0.965 0.005 155)',
  sidebarActive: 'oklch(0.925 0.03 155)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.55 0.135 155)',
  chart2: 'oklch(0.55 0.135 125)',
  chart3: 'oklch(0.55 0.135 190)',
  chart4: 'oklch(0.55 0.135 75)',
  chart5: 'oklch(0.55 0.135 265)',
};

const FOREST_DARK: ThemeColorTokens = {
  primary: 'oklch(0.72 0.135 152)',
  primaryFg: 'oklch(0.17 0.035 155)',
  secondary: 'oklch(0.25 0.01 155)',
  accent: 'oklch(0.81 0.15 128)',
  bg: 'oklch(0.163 0.008 155)',
  surface: 'oklch(0.196 0.009 155)',
  surfaceRaised: 'oklch(0.232 0.01 155)',
  border: 'oklch(0.284 0.011 155)',
  text: 'oklch(0.934 0.005 155)',
  textMuted: 'oklch(0.66 0.013 155)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.146 0.008 155)',
  sidebarActive: 'oklch(0.27 0.035 152)',
  topbar: 'oklch(0.163 0.008 155)',
  chart1: 'oklch(0.75 0.13 152)',
  chart2: 'oklch(0.75 0.13 128)',
  chart3: 'oklch(0.75 0.13 190)',
  chart4: 'oklch(0.75 0.13 80)',
  chart5: 'oklch(0.75 0.13 268)',
};

/** Sunset: burnt orange primary against a magenta dusk accent, warm neutrals. */
const SUNSET_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.55 0.17 35)',
  primaryFg: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.955 0.006 40)',
  accent: 'oklch(0.55 0.16 330)',
  bg: 'oklch(0.982 0.004 40)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.97 0.005 40)',
  border: 'oklch(0.908 0.008 40)',
  text: 'oklch(0.215 0.016 40)',
  textMuted: 'oklch(0.525 0.014 40)',
  success: 'oklch(0.55 0.14 150)',
  warning: 'oklch(0.66 0.15 70)',
  danger: 'oklch(0.55 0.21 27)',
  info: 'oklch(0.56 0.14 240)',
  sidebarBg: 'oklch(0.965 0.005 40)',
  sidebarActive: 'oklch(0.925 0.03 35)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.57 0.15 35)',
  chart2: 'oklch(0.57 0.15 15)',
  chart3: 'oklch(0.57 0.15 330)',
  chart4: 'oklch(0.57 0.15 295)',
  chart5: 'oklch(0.57 0.15 95)',
};

const SUNSET_DARK: ThemeColorTokens = {
  primary: 'oklch(0.74 0.155 45)',
  primaryFg: 'oklch(0.2 0.05 40)',
  secondary: 'oklch(0.25 0.01 40)',
  accent: 'oklch(0.75 0.145 335)',
  bg: 'oklch(0.163 0.008 40)',
  surface: 'oklch(0.196 0.009 40)',
  surfaceRaised: 'oklch(0.232 0.01 40)',
  border: 'oklch(0.284 0.011 40)',
  text: 'oklch(0.934 0.005 40)',
  textMuted: 'oklch(0.66 0.013 40)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.146 0.008 40)',
  sidebarActive: 'oklch(0.28 0.04 40)',
  topbar: 'oklch(0.163 0.008 40)',
  chart1: 'oklch(0.76 0.14 45)',
  chart2: 'oklch(0.76 0.14 20)',
  chart3: 'oklch(0.76 0.14 335)',
  chart4: 'oklch(0.76 0.14 300)',
  chart5: 'oklch(0.76 0.14 100)',
};

/** Rose: crimson-rose primary with a fuchsia accent; faintly pink neutrals. */
const ROSE_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.53 0.19 15)',
  primaryFg: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.955 0.006 350)',
  accent: 'oklch(0.56 0.19 340)',
  bg: 'oklch(0.982 0.004 350)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.97 0.005 350)',
  border: 'oklch(0.908 0.008 350)',
  text: 'oklch(0.215 0.016 350)',
  textMuted: 'oklch(0.525 0.014 350)',
  success: 'oklch(0.55 0.14 150)',
  warning: 'oklch(0.66 0.15 70)',
  danger: 'oklch(0.55 0.21 27)',
  info: 'oklch(0.56 0.14 240)',
  sidebarBg: 'oklch(0.965 0.005 350)',
  sidebarActive: 'oklch(0.925 0.03 15)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.57 0.16 15)',
  chart2: 'oklch(0.57 0.16 340)',
  chart3: 'oklch(0.57 0.16 300)',
  chart4: 'oklch(0.57 0.16 60)',
  chart5: 'oklch(0.57 0.16 200)',
};

const ROSE_DARK: ThemeColorTokens = {
  primary: 'oklch(0.72 0.16 15)',
  primaryFg: 'oklch(0.18 0.05 15)',
  secondary: 'oklch(0.25 0.01 350)',
  accent: 'oklch(0.75 0.15 340)',
  bg: 'oklch(0.163 0.008 350)',
  surface: 'oklch(0.196 0.009 350)',
  surfaceRaised: 'oklch(0.232 0.01 350)',
  border: 'oklch(0.284 0.011 350)',
  text: 'oklch(0.934 0.005 350)',
  textMuted: 'oklch(0.66 0.013 350)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.146 0.008 350)',
  sidebarActive: 'oklch(0.28 0.04 15)',
  topbar: 'oklch(0.163 0.008 350)',
  chart1: 'oklch(0.75 0.14 15)',
  chart2: 'oklch(0.75 0.14 340)',
  chart3: 'oklch(0.75 0.14 300)',
  chart4: 'oklch(0.75 0.14 65)',
  chart5: 'oklch(0.75 0.14 205)',
};

/**
 * Amber: honey primary on sand neutrals. The ONLY preset whose `primaryFg` is
 * dark — amber is too light to carry white text at 4.5:1, and lowering the
 * lightness until it could would have made it brown.
 */
const AMBER_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.62 0.14 70)',
  primaryFg: 'oklch(0.22 0.05 70)',
  secondary: 'oklch(0.955 0.006 75)',
  accent: 'oklch(0.55 0.12 40)',
  bg: 'oklch(0.982 0.004 75)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.97 0.005 75)',
  border: 'oklch(0.908 0.008 75)',
  text: 'oklch(0.215 0.016 75)',
  textMuted: 'oklch(0.525 0.014 75)',
  success: 'oklch(0.55 0.14 150)',
  warning: 'oklch(0.66 0.15 70)',
  danger: 'oklch(0.55 0.21 27)',
  info: 'oklch(0.56 0.14 240)',
  sidebarBg: 'oklch(0.965 0.005 75)',
  sidebarActive: 'oklch(0.93 0.035 75)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.6 0.14 70)',
  chart2: 'oklch(0.6 0.14 40)',
  chart3: 'oklch(0.6 0.14 130)',
  chart4: 'oklch(0.6 0.14 205)',
  chart5: 'oklch(0.6 0.14 330)',
};

const AMBER_DARK: ThemeColorTokens = {
  primary: 'oklch(0.81 0.145 78)',
  primaryFg: 'oklch(0.22 0.05 70)',
  secondary: 'oklch(0.25 0.01 75)',
  accent: 'oklch(0.75 0.12 45)',
  bg: 'oklch(0.163 0.008 75)',
  surface: 'oklch(0.196 0.009 75)',
  surfaceRaised: 'oklch(0.232 0.01 75)',
  border: 'oklch(0.284 0.011 75)',
  text: 'oklch(0.934 0.005 75)',
  textMuted: 'oklch(0.66 0.013 75)',
  success: 'oklch(0.742 0.152 152)',
  warning: 'oklch(0.812 0.146 79)',
  danger: 'oklch(0.681 0.184 24)',
  info: 'oklch(0.732 0.121 236)',
  sidebarBg: 'oklch(0.146 0.008 75)',
  sidebarActive: 'oklch(0.28 0.04 78)',
  topbar: 'oklch(0.163 0.008 75)',
  chart1: 'oklch(0.78 0.14 78)',
  chart2: 'oklch(0.78 0.14 45)',
  chart3: 'oklch(0.78 0.14 135)',
  chart4: 'oklch(0.78 0.14 205)',
  chart5: 'oklch(0.78 0.14 330)',
};

/**
 * High Contrast: pure white / near-black grounds, a BORDER that is a real line
 * rather than a hairline (3.5:1 against its surface, not 1.3:1), and body text
 * at ~20:1. For low vision, bright sunlight, and projectors.
 */
const HIGH_CONTRAST_LIGHT: ThemeColorTokens = {
  primary: 'oklch(0.42 0.2 265)',
  primaryFg: 'oklch(1 0 0)',
  secondary: 'oklch(0.94 0.0024 260)',
  accent: 'oklch(0.42 0.16 200)',
  bg: 'oklch(1 0 0)',
  surface: 'oklch(1 0 0)',
  surfaceRaised: 'oklch(0.965 0.0018 260)',
  border: 'oklch(0.62 0.006 260)',
  text: 'oklch(0.12 0.006 260)',
  textMuted: 'oklch(0.4 0.006 260)',
  success: 'oklch(0.46 0.16 150)',
  warning: 'oklch(0.55 0.16 70)',
  danger: 'oklch(0.48 0.21 27)',
  info: 'oklch(0.46 0.17 250)',
  sidebarBg: 'oklch(0.97 0.0018 260)',
  sidebarActive: 'oklch(0.88 0.04 265)',
  topbar: 'oklch(1 0 0)',
  chart1: 'oklch(0.45 0.18 265)',
  chart2: 'oklch(0.45 0.18 150)',
  chart3: 'oklch(0.45 0.18 25)',
  chart4: 'oklch(0.45 0.18 300)',
  chart5: 'oklch(0.45 0.18 200)',
};

const HIGH_CONTRAST_DARK: ThemeColorTokens = {
  primary: 'oklch(0.8 0.14 250)',
  primaryFg: 'oklch(0.13 0.02 265)',
  secondary: 'oklch(0.25 0.004 260)',
  accent: 'oklch(0.85 0.12 200)',
  bg: 'oklch(0.13 0.0024 260)',
  surface: 'oklch(0.17 0.0032 260)',
  surfaceRaised: 'oklch(0.22 0.0036 260)',
  border: 'oklch(0.52 0.006 260)',
  text: 'oklch(0.99 0 0)',
  textMuted: 'oklch(0.78 0.004 260)',
  success: 'oklch(0.85 0.19 150)',
  warning: 'oklch(0.88 0.17 88)',
  danger: 'oklch(0.76 0.19 25)',
  info: 'oklch(0.83 0.13 240)',
  sidebarBg: 'oklch(0.11 0.0024 260)',
  sidebarActive: 'oklch(0.32 0.05 265)',
  topbar: 'oklch(0.13 0.0024 260)',
  chart1: 'oklch(0.82 0.15 250)',
  chart2: 'oklch(0.82 0.15 150)',
  chart3: 'oklch(0.82 0.15 30)',
  chart4: 'oklch(0.82 0.15 300)',
  chart5: 'oklch(0.82 0.15 200)',
};

/** The gallery, in display order. Default first — it is the way back. */
export const COLOR_PRESETS: readonly ColorPreset[] = [
  DEFAULT_PRESET,
  preset('Graphite', 'graphite', GRAPHITE_LIGHT, GRAPHITE_DARK),
  preset('Ocean', 'ocean', OCEAN_LIGHT, OCEAN_DARK),
  preset('Forest', 'forest', FOREST_LIGHT, FOREST_DARK),
  preset('Sunset', 'sunset', SUNSET_LIGHT, SUNSET_DARK),
  preset('Rose', 'rose', ROSE_LIGHT, ROSE_DARK),
  preset('Amber', 'amber', AMBER_LIGHT, AMBER_DARK),
  preset('High Contrast', 'highContrast', HIGH_CONTRAST_LIGHT, HIGH_CONTRAST_DARK),
];

/* -------------------------------------------------------------------------- */
/* Font presets                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The Arabic fallback, interposed into EVERY stack immediately after the Latin
 * family and before the generic keyword.
 *
 * Font matching is PER GLYPH: Latin text keeps resolving from the preset's own
 * face (none of which ship Arabic), and only the Arabic characters fall through
 * to IBM Plex Sans Arabic instead of to whatever the system happens to pick.
 * Getting this wrong is not a cosmetic bug — a system fallback breaks the
 * cursive joins.
 */
const AR = "'IBM Plex Sans Arabic'";

export type FontPresetName =
  | 'Inter'
  | 'IBM Plex Sans'
  | 'Manrope'
  | 'DM Sans'
  | 'Space Grotesk'
  | 'Source Serif 4'
  | 'JetBrains Mono'
  | 'IBM Plex Mono';

/**
 * The tokens a font preset owns: the three stacks and the heading weight.
 *
 * DELIBERATELY NOT `fsBase` / `lh` / `ls`. Those are the Typography tab's own
 * word-labelled controls, and a font card that silently reset the reader's size
 * choice would make the two halves of the tab fight each other.
 */
export type FontPatch = Pick<SharedThemeTokens, 'fontBody' | 'fontHead' | 'fontMono' | 'hWeight'>;

/** Key suffix under `theme:fonts.` for a font card's one-line description. */
export type FontPresetKey =
  | 'inter'
  | 'ibmPlexSans'
  | 'manrope'
  | 'dmSans'
  | 'spaceGrotesk'
  | 'sourceSerif'
  | 'jetBrainsMono'
  | 'ibmPlexMono';

export interface FontPresetDef {
  name: FontPresetName;
  labelKey: FontPresetKey;
  /** The family the "Ag أب" specimen is drawn in. */
  previewFamily: string;
  /**
   * Whether `index.html` actually requests this family from Google Fonts.
   *
   * A `false` family is DECLARED, NOT LOADED: the browser uses it if the reader
   * happens to have it installed and silently falls through the stack if not —
   * a picker that does nothing on most machines. The card says so, rather than
   * pretending.
   *
   * EVERY PRESET IS `true` TODAY. WP4.5 shipped five of the eight unloaded
   * because `index.html` was frozen for that work package; WP4.7 added the
   * families to the single `css2` request (one stylesheet, and Google serves
   * only the `unicode-range` subsets a page paints, so an unused family costs
   * no font bytes). The flag stays because it is the CONTRACT with that file: a
   * preset added later starts `false` and only flips once its family is in the
   * `<link>`. It is not decoration — `TypographyPanel` renders the warning off
   * it, and getting it wrong is exactly the failure it was written to prevent.
   */
  bundled: boolean;
  patch: FontPatch;
}

/** Mono stack shared by every non-mono preset: the app's code face. */
const MONO_STACK = `'JetBrains Mono', ${AR}, ui-monospace, monospace`;

/** A sans preset: one family for body and headings, JetBrains Mono for code. */
const sans = (
  name: FontPresetName,
  labelKey: FontPresetKey,
  family: string,
  hWeight: number,
  bundled = false,
): FontPresetDef => ({
  name,
  labelKey,
  previewFamily: family,
  bundled,
  patch: {
    fontBody: `'${family}', ${AR}, ui-sans-serif, system-ui, sans-serif`,
    fontHead: `'${family}', ${AR}, ui-sans-serif, system-ui, sans-serif`,
    fontMono: MONO_STACK,
    hWeight,
  },
});

/** A serif preset — editorial headings and body, sans-free. */
const serif = (
  name: FontPresetName,
  labelKey: FontPresetKey,
  family: string,
  hWeight: number,
  bundled = false,
): FontPresetDef => ({
  name,
  labelKey,
  previewFamily: family,
  bundled,
  patch: {
    fontBody: `'${family}', ${AR}, ui-serif, Georgia, serif`,
    fontHead: `'${family}', ${AR}, ui-serif, Georgia, serif`,
    fontMono: MONO_STACK,
    hWeight,
  },
});

/** A mono preset: the whole UI in the code face. Terminal-flavoured, on purpose. */
const mono = (
  name: FontPresetName,
  labelKey: FontPresetKey,
  family: string,
  hWeight: number,
  bundled = false,
): FontPresetDef => ({
  name,
  labelKey,
  previewFamily: family,
  bundled,
  patch: {
    fontBody: `'${family}', ${AR}, ui-monospace, monospace`,
    fontHead: `'${family}', ${AR}, ui-monospace, monospace`,
    fontMono: `'${family}', ${AR}, ui-monospace, monospace`,
    hWeight,
  },
});

/**
 * Eight typography presets, every one of them actually LOADED.
 *
 * The `true` on each line is a claim about `apps/web/index.html`: that family
 * is named in its single Google Fonts request. Five of these were `false` when
 * WP4.5 shipped — declared but never fetched, so choosing one did nothing on a
 * machine without the family installed — and WP4.7 closed that by extending the
 * `<link>`. Adding a ninth preset means editing that file first.
 */
export const FONT_PRESETS: readonly FontPresetDef[] = [
  sans('Inter', 'inter', 'Inter', 600, true),
  // Plex Sans is the Latin sibling of the Arabic fallback — the one preset
  // where a mixed-script line is drawn by two members of the same superfamily.
  // Requested as STATIC weights for that reason: its Arabic sibling has to be
  // static (see `index.html`), and a variable Latin half would disagree with it
  // at the same nominal weight.
  sans('IBM Plex Sans', 'ibmPlexSans', 'IBM Plex Sans', 600, true),
  sans('Manrope', 'manrope', 'Manrope', 700, true),
  sans('DM Sans', 'dmSans', 'DM Sans', 600, true),
  sans('Space Grotesk', 'spaceGrotesk', 'Space Grotesk', 600, true),
  serif('Source Serif 4', 'sourceSerif', 'Source Serif 4', 600, true),
  mono('JetBrains Mono', 'jetBrainsMono', 'JetBrains Mono', 600, true),
  mono('IBM Plex Mono', 'ibmPlexMono', 'IBM Plex Mono', 600, true),
];

/* -------------------------------------------------------------------------- */
/* Dimension groups — word labels, never raw px                                */
/* -------------------------------------------------------------------------- */

/**
 * One choice in a segmented control. `patch` may carry SEVERAL tokens: "corners"
 * is one decision to a reader and four radii to the token layer, and exposing
 * `--card-radius` as its own row is how a theme editor turns into a spreadsheet.
 */
/**
 * Key suffix under `theme:options.`. Deliberately keyed by the WORD, not by
 * group + index: `square` / `subtle` / `rounded` / `pill` mean the same thing
 * wherever they appear, so one catalog entry translates every group that uses
 * them.
 */
export type DimensionOptionKey =
  | 'square'
  | 'subtle'
  | 'rounded'
  | 'pill'
  | 'comfortable'
  | 'compact'
  | 'cozy'
  | 'spacious'
  | 'narrow'
  | 'default'
  | 'wide'
  | 'boxed'
  | 'fluid'
  | 'none'
  | 'soft'
  | 'medium'
  | 'bold'
  | 'instant'
  | 'fast'
  | 'normal'
  | 'calm'
  | 'filled'
  | 'line'
  | 'tight'
  | 'relaxed'
  | 'airy';

/** Key suffix under `theme:groups.` (label) and `theme:hints.` (description). */
export type DimensionGroupKey =
  | 'radius'
  | 'density'
  | 'spacing'
  | 'sidebar'
  | 'content'
  | 'shadow'
  | 'speed'
  | 'chartStyle'
  | 'fontSize'
  | 'leading'
  | 'tracking';

export interface DimensionOption {
  labelKey: DimensionOptionKey;
  patch: Partial<SharedThemeTokens>;
}

export interface DimensionGroup {
  key: DimensionGroupKey;
  options: readonly DimensionOption[];
}

/** Corners: all four radii move together, from square to pill. */
const RADIUS_GROUP: DimensionGroup = {
  key: 'radius',
  options: [
    { labelKey: 'square', patch: { radius: 0, cardRadius: 0, btnRadius: 0, inputRadius: 0 } },
    { labelKey: 'subtle', patch: { radius: 6, cardRadius: 8, btnRadius: 6, inputRadius: 6 } },
    { labelKey: 'rounded', patch: { radius: 10, cardRadius: 14, btnRadius: 10, inputRadius: 10 } },
    { labelKey: 'pill', patch: { radius: 14, cardRadius: 20, btnRadius: 24, inputRadius: 14 } },
  ],
};

/** Density: the one enum token. `applyTheme` multiplies the spacing tokens by it. */
const DENSITY_GROUP: DimensionGroup = {
  key: 'density',
  options: [
    { labelKey: 'comfortable', patch: { density: 'comfortable' } },
    { labelKey: 'compact', patch: { density: 'compact' } },
  ],
};

/** Spacing: page padding, card padding and the grid gap as one "roominess" dial. */
const SPACING_GROUP: DimensionGroup = {
  key: 'spacing',
  options: [
    { labelKey: 'cozy', patch: { pagePad: 14, cardPad: 12, gap: 8, rowPad: 6 } },
    { labelKey: 'comfortable', patch: { pagePad: 20, cardPad: 16, gap: 12, rowPad: 8 } },
    { labelKey: 'spacious', patch: { pagePad: 28, cardPad: 22, gap: 18, rowPad: 11 } },
  ],
};

/** Sidebar: expanded and collapsed widths together. */
const SIDEBAR_GROUP: DimensionGroup = {
  key: 'sidebar',
  options: [
    { labelKey: 'narrow', patch: { sidebarW: 208, sidebarWc: 52 } },
    { labelKey: 'default', patch: { sidebarW: 232, sidebarWc: 56 } },
    { labelKey: 'wide', patch: { sidebarW: 272, sidebarWc: 64 } },
  ],
};

/** Content width — where a wide screen stops stretching the reading column. */
const CONTENT_GROUP: DimensionGroup = {
  key: 'content',
  options: [
    { labelKey: 'boxed', patch: { contentMax: 1200 } },
    { labelKey: 'wide', patch: { contentMax: 1600 } },
    // The schema caps `contentMax` at 2400, so "fluid" is the cap, not Infinity.
    { labelKey: 'fluid', patch: { contentMax: 2400 } },
  ],
};

/** Elevation: indexes the shadow ramp in `theme-tokens.ts`. */
const SHADOW_GROUP: DimensionGroup = {
  key: 'shadow',
  options: [
    { labelKey: 'none', patch: { shadowLevel: 0 } },
    { labelKey: 'soft', patch: { shadowLevel: 1 } },
    { labelKey: 'medium', patch: { shadowLevel: 2 } },
    { labelKey: 'bold', patch: { shadowLevel: 3 } },
  ],
};

/** Motion. `Instant` (0ms) is a real accessibility setting, not a joke option. */
const SPEED_GROUP: DimensionGroup = {
  key: 'speed',
  options: [
    { labelKey: 'instant', patch: { speed: 0 } },
    { labelKey: 'fast', patch: { speed: 90 } },
    { labelKey: 'normal', patch: { speed: 130 } },
    { labelKey: 'calm', patch: { speed: 240 } },
  ],
};

/** Chart fill style — the one non-geometry shared enum. */
const CHART_STYLE_GROUP: DimensionGroup = {
  key: 'chartStyle',
  options: [
    { labelKey: 'filled', patch: { chartStyle: 'filled' } },
    { labelKey: 'line', patch: { chartStyle: 'line' } },
  ],
};

/** Base font size. The px values stay here; the reader sees three words. */
const FONT_SIZE_GROUP: DimensionGroup = {
  key: 'fontSize',
  options: [
    { labelKey: 'compact', patch: { fsBase: 12.5 } },
    { labelKey: 'default', patch: { fsBase: 13.5 } },
    { labelKey: 'relaxed', patch: { fsBase: 15 } },
  ],
};

/** Line height. Arabic floors this at 1.7 in `index.css` — see the i18n doc. */
const LEADING_GROUP: DimensionGroup = {
  key: 'leading',
  options: [
    { labelKey: 'tight', patch: { lh: 1.35 } },
    { labelKey: 'normal', patch: { lh: 1.5 } },
    { labelKey: 'relaxed', patch: { lh: 1.65 } },
    { labelKey: 'airy', patch: { lh: 1.8 } },
  ],
};

/** Letter spacing, in em so it scales with the size. Zeroed for Arabic in CSS. */
const TRACKING_GROUP: DimensionGroup = {
  key: 'tracking',
  options: [
    { labelKey: 'tight', patch: { ls: -0.014 } },
    { labelKey: 'default', patch: { ls: -0.006 } },
    { labelKey: 'normal', patch: { ls: 0 } },
    { labelKey: 'wide', patch: { ls: 0.012 } },
  ],
};

/** The Typography tab's controls, under the font cards. */
export const TYPOGRAPHY_GROUPS: readonly DimensionGroup[] = [
  FONT_SIZE_GROUP,
  LEADING_GROUP,
  TRACKING_GROUP,
];

/** The Layout tab's controls. */
export const LAYOUT_GROUPS: readonly DimensionGroup[] = [
  RADIUS_GROUP,
  DENSITY_GROUP,
  SPACING_GROUP,
  SIDEBAR_GROUP,
  CONTENT_GROUP,
  SHADOW_GROUP,
  SPEED_GROUP,
  CHART_STYLE_GROUP,
];

/* -------------------------------------------------------------------------- */
/* Token editor grouping                                                       */
/* -------------------------------------------------------------------------- */

/** Key suffix under `theme:tokenGroups.` for a section of the token editor. */
export type TokenGroupKey = 'surfaces' | 'text' | 'accent' | 'semantic' | 'sidebar' | 'charts';

export interface TokenGroup {
  key: TokenGroupKey;
  tokens: ReadonlyArray<keyof ThemeColorTokens>;
}

/**
 * The 22 colour tokens, grouped for the editor.
 *
 * BY ROLE, NOT ALPHABETICALLY. Someone editing a theme thinks "the surfaces are
 * too warm" or "the charts clash", never "I need the token that starts with S".
 * Every token appears exactly once, and `theme-presets.test.ts` asserts the
 * groups cover the schema — a token added to the contract and forgotten here
 * would silently become uneditable.
 */
export const TOKEN_GROUPS: readonly TokenGroup[] = [
  { key: 'surfaces', tokens: ['bg', 'surface', 'surfaceRaised', 'border', 'secondary'] },
  { key: 'text', tokens: ['text', 'textMuted'] },
  { key: 'accent', tokens: ['primary', 'primaryFg', 'accent'] },
  { key: 'semantic', tokens: ['success', 'warning', 'danger', 'info'] },
  { key: 'sidebar', tokens: ['sidebarBg', 'sidebarActive', 'topbar'] },
  { key: 'charts', tokens: ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'] },
];

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Is this option the current one? An option is active when EVERY token it
 * patches already holds the option's value — which is what lets a multi-token
 * group ("corners") light up only when all four radii agree, and correctly show
 * nothing selected after a hand-import that sits between two presets.
 */
export function isOptionActive(option: DimensionOption, shared: SharedThemeTokens): boolean {
  return Object.entries(option.patch).every(
    ([key, value]) => shared[key as keyof SharedThemeTokens] === value,
  );
}

const sameColors = (a: ThemeColorTokens, b: ThemeColorTokens): boolean =>
  (Object.keys(a) as Array<keyof ThemeColorTokens>).every((key) => a[key] === b[key]);

/**
 * Which preset is the document currently wearing, if any.
 *
 * STRUCTURAL, not a stored label. The shared `themePreset` enum cannot yet hold
 * the seven new names (see {@link ColorPresetName}), and a label is a lie the
 * moment someone nudges one token anyway — comparing the 44 colours answers the
 * question the gallery is actually asking: "does this card describe what I am
 * looking at?"
 */
export function matchColorPreset(theme: ThemeDocument): ColorPreset | null {
  return (
    COLOR_PRESETS.find(
      (candidate) =>
        sameColors(candidate.light, theme.light) && sameColors(candidate.dark, theme.dark),
    ) ?? null
  );
}

/** The same idea for typography: the three stacks and the heading weight. */
export function matchFontPreset(shared: SharedThemeTokens): FontPresetDef | null {
  return (
    FONT_PRESETS.find(
      (candidate) =>
        candidate.patch.fontBody === shared.fontBody &&
        candidate.patch.fontHead === shared.fontHead &&
        candidate.patch.fontMono === shared.fontMono &&
        candidate.patch.hWeight === shared.hWeight,
    ) ?? null
  );
}
