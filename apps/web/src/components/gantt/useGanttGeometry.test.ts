import { describe, expect, it } from 'vitest';

import {
  AXIS_UNITS,
  DAY_WIDTH,
  MIN_RANGE_DAYS,
  ZOOM_LEVELS,
  addDays,
  addMonthsToMonthStart,
  createGanttGeometry,
  daysBetween,
  deriveRange,
  formatDay,
  isWeekendDay,
  parseDay,
  startOfMonthDay,
  startOfQuarterDay,
  startOfWeekDay,
  todayDay,
  unitNext,
  unitStart,
  type GanttZoom,
} from '@/components/gantt/useGanttGeometry';

/**
 * The geometry suite — the one the whole view rests on.
 *
 * Everything here runs in the DEFAULT node environment: `createGanttGeometry`
 * is a pure function, which is exactly why it can be tested this hard.
 */

/** A geometry over a fixed, hand-checkable window. */
function geometryFor(zoom: GanttZoom, start = '2026-03-02', end = '2026-04-26', today?: string) {
  return createGanttGeometry({ zoom, rangeStart: start, rangeEnd: end, today });
}

describe('day arithmetic', () => {
  it('round-trips a day through the UTC-noon anchor', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31', '1999-06-15']) {
      expect(formatDay(parseDay(iso))).toBe(iso);
    }
  });

  it('anchors at 12:00 UTC, so a ±1h DST shift cannot cross a day', () => {
    const day = parseDay('2026-03-08');
    expect(day.getUTCHours()).toBe(12);
    // The US spring-forward day and the EU autumn-back day both step by one.
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
  });

  it('steps across month, year and leap-day boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('measures signed whole days', () => {
    expect(daysBetween('2026-03-02', '2026-03-02')).toBe(0);
    expect(daysBetween('2026-03-02', '2026-03-05')).toBe(3);
    expect(daysBetween('2026-03-05', '2026-03-02')).toBe(-3);
    // Across a DST boundary in most northern zones, and across a leap day.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(29);
  });

  it('reads today from the LOCAL calendar', () => {
    expect(todayDay(new Date(2026, 2, 5, 23, 30))).toBe('2026-03-05');
    expect(todayDay(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01');
  });
});

