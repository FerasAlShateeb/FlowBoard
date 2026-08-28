import { beforeEach, describe, expect, it } from 'vitest';
import { themeDocumentSchema } from '@flowboard/shared';

import { DEFAULT_THEME } from '@/components/theme/theme-tokens';
import { DARK_STORAGE_KEY, THEME_STORAGE_KEY } from '@/components/theme/theme-storage';
import { COLOR_PRESETS, FONT_PRESETS, matchColorPreset } from '@/components/theme/theme-presets';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The studio's state machine: apply, edit, save, reset, export, import.
 *
 * The contract under test is the one the page's footer depends on — **live
 * always, persisted only on Save** — plus the `dirty` flag that makes the leave
 * guard and the disabled Save button correct. `dirty` is deliberately a
 * comparison against what is PERSISTED, not a "something happened" latch, so an
 * edit that is undone settles back to clean; that case has its own test because
 * a latch would pass every other one here.
 */

/** A known non-default preset to apply in the tests below. */
const OCEAN = COLOR_PRESETS.find((preset) => preset.name === 'Ocean');
const PLEX = FONT_PRESETS.find((preset) => preset.name === 'IBM Plex Sans');

if (!OCEAN || !PLEX) throw new Error('preset fixtures are missing');

/** The preset the PERSISTED document is wearing, or `null` if nothing is saved. */
function storedPreset(): string | null {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (!raw) return null;
  const parsed = themeDocumentSchema.safeParse(JSON.parse(raw));
  return parsed.success ? (matchColorPreset(parsed.data)?.name ?? null) : null;
}

beforeEach(() => {
  // `src/test/setup.ts` clears storage first; this re-baselines the singleton
  // store so each test starts saved-and-clean on the default document.
  const store = useThemeStore.getState();
  store.resetToDefault();
  store.save();
});

describe('applying presets', () => {
  it('replaces BOTH palettes and leaves the shared tokens alone', () => {
    useThemeStore.getState().applyPreset('Ocean');
    const { theme } = useThemeStore.getState();

    expect(theme.light).toEqual(OCEAN.light);
    expect(theme.dark).toEqual(OCEAN.dark);
    expect(theme.shared).toEqual(DEFAULT_THEME.shared);
    expect(matchColorPreset(theme)?.name).toBe('Ocean');
  });

  /**
   * WP4.7 widened `themePresetSchema` from `Default | Imported` to all eight
   * gallery names, and the store now records the real one. The property that
   * matters is unchanged and is what this asserts: whatever label is written,
   * the document must still round-trip through the shared schema — a value the
   * schema rejects fails `safeParse` on the next boot and silently drops the
   * ENTIRE theme, which is the failure this test has always been guarding.
   */
  it('records the real preset name, and the document still round-trips', () => {
    for (const preset of COLOR_PRESETS) {
      useThemeStore.getState().applyPreset(preset.name);
      const { theme } = useThemeStore.getState();

      expect(theme.themePreset).toBe(preset.name);
      expect(themeDocumentSchema.safeParse(theme).success).toBe(true);
    }
  });

  it('records the real font-preset name, and that document round-trips too', () => {
    for (const preset of FONT_PRESETS) {
      useThemeStore.getState().applyFontPreset(preset.name);
      const { theme } = useThemeStore.getState();

      expect(theme.fontPreset).toBe(preset.name);
      expect(themeDocumentSchema.safeParse(theme).success).toBe(true);
    }
  });

  /**
   * The label is a RECORD, not a pointer: editing a colour after applying a
   * preset leaves the label saying `'Ocean'` while the structural match — the
   * authority the gallery actually highlights from — correctly reports nothing.
   */
  it('keeps the label after a hand edit, while the structural match drops it', () => {
    useThemeStore.getState().applyPreset('Ocean');
    useThemeStore.getState().patchColors('dark', { primary: '#ff00ff' });
    const { theme } = useThemeStore.getState();

    expect(theme.themePreset).toBe('Ocean');
    expect(matchColorPreset(theme)).toBeNull();
  });

  it('ignores an unknown preset name instead of clearing the theme', () => {
    const before = useThemeStore.getState().theme;
    // Cast: the point of the test is the RUNTIME guard, for a name that reached
    // the store from an older persisted document rather than from the gallery.
    useThemeStore.getState().applyPreset('Nope' as (typeof COLOR_PRESETS)[number]['name']);
    expect(useThemeStore.getState().theme).toBe(before);
  });

  it('swaps the font stacks without touching the size tokens', () => {
    useThemeStore.getState().patchShared({ fsBase: 15 });
    useThemeStore.getState().applyFontPreset('IBM Plex Sans');
    const { shared } = useThemeStore.getState().theme;

    expect(shared.fontBody).toBe(PLEX.patch.fontBody);
    expect(shared.fontMono).toBe(PLEX.patch.fontMono);
    expect(shared.fsBase).toBe(15);
  });
});

