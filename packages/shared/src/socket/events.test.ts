/**
 * The socket protocol's payload schemas, as a PARSING boundary.
 *
 * `contracts.test.ts` already proves the registry is complete — every event
 * name has a schema, and the names follow the `scope:verb` convention. What it
 * does not cover is what happens to a payload that arrives with more (or less)
 * than the contract names, and that is the whole reason the web's socket
 * wrapper parses at all:
 *
 *   - a socket payload is UNTRUSTED input in exactly the way an HTTP body is,
 *     and it goes straight into a query cache with no request/response cycle to
 *     inspect it;
 *   - every one of these objects is a plain `z.object`, so unknown keys are
 *     STRIPPED, not rejected — which is what lets the API add a field to an
 *     event without every older tab throwing on it;
 *   - the corollary is that a parsed payload never carries an extra key into a
 *     cache, so a rogue publisher cannot smuggle a field past the reducer.
 *
 * Both halves of that trade are load-bearing, and neither is pinned anywhere
 * else, so they are pinned here.
 */
import { describe, expect, it } from 'vitest';

import {
  clientToServerEventSchemas,
  commentCreatedPayloadSchema,
  notificationNewPayloadSchema,
  presenceStatePayloadSchema,
  presenceUpdatePayloadSchema,
  projectRoomPayloadSchema,
  serverToClientEventSchemas,
  socketAckSchema,
  socketAuthSchema,
  sprintChangedPayloadSchema,
  taskCreatedPayloadSchema,
  taskDeletedPayloadSchema,
  taskMovedPayloadSchema,
  taskUpdatedPayloadSchema,
  workflowChangedPayloadSchema,
  projectRoom,
  userRoom,
} from './events.schema';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const STATUS = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';

