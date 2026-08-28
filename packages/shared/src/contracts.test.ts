// One parse-success + one parse-failure per remaining contract family. The
// families with real logic of their own (common, rank, tasks, auth, comments,
// envelope) have their own files; this is the breadth pass that stops a field
// being renamed on one side of the wire without the other noticing.
import { describe, expect, it } from 'vitest';
import { activityActionSchema, activitySchema } from './activity.schema';
import {
  attachmentSchema,
  MAX_ATTACHMENT_BYTES,
  confirmAttachmentInputSchema,
  presignAttachmentInputSchema,
  presignAttachmentResponseSchema,
} from './attachments.schema';
import { serverLogsQuerySchema, serverLogsSnapshotSchema } from './diagnostics.schema';
import {
  markNotificationsReadInputSchema,
  notificationSchema,
  unreadCountSchema,
} from './notifications.schema';
import {
  addMemberInputSchema,
  createInviteInputSchema,
  createOrgInputSchema,
  inviteSchema,
  orgDetailSchema,
  orgMemberSchema,
  orgWithRoleSchema,
  updateOrgInputSchema,
} from './orgs.schema';
import { adminUpdateUserInputSchema, provisionUserInputSchema } from './admin.schema';
import {
  createProjectInputSchema,
  labelSchema,
  projectDetailSchema,
  projectKeySchema,
  updateLabelInputSchema,
  updateProjectInputSchema,
} from './projects.schema';
import {
  burndownReportSchema,
  cumulativeFlowReportSchema,
  cycleTimeReportSchema,
  velocityReportSchema,
  workloadReportSchema,
} from './reports.schema';
import {
  completeSprintInputSchema,
  createSprintInputSchema,
  sprintSchema,
  startSprintInputSchema,
  updateSprintInputSchema,
} from './sprints.schema';
import {
  createTeamInputSchema,
  replaceTeamMembersInputSchema,
  teamSchema,
  updateTeamInputSchema,
} from './teams.schema';
import {
  latencyReportSchema,
  telemetryEventSchema,
  telemetryEventsQuerySchema,
  telemetryOverviewSchema,
  requestsOverTimeSchema,
  topEndpointsSchema,
} from './telemetry.schema';
import { themeDocumentSchema } from './theme.schema';
import { createUserInputSchema, updateUserInputSchema, userSchema } from './users.schema';
import { VALIDATION_MESSAGES, type ValidationMessage } from './validation-messages';
import {
  createStatusInputSchema,
  replaceTransitionsInputSchema,
  reorderStatusesInputSchema,
  statusSchema,
  updateStatusInputSchema,
  workflowSchema,
} from './workflow.schema';
import {
  projectRoom,
  serverToClientEventSchemas,
  socketAckSchema,
  SOCKET_EVENTS,
  taskMovedPayloadSchema,
  userRoom,
} from './socket/events.schema';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-02-01T10:00:00Z';
const USER_SUMMARY = { id: ID_A, name: 'Ada', avatarUrl: null };

