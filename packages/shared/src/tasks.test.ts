import { describe, expect, it } from 'vitest';
import {
  boardResponseSchema,
  createDependencyInputSchema,
  createTaskInputSchema,
  MAX_SEARCH_RESULTS,
  moveTaskInputSchema,
  patchTaskInputSchema,
  projectDependenciesResponseSchema,
  rankTaskInputSchema,
  searchQuerySchema,
  taskFiltersSchema,
  taskKeySchema,
  taskListQuerySchema,
  taskSummarySchema,
  watcherResponseSchema,
} from './tasks.schema';

const STATUS_A = '11111111-1111-4111-8111-111111111111';
const STATUS_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const TASK_A = '44444444-4444-4444-8444-444444444444';
const TASK_B = '55555555-5555-4555-8555-555555555555';

const summary = {
  id: TASK_A,
  number: 12,
  title: 'Ship the board',
  type: 'story',
  priority: 'high',
  statusId: STATUS_A,
  assignee: { id: USER_A, name: 'Ada', avatarUrl: null },
  storyPoints: 5,
  startDate: null,
  dueDate: '2026-03-01',
  labelIds: [],
  epicId: null,
  parentId: null,
  boardRank: 'a1',
  backlogRank: 'a1',
  sprintId: null,
  hasDescription: true,
  commentCount: 2,
  attachmentCount: 0,
  updatedAt: '2026-02-01T10:00:00Z',
};

describe('taskKeySchema', () => {
  it('accepts a well-formed key and uppercases it', () => {
    expect(taskKeySchema.parse('flow-123')).toBe('FLOW-123');
  });

  it('rejects a key without a number or with a too-long prefix', () => {
    expect(taskKeySchema.safeParse('FLOW-').success).toBe(false);
    expect(taskKeySchema.safeParse('TOOLONGPREFIX-1').success).toBe(false);
    expect(taskKeySchema.safeParse('1FLOW-1').success).toBe(false);
  });
});

describe('taskSummarySchema', () => {
  it('parses a board card', () => {
    const parsed = taskSummarySchema.parse(summary);

    expect(parsed.assignee?.name).toBe('Ada');
    expect(parsed.hasDescription).toBe(true);
  });

  it('rejects a card missing its rank', () => {
    const { boardRank: _boardRank, ...withoutRank } = summary;

    expect(taskSummarySchema.safeParse(withoutRank).success).toBe(false);
  });

  it('rejects an unknown task type', () => {
    expect(taskSummarySchema.safeParse({ ...summary, type: 'chore' }).success).toBe(false);
  });
});

describe('boardResponseSchema', () => {
  it('keeps empty columns, so the board still draws them', () => {
    const parsed = boardResponseSchema.parse({
      columns: { [STATUS_A]: [summary], [STATUS_B]: [] },
    });

    expect(Object.keys(parsed.columns)).toHaveLength(2);
    expect(parsed.columns[STATUS_B]).toEqual([]);
  });

  it('rejects a column holding something that is not a task summary', () => {
    expect(
      boardResponseSchema.safeParse({ columns: { [STATUS_A]: [{ id: TASK_A }] } }).success,
    ).toBe(false);
  });
});

