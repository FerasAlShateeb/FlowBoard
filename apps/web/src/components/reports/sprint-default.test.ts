import { describe, expect, it } from 'vitest';
import type { Sprint, SprintState } from '@flowboard/shared';

import {
  completedSprintsNewestFirst,
  orderSprintsForPicker,
  pickDefaultSprint,
  pickDefaultSprintId,
} from '@/components/reports/sprint-default';

/**
 * Which sprint the dashboard opens on — active, else most recently completed.
 *
 * The ordering deserves its own tests because the sprint list arrives in
 * whatever order the API returns it, and "most recent" has three possible
 * sources (`completedAt`, the planned `endDate`, `createdAt`) whose precedence
 * is the whole point.
 */
function sprint(id: string, state: SprintState, overrides: Partial<Sprint> = {}): Sprint {
  return {
    id,
    projectId: 'project-1',
    name: id,
    goal: null,
    state,
    startDate: null,
    endDate: null,
    startedAt: null,
    completedAt: null,
    committedPoints: null,
    completedPoints: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pickDefaultSprint', () => {
  it('prefers the ACTIVE sprint over any completed one', () => {
    const sprints = [
      sprint('done', 'completed', { completedAt: '2026-08-20T00:00:00.000Z' }),
      sprint('running', 'active'),
    ];
    expect(pickDefaultSprint(sprints)?.id).toBe('running');
  });

  it('falls back to the most recently completed sprint', () => {
    const sprints = [
      sprint('old', 'completed', { completedAt: '2026-06-01T00:00:00.000Z' }),
      sprint('new', 'completed', { completedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(pickDefaultSprint(sprints)?.id).toBe('new');
  });

  it('never opens on a PLANNED sprint — it has no commitment stamp yet', () => {
    expect(pickDefaultSprint([sprint('future', 'planned')])).toBeNull();
  });

  it('is null for a project with no sprints at all', () => {
    expect(pickDefaultSprint([])).toBeNull();
    expect(pickDefaultSprintId([])).toBeNull();
    expect(pickDefaultSprintId(undefined)).toBeNull();
  });

  it('returns the id, which is what the report hooks take', () => {
    expect(pickDefaultSprintId([sprint('running', 'active')])).toBe('running');
  });
});

describe('completedSprintsNewestFirst', () => {
  it('ranks by the ACTUAL completion stamp, not the planned end date', () => {
    const sprints = [
      // Planned to end later, but actually finished first.
      sprint('a', 'completed', {
        endDate: '2026-09-30',
        completedAt: '2026-07-01T00:00:00.000Z',
      }),
      sprint('b', 'completed', {
        endDate: '2026-07-15',
        completedAt: '2026-08-01T00:00:00.000Z',
      }),
    ];
    expect(completedSprintsNewestFirst(sprints).map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('falls back to the planned end date when a stamp is missing', () => {
    const sprints = [
      sprint('a', 'completed', { endDate: '2026-05-01' }),
      sprint('b', 'completed', { endDate: '2026-09-01' }),
    ];
    expect(completedSprintsNewestFirst(sprints).map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('orderSprintsForPicker', () => {
  it('lists active, then completed newest-first, then planned', () => {
    const sprints = [
      sprint('planned', 'planned'),
      sprint('old', 'completed', { completedAt: '2026-05-01T00:00:00.000Z' }),
      sprint('active', 'active'),
      sprint('recent', 'completed', { completedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(orderSprintsForPicker(sprints).map((entry) => entry.id)).toEqual([
      'active',
      'recent',
      'old',
      'planned',
    ]);
  });

  it('puts the DEFAULT first, so the pre-selected row opens at the top', () => {
    const sprints = [sprint('old', 'completed'), sprint('active', 'active')];
    expect(orderSprintsForPicker(sprints)[0]?.id).toBe(pickDefaultSprint(sprints)?.id);
  });
});
