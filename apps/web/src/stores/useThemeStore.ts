import { create } from 'zustand';
import {
  themeDocumentSchema,
  type SharedThemeTokens,
  type ThemeColorTokens,
  type ThemeDocument,
  type ThemeMode,
} from '@flowboard/shared';
import { DEFAULT_THEME, applyTheme } from '@/components/theme/theme-tokens';
import {
  COLOR_PRESETS,
  FONT_PRESETS,
  type ColorPresetName,
  type FontPresetName,
} from '@/components/theme/theme-presets';
import {
  loadStoredDark,
  loadStoredTheme,
  saveStoredDark,
  saveStoredTheme,
} from '@/components/theme/theme-storage';

/**
 * The theme store — UI state only (Zustand's remit in this app; server state
 * belongs to TanStack Query).
 *
 * PRE-PAINT BY CONSTRUCTION. The initial document is read from localStorage at
 * MODULE SCOPE and `applyTheme()` runs at the bottom of this file, so merely
 * importing this module puts every token and the `dark` class on `<html>`.
 * `main.tsx` therefore does nothing more than `import '@/stores/useThemeStore'`
 * before `createRoot` — no effect, no first-render flash.
 *
 * Persistence is EXPLICIT (`save()`), not automatic on every keystroke: the
 * Theme Studio's colour pickers fire continuously while dragging, and writing
 * localStorage on each frame is both wasteful and makes "cancel" impossible.
 * The dark toggle is the exception — it persists immediately, because it is a
 * committed decision rather than a live preview.
 *
 * EVERY MUTATION APPLIES LIVE, THOUGH. `setTheme` is the single write path and
 * it always calls `applyTheme()`, so the whole app — not a sandboxed preview
 * pane — repaints as you edit. That is the honest preview, and it is why the
 * studio needs {@link ThemeState.dirty} and a leave guard rather than a Cancel
 * button: what you are looking at IS the change.
 */

export type ChartStyle = SharedThemeTokens['chartStyle'];
/** Which of the document's two palettes is being read or edited. */
export type { ThemeMode };

/**
 * Why an import failed, as a CODE rather than a message: the store is not the
 * place that knows which language the reader speaks.
 *
 * `json` — not parseable at all. `schema` — parsed, but not a theme document
 * (a missing token, an out-of-range dimension, a colour string carrying a `;`).
 */
export type ThemeImportError = 'json' | 'schema';

export type ThemeImportResult = { ok: true } | { ok: false; error: ThemeImportError };

interface ThemeState {
  theme: ThemeDocument;
  dark: boolean;
  /** True when the live document differs from what is persisted. */
  dirty: boolean;
  /**
   * Derived getter — the reports dashboard reads the active style from here.
   *
   * Its one consumer is `CumulativeFlowChart`, the dashboard's only filled
   * chart (every other one is already a line), via `fillOpacityFor`. It is a
   * getter rather than a plain selector so a component subscribes to the
   * derived PRIMITIVE and not to the whole theme document — a colour-picker
   * drag would otherwise re-render the chart on every frame.
   */
  chartStyle: () => ChartStyle;
  setDark: (dark: boolean) => void;
  toggleDark: () => void;
  setTheme: (theme: ThemeDocument) => void;
  /** Swap BOTH palettes to a gallery preset. Shared tokens are untouched. */
  applyPreset: (name: ColorPresetName) => void;
  /** Swap the three font stacks and the heading weight. Sizes are untouched. */
  applyFontPreset: (name: FontPresetName) => void;
  /** Patch one mode's colour set (Theme Studio colour editors). */
  patchColors: (mode: ThemeMode, patch: Partial<ThemeColorTokens>) => void;
  /** Patch the mode-independent tokens (fonts, dimensions, density, speed). */
  patchShared: (patch: Partial<SharedThemeTokens>) => void;
  /** Restore the default preset. Does not touch localStorage until `save()`. */
  resetToDefault: () => void;
  /** @deprecated Wave-1 name for {@link ThemeState.resetToDefault}. */
  reset: () => void;
  /** Persist the current document to `fb-theme-v1` and clear `dirty`. */
  save: () => void;
  /** Re-read the persisted document (used after an import flow). */
  load: () => void;
  /** The document as pretty JSON — what the Export button downloads. */
  exportTheme: () => string;
  /** Parse, validate and APPLY a pasted/uploaded document. Never throws. */
  importTheme: (json: string) => ThemeImportResult;
}