describe('patching', () => {
  it('patches one mode without disturbing the other', () => {
    useThemeStore.getState().patchColors('light', { primary: '#123456' });
    const { theme } = useThemeStore.getState();

    expect(theme.light.primary).toBe('#123456');
    expect(theme.dark).toEqual(DEFAULT_THEME.dark);
  });

  it('patches shared tokens', () => {
    useThemeStore.getState().patchShared({ radius: 0, density: 'compact' });
    const { shared } = useThemeStore.getState().theme;

    expect(shared.radius).toBe(0);
    expect(shared.density).toBe('compact');
  });
});

describe('dirty, save and reset', () => {
  it('starts clean and goes dirty on the first edit', () => {
    expect(useThemeStore.getState().dirty).toBe(false);
    useThemeStore.getState().applyPreset('Ocean');
    expect(useThemeStore.getState().dirty).toBe(true);
  });

  it('returns to clean when an edit is undone', () => {
    useThemeStore.getState().patchShared({ radius: 0 });
    expect(useThemeStore.getState().dirty).toBe(true);

    useThemeStore.getState().patchShared({ radius: DEFAULT_THEME.shared.radius });
    expect(useThemeStore.getState().dirty).toBe(false);
  });

  it('persists only on save', () => {
    useThemeStore.getState().applyPreset('Forest');
    // Live everywhere, but the persisted copy is still the baseline document:
    // a session of experimenting is discarded by a reload until Save is hit.
    expect(storedPreset()).toBe('Default');

    useThemeStore.getState().save();
    expect(useThemeStore.getState().dirty).toBe(false);

    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const restored = themeDocumentSchema.safeParse(JSON.parse(raw ?? '{}'));
    expect(restored.success).toBe(true);
    expect(restored.success && matchColorPreset(restored.data)?.name).toBe('Forest');
  });

  it('reset restores the default document and marks it dirty against a saved theme', () => {
    useThemeStore.getState().applyPreset('Rose');
    useThemeStore.getState().save();

    useThemeStore.getState().resetToDefault();
    expect(useThemeStore.getState().theme).toEqual(DEFAULT_THEME);
    // The saved theme is Rose, so "back to default" is itself an unsaved change.
    expect(useThemeStore.getState().dirty).toBe(true);
  });

  it('`reset` is an alias of `resetToDefault`, not a second behaviour', () => {
    // Two names for one action is exactly the shape that drifts; the alias is
    // kept for the older call sites, and this is what says it must stay one.
    useThemeStore.getState().applyPreset('Rose');

    useThemeStore.getState().reset();

    expect(useThemeStore.getState().theme).toEqual(DEFAULT_THEME);
  });

  it('load re-reads the persisted document and clears dirty', () => {
    useThemeStore.getState().applyPreset('Amber');
    useThemeStore.getState().save();
    useThemeStore.getState().patchColors('dark', { primary: '#ffffff' });
    expect(useThemeStore.getState().dirty).toBe(true);

    useThemeStore.getState().load();
    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Amber');
    expect(useThemeStore.getState().dirty).toBe(false);
  });

  it('load is a NO-OP when nothing is persisted — it never wipes a live edit', () => {
    // The Theme Studio calls `load()` to discard changes. With an empty store
    // there is nothing to discard TO, and resetting to the default there would
    // throw away work the user can still see on screen.
    useThemeStore.getState().applyPreset('Ocean');
    localStorage.removeItem(THEME_STORAGE_KEY);

    useThemeStore.getState().load();

    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Ocean');
  });

  it('load survives a corrupted payload the same way', () => {
    useThemeStore.getState().applyPreset('Forest');
    localStorage.setItem(THEME_STORAGE_KEY, '{ not json');

    useThemeStore.getState().load();

    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Forest');
  });
});

