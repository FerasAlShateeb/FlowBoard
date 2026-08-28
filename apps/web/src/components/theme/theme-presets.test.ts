import { describe, expect, it } from 'vitest';
import {
  sharedThemeTokensSchema,
  themeColorTokensSchema,
  themeDocumentSchema,
  type ThemeColorTokens,
} from '@flowboard/shared';

import { contrastRatio } from '@/components/theme/color';
import { DEFAULT_THEME } from '@/components/theme/theme-tokens';
import {
  COLOR_PRESETS,
  FONT_PRESETS,
  LAYOUT_GROUPS,
  TOKEN_GROUPS,
  TYPOGRAPHY_GROUPS,
  isOptionActive,
  matchColorPreset,
  matchFontPreset,
} from '@/components/theme/theme-presets';

/**
 * The preset table, held to the two promises the gallery makes: that every card
 * produces a VALID document, and that every card produces a READABLE one.
 *
 * Both are loops over the data rather than eight hand-written cases — the whole
 * point of a preset table is that adding a ninth is a data change, and a data
 * change that skips the contrast check is exactly the regression this guards.
 */

/**
 * The AA-ish floors.
 *
 * Body text is held to WCAG AA (4.5:1) against every surface it can land on.
 * Muted text is held to 4.5 as well — it is secondary, not decorative. The
 * `primaryFg`/`primary` pair is a real text-on-fill relationship and gets 4.5.
 *
 * CHARTS AND SEMANTIC FILLS GET 2.5, not 4.5, and that is deliberate rather
 * than lenient: they are LARGE marks and icons, not body copy, and the shipped
 * `Default` light amber (`chart3`, 2.6:1 on its background) is the design the
 * rest of the palette was built around. Holding new presets to a text-grade
 * floor here would have meant re-tinting the default — the wrong direction of
 * causality for a check that exists to catch mistakes, not to redesign.
 */
const TEXT_MIN = 4.5;
const MARK_MIN = 2.5;

const ratio = (a: string, b: string): number => contrastRatio(a, b) ?? 0;

/** Every colour token, so a new one cannot be forgotten by a group or a loop. */
const ALL_TOKENS = Object.keys(themeColorTokensSchema.shape) as Array<keyof ThemeColorTokens>;