/**
 * A key-order-independent fingerprint of a document, used only to answer "is
 * this dirty?".
 *
 * `JSON.stringify` alone would not do: a document that came back from
 * `themeDocumentSchema.parse()` has the SCHEMA's key order, one built by
 * spreading a preset has the literal's, and the two can be the same theme with
 * different bytes. Sorting the keys makes the comparison about VALUES, which is
 * what "dirty" means — and it is what lets an edit-then-undo settle back to
 * clean instead of leaving the Save button lit forever.
 */
function fingerprint(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${fingerprint(item)}`);
  return `{${entries.join(',')}}`;
}

const storedTheme = loadStoredTheme();
const initialTheme = storedTheme ?? DEFAULT_THEME;

/**
 * The baseline `dirty` is measured against: the persisted document, or — when
 * nothing is stored — the default. Module-level rather than in the store,
 * because it changes ONLY on save/load, not on every edit.
 */
let savedFingerprint = fingerprint(initialTheme);

/**
 * DEFAULT MODE IS DARK. FlowBoard is a dark-first product (plan §Design), so an
 * unconfigured visitor gets dark even on a light-preferring OS. Only an
 * explicit stored choice overrides it — `loadStoredDark()` returns `null`, not
 * `false`, when nothing is saved, which is what keeps those two cases apart.
 */
const initialDark = loadStoredDark() ?? true;

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: initialTheme,
  dark: initialDark,
  dirty: false,

  chartStyle: () => get().theme.shared.chartStyle,

  setDark: (dark) => {
    set({ dark });
    saveStoredDark(dark);
    applyTheme(get().theme, dark);
  },

  toggleDark: () => {
    get().setDark(!get().dark);
  },

  setTheme: (theme) => {
    set({ theme, dirty: fingerprint(theme) !== savedFingerprint });
    applyTheme(theme, get().dark);
  },

  /**
   * Apply a colour preset, recording its REAL name.
   *
   * Until WP4.7 widened `themePresetSchema` past `Default | Imported`, this
   * wrote `undefined` for every other preset — a document persisting
   * `themePreset: 'Ocean'` would have failed `safeParse` on the next boot and
   * silently dropped the whole theme. The enum now carries all eight names, so
   * the label is honest.
   *
   * THE LABEL IS STILL NOT THE AUTHORITY. `matchColorPreset()` resolves the
   * active gallery card STRUCTURALLY, by comparing token blocks, and that stays
   * the case: apply Ocean, hand-edit one colour, and the document keeps saying
   * `'Ocean'` while the gallery correctly highlights nothing. Writing the name
   * buys a truthful export file and a readable persisted document, not a
   * shortcut for the gallery.
   */
  applyPreset: (name) => {
    const preset = COLOR_PRESETS.find((candidate) => candidate.name === name);
    if (!preset) return;
    const { theme } = get();
    get().setTheme({
      ...theme,
      light: preset.light,
      dark: preset.dark,
      themePreset: preset.name,
    });
  },

  /** Same contract for typography — see {@link applyPreset}. */
  applyFontPreset: (name) => {
    const preset = FONT_PRESETS.find((candidate) => candidate.name === name);
    if (!preset) return;
    const { theme } = get();
    get().setTheme({
      ...theme,
      shared: { ...theme.shared, ...preset.patch },
      fontPreset: preset.name,
    });
  },

  patchColors: (mode, patch) => {
    const { theme } = get();
    get().setTheme({ ...theme, [mode]: { ...theme[mode], ...patch } });
  },

  patchShared: (patch) => {
    const { theme } = get();
    get().setTheme({ ...theme, shared: { ...theme.shared, ...patch } });
  },

  resetToDefault: () => {
    get().setTheme(DEFAULT_THEME);
  },

  reset: () => {
    get().resetToDefault();
  },

  save: () => {
    const { theme } = get();
    saveStoredTheme(theme);
    savedFingerprint = fingerprint(theme);
    set({ dirty: false });
  },

  load: () => {
    const stored = loadStoredTheme();
    if (!stored) return;
    savedFingerprint = fingerprint(stored);
    get().setTheme(stored);
  },

  // Two spaces, because a theme file is something people read and hand-edit.
  exportTheme: () => JSON.stringify(get().theme, null, 2),

  importTheme: (json) => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, error: 'json' };
    }

    const parsed = themeDocumentSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'schema' };

    // `Imported` is the STORED MARKER for "matches no preset", not a display
    // label — it stays English and is one of the two values the shared enum
    // actually accepts.
    get().setTheme({ ...parsed.data, themePreset: 'Imported' });
    return { ok: true };
  },
}));

// THE PRE-PAINT APPLY. Module scope on purpose — see the header note. Guarded
// on `document` so the store stays importable from the node unit suites.
if (typeof document !== 'undefined') {
  applyTheme(initialTheme, initialDark);
}
