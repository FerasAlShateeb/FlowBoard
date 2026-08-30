import { UTF8_BOM } from '@/lib/csv';

/**
 * Handing the browser a file the app generated in memory.
 *
 * ═══ WHY AN OBJECT URL AND A SYNTHETIC ANCHOR ════════════════════════════
 *
 * There is no browser API for "save this blob". The portable answer is an
 * `<a download>` pointed at an object URL and clicked in code — the only shape
 * every engine honours without a navigation, a popup block or a permission
 * prompt. Three details in the eight lines below are each a bug that has been
 * shipped by someone omitting them:
 *
 *  - **The anchor is appended to the document before the click.** Firefox
 *    ignores `click()` on an element that is not in the tree; Chromium does
 *    not. A detached anchor therefore "works" everywhere the author tested.
 *  - **The object URL is revoked in a `finally`.** Every un-revoked URL pins
 *    its blob in memory for the life of the document, and an ops page whose
 *    export button is pressed twenty times is twenty full CSVs of retained
 *    heap.
 *  - **`rel="noopener"`.** The anchor never opens a window, but the attribute
 *    costs nothing and closes the door on a `target` arriving later.
 *
 * ═══ RELATIONSHIP TO `lib/csv.downloadCsv` ═══════════════════════════════
 *
 * `lib/csv` owns the CSV FORMAT (RFC 4180 quoting, CRLF records, the BOM,
 * formula neutralisation) and ships a `downloadCsv(filename, csv)` that both
 * serializes and saves. This module owns the SAVE half alone, because the
 * analytics console also exports things that are not CSV — a JSON theme
 * export, a chart PNG — and because a caller that already holds a `Blob` from
 * `fetch()` has nothing to serialize. {@link downloadCsvBlob} is the same
 * operation as `lib/csv.downloadCsv` with the arguments in this module's order;
 * it exists so a page that already imports `saveBlob` does not need two
 * download helpers in scope. Consolidating the pair is a W3.1 call, not a
 * W1.4 one — deleting either today would edit a file this package does not own.
 */

/**
 * Saves a blob to the user's downloads as `filename`.
 *
 * A no-op outside a document (node tests, SSR): the alternative is throwing
 * from a click handler on a code path that has nothing to save to.
 */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Saves an already-serialized CSV document.
 *
 * Prepends the UTF-8 BOM unless the caller already did (`lib/csv.toCsv` does
 * not; `lib/csv.downloadCsv` expects it to be there). Excel does NOT sniff
 * UTF-8 — without the BOM it decodes the file as the system ANSI codepage and
 * every Arabic label arrives as mojibake — and `charset=utf-8` in the MIME type
 * is the belt to that brace: the OS reads it when the file is double-clicked.
 */
export function downloadCsvBlob(csv: string, filename: string): void {
  const body = csv.startsWith(UTF8_BOM) ? csv : `${UTF8_BOM}${csv}`;
  saveBlob(new Blob([body], { type: 'text/csv;charset=utf-8' }), filename);
}
