import { describe, expect, it } from 'vitest';
import type {
  BurndownDay,
  BurnupDay,
  CumulativeFlowDay,
  VelocitySprint,
  WorkloadAssignee,
} from '@flowboard/shared';

import {
  burndownHeadline,
  burnupHeadline,
  cumulativeFlowHeadline,
  cycleTimeHeadline,
  sortWorkload,
  velocityAverage,
  velocityHeadline,
  workloadHeadline,
  workloadRows,
  workloadScale,
} from '@/components/reports/report-summaries';

/**
 * The headline numbers behind the screen-reader sentences — and, because a
 * chart is empty exactly when it has no headline, the empty-state rules too.
 *
 * `null` is the contract these tests are really about: every card branches on
 * it, so a function that returns zeroes for an empty payload would draw axes
 * around nothing and announce "0 points remain".
 */

function burndownDay(date: string, remaining: number, ideal: number): BurndownDay {
  return { date, remainingPoints: remaining, idealPoints: ideal };
}

function burnupDay(date: string, completed: number, scope: number): BurnupDay {
  return { date, completedPoints: completed, scopePoints: scope };
}

function flowDay(date: string, todo: number, inProgress: number, done: number): CumulativeFlowDay {
  return { date, counts: { todo, in_progress: inProgress, done } };
}

function sprint(name: string, committed: number, completed: number): VelocitySprint {
  return {
    sprintId: `11111111-1111-4111-8111-${name.padStart(12, '0')}`,
    name,
    committedPoints: committed,
    completedPoints: completed,
  };
}

function load(id: string | null, tasks: number, points: number): WorkloadAssignee {
  return {
    user: id === null ? null : { id, name: `User ${id}`, avatarUrl: null },
    openTasks: tasks,
    openPoints: points,
  };
}

describe('burndownHeadline', () => {
  it('reports the LAST day — "how are we doing" is a question about now', () => {
    expect(
      burndownHeadline([burndownDay('2026-08-01', 20, 20), burndownDay('2026-08-02', 13, 16)]),
    ).toEqual({ days: 2, remaining: 13, ideal: 16 });
  });

  it('is null for a sprint with no day buckets', () => {
    expect(burndownHeadline([])).toBeNull();
  });
});

describe('burnupHeadline', () => {
  it('reports completion against the CURRENT scope, creep included', () => {
    expect(
      burnupHeadline([burnupDay('2026-08-01', 0, 20), burnupDay('2026-08-02', 5, 26)]),
    ).toEqual({ days: 2, completed: 5, scope: 26 });
  });

  it('is null when empty', () => {
    expect(burnupHeadline([])).toBeNull();
  });
});

describe('cumulativeFlowHeadline', () => {
  it('splits the last day across the three categories', () => {
    expect(cumulativeFlowHeadline([flowDay('2026-08-01', 4, 2, 1)])).toEqual({
      days: 1,
      todo: 4,
      inProgress: 2,
      done: 1,
    });
  });

  it('treats an all-zero window as empty, not as a flat chart', () => {
    expect(cumulativeFlowHeadline([flowDay('2026-08-01', 0, 0, 0)])).toBeNull();
  });

  it('is not fooled by a zero LAST day when earlier days had work', () => {
    expect(
      cumulativeFlowHeadline([flowDay('2026-08-01', 3, 0, 0), flowDay('2026-08-02', 0, 0, 0)]),
    ).toEqual({ days: 2, todo: 0, inProgress: 0, done: 0 });
  });
});

describe('velocity', () => {
  it('averages COMPLETED points and reports the most recent sprint', () => {
    const sprints = [sprint('S1', 20, 10), sprint('S2', 20, 20), sprint('S3', 20, 15)];
    expect(velocityHeadline(sprints)).toEqual({ sprints: 3, average: 15, last: 15 });
    expect(velocityAverage(sprints)).toBe(15);
  });

  it('is null before any sprint has completed', () => {
    expect(velocityHeadline([])).toBeNull();
    expect(velocityAverage([])).toBeNull();
  });
});

describe('cycleTimeHeadline', () => {
  it('passes the SERVER percentiles through untouched', () => {
    const report = {
      tasks: [
        {
          taskId: '11111111-1111-4111-8111-111111111111',
          key: 'FB-1',
          startedAt: '2026-08-01T09:00:00.000Z',
          resolvedAt: '2026-08-02T09:00:00.000Z',
          hours: 24,
        },
      ],
      p50: 24,
      p90: 40,
    };
    expect(cycleTimeHeadline(report)).toEqual({ tasks: 1, p50: 24, p90: 40 });
  });

  it('is null when nothing resolved in the window', () => {
    expect(cycleTimeHeadline({ tasks: [], p50: null, p90: null })).toBeNull();
  });
});

describe('sortWorkload', () => {
  it('orders by open POINTS, heaviest first', () => {
    const sorted = sortWorkload([load('a', 9, 4), load('b', 2, 12), load('c', 5, 8)]);
    expect(sorted.map((row) => row.user?.id)).toEqual(['b', 'c', 'a']);
  });

  it('tie-breaks equal points by task count', () => {
    const sorted = sortWorkload([load('a', 2, 8), load('b', 7, 8)]);
    expect(sorted.map((row) => row.user?.id)).toEqual(['b', 'a']);
  });

  it('pins the unassigned bucket LAST however heavy it is', () => {
    const sorted = sortWorkload([load(null, 40, 99), load('a', 1, 1)]);
    expect(sorted.map((row) => row.user?.id ?? 'unassigned')).toEqual(['a', 'unassigned']);
  });

  it('does not mutate its input', () => {
    const input = [load('a', 1, 1), load('b', 2, 9)];
    sortWorkload(input);
    expect(input.map((row) => row.user?.id)).toEqual(['a', 'b']);
  });
});

describe('workloadRows / workloadScale / workloadHeadline', () => {
  it('drops rows carrying nothing', () => {
    expect(workloadRows([load('a', 0, 0), load('b', 3, 5)]).map((row) => row.user?.id)).toEqual([
      'b',
    ]);
  });

  it('scales by points when anything is estimated', () => {
    expect(workloadScale([load('a', 3, 5), load('b', 9, 2)])).toEqual({
      metric: 'points',
      max: 5,
    });
  });

  it('falls back to task counts when nothing is estimated', () => {
    expect(workloadScale([load('a', 3, 0), load('b', 9, 0)])).toEqual({
      metric: 'tasks',
      max: 9,
    });
  });

  it('totals only the rows that are drawn', () => {
    expect(workloadHeadline([load('a', 3, 5), load(null, 1, 2), load('c', 0, 0)])).toEqual({
      people: 2,
      tasks: 4,
      points: 7,
    });
  });

  it('is null when nobody carries open work', () => {
    expect(workloadHeadline([])).toBeNull();
    expect(workloadHeadline([load('a', 0, 0)])).toBeNull();
  });
});