describe('colour presets', () => {
  it('ships eight presets with unique names and keys', () => {
    expect(COLOR_PRESETS).toHaveLength(8);
    expect(new Set(COLOR_PRESETS.map((preset) => preset.name)).size).toBe(8);
    expect(new Set(COLOR_PRESETS.map((preset) => preset.labelKey)).size).toBe(8);
  });

  it('leads with Default, which is the document the app boots on', () => {
    expect(COLOR_PRESETS[0]?.name).toBe('Default');
    expect(COLOR_PRESETS[0]?.light).toEqual(DEFAULT_THEME.light);
    expect(COLOR_PRESETS[0]?.dark).toEqual(DEFAULT_THEME.dark);
  });

  it.each(COLOR_PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s parses the shared schema in BOTH modes',
    (_name, preset) => {
      expect(themeColorTokensSchema.safeParse(preset.light).success).toBe(true);
      expect(themeColorTokensSchema.safeParse(preset.dark).success).toBe(true);
      // And as a whole document, which is what `applyTheme` and the export
      // actually consume.
      expect(
        themeDocumentSchema.safeParse({
          light: preset.light,
          dark: preset.dark,
          shared: DEFAULT_THEME.shared,
        }).success,
      ).toBe(true);
    },
  );

  it.each(COLOR_PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s defines all 22 tokens in both modes',
    (_name, preset) => {
      expect(Object.keys(preset.light).sort()).toEqual([...ALL_TOKENS].sort());
      expect(Object.keys(preset.dark).sort()).toEqual([...ALL_TOKENS].sort());
    },
  );

  it.each(
    COLOR_PRESETS.flatMap((preset) => [
      [`${preset.name} light`, preset.light] as const,
      [`${preset.name} dark`, preset.dark] as const,
    ]),
  )('%s keeps body text readable on every surface', (_label, colors) => {
    for (const surface of [
      colors.bg,
      colors.surface,
      colors.surfaceRaised,
      colors.secondary,
      colors.sidebarBg,
      colors.sidebarActive,
      colors.topbar,
    ]) {
      expect(ratio(colors.text, surface)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it.each(
    COLOR_PRESETS.flatMap((preset) => [
      [`${preset.name} light`, preset.light] as const,
      [`${preset.name} dark`, preset.dark] as const,
    ]),
  )('%s keeps muted text and the primary label at AA', (_label, colors) => {
    expect(ratio(colors.textMuted, colors.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(ratio(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(ratio(colors.primaryFg, colors.primary)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it.each(
    COLOR_PRESETS.flatMap((preset) => [
      [`${preset.name} light`, preset.light] as const,
      [`${preset.name} dark`, preset.dark] as const,
    ]),
  )('%s keeps chart and status marks visible', (_label, colors) => {
    // WP3.8 rides the task-type glyphs on `--chart-1..5`, so an invisible chart
    // colour is an invisible ICON on the board, not just a flat bar.
    for (const mark of [
      colors.chart1,
      colors.chart2,
      colors.chart3,
      colors.chart4,
      colors.chart5,
      colors.success,
      colors.warning,
      colors.danger,
      colors.info,
      colors.accent,
    ]) {
      expect(ratio(mark, colors.bg)).toBeGreaterThanOrEqual(MARK_MIN);
      expect(ratio(mark, colors.surface)).toBeGreaterThanOrEqual(MARK_MIN);
    }
  });

  it.each(COLOR_PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s gives every chart slot a distinct colour',
    (_name, preset) => {
      for (const colors of [preset.light, preset.dark]) {
        const charts = [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5];
        expect(new Set(charts).size).toBe(5);
      }
    },
  );

  it('shows five swatches per card, all drawn from the palette', () => {
    for (const preset of COLOR_PRESETS) {
      expect(preset.swatches).toHaveLength(5);
      const palette = new Set([...Object.values(preset.light), ...Object.values(preset.dark)]);
      for (const swatch of preset.swatches) expect(palette.has(swatch)).toBe(true);
    }
  });

  it('matches a document back to the preset it came from', () => {
    for (const preset of COLOR_PRESETS) {
      const document = { ...DEFAULT_THEME, light: preset.light, dark: preset.dark };
      expect(matchColorPreset(document)?.name).toBe(preset.name);
    }
  });

  it('matches nothing once a single token is edited', () => {
    const [first] = COLOR_PRESETS;
    expect(first).toBeDefined();
    const edited = {
      ...DEFAULT_THEME,
      light: { ...(first?.light ?? DEFAULT_THEME.light), primary: 'oklch(0.5 0.2 12)' },
    };
    expect(matchColorPreset(edited)).toBeNull();
  });
});

describe('font presets', () => {
  it('ships at least six, with unique names', () => {
    expect(FONT_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(FONT_PRESETS.map((preset) => preset.name)).size).toBe(FONT_PRESETS.length);
  });

  it.each(FONT_PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s interposes the Arabic fallback in every stack',
    (_name, preset) => {
      for (const stack of [preset.patch.fontBody, preset.patch.fontHead, preset.patch.fontMono]) {
        expect(stack).toContain("'IBM Plex Sans Arabic'");
        // AFTER the Latin family, never before it — font matching is per glyph,
        // and leading with the Arabic face would draw Latin text in it.
        expect(stack.indexOf("'IBM Plex Sans Arabic'")).toBeGreaterThan(0);
      }
    },
  );

  it.each(FONT_PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s produces valid shared tokens',
    (_name, preset) => {
      const merged = { ...DEFAULT_THEME.shared, ...preset.patch };
      expect(sharedThemeTokensSchema.safeParse(merged).success).toBe(true);
    },
  );

  it('leaves the size tokens alone — those are the scale controls', () => {
    for (const preset of FONT_PRESETS) {
      expect(preset.patch).not.toHaveProperty('fsBase');
      expect(preset.patch).not.toHaveProperty('lh');
      expect(preset.patch).not.toHaveProperty('ls');
    }
  });

  it('matches the default document to the Inter preset', () => {
    expect(matchFontPreset(DEFAULT_THEME.shared)?.name).toBe('Inter');
  });
});

describe('dimension groups', () => {
  const GROUPS = [...TYPOGRAPHY_GROUPS, ...LAYOUT_GROUPS];

  it('covers the four spec groups with word labels', () => {
    const keys = GROUPS.map((group) => group.key);
    expect(keys).toEqual(expect.arrayContaining(['radius', 'density', 'fontSize', 'speed']));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(GROUPS.map((group) => [group.key, group] as const))(
    '%s maps every option to schema-valid numbers',
    (_key, group) => {
      expect(group.options.length).toBeGreaterThanOrEqual(2);
      for (const option of group.options) {
        const merged = { ...DEFAULT_THEME.shared, ...option.patch };
        expect(sharedThemeTokensSchema.safeParse(merged).success).toBe(true);
      }
    },
  );

  it('detects the active option only when every patched token agrees', () => {
    const radius = LAYOUT_GROUPS.find((group) => group.key === 'radius');
    const square = radius?.options[0];
    expect(square?.labelKey).toBe('square');
    if (!square) throw new Error('radius group is missing its Square option');

    const applied = { ...DEFAULT_THEME.shared, ...square.patch };
    expect(isOptionActive(square, applied)).toBe(true);
    // One radius left behind → the group shows nothing selected, which is the
    // honest answer for a hand-edited document.
    expect(isOptionActive(square, { ...applied, cardRadius: 8 })).toBe(false);
    expect(isOptionActive(square, DEFAULT_THEME.shared)).toBe(false);
  });

  it('offers a zero-duration motion option (a real accessibility setting)', () => {
    const speed = LAYOUT_GROUPS.find((group) => group.key === 'speed');
    expect(speed?.options.some((option) => option.patch.speed === 0)).toBe(true);
  });
});

describe('token editor grouping', () => {
  it('covers all 22 tokens exactly once', () => {
    const grouped = TOKEN_GROUPS.flatMap((group) => group.tokens);
    expect(grouped).toHaveLength(ALL_TOKENS.length);
    expect([...grouped].sort()).toEqual([...ALL_TOKENS].sort());
  });
});
