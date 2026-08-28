/**
 * The query-key factory — one of the project's critical files.
 *
 * WHY A FACTORY AND NOT INLINE ARRAYS. TanStack Query matches keys by PREFIX,
 * and FlowBoard leans on that everywhere: a socket `task:updated` event
 * invalidates `qk.project.all(projectId)` and every board, backlog, table and
 * report query under it refetches, without the realtime layer knowing any of
 * them exist. That only works if the prefixes are genuinely hierarchical and
 * spelled identically at every call site — which a factory guarantees and a
 * hand-written `['tasks', id]` does not.
 *
 * THE SHAPE. Every level exposes an `all` (its own prefix) plus the concrete
 * keys beneath it, so both `invalidateQueries({ queryKey: qk.task.all(id) })`
 * and `setQueryData(qk.task.detail(id), …)` are available at any depth.
 *
 * `as const` on every return is what makes the keys READONLY TUPLES rather than
 * `string[]`, so TypeScript can tell `qk.task.detail(id)` from
 * `qk.task.comments(id)` and `setQueryData` infers the right payload type.
 *
 * FILTERS ARE A STABLE STRING, never an object. Query keys are compared by
 * structural equality, and `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash
 * differently — two cache entries for one screen. {@link filtersKey} sorts the
 * entries before serialising, so the board's key is stable no matter how the
 * filter bar built its object.
 */

/** Anything a filter value can be. Mirrors `lib/api`'s `QueryValue`. */
export type FilterValue =
  string | number | boolean | null | undefined | readonly (string | number)[];

/**
 * A canonical, order-independent string for a filter object.
 *
 * Empty values are dropped (an absent filter and a cleared one are the same
 * query), keys are sorted, and arrays are sorted and comma-joined — so
 * `{ label: ['ui','bug'] }` and `{ label: ['bug','ui'] }` share one cache entry
 * instead of fetching the same rows twice.
 */
