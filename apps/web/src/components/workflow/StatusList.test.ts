/**
 * `statusSyncSignature` — the rule that decides when the workflow editor's
 * local copy of the status list is refreshed from the server.
 *
 * The signature exists because `StatusList` holds its own `order` array so a
 * drag can reorder rows under the pointer before the server agrees. Re-syncing
 * on array identity would churn on every parent render and fight that drag;
 * re-syncing on too NARROW a signature leaves the rows rendering stale objects.
 * These tests pin both edges.
 */
import { describe, expect, it } from 'vitest';
import type { Status } from '@flowboard/shared';

import { statusSyncSignature } from './StatusList';

function status(overrides: Partial<Status> = {}): Status {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    name: 'To Do',
    category: 'todo',
    color: '#8b8b8b',
    position: 0,
    wipLimit: null,
    ...overrides,
  };
}

describe('statusSyncSignature', () => {
  it('is stable for equal data, so an unrelated parent render does not re-sync', () => {
    // The whole reason this is a signature and not an array-identity check: a
    // re-render that produces an equal list must not reset a drag in progress.
    expect(statusSyncSignature([status()])).toBe(statusSyncSignature([status()]));
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * The signature used to be the id sequence alone. A rename does not change an
   * id, so it did not move the signature, the effect never re-ran, and the rows
   * kept rendering the old `Status` objects — most visibly the delete button,
   * whose `aria-label` announces the status name.
   */
  it('MOVES when a status is renamed', () => {
    const before = statusSyncSignature([status({ name: 'To Do' })]);
    const after = statusSyncSignature([status({ name: 'Ready' })]);

    expect(after).not.toBe(before);
  });

  it('moves when any other rendered field changes', () => {
    const base = statusSyncSignature([status()]);

    expect(statusSyncSignature([status({ category: 'in_progress' })])).not.toBe(base);
    expect(statusSyncSignature([status({ color: '#ff0000' })])).not.toBe(base);
    expect(statusSyncSignature([status({ wipLimit: 3 })])).not.toBe(base);
  });

  /**
   * `null` and `0` are different answers — "no limit" versus a limit the schema
   * would refuse — so they must not collapse into the same signature.
   */
  it('distinguishes a cleared WIP limit from a zero one', () => {
    expect(statusSyncSignature([status({ wipLimit: null })])).not.toBe(
      statusSyncSignature([status({ wipLimit: 0 })]),
    );
  });

  it('moves when the order changes, with the same members', () => {
    const todo = status({ id: '33333333-3333-4333-8333-333333333333', name: 'To Do' });
    const done = status({ id: '44444444-4444-4444-8444-444444444444', name: 'Done' });

    expect(statusSyncSignature([todo, done])).not.toBe(statusSyncSignature([done, todo]));
  });

  it('moves when a status is added or removed', () => {
    const todo = status({ id: '33333333-3333-4333-8333-333333333333' });
    const done = status({ id: '44444444-4444-4444-8444-444444444444', name: 'Done' });

    expect(statusSyncSignature([todo])).not.toBe(statusSyncSignature([todo, done]));
  });

  it('is empty for an empty list rather than throwing', () => {
    expect(statusSyncSignature([])).toBe('');
  });
});
