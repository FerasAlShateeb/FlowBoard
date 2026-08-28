// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadJson, themeFileName } from '@/components/theme/theme-file';

/**
 * The export download.
 *
 * The interesting behaviour is the FAILURE mode: `URL.createObjectURL` does not
 * exist in jsdom (and is absent in a few locked-down browser contexts), and an
 * Export button that throws would take the whole studio down with it. So the
 * helper reports `false` instead, and the page only toasts on `true`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('themeFileName', () => {
  it('is dated, so a second export does not overwrite the first', () => {
    expect(themeFileName(new Date(2026, 7, 27))).toBe('flowboard-theme-2026-08-27.json');
  });

  it('zero-pads single-digit months and days', () => {
    expect(themeFileName(new Date(2026, 0, 5))).toBe('flowboard-theme-2026-01-05.json');
  });
});

describe('downloadJson', () => {
  it('reports failure rather than throwing when object URLs are unavailable', () => {
    // Some locked-down contexts (and older jsdom builds) have no
    // `createObjectURL`. The helper must say so, not throw into a click handler.
    vi.stubGlobal('URL', { revokeObjectURL: () => {} });
    expect(downloadJson('{}')).toBe(false);
  });

  it('creates, clicks and revokes a download anchor', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const clicked: Array<{ download: string; href: string }> = [];

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob.type);
        return 'blob:theme';
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    });

    // jsdom does not navigate on a click, so the anchor is inspected in flight.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function click(this: HTMLAnchorElement) {
        clicked.push({ download: this.download, href: this.href });
      });

    expect(downloadJson('{"a":1}', 'my-theme.json')).toBe(true);
    expect(created).toEqual(['application/json']);
    expect(clicked).toEqual([{ download: 'my-theme.json', href: 'blob:theme' }]);
    expect(revoked).toEqual(['blob:theme']);
    // The anchor must not be left behind in the document.
    expect(document.querySelector('a[download]')).toBeNull();

    clickSpy.mockRestore();
  });
});
