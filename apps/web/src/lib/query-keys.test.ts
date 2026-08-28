import { describe, expect, it } from 'vitest';

import { filtersKey, qk, stableKey } from '@/lib/query-keys';

/**
 * The query-key factory is load-bearing for cache correctness: optimistic drag
 * updates write through these keys, and the socket layer invalidates by PREFIX.
 * Two properties therefore have to hold, and neither is visible at a call site:
 *
 *   1. **Stability** — the same logical query must produce an identical key
 *      whatever order its filters were assembled in. Query keys are compared
 *      structurally, so an unstable key silently doubles the cache and half the
 *      invalidations miss.
 *   2. **Prefix containment** — a narrower key must literally start with its
 *      parent's, or `invalidateQueries({ queryKey: parent })` will not reach it.
 */

describe('filtersKey', () => {
  it('is order-independent across object keys', () => {
    expect(filtersKey({ status: 'todo', assignee: 'u-1' })).toBe(
      filtersKey({ assignee: 'u-1', status: 'todo' }),
    );
  });

  it('is order-independent within an array value', () => {
    expect(filtersKey({ label: ['ui', 'bug'] })).toBe(filtersKey({ label: ['bug', 'ui'] }));
  });

  it('treats an absent, empty and null filter as the same query', () => {
    const empty = filtersKey(undefined);
    expect(filtersKey({})).toBe(empty);
    expect(filtersKey({ q: '', assignee: null, label: [] })).toBe(empty);
  });

  it('distinguishes genuinely different filters', () => {
    expect(filtersKey({ status: 'todo' })).not.toBe(filtersKey({ status: 'done' }));
  });
});

