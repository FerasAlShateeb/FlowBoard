import { describe, expect, it } from 'vitest';

import { DAY_WIDTH } from '@/components/gantt/useGanttGeometry';
import {
  MIN_BAR_DAYS,
  SCHEDULE_DEFAULT_DAYS,
  applyDrag,
  deltaDaysFromPx,
  dragPatch,
  seedSchedule,
} from '@/components/gantt/gantt-drag';

const SPAN = { startDate: '2026-03-10', dueDate: '2026-03-14' };

describe('deltaDaysFromPx', () => {
  it('maps a displacement to whole days at each zoom', () => {
    expect(deltaDaysFromPx(3 * DAY_WIDTH.week, DAY_WIDTH.week)).toBe(3);
    expect(deltaDaysFromPx(3 * DAY_WIDTH.month, DAY_WIDTH.month)).toBe(3);
    expect(deltaDaysFromPx(3 * DAY_WIDTH.quarter, DAY_WIDTH.quarter)).toBe(3);
    expect(deltaDaysFromPx(-2 * DAY_WIDTH.week, DAY_WIDTH.week)).toBe(-2);
  });

  it('ROUNDS rather than floors, so a half-cell drag already means one day', () => {
    expect(deltaDaysFromPx(DAY_WIDTH.week * 0.6, DAY_WIDTH.week)).toBe(1);
    expect(deltaDaysFromPx(DAY_WIDTH.week * 0.4, DAY_WIDTH.week)).toBe(0);
    expect(deltaDaysFromPx(DAY_WIDTH.week * -0.6, DAY_WIDTH.week)).toBe(-1);
  });

  it('is zero for a jitter and for a degenerate day width', () => {
    expect(deltaDaysFromPx(2, DAY_WIDTH.week)).toBe(0);
    expect(deltaDaysFromPx(100, 0)).toBe(0);
  });
});

describe('applyDrag — move', () => {
  it('shifts both dates and preserves the duration', () => {
    expect(applyDrag(SPAN, 'move', 3)).toEqual({
      startDate: '2026-03-13',
      dueDate: '2026-03-17',
    });
    expect(applyDrag(SPAN, 'move', -10)).toEqual({
      startDate: '2026-02-28',
      dueDate: '2026-03-04',
    });
  });

  it('returns the span unchanged for a zero delta', () => {
    expect(applyDrag(SPAN, 'move', 0)).toBe(SPAN);
  });

  it('is null-safe for an undated row', () => {
    expect(applyDrag(null, 'move', 5)).toBeNull();
  });
});

describe('applyDrag — resize', () => {
  it('moves only the dragged edge', () => {
    expect(applyDrag(SPAN, 'resize-start', -2)).toEqual({
      startDate: '2026-03-08',
      dueDate: '2026-03-14',
    });
    expect(applyDrag(SPAN, 'resize-end', 4)).toEqual({
      startDate: '2026-03-10',
      dueDate: '2026-03-18',
    });
  });

  it('clamps a start dragged past the end to a one-day bar at the end', () => {
    const result = applyDrag(SPAN, 'resize-start', 99);
    expect(result).toEqual({ startDate: '2026-03-14', dueDate: '2026-03-14' });
  });

  it('clamps an end dragged before the start to a one-day bar at the start', () => {
    const result = applyDrag(SPAN, 'resize-end', -99);
    expect(result).toEqual({ startDate: '2026-03-10', dueDate: '2026-03-10' });
  });

  it('never produces a bar shorter than the minimum', () => {
    for (const delta of [-50, -5, -1, 1, 5, 50]) {
      for (const mode of ['resize-start', 'resize-end'] as const) {
        const result = applyDrag(SPAN, mode, delta);
        expect(result).not.toBeNull();
        expect(result && result.startDate <= result.dueDate).toBe(true);
      }
    }
    expect(MIN_BAR_DAYS).toBe(1);
  });

  it('resizes a one-day bar without inverting it', () => {
    const point = { startDate: '2026-03-10', dueDate: '2026-03-10' };
    expect(applyDrag(point, 'resize-start', 1)).toEqual(point);
    expect(applyDrag(point, 'resize-end', -1)).toEqual(point);
    expect(applyDrag(point, 'resize-end', 2)).toEqual({
      startDate: '2026-03-10',
      dueDate: '2026-03-12',
    });
  });
});

describe('dragPatch', () => {
  it('is null when nothing actually changed', () => {
    expect(dragPatch(SPAN, SPAN)).toBeNull();
    expect(dragPatch(SPAN, { ...SPAN })).toBeNull();
    expect(dragPatch(SPAN, null)).toBeNull();
  });

  it('carries BOTH dates once the bar has moved', () => {
    expect(dragPatch(SPAN, applyDrag(SPAN, 'move', 1))).toEqual({
      startDate: '2026-03-11',
      dueDate: '2026-03-15',
    });
  });

  it('materialises the missing date for a single-dated task that was dragged', () => {
    const original = { startDate: null, dueDate: '2026-03-14' };
    const resolved = { startDate: '2026-03-14', dueDate: '2026-03-14' };
    expect(dragPatch(original, applyDrag(resolved, 'move', 2))).toEqual({
      startDate: '2026-03-16',
      dueDate: '2026-03-16',
    });
  });
});

describe('seedSchedule', () => {
  it('gives an undated task a grabbable four-day bar starting today', () => {
    expect(seedSchedule('2026-03-10')).toEqual({
      startDate: '2026-03-10',
      dueDate: '2026-03-13',
    });
    expect(SCHEDULE_DEFAULT_DAYS).toBe(3);
  });

  it('rolls across a month boundary', () => {
    expect(seedSchedule('2026-03-30')).toEqual({
      startDate: '2026-03-30',
      dueDate: '2026-04-02',
    });
  });
});
