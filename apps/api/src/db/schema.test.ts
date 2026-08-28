/**
 * Schema guard rails — the assertions that do not need a live database.
 *
 * These exist because the schema is a CONTRACT: `packages/shared`'s zod enums,
 * the web app's filter chips and the reports all hard-code the same vocabularies
 * and index assumptions. A silent rename here becomes a runtime `invalid input
 * value for enum` in Wave 4, far from the edit that caused it. Every expected
 * value below is spelled out by hand rather than derived from the schema —
 * a test that reads its expectations out of the code under test proves nothing.
 *
 * Lives at `src/db/schema.test.ts`, NOT inside `src/db/schema/`, so it never
 * lands in a schema glob.
 */
import * as shared from '@flowboard/shared';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from './schema';

describe('pg enums', () => {
  it('task_type matches the locked issue types', () => {
    expect(schema.taskTypeEnum.enumValues).toEqual(['epic', 'story', 'task', 'bug', 'subtask']);
  });

  it('task_priority is ordered lowest → highest', () => {
    expect(schema.taskPriorityEnum.enumValues).toEqual([
      'lowest',
      'low',
      'medium',
      'high',
      'highest',
    ]);
  });

  it('org_role and project_role match the locked role model', () => {
    expect(schema.orgRoleEnum.enumValues).toEqual(['admin', 'member']);
    expect(schema.projectRoleEnum.enumValues).toEqual(['admin', 'member', 'viewer']);
  });

  it('sprint_state covers the full lifecycle', () => {
    expect(schema.sprintStateEnum.enumValues).toEqual(['planned', 'active', 'completed']);
  });

  it('status_category is the fixed reporting bucket', () => {
    expect(schema.statusCategoryEnum.enumValues).toEqual(['todo', 'in_progress', 'done']);
  });

  it('notification_type covers the seven kinds, including the four wired triggers', () => {
    expect(schema.notificationTypeEnum.enumValues).toEqual([
      'task_assigned',
      'mentioned',
      'status_changed',
      'comment_added',
      'sprint_started',
      'sprint_completed',
      'due_soon',
    ]);
  });
});

/**
 * The pg enums and the shared zod enums are the same closed sets seen from the
 * two ends of one wire: the column stores the value, the browser parses it. Hand
 * lists (above) catch a rename inside this package; these catch the subtler
 * failure — the two packages each staying internally consistent while drifting
 * apart from each other, which surfaces only as a 422 in Wave 4.
 */
describe('pg enums match the shared contract', () => {
  it.each([
    ['task_type', schema.taskTypeEnum.enumValues, shared.taskTypeSchema.options],
    ['task_priority', schema.taskPriorityEnum.enumValues, shared.taskPrioritySchema.options],
    ['org_role', schema.orgRoleEnum.enumValues, shared.orgRoleSchema.options],
    ['project_role', schema.projectRoleEnum.enumValues, shared.projectRoleSchema.options],
    ['sprint_state', schema.sprintStateEnum.enumValues, shared.sprintStateSchema.options],
    ['status_category', schema.statusCategoryEnum.enumValues, shared.statusCategorySchema.options],
    [
      'notification_type',
      schema.notificationTypeEnum.enumValues,
      shared.notificationTypeSchema.options,
    ],
  ])('%s', (_name, pgValues, zodValues) => {
    expect([...pgValues].sort()).toEqual([...zodValues].sort());
  });
});