describe('dark mode, which is persisted SEPARATELY from the document', () => {
  it('toggles and writes the preference through', () => {
    const before = useThemeStore.getState().dark;

    useThemeStore.getState().toggleDark();

    expect(useThemeStore.getState().dark).toBe(!before);
    expect(localStorage.getItem(DARK_STORAGE_KEY)).toBe(before ? '0' : '1');
  });

  it('round-trips back on a second toggle', () => {
    const before = useThemeStore.getState().dark;

    useThemeStore.getState().toggleDark();
    useThemeStore.getState().toggleDark();

    expect(useThemeStore.getState().dark).toBe(before);
  });

  it('is NOT reset by applying a colour preset — they are different questions', () => {
    useThemeStore.getState().setDark(false);

    useThemeStore.getState().applyPreset('Ocean');

    expect(useThemeStore.getState().dark).toBe(false);
    expect(localStorage.getItem(DARK_STORAGE_KEY)).toBe('0');
  });

  it('does not make the document dirty — the mode is not part of the theme', () => {
    useThemeStore.getState().toggleDark();

    expect(useThemeStore.getState().dirty).toBe(false);
  });
});

describe('chartStyle', () => {
  it('reads straight off the live shared tokens', () => {
    // Charts read this rather than a prop so a Theme Studio edit repaints them
    // without the pages that host them knowing anything about the theme.
    expect(useThemeStore.getState().chartStyle()).toBe(DEFAULT_THEME.shared.chartStyle);
  });

  it('follows a shared patch immediately', () => {
    const next = DEFAULT_THEME.shared.chartStyle === 'filled' ? 'line' : 'filled';

    useThemeStore.getState().patchShared({ chartStyle: next });

    expect(useThemeStore.getState().chartStyle()).toBe(next);
  });
});

describe('export and import', () => {
  it('exports pretty JSON that parses back to the same document', () => {
    useThemeStore.getState().applyPreset('Sunset');
    const json = useThemeStore.getState().exportTheme();

    expect(json).toContain('\n  ');
    expect(JSON.parse(json)).toEqual(useThemeStore.getState().theme);
  });

  it('round-trips export → reset → import', () => {
    useThemeStore.getState().applyPreset('Graphite');
    useThemeStore.getState().patchShared({ radius: 0, speed: 0 });
    const exported = useThemeStore.getState().exportTheme();

    useThemeStore.getState().resetToDefault();
    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Default');

    const result = useThemeStore.getState().importTheme(exported);
    expect(result.ok).toBe(true);

    const { theme } = useThemeStore.getState();
    expect(matchColorPreset(theme)?.name).toBe('Graphite');
    expect(theme.shared.radius).toBe(0);
    expect(theme.shared.speed).toBe(0);
  });

  it('stamps an imported document as `Imported` and leaves it unsaved', () => {
    const result = useThemeStore.getState().importTheme(JSON.stringify(DEFAULT_THEME));
    expect(result.ok).toBe(true);
    expect(useThemeStore.getState().theme.themePreset).toBe('Imported');
    expect(useThemeStore.getState().dirty).toBe(true);
    // An import applies but does not persist — Save is still the only writer.
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}')).toEqual(DEFAULT_THEME);
  });

  it('rejects malformed JSON without touching the live theme', () => {
    const before = useThemeStore.getState().theme;
    const result = useThemeStore.getState().importTheme('{ not json');

    expect(result).toEqual({ ok: false, error: 'json' });
    expect(useThemeStore.getState().theme).toBe(before);
    expect(useThemeStore.getState().dirty).toBe(false);
  });

  it('rejects a document with a missing token', () => {
    const { light, ...rest } = DEFAULT_THEME;
    const partialLight: Record<string, string> = { ...light };
    delete partialLight.chart5;

    const result = useThemeStore
      .getState()
      .importTheme(JSON.stringify({ ...rest, light: partialLight }));

    expect(result).toEqual({ ok: false, error: 'schema' });
    expect(useThemeStore.getState().theme).toEqual(DEFAULT_THEME);
  });

  it('rejects an out-of-range dimension and a colour carrying a CSS injection', () => {
    expect(
      useThemeStore.getState().importTheme(
        JSON.stringify({
          ...DEFAULT_THEME,
          shared: { ...DEFAULT_THEME.shared, radius: 999 },
        }),
      ),
    ).toEqual({ ok: false, error: 'schema' });

    expect(
      useThemeStore.getState().importTheme(
        JSON.stringify({
          ...DEFAULT_THEME,
          // `;` would let a stored theme inject arbitrary declarations through
          // `setProperty` — the schema's character class is the guard.
          light: { ...DEFAULT_THEME.light, primary: 'oklch(0.5 0.1 20); color: red' },
        }),
      ),
    ).toEqual({ ok: false, error: 'schema' });
  });
});