describe('period starts', () => {
  it('snaps a week back to Monday, whatever day it is given', () => {
    for (let offset = 0; offset < 14; offset += 1) {
      const day = addDays('2026-03-01', offset);
      const monday = startOfWeekDay(day);
      expect(parseDay(monday).getUTCDay()).toBe(1);
      expect(daysBetween(monday, day)).toBeGreaterThanOrEqual(0);
      expect(daysBetween(monday, day)).toBeLessThan(7);
    }
  });

  it('snaps months and quarters', () => {
    expect(startOfMonthDay('2026-03-17')).toBe('2026-03-01');
    expect(startOfQuarterDay('2026-01-05')).toBe('2026-01-01');
    expect(startOfQuarterDay('2026-05-31')).toBe('2026-04-01');
    expect(startOfQuarterDay('2026-09-30')).toBe('2026-07-01');
    expect(startOfQuarterDay('2026-12-31')).toBe('2026-10-01');
  });

  it('adds months to a month start, rolling the year', () => {
    expect(addMonthsToMonthStart('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonthsToMonthStart('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonthsToMonthStart('2026-01-01', 12)).toBe('2027-01-01');
  });

  it('advances each unit by exactly one period', () => {
    expect(unitNext(unitStart('2026-03-17', 'day'), 'day')).toBe('2026-03-18');
    expect(
      daysBetween(
        unitStart('2026-03-17', 'week'),
        unitNext(unitStart('2026-03-17', 'week'), 'week'),
      ),
    ).toBe(7);
    expect(unitNext(unitStart('2026-03-17', 'month'), 'month')).toBe('2026-04-01');
    // March is in Q1, so the next quarter starts in April.
    expect(unitStart('2026-03-17', 'quarter')).toBe('2026-01-01');
    expect(unitNext(unitStart('2026-03-17', 'quarter'), 'quarter')).toBe('2026-04-01');
  });

  it('knows the weekend', () => {
    // 2026-03-07 is a Saturday, 2026-03-08 a Sunday.
    expect(parseDay('2026-03-07').getUTCDay()).toBe(6);
    expect(isWeekendDay('2026-03-07')).toBe(true);
    expect(isWeekendDay('2026-03-08')).toBe(true);
    expect(isWeekendDay('2026-03-09')).toBe(false);
    expect(isWeekendDay('2026-03-06')).toBe(false);
  });
});

describe('dateToX / xToDate', () => {
  it('places the range start at x = 0 and scales by the zoom', () => {
    for (const zoom of ZOOM_LEVELS) {
      const geometry = geometryFor(zoom);
      expect(geometry.dayWidth).toBe(DAY_WIDTH[zoom]);
      expect(geometry.dateToX(geometry.rangeStart)).toBe(0);
      expect(geometry.dateToX(addDays(geometry.rangeStart, 10))).toBe(10 * DAY_WIDTH[zoom]);
      expect(geometry.totalWidth).toBe(geometry.totalDays * DAY_WIDTH[zoom]);
      expect(geometry.dateToEndX(geometry.rangeEnd)).toBe(geometry.totalWidth);
    }
  });

  it('round-trips every day in the range, at every zoom', () => {
    for (const zoom of ZOOM_LEVELS) {
      const geometry = geometryFor(zoom);
      for (let index = 0; index < geometry.totalDays; index += 1) {
        const day = addDays(geometry.rangeStart, index);
        expect(geometry.xToDate(geometry.dateToX(day))).toBe(day);
      }
    }
  });

  it('snaps to the day whose COLUMN the pixel is inside', () => {
    const geometry = geometryFor('week');
    const day = '2026-03-10';
    const left = geometry.dateToX(day);
    expect(geometry.xToDate(left)).toBe(day);
    expect(geometry.xToDate(left + 0.5)).toBe(day);
    expect(geometry.xToDate(left + geometry.dayWidth - 0.001)).toBe(day);
    // The very next pixel belongs to the next day, not to this one.
    expect(geometry.xToDate(left + geometry.dayWidth)).toBe(addDays(day, 1));
  });

  it('clamps a pixel outside the range to the first / last visible day', () => {
    const geometry = geometryFor('month');
    expect(geometry.xToDate(-9999)).toBe(geometry.rangeStart);
    expect(geometry.xToDate(-1)).toBe(geometry.rangeStart);
    expect(geometry.xToDate(geometry.totalWidth)).toBe(geometry.rangeEnd);
    expect(geometry.xToDate(geometry.totalWidth + 9999)).toBe(geometry.rangeEnd);
  });

  it('lets dateToX run outside the range without clamping', () => {
    const geometry = geometryFor('week');
    expect(geometry.dateToX(addDays(geometry.rangeStart, -2))).toBe(-2 * DAY_WIDTH.week);
    expect(geometry.dateToX(addDays(geometry.rangeEnd, 3))).toBeGreaterThan(geometry.totalWidth);
  });
});

describe('barRect', () => {
  const geometry = geometryFor('week');

  it('is INCLUSIVE of the end day', () => {
    const rect = geometry.barRect({ startDate: '2026-03-03', dueDate: '2026-03-05' });
    expect(rect).not.toBeNull();
    expect(rect?.days).toBe(3);
    expect(rect?.width).toBe(3 * DAY_WIDTH.week);
    expect(rect?.x).toBe(geometry.dateToX('2026-03-03'));
    // The right edge is the right edge of the 5th's column, not its left edge.
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBe(geometry.dateToEndX('2026-03-05'));
  });

  it('draws a one-day bar for a task with a start and no due date', () => {
    const rect = geometry.barRect({ startDate: '2026-03-10', dueDate: null });
    expect(rect?.days).toBe(1);
    expect(rect?.start).toBe('2026-03-10');
    expect(rect?.end).toBe('2026-03-10');
    expect(rect?.width).toBe(DAY_WIDTH.week);
  });

  it('draws a one-day bar for a task with a due date and no start', () => {
    const rect = geometry.barRect({ startDate: null, dueDate: '2026-03-12' });
    expect(rect?.days).toBe(1);
    expect(rect?.start).toBe('2026-03-12');
    expect(rect?.x).toBe(geometry.dateToX('2026-03-12'));
  });

  it('returns null for an undated task', () => {
    expect(geometry.barRect({ startDate: null, dueDate: null })).toBeNull();
  });

  it('collapses inverted dates to one day rather than a negative width', () => {
    const rect = geometry.barRect({ startDate: '2026-03-12', dueDate: '2026-03-05' });
    expect(rect?.days).toBe(1);
    expect(rect?.width).toBe(DAY_WIDTH.week);
    expect(rect?.start).toBe('2026-03-12');
  });

  it('spans a month boundary correctly', () => {
    const rect = geometry.barRect({ startDate: '2026-03-30', dueDate: '2026-04-02' });
    expect(rect?.days).toBe(4);
  });
});

describe('axis segments', () => {
  it('cuts each zoom into the documented pair of units', () => {
    for (const zoom of ZOOM_LEVELS) {
      const geometry = geometryFor(zoom);
      expect(geometry.axis.upperUnit).toBe(AXIS_UNITS[zoom].upper);
      expect(geometry.axis.lowerUnit).toBe(AXIS_UNITS[zoom].lower);
    }
  });

  it('gives the week zoom one lower cell per day', () => {
    const geometry = geometryFor('week');
    expect(geometry.axis.lower).toHaveLength(geometry.totalDays);
    expect(geometry.axis.lower.every((cell) => cell.width === DAY_WIDTH.week)).toBe(true);
    expect(geometry.axis.lower[0]?.start).toBe(geometry.rangeStart);
  });

  it('tiles both rows edge to edge with no gap and no overlap', () => {
    for (const zoom of ZOOM_LEVELS) {
      const geometry = geometryFor(zoom);
      for (const row of [geometry.axis.lower, geometry.axis.upper]) {
        expect(row[0]?.x).toBe(0);
        let cursor = 0;
        for (const segment of row) {
          expect(segment.x).toBe(cursor);
          cursor += segment.width;
        }
        expect(cursor).toBe(geometry.totalWidth);
      }
    }
  });

  it('labels a CLIPPED segment from its real period start', () => {
    // A range opening mid-March: the first month segment is short, but it is
    // still March — which is what `unitStart` carries and `start` does not.
    const geometry = createGanttGeometry({
      zoom: 'month',
      rangeStart: '2026-03-16',
      rangeEnd: '2026-05-10',
    });
    const first = geometry.axis.upper[0];
    expect(first?.unitStart).toBe('2026-03-01');
    expect(first?.start).toBe('2026-03-16');
    expect(first?.whole).toBe(false);
    expect(geometry.axis.upper.map((segment) => segment.unitStart)).toEqual([
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ]);
  });

  it('starts a new month segment exactly on the 1st', () => {
    const geometry = createGanttGeometry({
      zoom: 'month',
      rangeStart: '2026-03-01',
      rangeEnd: '2026-04-30',
    });
    const april = geometry.axis.upper[1];
    expect(april?.unitStart).toBe('2026-04-01');
    expect(april?.x).toBe(geometry.dateToX('2026-04-01'));
    expect(geometry.axis.upper[0]?.width).toBe(31 * DAY_WIDTH.month);
  });

  it('cuts the quarter zoom into months under quarters', () => {
    const geometry = createGanttGeometry({
      zoom: 'quarter',
      rangeStart: '2026-01-01',
      rangeEnd: '2026-09-30',
    });
    expect(geometry.axis.lower).toHaveLength(9);
    expect(geometry.axis.upper).toHaveLength(3);
    expect(geometry.axis.upper.map((segment) => segment.unitStart)).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
    ]);
    expect(geometry.axis.upper.every((segment) => segment.whole)).toBe(true);
  });

  it('crosses a year boundary without losing a period', () => {
    const geometry = createGanttGeometry({
      zoom: 'quarter',
      rangeStart: '2026-11-01',
      rangeEnd: '2027-02-28',
    });
    expect(geometry.axis.lower.map((segment) => segment.unitStart)).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
    expect(geometry.axis.upper.map((segment) => segment.unitStart)).toEqual([
      '2026-10-01',
      '2027-01-01',
    ]);
  });
});

