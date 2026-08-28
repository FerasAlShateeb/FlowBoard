/**
 * Downloading the exported theme as a file.
 *
 * A BLOB URL, not a `data:` href. A theme document is a few kilobytes of JSON
 * and both would work today, but `data:` URIs are capped (and, in some
 * browsers, blocked as top-level navigations), while `URL.createObjectURL` has
 * no practical size limit and is revoked the moment the click is dispatched, so
 * nothing is retained.
 *
 * Kept out of the page component because it touches four DOM APIs and none of
 * React: the studio's Export button should read as "download this string".
 */

/** The default filename. Dated, so exporting twice does not overwrite. */
export function themeFileName(now: Date = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `flowboard-theme-${stamp}.json`;
}

/**
 * Offer `json` to the user as a downloaded file. Returns `false` when the
 * environment cannot do it (a jsdom test, an ancient browser) rather than
 * throwing — an export that fails must not take the studio down with it.
 */
export function downloadJson(json: string, fileName: string = themeFileName()): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  // Appending is required by Firefox, which ignores a click on a detached node.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