describe('taskFiltersSchema', () => {
  it('splits comma-separated multi-value params', () => {
    const parsed = taskFiltersSchema.parse({
      statusId: `${STATUS_A},${STATUS_B}`,
      type: 'bug,task',
      priority: 'high,highest',
    });

    expect(parsed.statusId).toEqual([STATUS_A, STATUS_B]);
    expect(parsed.type).toEqual(['bug', 'task']);
    expect(parsed.priority).toEqual(['high', 'highest']);
  });

  it('accepts the none sentinel on every nullable-id filter', () => {
    const parsed = taskFiltersSchema.parse({
      sprintId: 'none',
      assigneeId: 'none',
      epicId: 'none',
      parentId: 'none',
    });

    expect(parsed.sprintId).toEqual(['none']);
    expect(parsed.assigneeId).toEqual(['none']);
    expect(parsed.epicId).toEqual(['none']);
    expect(parsed.parentId).toEqual(['none']);
  });

  it('mixes the sentinel with real ids in one param', () => {
    expect(taskFiltersSchema.parse({ sprintId: `none,${STATUS_A}` }).sprintId).toEqual([
      'none',
      STATUS_A,
    ]);
  });

  it('refuses the sentinel where NULL is not a possible value', () => {
    expect(taskFiltersSchema.safeParse({ statusId: 'none' }).success).toBe(false);
    expect(taskFiltersSchema.safeParse({ labelId: 'none' }).success).toBe(false);
  });

  it('leaves an absent filter absent rather than defaulting it', () => {
    expect(taskFiltersSchema.parse({})).toEqual({});
  });

  it('distinguishes a calendar due-date bound from an instant sync cursor', () => {
    expect(taskFiltersSchema.safeParse({ dueFrom: '2026-01-01' }).success).toBe(true);
    expect(taskFiltersSchema.safeParse({ dueFrom: '2026-01-01T00:00:00Z' }).success).toBe(false);
    expect(taskFiltersSchema.safeParse({ updatedSince: '2026-01-01T00:00:00Z' }).success).toBe(
      true,
    );
  });

  it('carries a start-date window alongside the due-date one', () => {
    // The Calendar and Roadmap draw a task as a SPAN, so "which tasks touch
    // this month" needs both columns; a due-only pair cannot see a task that
    // starts inside the window and is due outside it.
    const parsed = taskFiltersSchema.parse({ startFrom: '2026-04-01', startTo: '2026-04-30' });
    expect(parsed).toEqual({ startFrom: '2026-04-01', startTo: '2026-04-30' });
    expect(taskFiltersSchema.safeParse({ startFrom: '2026-04-01T00:00:00Z' }).success).toBe(false);
  });

  it('accepts `undated` from a query string as well as a JSON body', () => {
    expect(taskFiltersSchema.parse({ undated: 'true' }).undated).toBe(true);
    expect(taskFiltersSchema.parse({ undated: '1' }).undated).toBe(true);
    expect(taskFiltersSchema.parse({ undated: 'false' }).undated).toBe(false);
    expect(taskFiltersSchema.parse({ undated: true }).undated).toBe(true);
    // Absent means "do not filter", which is a different question from `false`.
    expect(taskFiltersSchema.parse({})).not.toHaveProperty('undated');
    expect(taskFiltersSchema.safeParse({ undated: 'yes' }).success).toBe(false);
  });

  /**
   * THE OR-WINDOW, parameter by parameter.
   *
   * `(dueFrom ≤ due ≤ dueTo) OR (startFrom ≤ start ≤ startTo)` is a documented
   * contract with four independent optional halves, and the Calendar and
   * Roadmap both build the query from a month boundary that can supply any
   * subset of them. The schema's job is to let every subset through unchanged —
   * a schema that quietly required pairs would turn "everything due before the
   * 5th" into a 422, and one that reordered or defaulted a bound would change
   * which tasks the month shows.
   */
  describe('the start/due OR-window', () => {
    it.each([
      ['a due window alone', { dueFrom: '2026-04-01', dueTo: '2026-04-30' }],
      ['a start window alone', { startFrom: '2026-04-01', startTo: '2026-04-30' }],
      [
        'both windows, the full calendar query',
        {
          dueFrom: '2026-04-01',
          dueTo: '2026-04-30',
          startFrom: '2026-04-01',
          startTo: '2026-04-30',
        },
      ],
      ['an open-ended due window (from only)', { dueFrom: '2026-04-01' }],
      ['an open-ended due window (to only)', { dueTo: '2026-04-30' }],
      ['an open-ended start window (from only)', { startFrom: '2026-04-01' }],
      ['an open-ended start window (to only)', { startTo: '2026-04-30' }],
      [
        'crossed halves — a due floor and a start ceiling',
        {
          dueFrom: '2026-04-01',
          startTo: '2026-04-30',
        },
      ],
    ])('passes %s through unchanged', (_label, input) => {
      expect(taskFiltersSchema.parse(input)).toEqual(input);
    });

    it('accepts a single-day window, where both bounds are the same date', () => {
      expect(taskFiltersSchema.parse({ startFrom: '2026-04-07', startTo: '2026-04-07' })).toEqual({
        startFrom: '2026-04-07',
        startTo: '2026-04-07',
      });
    });

    it('does NOT reject a reversed window — an empty result is the honest answer', () => {
      // There is no cross-field refinement here on purpose: a reversed range
      // selects nothing, which is what the caller asked for. Refusing it would
      // make a date picker mid-drag throw a 422 at the user.
      expect(
        taskFiltersSchema.safeParse({ startFrom: '2026-04-30', startTo: '2026-04-01' }).success,
      ).toBe(true);
    });

    it('rejects an INSTANT on any of the four bounds — these are calendar days', () => {
      for (const key of ['dueFrom', 'dueTo', 'startFrom', 'startTo']) {
        expect(taskFiltersSchema.safeParse({ [key]: '2026-04-01T00:00:00Z' }).success).toBe(false);
        expect(taskFiltersSchema.safeParse({ [key]: 'not-a-date' }).success).toBe(false);
      }
    });

    it('accepts `undated` ALONGSIDE a window, which simply matches nothing', () => {
      // Documented and deliberate: a row with no dates cannot satisfy a range,
      // so the combination returns an empty set rather than a validation error.
      // The Calendar sends the tray query and the grid query separately, and a
      // schema-level ban would make a merged one impossible to even express.
      const both = { undated: true, startFrom: '2026-04-01', startTo: '2026-04-30' };
      expect(taskFiltersSchema.parse(both)).toEqual(both);
    });

    it('keeps `undated: false` distinct from an absent `undated`', () => {
      expect(taskFiltersSchema.parse({ undated: 'false' })).toEqual({ undated: false });
      expect(taskFiltersSchema.parse({})).toEqual({});
    });

    it('combines a window with the ordinary id filters without interference', () => {
      const parsed = taskFiltersSchema.parse({
        startFrom: '2026-04-01',
        startTo: '2026-04-30',
        assigneeId: 'none',
        sprintId: `${STATUS_A}`,
      });

      expect(parsed).toEqual({
        startFrom: '2026-04-01',
        startTo: '2026-04-30',
        assigneeId: ['none'],
        sprintId: [STATUS_A],
      });
    });

    it('strips a bound the contract does not name — the query is a closed set', () => {
      const parsed = taskFiltersSchema.parse({
        startFrom: '2026-04-01',
        resolvedFrom: '2026-04-01',
      });

      expect(parsed).toEqual({ startFrom: '2026-04-01' });
      expect(parsed).not.toHaveProperty('resolvedFrom');
    });
  });
});

