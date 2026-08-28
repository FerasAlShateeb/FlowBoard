/**
 * CSV serialisation and download — the Table view's export, as pure functions.
 *
 * WHY THIS IS ITS OWN MODULE. Getting CSV *nearly* right is the norm: a title
 * containing a comma splits a row, a quoted description eats the rest of the
 * file, and Arabic opens in Excel as mojibake. Those are three separate rules
 * (RFC 4180 quoting, CRLF records, a UTF-8 BOM), none of them guessable from a
 * `join(',')`, and all three are cheap to unit-test in isolation and expensive
 * to debug inside a React tree. So the whole format lives here, with no
 * knowledge of tasks, columns or i18n; the caller supplies already-flattened
 * rows and already-localized headers.
 *
 * THE FOUR RULES, and why each one is not optional:
 *
 * 1. **RFC 4180 quoting.** A field is wrapped in double quotes when it contains
 *    a quote, a comma, CR or LF; an embedded quote is doubled (`"` → `""`).
 *    Anything else is emitted bare, so the common case stays readable in a
 *    diff and in a terminal.
 * 2. **CRLF between records.** The spec says CRLF, and Excel on Windows agrees.
 *    A bare LF is tolerated by most readers but is exactly the kind of thing
 *    that turns into "the last column is empty on my machine".
 * 3. **A UTF-8 BOM in front.** Excel does NOT sniff UTF-8: without the BOM it
 *    decodes the file as the system ANSI codepage, and every Arabic task title
 *    arrives as `Ø§Ù„Ù…Ù‡Ù…Ø©`. The three-byte BOM is the only portable way to
 *    say "this is UTF-8" in a format that has no header. Every other consumer
 *    (pandas, Google Sheets, `csv` in Node) skips it.
 * 4. **Formula neutralisation.** See {@link escapeCsvField}. Task titles,
 *    labels and people's names are attacker-supplied text that lands in a cell
 *    Excel will happily evaluate; a leading `=`/`+`/`-`/`@`/TAB is disarmed
 *    with a single quote before the quoting in rule 1 runs.
 *
 * NO TRAILING NEWLINE. Records are JOINED by CRLF rather than terminated by it.
 * RFC 4180 allows either, and a terminating CRLF is indistinguishable from a
 * final empty record for the stricter parsers — including our own tests, which
 * would otherwise have to special-case the last line.
 */

/** One output column: which key to read from a row, and what to call it. */
export interface CsvHeader {
  /** Property name on each row object. */
  key: string;
  /** The localized column title written into the header record. */
  label: string;
}

/** Everything a flattened cell may hold. `null`/`undefined` become empty. */
export type CsvValue = string | number | null | undefined;

/** A flattened export row: one primitive per output column, keyed by column. */
export type CsvRow = Record<string, CsvValue>;

/**
 * The UTF-8 byte-order mark, as the single code point `U+FEFF`.
 *
 * Exported so a caller that assembles a document some other way can prepend the
 * same constant instead of re-typing the escape — and so tests can assert on it
 * by name rather than by a magic string.
 */
export const UTF8_BOM = '\uFEFF';

/** RFC 4180's record separator. */
const RECORD_SEPARATOR = '\r\n';

/** The delimiter. Not configurable: the "C" in CSV is load-bearing here. */
const FIELD_SEPARATOR = ',';

/**
 * The four characters that force a field to be quoted. CR and LF are listed
 * separately because a value may contain either alone — a textarea on Linux
 * produces bare LF, one pasted from Windows produces CRLF, and both have to
 * survive as ONE field.
 */