const TASK_SUMMARY = {
  id: TASK,
  number: 12,
  title: 'Ship the rebalance',
  type: 'task',
  priority: 'medium',
  statusId: STATUS,
  assignee: null,
  storyPoints: null,
  startDate: null,
  dueDate: null,
  labelIds: [],
  epicId: null,
  parentId: null,
  boardRank: 'a1',
  backlogRank: 'a1',
  sprintId: null,
  hasDescription: false,
  commentCount: 0,
  attachmentCount: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const USER_SUMMARY = { id: USER, name: 'Ada', avatarUrl: null };

/** One valid payload per server→client event, keyed by event name. */
const VALID_SERVER_PAYLOADS: Record<keyof typeof serverToClientEventSchemas, unknown> = {
  'presence:state': { projectId: PROJECT, entries: [{ user: USER_SUMMARY, taskId: TASK }] },
  'task:created': { projectId: PROJECT, task: TASK_SUMMARY },
  'task:updated': { projectId: PROJECT, task: TASK_SUMMARY, changedFields: ['title'] },
  'task:deleted': { projectId: PROJECT, taskId: TASK },
  'task:moved': {
    projectId: PROJECT,
    taskId: TASK,
    statusId: STATUS,
    boardRank: 'a1',
    rebalanced: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  'comment:created': {
    projectId: PROJECT,
    taskId: TASK,
    comment: {
      id: OTHER,
      taskId: TASK,
      author: USER_SUMMARY,
      body: 'Nice',
      editedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  'comment:updated': {
    projectId: PROJECT,
    taskId: TASK,
    comment: {
      id: OTHER,
      taskId: TASK,
      author: USER_SUMMARY,
      body: 'Edited',
      editedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  'comment:deleted': { projectId: PROJECT, taskId: TASK, commentId: OTHER },
  'sprint:changed': { projectId: PROJECT, sprintId: OTHER, action: 'started', sprint: null },
  'workflow:changed': { projectId: PROJECT, statuses: [], transitions: [] },
  'notification:new': {
    notification: {
      id: OTHER,
      recipientId: USER,
      type: 'mentioned',
      payload: {},
      readAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    unreadCount: 3,
  },
};

describe('the room helpers', () => {
  it('namespace the two room kinds so a uuid can never collide across them', () => {
    expect(userRoom(USER)).toBe(`user:${USER}`);
    expect(projectRoom(PROJECT)).toBe(`project:${PROJECT}`);
    expect(userRoom(USER)).not.toBe(projectRoom(USER));
  });
});

describe('every server->client payload', () => {
  const names = Object.keys(serverToClientEventSchemas) as (keyof typeof VALID_SERVER_PAYLOADS)[];

  it.each(names)('%s parses its documented shape', (name) => {
    expect(serverToClientEventSchemas[name].safeParse(VALID_SERVER_PAYLOADS[name]).success).toBe(
      true,
    );
  });

  it.each(names)('%s STRIPS a key the contract does not name', (name) => {
    // Forward compatibility in one direction: a newer API can add a field and
    // an older tab keeps working. And in the other: whatever the publisher
    // sent, only contract fields reach the cache reducer.
    const parsed = serverToClientEventSchemas[name].parse({
      ...(VALID_SERVER_PAYLOADS[name] as Record<string, unknown>),
      __smuggled: { evil: true },
    });

    expect(parsed).not.toHaveProperty('__smuggled');
    expect(parsed).toEqual(serverToClientEventSchemas[name].parse(VALID_SERVER_PAYLOADS[name]));
  });

  it.each(names.filter((name) => name !== 'notification:new'))(
    '%s REJECTS a payload with no projectId — a listener routes on it',
    (name) => {
      const { projectId: _dropped, ...withoutProject } = VALID_SERVER_PAYLOADS[name] as Record<
        string,
        unknown
      >;

      expect(serverToClientEventSchemas[name].safeParse(withoutProject).success).toBe(false);
    },
  );

  it('notification:new carries no projectId — it is delivered to a USER room', () => {
    // The one event that is not project-scoped. Requiring a projectId here
    // would be requiring the bell to know which project it is looking at.
    expect(VALID_SERVER_PAYLOADS['notification:new']).not.toHaveProperty('projectId');
    expect(
      notificationNewPayloadSchema.safeParse(VALID_SERVER_PAYLOADS['notification:new']).success,
    ).toBe(true);
  });
});

describe('individual payload rules', () => {
  it('task:updated treats `changedFields` as optional, and absent is not "nothing changed"', () => {
    // A publisher that cannot enumerate its change omits the hint; a receiver
    // must then invalidate conservatively rather than read it as an empty diff.
    const withoutHint = taskUpdatedPayloadSchema.parse({ projectId: PROJECT, task: TASK_SUMMARY });
    expect(withoutHint).not.toHaveProperty('changedFields');

    const empty = taskUpdatedPayloadSchema.parse({
      projectId: PROJECT,
      task: TASK_SUMMARY,
      changedFields: [],
    });
    expect(empty.changedFields).toEqual([]);
  });

  it('task:updated keeps `changedFields` a loose string[], not a closed enum', () => {
    // Deliberate: this is a cache-targeting HINT, and a closed enum here would
    // turn adding a column into a wire-contract change.
    expect(
      taskUpdatedPayloadSchema.parse({
        projectId: PROJECT,
        task: TASK_SUMMARY,
        changedFields: ['dependencies', 'attachments', 'a-column-invented-tomorrow'],
      }).changedFields,
    ).toHaveLength(3);
    expect(
      taskUpdatedPayloadSchema.safeParse({
        projectId: PROJECT,
        task: TASK_SUMMARY,
        changedFields: [7],
      }).success,
    ).toBe(false);
  });

  it('task:moved insists on a REAL rank, not any string', () => {
    const base = {
      projectId: PROJECT,
      taskId: TASK,
      statusId: STATUS,
      rebalanced: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(taskMovedPayloadSchema.safeParse({ ...base, boardRank: 'a1' }).success).toBe(true);
    expect(taskMovedPayloadSchema.safeParse({ ...base, boardRank: '' }).success).toBe(false);
  });

  /**
   * The version stamp the web orders the board splice against. Required, not
   * optional: an optional stamp would let a publisher silently reintroduce the
   * unordered write this field exists to eliminate, and the receiver could not
   * tell "no change" from "publisher forgot".
   */
  it('task:moved requires an offset-bearing updatedAt', () => {
    const base = {
      projectId: PROJECT,
      taskId: TASK,
      statusId: STATUS,
      boardRank: 'a1',
      rebalanced: false,
    };

    expect(
      taskMovedPayloadSchema.parse({ ...base, updatedAt: '2026-01-01T00:00:00.000Z' }).updatedAt,
    ).toBe('2026-01-01T00:00:00.000Z');
    expect(taskMovedPayloadSchema.safeParse(base).success).toBe(false);
    // A local-time string has no offset to compare across clients.
    expect(taskMovedPayloadSchema.safeParse({ ...base, updatedAt: '2026-01-01' }).success).toBe(
      false,
    );
  });

  it('task:created and task:deleted carry a summary and a bare id respectively', () => {
    // The asymmetry is the point: a delete needs nothing but the id, and
    // shipping a summary of a row that no longer exists would be a lie.
    expect(taskCreatedPayloadSchema.parse({ projectId: PROJECT, task: TASK_SUMMARY }).task.id).toBe(
      TASK,
    );
    expect(taskDeletedPayloadSchema.parse({ projectId: PROJECT, taskId: TASK })).toEqual({
      projectId: PROJECT,
      taskId: TASK,
    });
    expect(
      taskDeletedPayloadSchema.safeParse({ projectId: PROJECT, taskId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('presence:state accepts an EMPTY roster — the last person leaving is an event', () => {
    expect(presenceStatePayloadSchema.parse({ projectId: PROJECT, entries: [] }).entries).toEqual(
      [],
    );
  });

  it('presence entries allow a null taskId, meaning "on the board, not in a task"', () => {
    const parsed = presenceStatePayloadSchema.parse({
      projectId: PROJECT,
      entries: [{ user: USER_SUMMARY, taskId: null }],
    });

    expect(parsed.entries[0]?.taskId).toBeNull();
  });

  it('sprint:changed allows a null sprint only alongside a real action', () => {
    expect(
      sprintChangedPayloadSchema.parse({
        projectId: PROJECT,
        sprintId: OTHER,
        action: 'deleted',
        sprint: null,
      }).sprint,
    ).toBeNull();
    expect(
      sprintChangedPayloadSchema.safeParse({
        projectId: PROJECT,
        sprintId: OTHER,
        action: 'archived',
        sprint: null,
      }).success,
    ).toBe(false);
  });

  it('workflow:changed spreads the whole workflow next to the project id', () => {
    // Not `{ projectId, workflow }` — the payload IS the workflow plus a
    // routing key, so a listener writes it into the cache without unwrapping.
    const parsed = workflowChangedPayloadSchema.parse({
      projectId: PROJECT,
      statuses: [],
      transitions: [],
    });

    expect(Object.keys(parsed).sort()).toEqual(['projectId', 'statuses', 'transitions']);
  });

  it('notification:new refuses a negative or fractional unread count', () => {
    const base = VALID_SERVER_PAYLOADS['notification:new'] as Record<string, unknown>;

    expect(notificationNewPayloadSchema.parse({ ...base, unreadCount: 0 }).unreadCount).toBe(0);
    expect(notificationNewPayloadSchema.safeParse({ ...base, unreadCount: -1 }).success).toBe(
      false,
    );
    expect(notificationNewPayloadSchema.safeParse({ ...base, unreadCount: 1.5 }).success).toBe(
      false,
    );
  });

  it('comment:created nests the whole comment, so the thread needs no refetch', () => {
    const parsed = commentCreatedPayloadSchema.parse(VALID_SERVER_PAYLOADS['comment:created']);

    expect(parsed.comment.author.id).toBe(USER);
  });
});

describe('client->server payloads', () => {
  it('registers exactly the three events a client may emit', () => {
    expect(Object.keys(clientToServerEventSchemas).sort()).toEqual([
      'presence:update',
      'project:join',
      'project:leave',
    ]);
  });

  it('the room events take a project id and nothing else', () => {
    expect(projectRoomPayloadSchema.parse({ projectId: PROJECT, extra: 1 })).toEqual({
      projectId: PROJECT,
    });
    expect(projectRoomPayloadSchema.safeParse({ projectId: 'nope' }).success).toBe(false);
  });

  it('presence:update requires an EXPLICIT taskId, null included', () => {
    // `null` is a meaningful value here ("I left the task, I am still on the
    // board"), so it cannot be optional — an omitted field and a null one would
    // otherwise be indistinguishable to the gateway.
    expect(
      presenceUpdatePayloadSchema.parse({ projectId: PROJECT, taskId: null }).taskId,
    ).toBeNull();
    expect(presenceUpdatePayloadSchema.parse({ projectId: PROJECT, taskId: TASK }).taskId).toBe(
      TASK,
    );
    expect(presenceUpdatePayloadSchema.safeParse({ projectId: PROJECT }).success).toBe(false);
  });

  it('strips unknown keys on the way IN as well as out', () => {
    expect(
      presenceUpdatePayloadSchema.parse({ projectId: PROJECT, taskId: null, spoofedUserId: USER }),
    ).toEqual({ projectId: PROJECT, taskId: null });
  });
});

describe('the handshake and the ack', () => {
  it('the handshake carries a non-empty token', () => {
    expect(socketAuthSchema.parse({ token: 'jwt', extra: 'ignored' })).toEqual({ token: 'jwt' });
    expect(socketAuthSchema.safeParse({ token: '' }).success).toBe(false);
    expect(socketAuthSchema.safeParse({}).success).toBe(false);
  });

  it('an ack may carry a code and a message, and both are optional', () => {
    expect(socketAckSchema.parse({ ok: false, code: 'NOT_FOUND', message: 'gone' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'gone',
    });
    expect(socketAckSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(socketAckSchema.safeParse({ ok: 'yes' }).success).toBe(false);
  });
});