describe('weekend bands', () => {
  it('shades each Saturday+Sunday pair as one band at the week zoom', () => {
    const geometry = createGanttGeometry({
      zoom: 'week',
      // A Monday through the Sunday four weeks later.
      rangeStart: startOfWeekDay('2026-03-02'),
      rangeEnd: addDays(startOfWeekDay('2026-03-02'), 27),
    });
    expect(geometry.weekendBands).toHaveLength(4);
    for (const band of geometry.weekendBands) {
      expect(band.width).toBe(2 * DAY_WIDTH.week);
      expect(isWeekendDay(band.key)).toBe(true);
      expect(parseDay(band.key).getUTCDay()).toBe(6);
    }
    expect(geometry.weekendBands[0]?.x).toBe(5 * DAY_WIDTH.week);
  });

  it('drops weekend shading at the quarter zoom, where it is only noise', () => {
    expect(geometryFor('quarter').weekendBands).toEqual([]);
  });

  it('clips a band that the range cuts in half', () => {
    // Range ending on a Saturday: the final band is one day, not two.
    const saturday = '2026-03-07';
    const geometry = createGanttGeometry({
      zoom: 'week',
      rangeStart: '2026-03-02',
      rangeEnd: saturday,
    });
    const last = geometry.weekendBands[geometry.weekendBands.length - 1];
    expect(last?.key).toBe(saturday);
    expect(last?.width).toBe(DAY_WIDTH.week);
  });
});

