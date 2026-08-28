import { describe, expect, it, vi } from 'vitest';
import type { LogLevel, ServerLogRecord } from '@flowboard/shared';

import {
  contextChips,
  copyText,
  DOCK_BORDER_CLASS,
  filterByMinLevel,
  formatLogTime,
  isDrawerFirst,
  isNearBottom,
  levelBadgeStyle,
  levelBadgeVar,
  LEVEL_FILTER_CHOICES,
  logsToJsonl,
  shellDirectionClass,
} from '@/components/diagnostics/diag-chrome';

/**
 * The drawer's rules, tested where they live: as functions, in the node
 * environment, with no jsdom and no render. Everything the UI does on top of
 * these is arrangement.
 */

function record(
  id: number,
  level: LogLevel,
  overrides: Partial<ServerLogRecord> = {},
): ServerLogRecord {
  return { id, time: 0, level, msg: `line ${id}`, context: {}, ...overrides };
}

const MIXED: ServerLogRecord[] = [
  record(1, 'trace'),
  record(2, 'debug'),
  record(3, 'info'),
  record(4, 'warn'),
  record(5, 'error'),
  record(6, 'fatal'),
];

describe('filterByMinLevel', () => {
  it('passes everything through for `all`', () => {
    expect(filterByMinLevel(MIXED, 'all').map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('treats the selection as a MINIMUM severity, not an exact match', () => {
    expect(filterByMinLevel(MIXED, 'warn').map((r) => r.level)).toEqual(['warn', 'error', 'fatal']);
    expect(filterByMinLevel(MIXED, 'error').map((r) => r.level)).toEqual(['error', 'fatal']);
    expect(filterByMinLevel(MIXED, 'debug').map((r) => r.level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('never mutates or aliases the input', () => {
    const result = filterByMinLevel(MIXED, 'all');
    expect(result).not.toBe(MIXED);
    expect(MIXED).toHaveLength(6);
  });

  it('offers `all` plus the four useful floors, in menu order', () => {
    expect(LEVEL_FILTER_CHOICES).toEqual(['all', 'debug', 'info', 'warn', 'error']);
  });
});

describe('levelBadgeVar', () => {
  it('maps every level onto a design token, never a colour', () => {
    expect(levelBadgeVar('trace')).toBe('--text-muted');
    expect(levelBadgeVar('debug')).toBe('--text-muted');
    expect(levelBadgeVar('info')).toBe('--info');
    expect(levelBadgeVar('warn')).toBe('--warning');
    expect(levelBadgeVar('error')).toBe('--danger');
    expect(levelBadgeVar('fatal')).toBe('--danger');
  });

  it('tints the badge background from the SAME token as its text', () => {
    expect(levelBadgeStyle('warn')).toEqual({
      color: 'var(--warning)',
      background: 'color-mix(in oklab, var(--warning) 14%, transparent)',
    });
  });
});

describe('formatLogTime', () => {
  it('is fixed-width 24-hour local time to the millisecond', () => {
    // Built from local parts, so the assertion holds in any TZ the suite runs in.
    const time = new Date(2026, 2, 14, 9, 5, 3, 7).getTime();
    expect(formatLogTime(time)).toBe('09:05:03.007');
  });

  it('pads midnight and keeps the 24-hour clock past noon', () => {
    expect(formatLogTime(new Date(2026, 0, 1, 0, 0, 0, 0).getTime())).toBe('00:00:00.000');
    expect(formatLogTime(new Date(2026, 0, 1, 23, 59, 59, 999).getTime())).toBe('23:59:59.999');
  });

  it('degrades to a placeholder rather than "Invalid Date"', () => {
    expect(formatLogTime(Number.NaN)).toBe('--:--:--.---');
  });
});

describe('contextChips', () => {
  it('promotes only the allowlisted keys, in allowlist order', () => {
    const chips = contextChips({ scope: 'tasks', taskId: 't-1', durationMs: 12, userId: 'u-1' });
    expect(chips).toEqual(['userId:u-1', 'taskId:t-1', 'scope:tasks']);
  });

  it('skips null and undefined values, and answers empty for a bare context', () => {
    expect(contextChips({ userId: null, projectId: undefined })).toEqual([]);
    expect(contextChips({})).toEqual([]);
  });
});

describe('isNearBottom', () => {
  it('is true at the bottom and within the threshold of it', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 790, clientHeight: 200 })).toBe(true);
  });

  it('is false once the user has scrolled away', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 200 })).toBe(false);
  });

  it('honours a custom threshold', () => {
    const scroller = { scrollHeight: 1000, scrollTop: 700, clientHeight: 200 };
    expect(isNearBottom(scroller, 24)).toBe(false);
    expect(isNearBottom(scroller, 120)).toBe(true);
  });
});

describe('logsToJsonl', () => {
  it('writes one JSON object per line, with no trailing newline', () => {
    const jsonl = logsToJsonl([record(1, 'info'), record(2, 'error')]);
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ id: 1, level: 'info' });
    expect(jsonl.endsWith('\n')).toBe(false);
  });

  it('answers an empty string for nothing to copy', () => {
    expect(logsToJsonl([])).toBe('');
  });
});

describe('copyText', () => {
  it('writes through the clipboard API when there is one', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    expect(copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');

    vi.unstubAllGlobals();
  });

  it('reports failure instead of throwing where the API is absent or blocked', () => {
    vi.stubGlobal('navigator', {});
    expect(copyText('hello')).toBe(false);

    vi.stubGlobal('navigator', {
      get clipboard() {
        throw new Error('blocked by permissions policy');
      },
    });
    expect(copyText('hello')).toBe(false);

    vi.unstubAllGlobals();
  });
});

describe('dock geometry', () => {
  it('runs the shell as a row for side docks and a column for top/bottom', () => {
    expect(shellDirectionClass('left')).toBe('flex-row');
    expect(shellDirectionClass('right')).toBe('flex-row');
    expect(shellDirectionClass('bottom')).toBe('flex-col');
    expect(shellDirectionClass('top')).toBe('flex-col');
  });

  it('borders the edge that faces the page content', () => {
    expect(DOCK_BORDER_CLASS).toEqual({
      bottom: 'border-t',
      top: 'border-b',
      left: 'border-r',
      right: 'border-l',
    });
  });

  it('orders side docks by PHYSICAL edge, compensating for RTL', () => {
    // LTR: first child is on the left.
    expect(isDrawerFirst('left', false)).toBe(true);
    expect(isDrawerFirst('right', false)).toBe(false);
    // RTL: a reversed row paints the first child on the RIGHT, so the two swap.
    expect(isDrawerFirst('left', true)).toBe(false);
    expect(isDrawerFirst('right', true)).toBe(true);
  });

  it('leaves top/bottom docks unaffected by direction', () => {
    for (const rtl of [false, true]) {
      expect(isDrawerFirst('top', rtl)).toBe(true);
      expect(isDrawerFirst('bottom', rtl)).toBe(false);
    }
  });
});