describe('key hierarchy', () => {
  it('nests every project sub-key under the project prefix', () => {
    const prefix = qk.project.all('p-1');

    for (const key of [
      qk.project.detail('p-1'),
      qk.project.statuses('p-1'),
      qk.tasks.board('p-1'),
      qk.tasks.backlog('p-1'),
      qk.sprints.list('p-1'),
      qk.reports.velocity('p-1'),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
  });

  it('nests every task sub-key under the task prefix', () => {
    const prefix = qk.task.all('t-1');

    for (const key of [
      qk.task.detail('t-1'),
      qk.task.comments('t-1'),
      qk.task.activity('t-1'),
      qk.task.attachments('t-1'),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
  });

  it('keeps a single task OUT of the project prefix', () => {
    // Deliberate: the task sheet is deep-linkable by key and a `task:updated`
    // socket event does not always carry a project id, so `['task', id]` has to
    // be addressable without one.
    expect(qk.task.detail('t-1')[0]).toBe('task');
    expect(qk.project.all('p-1')[0]).toBe('project');
  });

  it('separates the board and backlog orderings of the same rows', () => {
    expect(qk.tasks.board('p-1')).not.toEqual(qk.tasks.backlog('p-1'));
  });

  it('produces identical keys for equivalent inputs', () => {
    expect(qk.tasks.board('p-1', { status: 'todo', label: ['a', 'b'] })).toEqual(
      qk.tasks.board('p-1', { label: ['b', 'a'], status: 'todo' }),
    );
  });

  it('defaults pagination so an unpaged and a first-page call agree', () => {
    expect(qk.tasks.list('p-1', undefined, { page: 1, pageSize: 25 })).toEqual(
      qk.tasks.list('p-1', undefined, {}),
    );
  });

  it('gives each SORT its own entry — a re-sort changes what page 2 holds', () => {
    const ascending = qk.tasks.list('p-1', undefined, { page: 2, sort: 'title:asc' });
    const descending = qk.tasks.list('p-1', undefined, { page: 2, sort: 'title:desc' });

    expect(ascending).not.toEqual(descending);
    // Absent `sort` keeps the pre-WP3.8 key shape, so nothing else re-fetches.
    expect(qk.tasks.list('p-1', undefined, { page: 2 })).toEqual(
      qk.tasks.list('p-1', undefined, { page: 2, sort: undefined }),
    );
  });

  it('scopes project dependencies outside the task collections', () => {
    // A board drag invalidates `qk.tasks.all()`; the project's edge set cannot
    // have changed, so it must not sit under that prefix.
    const dependencies = qk.project.dependencies('p-1');
    expect(dependencies).toEqual(['project', 'p-1', 'dependencies']);
    expect(dependencies.slice(0, 3)).not.toEqual(qk.tasks.all('p-1'));
  });

  it('keeps the log key free of the poll cursor', () => {
    // `sinceId` must NOT be part of the key: the drawer polls every 2s, and a
    // monotonically increasing cursor would mint a new cache entry each time.
    expect(qk.admin.logs('debug')).toEqual(['admin', 'logs', 'debug']);
  });
});

/**
 * `stableKey` is the LOSSLESS sibling of `filtersKey`, used wherever a key
 * segment is not a flat bag of filters. The two properties that matter are the
 * opposite of each other, so both are asserted: order of object KEYS must not
 * change the output, and order of ARRAY MEMBERS must.
 */
describe('stableKey', () => {
  it('is independent of object key order, recursively', () => {
    expect(stableKey({ b: 1, a: { d: 2, c: 3 } })).toBe(stableKey({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('PRESERVES array order — unlike filtersKey, where order is noise', () => {
    expect(stableKey({ a: [1, 2] })).not.toBe(stableKey({ a: [2, 1] }));
    expect(filtersKey({ a: [1, 2] })).toBe(filtersKey({ a: [2, 1] }));
  });

  it('distinguishes a string from the number that shares its spelling', () => {
    expect(stableKey({ a: '1' })).not.toBe(stableKey({ a: 1 }));
    expect(stableKey({ a: 'true' })).not.toBe(stableKey({ a: true }));
  });

  it('keeps null and the empty string, which filtersKey deliberately drops', () => {
    expect(stableKey({ a: null })).not.toBe(stableKey({}));
    expect(stableKey({ a: '' })).not.toBe(stableKey({}));
    expect(filtersKey({ a: null })).toBe(filtersKey({}));
  });

  it('treats an absent property and an explicit undefined as one value', () => {
    expect(stableKey({ a: 1, b: undefined })).toBe(stableKey({ a: 1 }));
  });

  it('serialises undefined itself to the empty string', () => {
    expect(stableKey(undefined)).toBe('');
  });

  it('is stable across repeated calls on equivalent values', () => {
    const once = stableKey({ range: 'sprint', ids: ['a', 'b'], nested: { on: true } });
    const twice = stableKey({ nested: { on: true }, ids: ['a', 'b'], range: 'sprint' });
    expect(once).toBe(twice);
  });
});

/** Keys added by WP2.4 for the hooks Wave 3 consumes. */
describe('WP2.4 key additions', () => {
  it('nests the by-key lookup under the project task prefix', () => {
    const prefix = qk.tasks.all('p-1');
    expect(qk.tasks.byKey('p-1', 'FB-142').slice(0, prefix.length)).toEqual([...prefix]);
  });

  it('gives each sprint state its own list entry', () => {
    expect(qk.sprints.list('p-1', 'active')).not.toEqual(qk.sprints.list('p-1', 'planned'));
    expect(qk.sprints.list('p-1')).not.toEqual(qk.sprints.list('p-1', 'active'));
  });

  it('keeps sprint lists under the project prefix so a project switch drops them', () => {
    const prefix = qk.project.all('p-1');
    expect(qk.sprints.list('p-1', 'active').slice(0, prefix.length)).toEqual([...prefix]);
  });

  it('separates a backlog bucket per sprint', () => {
    expect(qk.tasks.backlog('p-1', { sprintId: 'none' })).not.toEqual(
      qk.tasks.backlog('p-1', { sprintId: 's-1' }),
    );
  });
});