describe('todayX', () => {
  it('sits at the centre of today’s column', () => {
    const geometry = geometryFor('week', '2026-03-02', '2026-04-26', '2026-03-10');
    expect(geometry.todayX).toBe(geometry.dateToX('2026-03-10') + DAY_WIDTH.week / 2);
  });

  it('is null when today falls outside the range', () => {
    expect(geometryFor('week', '2026-03-02', '2026-04-26', '2026-01-01').todayX).toBeNull();
    expect(geometryFor('week', '2026-03-02', '2026-04-26', '2027-01-01').todayX).toBeNull();
  });

  it('includes both inclusive ends of the range', () => {
    expect(geometryFor('week', '2026-03-02', '2026-04-26', '2026-03-02').todayX).toBe(
      DAY_WIDTH.week / 2,
    );
    expect(geometryFor('week', '2026-03-02', '2026-04-26', '2026-04-26').todayX).not.toBeNull();
  });
});

describe('deriveRange', () => {
  const spans = [
    { startDate: '2026-03-10', dueDate: '2026-03-14' },
    { startDate: null, dueDate: '2026-03-20' },
    { startDate: '2026-03-04', dueDate: null },
    { startDate: null, dueDate: null },
  ];

  it('covers every dated task', () => {
    const { rangeStart, rangeEnd } = deriveRange(spans, 'week', '2026-03-12');
    expect(rangeStart <= '2026-03-04').toBe(true);
    expect(rangeEnd >= '2026-03-20').toBe(true);
  });

  it('never returns less than eight weeks', () => {
    for (const zoom of ZOOM_LEVELS) {
      const { rangeStart, rangeEnd } = deriveRange(spans, zoom, '2026-03-12');
      expect(daysBetween(rangeStart, rangeEnd) + 1).toBeGreaterThanOrEqual(MIN_RANGE_DAYS);
    }
  });

  it('snaps to whole lower-unit cells, so no axis cell is half drawn', () => {
    const week = deriveRange(spans, 'week', '2026-03-12');
    expect(parseDay(week.rangeStart).getUTCDay()).toBe(1);
    expect(parseDay(week.rangeEnd).getUTCDay()).toBe(0);

    const month = deriveRange(spans, 'month', '2026-03-12');
    expect(parseDay(month.rangeStart).getUTCDay()).toBe(1);
    expect((daysBetween(month.rangeStart, month.rangeEnd) + 1) % 7).toBe(0);

    const quarter = deriveRange(spans, 'quarter', '2026-03-12');
    expect(quarter.rangeStart).toBe(startOfMonthDay(quarter.rangeStart));
    expect(addDays(quarter.rangeEnd, 1)).toBe(startOfMonthDay(addDays(quarter.rangeEnd, 1)));
  });

  it('centres on today when nothing is dated at all', () => {
    const { rangeStart, rangeEnd } = deriveRange(
      [{ startDate: null, dueDate: null }],
      'week',
      '2026-03-12',
    );
    expect(rangeStart < '2026-03-12').toBe(true);
    expect(rangeEnd > '2026-03-12').toBe(true);
    expect(daysBetween(rangeStart, rangeEnd) + 1).toBeGreaterThanOrEqual(MIN_RANGE_DAYS);
  });

  it('pads further at coarser zooms', () => {
    const wide = { startDate: '2026-03-10', dueDate: '2026-09-14' };
    const week = deriveRange([wide], 'week', '2026-03-12');
    const quarter = deriveRange([wide], 'quarter', '2026-03-12');
    expect(quarter.rangeStart < week.rangeStart).toBe(true);
    expect(quarter.rangeEnd > week.rangeEnd).toBe(true);
  });

  it('feeds a geometry whose segments cover exactly the derived range', () => {
    for (const zoom of ZOOM_LEVELS) {
      const range = deriveRange(spans, zoom, '2026-03-12');
      const geometry = createGanttGeometry({ zoom, ...range, today: '2026-03-12' });
      expect(geometry.axis.lower.every((segment) => segment.whole)).toBe(true);
      expect(geometry.axis.lower[0]?.start).toBe(range.rangeStart);
      expect(geometry.axis.lower[geometry.axis.lower.length - 1]?.end).toBe(range.rangeEnd);
    }
  });
});