describe('users', () => {
  const user = {
    id: ID_A,
    email: 'ada@flowboard.dev',
    name: 'Ada Lovelace',
    avatarUrl: null,
    isGlobalAdmin: false,
    locale: 'en',
    isActive: true,
    createdAt: NOW,
  };

  it('parses an account row and never leaks the hash', () => {
    const parsed = userSchema.parse({ ...user, passwordHash: 'secret', tokenVersion: 4 });

    expect(parsed).not.toHaveProperty('passwordHash');
    expect(parsed).not.toHaveProperty('tokenVersion');
  });

  it('rejects an account with no email', () => {
    const { email: _email, ...withoutEmail } = user;

    expect(userSchema.safeParse(withoutEmail).success).toBe(false);
  });

  it('defaults provisioning to a non-admin English account', () => {
    const parsed = createUserInputSchema.parse({
      email: 'grace@flowboard.dev',
      name: 'Grace',
      password: 'longenough',
    });

    expect(parsed).toMatchObject({ isGlobalAdmin: false, locale: 'en' });
  });

  it('requires at least one field on an admin update', () => {
    expect(updateUserInputSchema.safeParse({}).success).toBe(false);
    expect(updateUserInputSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });
});

describe('organizations', () => {
  it('parses an org row with the caller role', () => {
    const parsed = orgWithRoleSchema.parse({
      id: ID_A,
      name: 'Acme',
      slug: 'acme',
      createdAt: NOW,
      updatedAt: NOW,
      role: 'admin',
      memberCount: 3,
      projectCount: 2,
    });

    expect(parsed.role).toBe('admin');
  });

  it('rejects a member row with an invented role', () => {
    expect(
      orgMemberSchema.safeParse({
        orgId: ID_A,
        user: USER_SUMMARY,
        email: 'ada@flowboard.dev',
        role: 'owner',
        joinedAt: NOW,
      }).success,
    ).toBe(false);
  });

  it('rejects an uppercase slug on create and an empty update', () => {
    expect(createOrgInputSchema.safeParse({ name: 'Acme', slug: 'Acme' }).success).toBe(false);
    expect(updateOrgInputSchema.safeParse({}).success).toBe(false);
  });

  it('defaults an invite to an open member link expiring in a week', () => {
    expect(createInviteInputSchema.parse({})).toMatchObject({
      email: null,
      orgRole: 'member',
      projectId: null,
      projectRole: null,
      expiresInDays: 7,
    });
  });

  it('rejects an invite that grants a project without a role on it', () => {
    expect(createInviteInputSchema.safeParse({ projectId: ID_B }).success).toBe(false);
  });

  it('carries teamCount on the single-org payload but not on a list row', () => {
    const base = {
      id: ID_A,
      name: 'Acme',
      slug: 'acme',
      createdAt: NOW,
      updatedAt: NOW,
      role: 'admin',
      memberCount: 3,
      projectCount: 2,
    };

    expect(orgDetailSchema.parse({ ...base, teamCount: 4 }).teamCount).toBe(4);
    // A list row that is handed the extra field simply drops it — counting
    // teams per row is a subquery the org switcher never renders.
    expect(orgWithRoleSchema.parse({ ...base, teamCount: 4 })).not.toHaveProperty('teamCount');
    expect(orgDetailSchema.safeParse(base).success).toBe(false);
  });

  it('lets a global admin name the first admin, and defaults to the caller', () => {
    expect(
      createOrgInputSchema.parse({ name: 'Acme', slug: 'acme', adminUserId: ID_B }),
    ).toMatchObject({ adminUserId: ID_B });
    expect(createOrgInputSchema.parse({ name: 'Acme', slug: 'acme' })).not.toHaveProperty(
      'adminUserId',
    );
  });

  it('identifies a new member by userId XOR email — never both, never neither', () => {
    expect(addMemberInputSchema.parse({ userId: ID_B })).toMatchObject({
      userId: ID_B,
      role: 'member',
    });
    expect(addMemberInputSchema.parse({ email: 'Ada@Flowboard.DEV', role: 'admin' })).toMatchObject(
      {
        email: 'ada@flowboard.dev',
        role: 'admin',
      },
    );
    expect(
      addMemberInputSchema.safeParse({ userId: ID_B, email: 'ada@flowboard.dev' }).success,
    ).toBe(false);
    expect(addMemberInputSchema.safeParse({ role: 'member' }).success).toBe(false);
  });

  it('tolerates an invite whose creator has since been deleted', () => {
    const invite = {
      id: ID_A,
      orgId: ID_B,
      email: null,
      orgRole: 'member',
      projectId: null,
      projectRole: null,
      token: 'a-long-enough-token',
      expiresAt: NOW,
      acceptedAt: null,
      createdBy: null,
      createdAt: NOW,
    };

    // `invites.invited_by_id` is ON DELETE SET NULL, so the link outlives the
    // admin who minted it.
    expect(inviteSchema.parse(invite).createdBy).toBeNull();
    expect(inviteSchema.parse({ ...invite, createdBy: USER_SUMMARY }).createdBy).toEqual(
      USER_SUMMARY,
    );
  });
});

describe('admin user administration', () => {
  it('provisions an account and its org grants in one body', () => {
    const parsed = provisionUserInputSchema.parse({
      email: 'ada@flowboard.dev',
      name: 'Ada',
      password: 'longenough',
      orgMemberships: [{ orgId: ID_B }],
    });

    expect(parsed.orgMemberships).toEqual([{ orgId: ID_B, role: 'member' }]);
    // Omitted entirely, the account is simply provisioned into nothing.
    expect(
      provisionUserInputSchema.parse({
        email: 'ada@flowboard.dev',
        name: 'Ada',
        password: 'longenough',
      }).orgMemberships,
    ).toEqual([]);
  });

  it('carries forceLogout, which the self-service update deliberately cannot', () => {
    expect(adminUpdateUserInputSchema.parse({ forceLogout: true })).toEqual({ forceLogout: true });
    expect(adminUpdateUserInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('teams', () => {
  it('parses a team row', () => {
    const parsed = teamSchema.parse({
      id: ID_A,
      orgId: ID_B,
      name: 'Platform',
      description: null,
      memberCount: 4,
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(parsed.memberCount).toBe(4);
  });

  it('rejects a team with no name and an empty update', () => {
    expect(createTeamInputSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(updateTeamInputSchema.safeParse({}).success).toBe(false);
  });

  it('treats an empty roster replacement as legal — a team may have nobody', () => {
    expect(replaceTeamMembersInputSchema.parse({ userIds: [] }).userIds).toEqual([]);
  });
});

describe('projects, labels and workflow', () => {
  const status = {
    id: ID_A,
    projectId: ID_B,
    name: 'In Progress',
    category: 'in_progress',
    color: '#4f46e5',
    position: 1,
    wipLimit: 3,
  };
  const label = { id: ID_C, projectId: ID_B, name: 'backend', color: '#0ea5e9' };

  it('uppercases a project key and rejects a bad one', () => {
    expect(projectKeySchema.parse('flow')).toBe('FLOW');
    expect(projectKeySchema.safeParse('F').success).toBe(false);
    expect(projectKeySchema.safeParse('9FLOW').success).toBe(false);
    expect(projectKeySchema.safeParse('FLOW-BOARD').success).toBe(false);
  });

  it('bundles statuses, labels and the caller role into project detail', () => {
    const parsed = projectDetailSchema.parse({
      id: ID_B,
      orgId: ID_A,
      key: 'FLOW',
      name: 'FlowBoard',
      description: null,
      teamId: null,
      leadId: null,
      lead: null,
      createdAt: NOW,
      updatedAt: NOW,
      role: 'member',
      statuses: [status],
      labels: [label],
      memberCount: 6,
    });

    expect(parsed.statuses).toHaveLength(1);
    expect(parsed.labels[0]?.name).toBe('backend');
  });

  it('rejects a project create with a malformed key and an empty update', () => {
    expect(createProjectInputSchema.safeParse({ key: 'x', name: 'X' }).success).toBe(false);
    expect(updateProjectInputSchema.safeParse({}).success).toBe(false);
  });

  it('refuses to rename a project key through the update body', () => {
    const parsed = updateProjectInputSchema.parse({ name: 'Renamed', key: 'OTHER' });

    expect(parsed).not.toHaveProperty('key');
  });

  it('parses a label and rejects a non-hex color', () => {
    expect(labelSchema.parse(label).color).toBe('#0ea5e9');
    expect(labelSchema.safeParse({ ...label, color: 'blue' }).success).toBe(false);
  });

  it('accepts a partial label edit and refuses an empty one', () => {
    // The same "at least one field" rule every PATCH body carries: an empty
    // body is a request that cannot be answered, not a no-op update.
    expect(updateLabelInputSchema.parse({ color: '#0ea5e9' })).toEqual({ color: '#0ea5e9' });
    expect(updateLabelInputSchema.parse({ name: 'bug' })).toEqual({ name: 'bug' });
    expect(updateLabelInputSchema.safeParse({}).success).toBe(false);
    expect(updateLabelInputSchema.safeParse({ color: 'blue' }).success).toBe(false);
  });

  it('parses a status and rejects a WIP limit of zero', () => {
    expect(statusSchema.parse(status).wipLimit).toBe(3);
    expect(statusSchema.safeParse({ ...status, wipLimit: 0 }).success).toBe(false);
    expect(statusSchema.safeParse({ ...status, category: 'blocked' }).success).toBe(false);
  });

  it('defaults a new status to no WIP limit and keeps position server-owned', () => {
    const parsed = createStatusInputSchema.parse({
      name: 'Review',
      category: 'in_progress',
      color: '#f59e0b',
    });

    expect(parsed.wipLimit).toBeNull();
    expect(parsed).not.toHaveProperty('position');
  });

  it('rejects an empty status update and an empty reorder', () => {
    expect(updateStatusInputSchema.safeParse({}).success).toBe(false);
    expect(reorderStatusesInputSchema.safeParse({ statusIds: [] }).success).toBe(false);
  });

  it('treats an empty transition set as "no restrictions" but rejects a self-loop', () => {
    expect(replaceTransitionsInputSchema.parse({ transitions: [] }).transitions).toEqual([]);
    expect(
      replaceTransitionsInputSchema.safeParse({
        transitions: [{ fromStatusId: ID_A, toStatusId: ID_A }],
      }).success,
    ).toBe(false);
  });

  it('parses a whole workflow', () => {
    const parsed = workflowSchema.parse({
      statuses: [status],
      transitions: [{ id: ID_C, projectId: ID_B, fromStatusId: ID_A, toStatusId: ID_A }],
    });

    expect(parsed.transitions).toHaveLength(1);
  });
});

describe('sprints', () => {
  const sprint = {
    id: ID_A,
    projectId: ID_B,
    name: 'Sprint 4',
    goal: null,
    state: 'active',
    startDate: '2026-02-01',
    endDate: '2026-02-14',
    startedAt: NOW,
    completedAt: null,
    committedPoints: 34,
    completedPoints: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses an active sprint with its commitment stamped', () => {
    expect(sprintSchema.parse(sprint).committedPoints).toBe(34);
  });

  it('rejects an invented sprint state', () => {
    expect(sprintSchema.safeParse({ ...sprint, state: 'paused' }).success).toBe(false);
  });

  it('rejects a reversed date range on create and on start', () => {
    expect(
      createSprintInputSchema.safeParse({
        name: 'Sprint 5',
        startDate: '2026-03-10',
        endDate: '2026-03-01',
      }).success,
    ).toBe(false);
    expect(
      startSprintInputSchema.safeParse({ startDate: '2026-03-10', endDate: '2026-03-01' }).success,
    ).toBe(false);
  });

  it('requires both dates to start a sprint — a burndown needs an axis', () => {
    expect(startSprintInputSchema.safeParse({ startDate: '2026-03-01' }).success).toBe(false);
  });

  it('accepts either destination for the leftovers, but demands one', () => {
    expect(completeSprintInputSchema.parse({ moveIncompleteTo: 'backlog' })).toEqual({
      moveIncompleteTo: 'backlog',
    });
    expect(completeSprintInputSchema.parse({ moveIncompleteTo: ID_C }).moveIncompleteTo).toBe(ID_C);
    expect(completeSprintInputSchema.safeParse({}).success).toBe(false);
    expect(completeSprintInputSchema.safeParse({ moveIncompleteTo: 'nowhere' }).success).toBe(
      false,
    );
  });

  it('edits a sprint field by field, and refuses an empty body', () => {
    expect(updateSprintInputSchema.parse({ goal: 'Ship the board' })).toEqual({
      goal: 'Ship the board',
    });
    expect(updateSprintInputSchema.safeParse({}).success).toBe(false);
  });

  it('checks the date range on an edit only when BOTH bounds are present', () => {
    // Clearing one bound (`null`) or moving one of them alone is legal — the
    // pair is only comparable when the body actually carries both.
    expect(
      updateSprintInputSchema.safeParse({ startDate: '2026-03-01', endDate: '2026-03-05' }).success,
    ).toBe(true);
    expect(
      updateSprintInputSchema.safeParse({ startDate: '2026-03-05', endDate: '2026-03-01' }).success,
    ).toBe(false);
    expect(updateSprintInputSchema.safeParse({ startDate: '2026-03-05' }).success).toBe(true);
    expect(
      updateSprintInputSchema.safeParse({ startDate: '2026-03-05', endDate: null }).success,
    ).toBe(true);
    expect(
      updateSprintInputSchema.safeParse({ startDate: null, endDate: '2026-03-01' }).success,
    ).toBe(true);
  });

  it('accepts a same-day sprint window on an edit', () => {
    expect(
      updateSprintInputSchema.safeParse({ startDate: '2026-03-01', endDate: '2026-03-01' }).success,
    ).toBe(true);
  });
});

describe('attachments', () => {
  it('parses an attachment row', () => {
    const parsed = attachmentSchema.parse({
      id: ID_A,
      taskId: ID_B,
      fileName: 'spec.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      s3Key: `${ID_A}/${ID_B}/${ID_C}/uuid-spec.pdf`,
      uploadedBy: USER_SUMMARY,
      createdAt: NOW,
    });

    expect(parsed.fileName).toBe('spec.pdf');
  });

  it('rejects a presign above the 25 MB ceiling and a zero-byte file', () => {
    const base = { fileName: 'big.zip', mimeType: 'application/zip' };

    expect(
      presignAttachmentInputSchema.safeParse({ ...base, sizeBytes: MAX_ATTACHMENT_BYTES }).success,
    ).toBe(true);
    expect(
      presignAttachmentInputSchema.safeParse({ ...base, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })
        .success,
    ).toBe(false);
    expect(presignAttachmentInputSchema.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
  });

  it('rejects a presign response whose upload url is not a url', () => {
    expect(
      presignAttachmentResponseSchema.safeParse({
        uploadUrl: 'not a url',
        s3Key: 'k',
        attachmentId: ID_A,
        expiresAt: NOW,
      }).success,
    ).toBe(false);
  });

  it('hands back the pending row id alongside the key', () => {
    const parsed = presignAttachmentResponseSchema.parse({
      uploadUrl: 'https://minio.local/bucket/key?sig=1',
      s3Key: 'k',
      attachmentId: ID_A,
      expiresAt: NOW,
    });

    expect(parsed.attachmentId).toBe(ID_A);
  });

  it('confirms by attachmentId OR s3Key, but not by neither', () => {
    expect(confirmAttachmentInputSchema.safeParse({ attachmentId: ID_A }).success).toBe(true);
    expect(confirmAttachmentInputSchema.safeParse({ s3Key: 'k' }).success).toBe(true);
    expect(confirmAttachmentInputSchema.safeParse({ fileName: 'a.txt' }).success).toBe(false);
  });

  it('re-validates the size at confirm, not just at presign', () => {
    expect(
      confirmAttachmentInputSchema.safeParse({
        s3Key: 'k',
        fileName: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: MAX_ATTACHMENT_BYTES + 1,
      }).success,
    ).toBe(false);
  });
});

describe('activity', () => {
  it('parses a field-diff row with jsonb values of any shape', () => {
    const parsed = activitySchema.parse({
      id: '90218',
      projectId: ID_B,
      taskId: ID_C,
      actor: USER_SUMMARY,
      action: 'task.field_changed',
      field: 'storyPoints',
      oldValue: 3,
      newValue: null,
      createdAt: NOW,
    });

    expect(parsed.id).toBe('90218');
    expect(parsed.newValue).toBeNull();
  });

  it('parses a project-scoped row with no task and no actor', () => {
    const parsed = activitySchema.parse({
      id: '1',
      projectId: ID_B,
      taskId: null,
      actor: null,
      action: 'workflow.changed',
      createdAt: NOW,
    });

    expect(parsed.taskId).toBeNull();
  });

  it('carries the bigserial id as a numeric string, not a number', () => {
    expect(
      activitySchema.safeParse({
        id: 90218,
        projectId: ID_B,
        taskId: null,
        actor: null,
        action: 'task.created',
        createdAt: NOW,
      }).success,
    ).toBe(false);
  });

  it('rejects an action outside the closed audit vocabulary', () => {
    expect(activityActionSchema.safeParse('task.created').success).toBe(true);
    expect(activityActionSchema.safeParse('task.exploded').success).toBe(false);
  });
});

describe('notifications', () => {
  const notification = {
    id: ID_A,
    recipientId: ID_B,
    type: 'mentioned',
    payload: {
      taskKey: 'FLOW-12',
      taskTitle: 'Ship the board',
      orgSlug: 'acme',
      projectKey: 'FLOW',
      actorName: 'Ada',
    },
    readAt: null,
    createdAt: NOW,
  };

  it('parses an unread mention with its denormalized payload', () => {
    const parsed = notificationSchema.parse(notification);

    expect(parsed.readAt).toBeNull();
    expect(parsed.payload.taskKey).toBe('FLOW-12');
  });

  it('accepts an entirely empty payload — every field is optional', () => {
    expect(notificationSchema.parse({ ...notification, payload: {} }).payload).toEqual({});
  });

  it('rejects a notification type nothing produces', () => {
    expect(notificationSchema.safeParse({ ...notification, type: 'task_exploded' }).success).toBe(
      false,
    );
  });

  it('parses an unread count and rejects a negative one', () => {
    expect(unreadCountSchema.parse({ count: 0 }).count).toBe(0);
    expect(unreadCountSchema.safeParse({ count: -1 }).success).toBe(false);
  });

  it('rejects marking an empty set read', () => {
    expect(markNotificationsReadInputSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe('reports', () => {
  it('parses a burndown with its ideal line', () => {
    const parsed = burndownReportSchema.parse({
      days: [{ date: '2026-02-01', remainingPoints: 34, idealPoints: 34 }],
    });

    expect(parsed.days[0]?.idealPoints).toBe(34);
  });

  it('rejects a burndown day stamped with an instant instead of a calendar day', () => {
    expect(
      burndownReportSchema.safeParse({
        days: [{ date: NOW, remainingPoints: 1, idealPoints: 1 }],
      }).success,
    ).toBe(false);
  });

  it('requires every status category in a cumulative-flow day', () => {
    expect(
      cumulativeFlowReportSchema.parse({
        days: [{ date: '2026-02-01', counts: { todo: 4, in_progress: 2, done: 9 } }],
      }).days,
    ).toHaveLength(1);
    expect(
      cumulativeFlowReportSchema.safeParse({
        days: [{ date: '2026-02-01', counts: { todo: 4 } }],
      }).success,
    ).toBe(false);
  });

  it('parses velocity, cycle time and workload', () => {
    expect(
      velocityReportSchema.parse({
        sprints: [{ sprintId: ID_A, name: 'Sprint 3', committedPoints: 30, completedPoints: 26 }],
      }).sprints,
    ).toHaveLength(1);

    const cycle = cycleTimeReportSchema.parse({ tasks: [], p50: null, p90: null });
    expect(cycle.p50).toBeNull();

    const workload = workloadReportSchema.parse({
      assignees: [{ user: null, openTasks: 5, openPoints: 13 }],
    });
    expect(workload.assignees[0]?.user).toBeNull();
  });

  it('rejects a cycle-time row with a malformed task key', () => {
    expect(
      cycleTimeReportSchema.safeParse({
        tasks: [{ taskId: ID_A, key: 'nope', startedAt: NOW, resolvedAt: NOW, hours: 4 }],
        p50: 4,
        p90: 4,
      }).success,
    ).toBe(false);
  });
});

describe('telemetry', () => {
  it('parses a stored event and rejects an unlisted type', () => {
    const event = {
      id: '42',
      type: 'task_moved',
      userId: ID_A,
      orgId: null,
      projectId: ID_B,
      payload: { statusId: ID_C },
      createdAt: NOW,
    };

    expect(telemetryEventSchema.parse(event).type).toBe('task_moved');
    expect(telemetryEventSchema.safeParse({ ...event, type: 'rage_quit' }).success).toBe(false);
  });

  it('splits a comma-separated type filter and defaults the page', () => {
    const parsed = telemetryEventsQuerySchema.parse({ type: 'auth_login,page_view' });

    expect(parsed.type).toEqual(['auth_login', 'page_view']);
    expect(parsed).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('parses the overview KPIs and rejects a fractional count', () => {
    const overview = {
      dau: 12,
      eventsToday: 400,
      tasksCreated7d: 30,
      tasksCompleted7d: 25,
      activeProjects: 4,
    };

    expect(telemetryOverviewSchema.parse(overview).dau).toBe(12);
    expect(telemetryOverviewSchema.safeParse({ ...overview, dau: 1.5 }).success).toBe(false);
  });

  it('parses the three request charts', () => {
    expect(
      requestsOverTimeSchema.parse({ buckets: [{ ts: NOW, count: 10, avgDurationMs: 22.5 }] })
        .buckets,
    ).toHaveLength(1);
    expect(
      topEndpointsSchema.parse({
        endpoints: [
          { method: 'GET', path: '/api/tasks/:taskId', count: 9, avgDurationMs: 4, errorRate: 0 },
        ],
      }).endpoints,
    ).toHaveLength(1);
    expect(
      latencyReportSchema.parse({
        buckets: [{ ts: NOW, p50: 3, p90: 9, p95: 12, p99: 40, max: 90, count: 100 }],
      }).buckets[0]?.p99,
    ).toBe(40);
  });

  it('rejects an error rate outside 0..1', () => {
    expect(
      topEndpointsSchema.safeParse({
        endpoints: [{ method: 'GET', path: '/api/x', count: 1, avgDurationMs: 1, errorRate: 1.5 }],
      }).success,
    ).toBe(false);
  });
});

describe('diagnostics', () => {
  it('parses a ring snapshot and fills the record defaults', () => {
    const parsed = serverLogsSnapshotSchema.parse({
      records: [{ id: 1, time: 1770000000000, level: 'info' }],
      lastId: 1,
    });

    expect(parsed.records[0]?.msg).toBe('');
    expect(parsed.records[0]?.context).toEqual({});
  });

  it('rejects a level pino does not emit', () => {
    expect(
      serverLogsSnapshotSchema.safeParse({
        records: [{ id: 1, time: 1, level: 'verbose' }],
        lastId: 1,
      }).success,
    ).toBe(false);
  });

  it('coerces the query string and caps the limit at the ring size', () => {
    expect(serverLogsQuerySchema.parse({})).toEqual({ sinceId: 0, limit: 500 });
    expect(serverLogsQuerySchema.parse({ sinceId: '120', limit: '50' })).toEqual({
      sinceId: 120,
      limit: 50,
    });
    expect(serverLogsQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
    expect(serverLogsQuerySchema.safeParse({ sinceId: '-1' }).success).toBe(false);
  });
});

describe('theme', () => {
  const colors = {
    primary: 'oklch(0.662 0.166 278)',
    primaryFg: '#ffffff',
    secondary: 'oklch(0.248 0.009 275)',
    accent: 'oklch(0.742 0.116 220)',
    bg: '#0b0d12',
    surface: '#12151c',
    surfaceRaised: '#181c25',
    border: '#232936',
    text: '#e6e9ef',
    textMuted: '#8b93a7',
    success: '#3fb950',
    warning: '#d29922',
    danger: '#f85149',
    info: '#3b82f6',
    sidebarBg: '#0e1117',
    sidebarActive: '#161b27',
    topbar: '#0b0d12',
    chart1: '#5b6ef5',
    chart2: '#7c5cff',
    chart3: '#3fb950',
    chart4: '#d29922',
    chart5: '#f85149',
  };
  const document = {
    light: colors,
    dark: colors,
    shared: {
      fontBody: "'Inter', 'IBM Plex Sans Arabic', ui-sans-serif, sans-serif",
      fontHead: "'Inter', 'IBM Plex Sans Arabic', ui-sans-serif, sans-serif",
      fontMono: "'JetBrains Mono', ui-monospace, monospace",
      hWeight: 600,
      fsBase: 13.5,
      lh: 1.5,
      ls: -0.006,
      radius: 6,
      cardRadius: 8,
      btnRadius: 6,
      inputRadius: 6,
      sidebarW: 232,
      sidebarWc: 56,
      topbarH: 48,
      contentMax: 1600,
      pagePad: 20,
      cardPad: 16,
      gap: 12,
      rowPad: 8,
      shadowLevel: 1,
      speed: 130,
      density: 'compact',
      chartStyle: 'filled',
    },
    themePreset: 'Default',
    fontPreset: 'Inter',
  };

  it('parses a complete theme document', () => {
    expect(themeDocumentSchema.parse(document).shared.density).toBe('compact');
  });

  it('accepts both hex and OKLCH color tokens', () => {
    const parsed = themeDocumentSchema.parse(document);

    expect(parsed.light.primary).toBe('oklch(0.662 0.166 278)');
    expect(parsed.light.primaryFg).toBe('#ffffff');
  });

  it('parses a document with no preset markers', () => {
    const { themePreset: _theme, fontPreset: _font, ...anonymous } = document;

    expect(themeDocumentSchema.parse(anonymous).themePreset).toBeUndefined();
  });

  it('rejects a mode that is missing a token — no cross-mode inheritance', () => {
    const { chart5: _chart5, ...incomplete } = colors;

    expect(themeDocumentSchema.safeParse({ ...document, dark: incomplete }).success).toBe(false);
  });

  it('rejects a color token that is neither hex nor a CSS color function', () => {
    expect(
      themeDocumentSchema.safeParse({ ...document, light: { ...colors, primary: 'blue' } }).success,
    ).toBe(false);
  });

  it('rejects a color token carrying a CSS declaration terminator', () => {
    // These strings go straight into `style.setProperty()`, so `;` `{` `}` would
    // be an injection vector.
    expect(
      themeDocumentSchema.safeParse({
        ...document,
        light: { ...colors, primary: 'rgb(0,0,0); background: url(x)' },
      }).success,
    ).toBe(false);
  });

  it('rejects a dimensional token that arrived as a CSS string', () => {
    expect(
      themeDocumentSchema.safeParse({
        ...document,
        shared: { ...document.shared, radius: '6px' },
      }).success,
    ).toBe(false);
  });
});

describe('socket protocol', () => {
  it('builds the two room names', () => {
    expect(userRoom(ID_A)).toBe(`user:${ID_A}`);
    expect(projectRoom(ID_B)).toBe(`project:${ID_B}`);
  });

  it('names every event in SOCKET_EVENTS with the scope:verb convention', () => {
    for (const name of Object.values(SOCKET_EVENTS)) {
      expect(name).toMatch(/^[a-z]+:[a-z_]+$/);
    }
  });

  it('registers a payload schema for every server->client event name', () => {
    const registered = Object.keys(serverToClientEventSchemas);
    const serverEventNames = Object.values(SOCKET_EVENTS).filter(
      (name) => !name.startsWith('project:') && name !== 'presence:update',
    );

    expect([...registered].sort()).toEqual([...serverEventNames].sort());
  });

  it('parses a task:moved payload and rejects one missing the rebalance flag', () => {
    const payload = {
      projectId: ID_A,
      taskId: ID_B,
      statusId: ID_C,
      boardRank: 'a0V',
      rebalanced: false,
      updatedAt: NOW,
    };

    expect(taskMovedPayloadSchema.parse(payload).rebalanced).toBe(false);

    const { rebalanced: _rebalanced, ...withoutFlag } = payload;
    expect(taskMovedPayloadSchema.safeParse(withoutFlag).success).toBe(false);
  });

  it('parses both halves of the ack contract', () => {
    expect(socketAckSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(socketAckSchema.parse({ ok: false, code: 'FORBIDDEN' }).code).toBe('FORBIDDEN');
    expect(socketAckSchema.safeParse({}).success).toBe(false);
  });
});

describe('validation messages', () => {
  it('exposes a unique English string per constant', () => {
    const values = Object.values(VALIDATION_MESSAGES);

    expect(new Set(values).size).toBe(values.length);
  });

  it('types the union from the object, so an i18n map can be exhaustive', () => {
    const sample: ValidationMessage = VALIDATION_MESSAGES.VM_REQUIRED;

    expect(sample).toBe('This field is required');
  });
});