describe('schema barrel', () => {
  /** Every table the approved plan names, with the DB name it must have. */
  const EXPECTED_TABLES = [
    'users',
    'organizations',
    'org_members',
    'invites',
    'teams',
    'team_members',
    'projects',
    'project_members',
    'statuses',
    'workflow_transitions',
    'sprints',
    'tasks',
    'labels',
    'task_labels',
    'task_watchers',
    'task_dependencies',
    'comments',
    'attachments',
    'activity',
    'notifications',
    'telemetry_events',
    'request_logs',
  ] as const;

  const exportedTables = Object.values(schema).filter(
    (value): value is Parameters<typeof getTableConfig>[0] =>
      typeof value === 'object' && value !== null && !('enumValues' in value),
  );

  it('exports exactly the planned set of tables', () => {
    const names = exportedTables.map((table) => getTableConfig(table).name).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });

  it('names every column in snake_case', () => {
    const offenders: string[] = [];
    for (const table of exportedTables) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (!/^[a-z][a-z0-9_]*$/u.test(column.name)) {
          offenders.push(`${config.name}.${column.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('puts deleted_at on exactly the soft-deleted tables', () => {
    const softDeleted = exportedTables
      .map((table) => getTableConfig(table))
      .filter((config) => config.columns.some((column) => column.name === 'deleted_at'))
      .map((config) => config.name)
      .sort();

    expect(softDeleted).toEqual(
      ['organizations', 'teams', 'projects', 'tasks', 'comments', 'attachments'].sort(),
    );
  });

  it('gives every mutable entity created_at and updated_at', () => {
    // Append-only streams and junction rows carry created_at only, by design.
    const createdOnly = new Set([
      'org_members',
      'team_members',
      'project_members',
      'task_labels',
      'task_watchers',
      'task_dependencies',
      'workflow_transitions',
      'invites',
      'activity',
      'notifications',
      'telemetry_events',
      'request_logs',
    ]);

    for (const table of exportedTables) {
      const config = getTableConfig(table);
      const names = new Set(config.columns.map((column) => column.name));
      expect(names.has('created_at'), `${config.name} has created_at`).toBe(true);
      expect(names.has('updated_at'), `${config.name} updated_at`).toBe(
        !createdOnly.has(config.name),
      );
    }
  });
});

describe('indexes the product depends on', () => {
  const indexNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
    getTableConfig(table)
      .indexes.map((index) => index.config.name)
      .filter((name): name is string => name !== undefined);

  it('makes email uniqueness case-insensitive', () => {
    const emailIndex = getTableConfig(schema.users).indexes.find(
      (index) => index.config.name === 'users_email_lower_unique',
    );
    expect(emailIndex?.config.unique).toBe(true);
  });

  it('declares the seven task read paths', () => {
    expect(indexNames(schema.tasks)).toEqual([
      'tasks_project_number_unique',
      'tasks_board_idx',
      'tasks_backlog_idx',
      'tasks_assignee_idx',
      'tasks_epic_idx',
      'tasks_parent_idx',
      'tasks_project_due_date_idx',
      'tasks_title_trgm_idx',
    ]);
  });

  it('keeps the assignee index partial on live rows', () => {
    const assigneeIndex = getTableConfig(schema.tasks).indexes.find(
      (index) => index.config.name === 'tasks_assignee_idx',
    );
    expect(assigneeIndex?.config.where).toBeDefined();
  });

  it('searches titles with a trigram GIN index', () => {
    const trgmIndex = getTableConfig(schema.tasks).indexes.find(
      (index) => index.config.name === 'tasks_title_trgm_idx',
    );
    expect(trgmIndex?.config.method).toBe('gin');
  });

  it('enforces one active sprint per project with a partial unique index', () => {
    const activeSprintIndex = getTableConfig(schema.sprints).indexes.find(
      (index) => index.config.name === 'sprints_one_active_per_project',
    );
    expect(activeSprintIndex?.config.unique).toBe(true);
    expect(activeSprintIndex?.config.where).toBeDefined();
  });

  it('keeps the unread-notification index partial', () => {
    const unreadIndex = getTableConfig(schema.notifications).indexes.find(
      (index) => index.config.name === 'notifications_unread_idx',
    );
    expect(unreadIndex?.config.where).toBeDefined();
  });

  it('scopes project keys and task numbers with unique indexes', () => {
    expect(indexNames(schema.projects)).toContain('projects_org_key_unique');
    expect(indexNames(schema.tasks)).toContain('tasks_project_number_unique');
  });
});

describe('check constraints', () => {
  const checkNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
    getTableConfig(table).checks.map((check) => check.name);

  it('guards task invariants', () => {
    expect(checkNames(schema.tasks)).toEqual([
      'tasks_number_positive',
      'tasks_story_points_non_negative',
      'tasks_dates_ordered',
      'tasks_not_own_epic',
      'tasks_not_own_parent',
    ]);
  });

  it('rejects self-blocking dependencies and self-transitions', () => {
    expect(checkNames(schema.taskDependencies)).toContain('task_dependencies_not_self');
    expect(checkNames(schema.workflowTransitions)).toContain('workflow_transitions_not_self');
  });

  it('makes an invite project grant all-or-nothing', () => {
    expect(checkNames(schema.invites)).toContain('invites_project_grant_complete');
  });
});

describe('stream tables use bigserial ids', () => {
  it.each(['activity', 'telemetry_events', 'request_logs'] as const)('%s', (tableName) => {
    const table = Object.values(schema).find(
      (value): value is Parameters<typeof getTableConfig>[0] =>
        typeof value === 'object' &&
        value !== null &&
        !('enumValues' in value) &&
        getTableConfig(value).name === tableName,
    );
    expect(table).toBeDefined();
    if (!table) {
      return;
    }
    const idColumn = getTableConfig(table).columns.find((column) => column.name === 'id');
    expect(idColumn?.getSQLType()).toBe('bigserial');
  });
});
