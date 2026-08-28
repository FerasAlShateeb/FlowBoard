/**
 * The theme's device-local persistence — and specifically its FAILURE modes.
 *
 * This module runs at MODULE SCOPE during boot, from `useThemeStore`, before
 * React exists. An exception here is not a caught render error, it is a blank
 * page. Every read is therefore both zod-validated and try/catch-wrapped, and
 * the four ways it can go wrong — no value, malformed JSON, a payload from an
 * older schema, and a browser whose `localStorage` throws on access — must all
 * degrade to "use the default", never to a throw.
 *
 * `useThemeStore.test.ts` covers the studio's state machine on top of this;
 * what is here is the layer underneath it, driven directly so the storage can
 * actually be broken.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME } from '@/components/theme/theme-tokens';
import {
  DARK_STORAGE_KEY,
  THEME_STORAGE_KEY,
  clearStoredTheme,
  loadStoredDark,
  loadStoredTheme,
  saveStoredDark,
  saveStoredTheme,
} from '@/components/theme/theme-storage';

/** Replace `localStorage` with one that throws on every operation. */
function breakStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    },
    removeItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the storage keys', () => {
  it('follow the `fb-<name>-v1` convention, and are two DIFFERENT keys', () => {
    // The document says what light and dark look like; the flag says which one
    // you are in. Sharing a key would make switching preset reset the mode.
    expect(THEME_STORAGE_KEY).toBe('fb-theme-v1');
    expect(DARK_STORAGE_KEY).toBe('fb-dark-v1');
  });
});

describe('loadStoredTheme', () => {
  it('round-trips a saved document', () => {
    saveStoredTheme(DEFAULT_THEME);

    expect(loadStoredTheme()).toEqual(DEFAULT_THEME);
  });

  it('returns null when nothing has ever been saved', () => {
    expect(loadStoredTheme()).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing during boot', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{"light": ');

    expect(loadStoredTheme()).toBeNull();
  });

  it('returns null for JSON that is not a theme document at all', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '"just a string"');

    expect(loadStoredTheme()).toBeNull();
  });

  it('REJECTS a document from an older schema instead of half-applying it', () => {
    // A release that adds a token must not resurrect a saved document missing
    // it — half a palette is a worse first paint than the default.
    const { radius: _dropped, ...sharedWithoutRadius } = DEFAULT_THEME.shared;
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_THEME, shared: sharedWithoutRadius }),
    );

    expect(loadStoredTheme()).toBeNull();
  });

  it('rejects a colour token carrying a CSS declaration terminator', () => {
    // The stored payload is user-editable text that is written into a style
    // attribute; the schema is what stops it becoming an injection point.
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_THEME,
        dark: { ...DEFAULT_THEME.dark, primary: '#fff; background: url(evil)' },
      }),
    );

    expect(loadStoredTheme()).toBeNull();
  });

  it('returns null when localStorage itself throws', () => {
    breakStorage();

    expect(loadStoredTheme()).toBeNull();
  });
});

describe('saveStoredTheme and clearStoredTheme', () => {
  it('writes a document that loads back', () => {
    saveStoredTheme(DEFAULT_THEME);

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeTruthy();
    expect(loadStoredTheme()).toEqual(DEFAULT_THEME);
  });

  it('clears it again', () => {
    saveStoredTheme(DEFAULT_THEME);

    clearStoredTheme();

    expect(loadStoredTheme()).toBeNull();
  });

  it('swallows a quota failure — the theme still applies for this session', () => {
    breakStorage();

    expect(() => {
      saveStoredTheme(DEFAULT_THEME);
    }).not.toThrow();
  });

  it('swallows a clear that cannot reach storage', () => {
    breakStorage();

    expect(() => {
      clearStoredTheme();
    }).not.toThrow();
  });
});

describe('loadStoredDark — null is not false', () => {
  it('answers null when nothing is stored, so the dark-first default wins', () => {
    // The whole reason this returns a nullable: an unconfigured visitor gets
    // FlowBoard's dark default even on a light-preferring OS, while somebody
    // who explicitly chose light keeps it across reloads.
    expect(loadStoredDark()).toBeNull();
  });

  it('round-trips both explicit choices', () => {
    saveStoredDark(true);
    expect(loadStoredDark()).toBe(true);

    saveStoredDark(false);
    expect(loadStoredDark()).toBe(false);
  });

  it('stores the flag as "1"/"0", not as JSON', () => {
    saveStoredDark(true);
    expect(localStorage.getItem(DARK_STORAGE_KEY)).toBe('1');

    saveStoredDark(false);
    expect(localStorage.getItem(DARK_STORAGE_KEY)).toBe('0');
  });

  it('reads any other stored value as light rather than throwing', () => {
    localStorage.setItem(DARK_STORAGE_KEY, 'true');

    expect(loadStoredDark()).toBe(false);
  });

  it('answers null when localStorage throws', () => {
    breakStorage();

    expect(loadStoredDark()).toBeNull();
  });

  it('swallows a failed write of the preference', () => {
    breakStorage();

    expect(() => {
      saveStoredDark(true);
    }).not.toThrow();
  });
});