const NEEDS_QUOTING = /["\r\n,]/;

/**
 * The characters that make a spreadsheet read a cell as a FORMULA rather than
 * as text, when they appear first.
 *
 * `=` and `+` open a formula in every engine; `-` does too (Excel reads `-1+1`
 * as an expression); `@` is Excel's legacy function-call sigil (`@SUM(...)`,
 * and the entry point for the `=cmd|'/C calc'!A0` DDE family); a leading TAB is
 * stripped before parsing, which hands the character after it to the formula
 * parser and is exactly how a naive `=`-only check gets bypassed.
 */
const FORMULA_LEAD = /^[=+\-@\t]/;

/** The prefix that neutralises a formula: Excel shows it, but does not store it. */
const FORMULA_GUARD = "'";

/**
 * One field, escaped per RFC 4180 — and neutralised against CSV INJECTION.
 *
 * ═══ FORMULA INJECTION ═════════════════════════════════════════════════════
 *
 * A task title is text a stranger typed. Exported to a cell and opened in
 * Excel, LibreOffice or Sheets, `=cmd|'/C calc'!A0` is not text any more: it is
 * a formula the SPREADSHEET runs, on the reviewer's machine, under their
 * account. Quoting per RFC 4180 does not help — the quotes are a transport
 * detail the parser removes before the cell is evaluated — so the value itself
 * has to stop being formula-shaped. A leading `'` does exactly that: every
 * major engine treats it as "the rest is literal text", displays the cell
 * without it, and does not keep it in the stored value.
 *
 * THE GUARD RUNS BEFORE THE QUOTING, so a hostile value containing a comma is
 * disarmed AND transported correctly: `=A1,B1` becomes `"'=A1,B1"`.
 *
 * ═══ THE `-5` TRADEOFF, AND WHY IT IS RESOLVED THIS WAY ════════════════════
 *
 * `-` is both the start of a formula and the start of every negative number,
 * so the rule has two possible shapes:
 *
 *   a. guard only when the value is not *entirely* a plain number, keeping
 *      `-5` numeric and guarding `-5+cmd|'/C calc'!A0`;
 *   b. guard whenever the first character qualifies, full stop.
 *
 * **(b) is what this does**, deliberately. A carve-out is a second parser — it
 * has to agree with the spreadsheet's idea of "a number" across locales,
 * exponents (`-1e3`), leading/trailing whitespace, Unicode minus signs and
 * digit shapes — and every disagreement is a bypass. The cost is that a
 * genuinely negative number exports as `'-5` and lands in the cell as TEXT, so
 * a column of them will not sum without a re-type.
 *
 * That cost is currently zero for FlowBoard: the only numeric column the export
 * emits is story points, which `storyPointsSchema` bounds to 0–1000
 * (`components/datatable/csv-rows.ts`). If a signed metric is ever exported,
 * the honest fix is a per-column "numeric" flag on {@link CsvHeader} — not
 * loosening the guard for every free-text field on the row.
 *
 * Numbers are stringified with `String()`, which always yields Latin digits and
 * a `.` decimal separator regardless of the UI language — deliberate: a CSV is
 * a machine format, and `Intl` output (`٠٫٥`, or `0,5` in a German locale)
 * would break every consumer that parses it back. Localized *headers* are fine;
 * localized *numbers* are not.
 */
export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  const text = typeof value === 'number' ? String(value) : value;
  const guarded = FORMULA_LEAD.test(text) ? FORMULA_GUARD + text : text;

  if (!NEEDS_QUOTING.test(guarded)) return guarded;

  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Rows + headers → a complete CSV document (BOM included).
 *
 * HEADERS DRIVE EVERYTHING. Column order comes from `headers`, not from the key
 * order of the row objects, and a key absent from a row emits an empty field
 * rather than shifting the remaining columns left. That is what lets the Table
 * view hand this function heterogeneous rows (a task with no sprint simply has
 * no `sprint` key) without pre-filling every gap.
 *
 * @example
 *   toCsv(
 *     [{ key: 'FB-1', title: 'Fix, urgently' }],
 *     [{ key: 'key', label: 'Key' }, { key: 'title', label: 'Title' }],
 *   );
 *   // '<BOM>Key,Title\r\nFB-1,"Fix, urgently"'
 */
export function toCsv(rows: readonly CsvRow[], headers: readonly CsvHeader[]): string {
  const records: string[] = [
    headers.map((header) => escapeCsvField(header.label)).join(FIELD_SEPARATOR),
  ];

  for (const row of rows) {
    records.push(headers.map((header) => escapeCsvField(row[header.key])).join(FIELD_SEPARATOR));
  }

  return UTF8_BOM + records.join(RECORD_SEPARATOR);
}

/**
 * Hands the browser a finished CSV document as a file download.
 *
 * A Blob + object URL + synthetic anchor click, because there is no other way:
 * `fetch` cannot save, and a `data:` URL is size-capped in several browsers and
 * loses the filename. The anchor is never attached to the document — a detached
 * element's `click()` still triggers the download in every engine we support,
 * and skipping the append/remove pair means no layout thrash and no chance of
 * leaving a stray node behind if something throws mid-way.
 *
 * The object URL is revoked in a `finally`, so a failed click cannot leak the
 * whole document (which for a 1000-row export is not trivial).
 *
 * The `charset=utf-8` in the MIME type is belt to the BOM's braces: browsers
 * pass it through to the OS, which is what stops a double-click opening the
 * file in the wrong encoding on macOS.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A filesystem-safe filename, `<prefix>-YYYY-MM-DD.csv`.
 *
 * Kept here rather than at the call site so the export's name is decided in the
 * same module as its contents. The date is the LOCAL calendar day (what the
 * person clicking the button would call "today"), not UTC.
 */
export function csvFilename(prefix: string, at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  const safePrefix = prefix.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';

  return `${safePrefix}-${year}-${month}-${day}.csv`;
}