describe('projectDependenciesResponseSchema', () => {
  it('carries bare id pairs — the arrow layer needs nothing else', () => {
    const parsed = projectDependenciesResponseSchema.parse({
      edges: [{ blockerTaskId: STATUS_A, blockedTaskId: STATUS_B }],
    });
    expect(parsed.edges).toEqual([{ blockerTaskId: STATUS_A, blockedTaskId: STATUS_B }]);
  });

  it('accepts an empty set — a project with no dependencies is not an error', () => {
    expect(projectDependenciesResponseSchema.parse({ edges: [] }).edges).toEqual([]);
  });

  it('refuses an edge that is not a pair of uuids', () => {
    expect(
      projectDependenciesResponseSchema.safeParse({ edges: [{ blockerTaskId: STATUS_A }] }).success,
    ).toBe(false);
    expect(
      projectDependenciesResponseSchema.safeParse({
        edges: [{ blockerTaskId: 'nope', blockedTaskId: STATUS_B }],
      }).success,
    ).toBe(false);
  });
});

describe('taskListQuerySchema', () => {
  it('carries the filters plus a flat-view and pagination default', () => {
    const parsed = taskListQuerySchema.parse({ type: 'bug' });

    expect(parsed).toMatchObject({ view: 'flat', page: 1, pageSize: 25, type: ['bug'] });
  });

  it('accepts the board view', () => {
    expect(taskListQuerySchema.parse({ view: 'board' }).view).toBe('board');
  });

  it('rejects a view it does not implement', () => {
    expect(taskListQuerySchema.safeParse({ view: 'gantt' }).success).toBe(false);
  });
});

