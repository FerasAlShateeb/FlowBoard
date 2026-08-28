import { themeDocumentSchema, type ThemeDocument } from '@flowboard/shared';

/**
 * Device-local persistence for the Theme Studio document.
 *
 * Every read is zod-VALIDATED and every access is wrapped in try/catch. Both
 * matter at this exact spot: this module runs at module scope during boot (via
 * `useThemeStore`), BEFORE React exists, so an exception here is a blank page —
 * not a caught render error. A corrupted payload, a schema change between
 * releases, a private-mode browser that throws on `localStorage`, or a user who
 * hand-edited the JSON must all degrade to "use the default preset".
 */

/** Theme document key (conventions: `fb-<name>-v1`). */
export const THEME_STORAGE_KEY = 'fb-theme-v1';

/**
 * Dark-mode preference, persisted SEPARATELY from the document. They are
 * different questions: the document says what light and dark look like, this
 * says which one you are in — so switching preset must not reset the mode.
 */
export const DARK_STORAGE_KEY = 'fb-dark-v1';

/** The saved theme, or `null` when there is nothing usable stored. */
export function loadStoredTheme(): ThemeDocument | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = themeDocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Unavailable storage, malformed JSON, or a payload from an older schema.
    return null;
  }
}

export function saveStoredTheme(theme: ThemeDocument): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Storage full or blocked — the theme still applies for this session.
  }
}

export function clearStoredTheme(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * The saved dark preference. `null` means NOTHING IS STORED, which is distinct
 * from `false` — the store falls back to the FlowBoard default (dark) only on
 * `null`, so an explicit "I want light" survives a reload.
 */
export function loadStoredDark(): boolean | null {
  try {
    const raw = localStorage.getItem(DARK_STORAGE_KEY);
    if (raw === null) return null;
    return raw === '1';
  } catch {
    return null;
  }
}

export function saveStoredDark(dark: boolean): void {
  try {
    localStorage.setItem(DARK_STORAGE_KEY, dark ? '1' : '0');
  } catch {
    // ignore
  }
}
