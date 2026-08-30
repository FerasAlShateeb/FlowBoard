// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UTF8_BOM } from '@/lib/csv';
import { downloadCsvBlob, saveBlob } from '@/components/dashboard/save-blob';

/**
 * The download mechanics.
 *
 * jsdom implements neither `URL.createObjectURL` nor a real navigation, so both
 * are stubbed and the assertions are about the CONTRACT the helper has to keep:
 * the anchor is in the document when it is clicked (Firefox ignores a detached
 * one), the object URL is revoked exactly once, and nothing is left behind in
 * the DOM. Those are the three things that have historically been wrong.
 */

let clicked: HTMLAnchorElement[] = [];
let created: Blob[] = [];
let revoked: string[] = [];
/** The anchor's parent AT CLICK TIME — the Firefox contract, in one value. */
let parentAtClick: (ParentNode | null)[] = [];

beforeEach(() => {
  clicked = [];
  created = [];
  revoked = [];
  parentAtClick = [];

  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return `blob:test/${String(created.length)}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
    parentAtClick.push(this.parentNode);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveBlob()', () => {
  it('clicks a download anchor carrying the filename', () => {
    saveBlob(new Blob(['x']), 'report.csv');

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('report.csv');
    expect(clicked[0]?.getAttribute('href')).toBe('blob:test/1');
    expect(clicked[0]?.rel).toBe('noopener');
  });

  it('has the anchor IN the document when it clicks it', () => {
    saveBlob(new Blob(['x']), 'report.csv');
    expect(parentAtClick[0]).toBe(document.body);
  });

  it('leaves nothing behind — no anchor, no live object URL', () => {
    saveBlob(new Blob(['x']), 'report.csv');

    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('revokes the URL even when the click throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => {
      saveBlob(new Blob(['x']), 'report.csv');
    }).toThrow('blocked');
    expect(revoked).toEqual(['blob:test/1']);
  });
});

/**
 * The first bytes of a blob.
 *
 * Asserted as BYTES rather than through `Blob.text()`, because the UTF-8 decode
 * that backs `text()` STRIPS a leading BOM by specification — the very byte
 * sequence under test would be invisible to it.
 */
async function leadingBytes(blob: Blob | undefined, count: number): Promise<number[]> {
  if (!blob) return [];
  const buffer = await blob.arrayBuffer();
  return [...new Uint8Array(buffer).slice(0, count)];
}

const BOM_BYTES = [0xef, 0xbb, 0xbf];

describe('downloadCsvBlob()', () => {
  it('prepends the UTF-8 BOM, without which Excel mangles Arabic', async () => {
    downloadCsvBlob('a,b\r\n1,2', 'x.csv');

    expect(created).toHaveLength(1);
    await expect(leadingBytes(created[0], 3)).resolves.toEqual(BOM_BYTES);
    await expect(created[0]?.text()).resolves.toBe('a,b\r\n1,2');
  });

  it('does not double the BOM when the caller already wrote one', async () => {
    downloadCsvBlob(`${UTF8_BOM}a,b`, 'x.csv');

    await expect(leadingBytes(created[0], 3)).resolves.toEqual(BOM_BYTES);
    // One BOM (3 bytes) plus `a,b` (3 bytes). A doubled BOM would be 9.
    expect(created[0]?.size).toBe(6);
  });

  it('declares the charset so a double-click opens in the right encoding', () => {
    downloadCsvBlob('a,b', 'x.csv');
    expect(created[0]?.type).toBe('text/csv;charset=utf-8');
  });

  it('passes the filename straight through', () => {
    downloadCsvBlob('a,b', 'engagement-2026-03-12.csv');
    expect(clicked[0]?.download).toBe('engagement-2026-03-12.csv');
  });
});