describe('write inputs', () => {
  it('fills a create body with the documented defaults', () => {
    const parsed = createTaskInputSchema.parse({ title: 'New task' });

    expect(parsed).toMatchObject({
      type: 'task',
      priority: 'medium',
      description: null,
      assigneeId: null,
      sprintId: null,
      labelIds: [],
      watcherIds: [],
    });
    expect(parsed.statusId).toBeUndefined();
  });

  it('rejects a create body with an empty title', () => {
    expect(createTaskInputSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('accepts a single-field patch and rejects an empty one', () => {
    expect(patchTaskInputSchema.parse({ assigneeId: null })).toEqual({ assigneeId: null });
    expect(patchTaskInputSchema.safeParse({}).success).toBe(false);
  });

  it('refuses to patch a rank directly — ranks come from move/rank', () => {
    const parsed = patchTaskInputSchema.parse({ title: 'x', boardRank: 'zz' });

    expect(parsed).not.toHaveProperty('boardRank');
  });

  it('accepts a move with one neighbour, or none (drop at the end)', () => {
    expect(moveTaskInputSchema.safeParse({ statusId: STATUS_A }).success).toBe(true);
    expect(
      moveTaskInputSchema.safeParse({ statusId: STATUS_A, beforeTaskId: TASK_B }).success,
    ).toBe(true);
  });

  it('rejects a move that names both neighbours', () => {
    const result = moveTaskInputSchema.safeParse({
      statusId: STATUS_A,
      beforeTaskId: TASK_A,
      afterTaskId: TASK_B,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a rank into the backlog (sprintId null) and rejects a missing sprintId', () => {
    expect(rankTaskInputSchema.parse({ sprintId: null }).sprintId).toBeNull();
    expect(rankTaskInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('searchQuerySchema', () => {
  it('defaults the limit and enforces the 2-character floor', () => {
    expect(searchQuerySchema.parse({ q: 'bo' })).toEqual({ q: 'bo', limit: 20 });
    expect(searchQuerySchema.safeParse({ q: 'b' }).success).toBe(false);
  });

  it('REJECTS an over-large limit rather than clamping it silently', () => {
    expect(searchQuerySchema.parse({ q: 'bo', limit: String(MAX_SEARCH_RESULTS) }).limit).toBe(
      MAX_SEARCH_RESULTS,
    );
    // A clamped limit reads to the caller as the org having fewer matches than
    // it does; a 422 says the request was wrong.
    expect(searchQuerySchema.safeParse({ q: 'bo', limit: MAX_SEARCH_RESULTS + 1 }).success).toBe(
      false,
    );
  });
});

describe('createDependencyInputSchema', () => {
  it('accepts either direction of the blocks edge', () => {
    expect(createDependencyInputSchema.parse({ blockerTaskId: TASK_B })).toEqual({
      blockerTaskId: TASK_B,
    });
    expect(createDependencyInputSchema.parse({ blockedTaskId: TASK_B })).toEqual({
      blockedTaskId: TASK_B,
    });
  });

  it('refuses both directions at once, and neither', () => {
    // Both has no correct reading — the two halves describe different edges.
    expect(
      createDependencyInputSchema.safeParse({ blockerTaskId: TASK_A, blockedTaskId: TASK_B })
        .success,
    ).toBe(false);
    expect(createDependencyInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('watcherResponseSchema', () => {
  it('reports the resulting state, so an idempotent PUT/DELETE stays in sync', () => {
    const parsed = watcherResponseSchema.parse({
      taskId: TASK_A,
      userId: USER_A,
      watching: true,
      isMuted: false,
    });

    expect(parsed).toEqual({ taskId: TASK_A, userId: USER_A, watching: true, isMuted: false });
  });

  it('rejects a payload missing the state flags', () => {
    expect(watcherResponseSchema.safeParse({ taskId: TASK_A, userId: USER_A }).success).toBe(false);
  });
});

describe('taskListQuerySchema sort', () => {
  it('parses a whitelisted sort spec into a literal field + direction', () => {
    expect(taskListQuerySchema.parse({ sort: 'dueDate:desc' }).sort).toEqual({
      field: 'dueDate',
      direction: 'desc',
    });
  });

  it('rejects a field the API cannot order by, at the boundary', () => {
    expect(taskListQuerySchema.safeParse({ sort: 'passwordHash:asc' }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ sort: 'dueDate:sideways' }).success).toBe(false);
  });

  it('defaults a bare field to ascending', () => {
    expect(taskListQuerySchema.parse({ sort: 'title' }).sort).toEqual({
      field: 'title',
      direction: 'asc',
    });
  });

  it('leaves sort absent when it is not asked for', () => {
    expect(taskListQuerySchema.parse({})).not.toHaveProperty('sort');
  });
});