export function filtersKey(filters: Record<string, FilterValue> | undefined): string {
  if (!filters) return '';

  const parts: string[] = [];
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${key}=${[...value].map(String).sort().join(',')}`);
      continue;
    }
    const asString = String(value);
    if (asString === '') continue;
    parts.push(`${key}=${asString}`);
  }
  return parts.join('&');
}

/**
 * A canonical string for ANY JSON-ish value — the general form of
 * {@link filtersKey}, and the one to reach for when a key segment is not a flat
 * bag of filters.
 *
 * WHY BOTH EXIST. `filtersKey` is deliberately LOSSY: it drops empty values and
 * sorts array members, because for a filter bar "unset", "cleared" and "empty
 * array" are one query and `['ui','bug']` selects the same rows as
 * `['bug','ui']`. `stableKey` is LOSSLESS: it preserves array order and keeps
 * `null`/`''`, because for anything else — a sprint bucket descriptor, a
 * report range, a sort spec — those distinctions are real.
 *
 * The guarantee both share, and the only one a query key needs: the same
 * logical value always serialises to the same string, whatever order its
 * object keys were assembled in. Objects are emitted with sorted keys,
 * recursively; arrays keep their order; `undefined` members of an object are
 * omitted (an absent property and one explicitly set to `undefined` are the
 * same object).
 *
 * @example
 *   stableKey({ b: 1, a: [2, 1] }) === stableKey({ a: [2, 1], b: 1 }); // true
 *   stableKey({ a: [2, 1] }) === stableKey({ a: [1, 2] });             // false
 */
export function stableKey(value: unknown): string {
  if (value === undefined) return '';
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return `[${items.map(serialize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      // An absent property and one set to `undefined` describe the same query.
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(entry)}`);
    }
    return `{${parts.join(',')}}`;
  }

  // Primitives go through JSON so a string is quoted and can never collide with
  // the number or boolean that shares its spelling (`'1'` vs `1`, `'true'`).
  return JSON.stringify(value) ?? String(value);
}

/**
 * The window onto a list — everything that decides WHICH rows a page holds
 * without being a filter. Present on every list key so pages cache separately.
 *
 * `sort` lives here rather than in the filter object because that is where the
 * contract puts it (`taskListQuerySchema` keeps `sort` beside `view` and the
 * pagination keys, never in `taskFiltersSchema`) — and because it belongs to
 * the same question as `page`: re-sorting changes the contents of page 2 just
 * as decisively as paging does, so the two must not share a cache entry.
 */
export interface PageParams {
  page?: number;
  pageSize?: number;
  /** `field:asc|desc`. Omitted entirely when unsorted, so old keys are stable. */
  sort?: string;
}

function pageKey(params: PageParams | undefined): string {
  if (!params) return '';
  const base = `page=${params.page ?? 1}&size=${params.pageSize ?? 25}`;
  return params.sort === undefined || params.sort === '' ? base : `${base}&sort=${params.sort}`;
}

export const qk = {
  /** Session-scoped reads. Cleared wholesale on sign-out. */
  auth: {
    all: () => ['auth'] as const,
    me: () => ['auth', 'me'] as const,
    invite: (token: string) => ['auth', 'invite', token] as const,
  },

  /** The org list the signed-in user belongs to, and one org's own sub-tree. */
  orgs: {
    all: () => ['orgs'] as const,
    mine: () => ['orgs', 'mine'] as const,
    detail: (orgId: string) => ['orgs', orgId] as const,
    members: (orgId: string, page?: PageParams) =>
      ['orgs', orgId, 'members', pageKey(page)] as const,
    invites: (orgId: string) => ['orgs', orgId, 'invites'] as const,
    teams: (orgId: string) => ['orgs', orgId, 'teams'] as const,
    team: (orgId: string, teamId: string) => ['orgs', orgId, 'teams', teamId] as const,
    /** The user directory behind pickers and @-mentions. */
    users: (orgId: string, search?: string) => ['orgs', orgId, 'users', search ?? ''] as const,
    /** Command-palette search across an org's tasks. */
    search: (orgId: string, query: string) => ['orgs', orgId, 'search', query] as const,
    projects: (orgId: string) => ['orgs', orgId, 'projects'] as const,
  },

  /**
   * Everything scoped to one project. `all(projectId)` is the prefix the socket
   * layer invalidates on a workflow change, and the one a project switch drops.
   */
  project: {
    all: (projectId: string) => ['project', projectId] as const,
    detail: (projectId: string) => ['project', projectId, 'detail'] as const,
    members: (projectId: string) => ['project', projectId, 'members'] as const,
    statuses: (projectId: string) => ['project', projectId, 'statuses'] as const,
    transitions: (projectId: string) => ['project', projectId, 'transitions'] as const,
    labels: (projectId: string) => ['project', projectId, 'labels'] as const,
    /**
     * EVERY `blocks` edge in the project, in one entry — the Roadmap's arrow
     * layer. Under `project` rather than `tasks` because it is not a collection
     * of tasks: invalidating `qk.tasks.all()` after a drag must not refetch a
     * set that a rank change cannot have altered.
     */
    dependencies: (projectId: string) => ['project', projectId, 'dependencies'] as const,
    activity: (projectId: string, page?: PageParams) =>
      ['project', projectId, 'activity', pageKey(page)] as const,
  },

  /**
   * Task collections and single tasks.
   *
   * `board` and `backlog` are SEPARATE keys over the same rows on purpose: they
   * are ordered by different columns (`board_rank` vs `backlog_rank`) and an
   * optimistic drag splices one without disturbing the other.
   */
  tasks: {
    all: (projectId: string) => ['project', projectId, 'tasks'] as const,
    board: (projectId: string, filters?: Record<string, FilterValue>) =>
      ['project', projectId, 'tasks', 'board', filtersKey(filters)] as const,
    backlog: (projectId: string, filters?: Record<string, FilterValue>) =>
      ['project', projectId, 'tasks', 'backlog', filtersKey(filters)] as const,
    list: (projectId: string, filters?: Record<string, FilterValue>, page?: PageParams) =>
      ['project', projectId, 'tasks', 'list', filtersKey(filters), pageKey(page)] as const,
    // NO `calendar` KEY. WP1.4 speculated one, and nothing ever used it: the
    // Calendar's window is `dueFrom`/`dueTo`/`startFrom`/`startTo`, which are
    // ordinary FILTERS, so `list(projectId, {dueFrom, …})` already gives it one
    // cache entry per grid — and one that a filter-bar change invalidates
    // correctly, which a bespoke `(from, to)` key would not.
    roadmap: (projectId: string, filters?: Record<string, FilterValue>) =>
      ['project', projectId, 'tasks', 'roadmap', filtersKey(filters)] as const,
    /**
     * The `PROJ-123` → task lookup behind the deep-linkable task sheet. Nested
     * under the project (not under `qk.task`) because the endpoint is
     * project-scoped: a bare key is only unique once you know the project.
     */
    byKey: (projectId: string, taskKey: string) =>
      ['project', projectId, 'tasks', 'by-key', taskKey] as const,
  },

  /**
   * One task. Deliberately TOP-LEVEL (`['task', id]`) rather than nested under
   * its project: the task sheet is deep-linkable by key, so it must be
   * addressable before the project id is known, and a `task:updated` socket
   * event carries a task id but not always a project id.
   */
  task: {
    all: (taskId: string) => ['task', taskId] as const,
    detail: (taskId: string) => ['task', taskId, 'detail'] as const,
    byKey: (taskKey: string) => ['task', 'by-key', taskKey] as const,
    comments: (taskId: string) => ['task', taskId, 'comments'] as const,
    activity: (taskId: string) => ['task', taskId, 'activity'] as const,
    attachments: (taskId: string) => ['task', taskId, 'attachments'] as const,
    watchers: (taskId: string) => ['task', taskId, 'watchers'] as const,
    dependencies: (taskId: string) => ['task', taskId, 'dependencies'] as const,
    subtasks: (taskId: string) => ['task', taskId, 'subtasks'] as const,
  },

  sprints: {
    all: (projectId: string) => ['project', projectId, 'sprints'] as const,
    /** `state` narrows the list (`planned` / `active` / `completed`). */
    list: (projectId: string, state?: string) =>
      ['project', projectId, 'sprints', 'list', state ?? ''] as const,
    detail: (projectId: string, sprintId: string) =>
      ['project', projectId, 'sprints', sprintId] as const,
    active: (projectId: string) => ['project', projectId, 'sprints', 'active'] as const,
  },

  /**
   * Report series. Every report takes the same `(projectId, range)` pair, where
   * `range` is a caller-built string (a sprint id, or `from..to`) — reports are
   * expensive and must not share a cache entry across ranges.
   */
  reports: {
    all: (projectId: string) => ['project', projectId, 'reports'] as const,
    burndown: (projectId: string, range: string) =>
      ['project', projectId, 'reports', 'burndown', range] as const,
    burnup: (projectId: string, range: string) =>
      ['project', projectId, 'reports', 'burnup', range] as const,
    cumulativeFlow: (projectId: string, range: string) =>
      ['project', projectId, 'reports', 'cumulative-flow', range] as const,
    velocity: (projectId: string) => ['project', projectId, 'reports', 'velocity'] as const,
    cycleTime: (projectId: string, range: string) =>
      ['project', projectId, 'reports', 'cycle-time', range] as const,
    workload: (projectId: string) => ['project', projectId, 'reports', 'workload'] as const,
  },

  notifications: {
    all: () => ['notifications'] as const,
    list: (unreadOnly: boolean, page?: PageParams) =>
      ['notifications', 'list', unreadOnly, pageKey(page)] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },

  /** Global-admin surfaces. Separate root so a non-admin never prefetches them. */
  admin: {
    all: () => ['admin'] as const,
    users: (filters?: Record<string, FilterValue>, page?: PageParams) =>
      ['admin', 'users', filtersKey(filters), pageKey(page)] as const,
    user: (userId: string) => ['admin', 'users', userId] as const,
    /**
     * The diagnostics ring buffer. `sinceId` is NOT in the key: the log drawer
     * polls incrementally and appends to its own store, so putting a
     * monotonically increasing cursor here would mint a fresh cache entry every
     * two seconds and leak unbounded memory.
     */
    logs: (level: string) => ['admin', 'logs', level] as const,
    telemetryOverview: (range: string) => ['admin', 'telemetry', 'overview', range] as const,
    telemetryEvents: (filters?: Record<string, FilterValue>, page?: PageParams) =>
      ['admin', 'telemetry', 'events', filtersKey(filters), pageKey(page)] as const,
    telemetryRequests: (range: string) => ['admin', 'telemetry', 'requests', range] as const,
    telemetryEndpoints: (range: string) => ['admin', 'telemetry', 'endpoints', range] as const,
    telemetryLatency: (range: string) => ['admin', 'telemetry', 'latency', range] as const,
  },
} as const;
