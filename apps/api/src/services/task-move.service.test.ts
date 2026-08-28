/**
 * Unit coverage for the PURE half of the status-change rule set.
 *
 * `validateStatusChange`, `assertTransitionAllowed` and `assertWipCapacity` all
 * read the database and are covered end to end by
 * `routes/__tests__/tasks-move.routes.test.ts`. What is testable in isolation —
 * and worth testing here rather than through six HTTP round trips — is the
 * decision logic those three wrap:
 *
 *   - `requireStatus`  — a status id is narrowed to THIS project, or refused;
 *   - `defaultStatus`  — where a task lands when nobody names a column;
 *   - `resolutionFor`  — the `resolved_at` stamp, including the two edges the
 *                        route suite does not reach: reopening a done task, and
 *                        moving between two done columns.
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../utils/api-error';
import { defaultStatus, requireStatus, resolutionFor, type StatusInfo } from './task-move.service';

function status(overrides: Partial<StatusInfo> & Pick<StatusInfo, 'id'>): StatusInfo {
  return {
    name: 'Column',
    category: 'todo',
    position: 0,
    wipLimit: null,
    ...overrides,
  };
}

const TODO = status({ id: 'todo-1', name: 'To Do', category: 'todo', position: 1 });
const DOING = status({ id: 'doing-1', name: 'In Progress', category: 'in_progress', position: 2 });
const DONE = status({ id: 'done-1', name: 'Done', category: 'done', position: 3 });

describe('requireStatus', () => {
  it('returns the column when the id belongs to the project', () => {
    expect(requireStatus([TODO, DOING, DONE], DOING.id)).toBe(DOING);
  });

  it('refuses an id from somebody else s project with a 400, not a 404', () => {
    // A 404 would say "this status does not exist", which is both untrue and a
    // cross-tenant existence probe. The id is a request FIELD, so it is a 400.
    try {
      requireStatus([TODO, DONE], 'a-status-from-another-project');
      expect.unreachable('requireStatus accepted a foreign status id');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });

  it('refuses every id when the project has no columns at all', () => {
    expect(() => requireStatus([], TODO.id)).toThrow(ApiError);
  });
});

describe('defaultStatus', () => {
  it('picks the first todo column, not merely the leftmost one', () => {
    // `available` arrives in board order, so a workflow whose leftmost column is
    // an in_progress one still drops new work in the first todo.
    expect(defaultStatus([DOING, TODO, DONE])).toBe(TODO);
  });

  it('falls back to the leftmost column when the workflow has no todo', () => {
    expect(defaultStatus([DOING, DONE])).toBe(DOING);
  });

  it('refuses a project that has been edited down to no columns', () => {
    try {
      defaultStatus([]);
      expect.unreachable('defaultStatus invented a column');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });
});

describe('resolutionFor', () => {
  const now = new Date('2026-05-01T12:00:00.000Z');
  const earlier = new Date('2026-04-01T09:00:00.000Z');

  it('stamps resolvedAt and reports completion on the todo -> done edge', () => {
    expect(resolutionFor('todo', 'done', null, now)).toEqual({
      resolvedAt: now,
      changed: true,
      completed: true,
    });
  });

  it('stamps resolvedAt on the in_progress -> done edge too', () => {
    expect(resolutionFor('in_progress', 'done', null, now)).toEqual({
      resolvedAt: now,
      changed: true,
      completed: true,
    });
  });

  it('CLEARS resolvedAt when a done task is reopened, and is not a completion', () => {
    // The reopen edge. Cycle-time and velocity both read `resolved_at`, so a
    // stamp left behind here would keep counting a task that is back in flight.
    expect(resolutionFor('done', 'in_progress', earlier, now)).toEqual({
      resolvedAt: null,
      changed: true,
      completed: false,
    });
    expect(resolutionFor('done', 'todo', earlier, now)).toEqual({
      resolvedAt: null,
      changed: true,
      completed: false,
    });
  });

  it('keeps the ORIGINAL stamp when a task moves between two done columns', () => {
    // "Done" -> "Released" is not a second completion: the task finished once,
    // and the reports must keep reading the date it actually finished on.
    expect(resolutionFor('done', 'done', earlier, now)).toEqual({
      resolvedAt: earlier,
      changed: false,
      completed: false,
    });
  });

  it('back-fills a done task that somehow has no stamp, without claiming completion', () => {
    expect(resolutionFor('done', 'done', null, now)).toEqual({
      resolvedAt: now,
      changed: true,
      completed: false,
    });
  });

  it('leaves a task that never touched done alone', () => {
    expect(resolutionFor('todo', 'in_progress', null, now)).toEqual({
      resolvedAt: null,
      changed: false,
      completed: false,
    });
  });

  it('keys off the CATEGORY, so a column named anything still resolves', () => {
    // The whole point of reading `category`: a project is free to call its done
    // column "Shipped", and nothing here reads a name.
    expect(resolutionFor('in_progress', 'done', null, now).completed).toBe(true);
  });

  it('defaults `now` to the current instant when the caller does not pin one', () => {
    const before = Date.now();
    const result = resolutionFor('todo', 'done', null);
    const after = Date.now();
    expect(result.resolvedAt).toBeInstanceOf(Date);
    const stamped = (result.resolvedAt as Date).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});
