// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyFavicon,
  buildFaviconDataUri,
  buildFaviconSvg,
  initFaviconUpdater,
  resetFaviconUpdaterForTests,
  resolveFaviconColors,
} from '@/components/theme/favicon-updater';
import { COLOR_PRESETS } from '@/components/theme/theme-presets';
import { DEFAULT_THEME } from '@/components/theme/theme-tokens';
import { colorToHex } from '@/components/theme/color';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The live favicon.
 *
 * Three things have to hold, and each has bitten a real implementation of this
 * before: the SVG must carry RESOLVED colours (a browser rasterising a favicon
 * has no CSS custom properties), the data-URI must be escaped (an unencoded `#`
 * truncates the SVG at the first fill), and the subscription must actually fire
 * on a preset change rather than only at boot.
 */

const OCEAN = COLOR_PRESETS.find((preset) => preset.name === 'Ocean');
if (!OCEAN) throw new Error('preset fixture is missing');

const iconHref = (): string =>
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? '';

beforeEach(() => {
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => {
    link.remove();
  });
  resetFaviconUpdaterForTests();
  useThemeStore.getState().resetToDefault();
  useThemeStore.getState().save();
  useThemeStore.getState().setDark(true);
});

describe('mark generation', () => {
  it('paints the tile in `primary` and the glyph in `primaryFg`, as hex', () => {
    const svg = buildFaviconSvg({ primary: 'oklch(0.662 0.166 278)', primaryFg: '#101014' });

    expect(svg).toContain(colorToHex('oklch(0.662 0.166 278)') ?? 'MISSING');
    expect(svg).toContain('#101014');
    // No custom property may survive into the data-URI: nothing resolves it.
    expect(svg).not.toContain('var(--');
    expect(svg).toContain('<svg');
    expect(svg).toContain('rx="14"');
  });

  it('passes through a colour form the converter does not implement', () => {
    const svg = buildFaviconSvg({ primary: 'lab(50% 40 59.5)', primaryFg: '#ffffff' });
    expect(svg).toContain('lab(50% 40 59.5)');
  });

  it('escapes the data-URI so a hex fill cannot truncate it', () => {
    const uri = buildFaviconDataUri({ primary: '#4f46e5', primaryFg: '#ffffff' });

    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(uri).not.toContain('#');
    expect(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))).toContain('#4f46e5');
  });

  it('reads the colours of the ACTIVE mode', () => {
    expect(resolveFaviconColors(DEFAULT_THEME, true)).toEqual({
      primary: DEFAULT_THEME.dark.primary,
      primaryFg: DEFAULT_THEME.dark.primaryFg,
    });
    expect(resolveFaviconColors(DEFAULT_THEME, false).primary).toBe(DEFAULT_THEME.light.primary);
  });
});

describe('applyFavicon', () => {
  it('creates the link when the document has none', () => {
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
    applyFavicon('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(link?.type).toBe('image/svg+xml');
  });

  it('reuses the existing link rather than stacking new ones', () => {
    applyFavicon('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');
    applyFavicon('data:image/svg+xml,%3Csvg/%3E');
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });
});

describe('initFaviconUpdater', () => {
  it('paints immediately and follows a preset change', () => {
    initFaviconUpdater();
    const atBoot = iconHref();
    expect(decodeURIComponent(atBoot)).toContain(colorToHex(DEFAULT_THEME.dark.primary) ?? 'X');

    useThemeStore.getState().applyPreset('Ocean');
    expect(iconHref()).not.toBe(atBoot);
    expect(decodeURIComponent(iconHref())).toContain(colorToHex(OCEAN.dark.primary) ?? 'X');
  });

  it('follows the dark toggle', () => {
    initFaviconUpdater();
    useThemeStore.getState().setDark(false);
    expect(decodeURIComponent(iconHref())).toContain(
      colorToHex(DEFAULT_THEME.light.primary) ?? 'X',
    );
  });

  it('is idempotent — a second call adds no second subscription', () => {
    initFaviconUpdater();
    initFaviconUpdater();
    useThemeStore.getState().applyPreset('Forest');
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });
});
