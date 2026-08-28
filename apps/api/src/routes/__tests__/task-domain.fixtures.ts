/**
 * WP2.3 integration-test support: the task-domain app under test, plus row
 * builders that write fixtures straight to the database.
 *
 * WHY ROWS AND NOT THE API. A suite about the task domain has to arrange states
 * the API deliberately refuses to create — a column already sitting at its WIP
 * limit, a rank long enough to force a rebalance, a task resolved three days
 * ago — and building those through endpoints would make the arrangement share
 * failure modes with the assertion. A broken guard would then quietly produce a
 * passing test.
 *
 * Lives in `__tests__/` and is NOT named `*.test.ts`: vitest's `include` glob
 * would treat it as a suite with no tests, and `tsconfig.json` excludes the
 * folder so the `supertest` devDependency can never reach `dist/`.
 */
import { eq, sql } from 'drizzle-orm';
import express, { type Express } from 'express';
import {
  rankBetween,
  type ProjectRole,
  type StatusCategory,
  type TelemetryEventType,
} from '@flowboard/shared';

import {
  db,
  labels,
  organizations,
  orgMembers,
  projectMembers,
  projects,
  sprints,
  statuses,
  taskLabels,
  tasks,
  users,
  workflowTransitions,
} from '../../db';
import { errorHandler, notFound } from '../../middlewares/error-handler';
import { socketIdMiddleware } from '../../middlewares/socket-id';
import { signAccessToken } from '../../utils/jwt';
import { setTelemetrySink } from '../../services/telemetry.service';
import {
  clearDomainEventHandlers,
  onDomainEvent,
  type DomainEventMap,
  type DomainEventName,
} from '../../utils/domain-events';
import { attachmentsRouter } from '../attachments.routes';
import { commentsRouter } from '../comments.routes';
import { reportsRouter } from '../reports.routes';
import { searchRouter } from '../search.routes';
import { sprintsRouter } from '../sprints.routes';
import { tasksRouter } from '../tasks.routes';

/**
 * The app under test.
 *
 * Deliberately NOT `createApp()`: this suite must fail when WP2.3's routers
 * break, not when a sibling work package's router is mid-edit. Everything that
 * shapes a response body is here — JSON parsing, the 404 fallthrough and the
 * single error-envelope formatter; the rate limiter, CORS and the request
 * logger are not, because none of them changes one.
 *
 * All six routers stack on `/api`, exactly as `routes/index.ts` will mount
 * them: each carries its own full paths and Express falls through a router with
 * no matching route.
 */
export function createTaskTestApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // Echo suppression is part of the contract these services publish under, so
  // the header reader is mounted here even though it shapes no response body.
  app.use(socketIdMiddleware);
  app.use('/api', tasksRouter);
  app.use('/api', commentsRouter);
  app.use('/api', attachmentsRouter);
  app.use('/api', sprintsRouter);
  app.use('/api', searchRouter);
  app.use('/api', reportsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

let sequence = 0;
/** Monotonic suffix so emails, slugs and project keys stay unique in a suite. */
function nextId(): number {
  sequence += 1;
  return sequence;
}

/** A seeded account and a ready-to-use Bearer token for it. */
export interface UserRef {
  id: string;
  name: string;
  email: string;
  token: string;
}

export async function seedUser(
  options: { name?: string; isGlobalAdmin?: boolean; isActive?: boolean } = {},
): Promise<UserRef> {
  const id = nextId();
  const email = `wp23-user${String(id)}@flowboard.dev`;
  const name = options.name ?? `User ${String(id)}`;
  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      // A bcrypt-shaped constant: nothing in this work package verifies a
      // password, and hashing one per fixture would dominate the suite's time.
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv0123456789012345678901234567890',
      isGlobalAdmin: options.isGlobalAdmin ?? false,
      isActive: options.isActive ?? true,
    })
    .returning({ id: users.id, tokenVersion: users.tokenVersion });
  if (!row) throw new Error('seedUser inserted nothing');

  return {
    id: row.id,
    name,
    email,
    token: signAccessToken({
      sub: row.id,
      tokenVersion: row.tokenVersion,
      isGlobalAdmin: options.isGlobalAdmin ?? false,
    }),
  };
}

/** `Authorization` header for a seeded user. */
export function auth(user: UserRef): string {
  return `Bearer ${user.token}`;
}

export interface StatusRefs {
  todo: string;
  inProgress: string;
  done: string;
}

/** Everything a task-domain suite arranges against. */
export interface World {
  orgId: string;
  projectId: string;
  projectKey: string;
  statuses: StatusRefs;
  admin: UserRef;
  member: UserRef;
  viewer: UserRef;
  /** An org member with no project role — reaches nothing in this project. */
  outsider: UserRef;
}

export interface WorldOptions {
  /** WIP limit on the `in_progress` column; `null` (default) is unlimited. */
  inProgressWipLimit?: number | null;
  /**
   * When true, seeds a transition whitelist: todo -> inProgress and
   * inProgress -> done only. Zero rows (the default) means a fully open
   * workflow, which is the semantic the schema documents.
   */
  restrictTransitions?: boolean;
}

/**
 * A complete tenancy: an org, four accounts with the three project roles plus
 * an outsider, and a project with the default three-column workflow.
 */
export async function seedWorld(options: WorldOptions = {}): Promise<World> {
  const id = nextId();
  const [org] = await db
    .insert(organizations)
    .values({ slug: `wp23-org-${String(id)}`, name: `Org ${String(id)}` })
    .returning({ id: organizations.id });
  if (!org) throw new Error('seedWorld inserted no org');

  const [admin, member, viewer, outsider] = await Promise.all([
    seedUser({ name: 'Project Admin' }),
    seedUser({ name: 'Project Member' }),
    seedUser({ name: 'Project Viewer' }),
    seedUser({ name: 'Org Outsider' }),
  ]);

  await db.insert(orgMembers).values(
    [admin, member, viewer, outsider].map((user) => ({
      orgId: org.id,
      userId: user.id,
      role: 'member' as const,
    })),
  );

  const key = `WP${String(id)}`.slice(0, 10);
  const [project] = await db
    .insert(projects)
    .values({ orgId: org.id, key, name: `Project ${String(id)}` })
    .returning({ id: projects.id });
  if (!project) throw new Error('seedWorld inserted no project');

  const roles: [UserRef, ProjectRole][] = [
    [admin, 'admin'],
    [member, 'member'],
    [viewer, 'viewer'],
  ];
  await db
    .insert(projectMembers)
    .values(roles.map(([user, role]) => ({ projectId: project.id, userId: user.id, role })));

  const statusRows = await db
    .insert(statuses)
    .values([
      { projectId: project.id, name: 'To Do', category: 'todo', position: 0, color: '#64748b' },
      {
        projectId: project.id,
        name: 'In Progress',
        category: 'in_progress',
        position: 1,
        color: '#3b82f6',
        wipLimit: options.inProgressWipLimit ?? null,
      },
      { projectId: project.id, name: 'Done', category: 'done', position: 2, color: '#22c55e' },
    ])
    .returning({ id: statuses.id, category: statuses.category });

  const byCategory = (category: StatusCategory): string => {
    const row = statusRows.find((candidate) => candidate.category === category);
    if (!row) throw new Error(`seedWorld produced no ${category} status`);
    return row.id;
  };
  const refs: StatusRefs = {
    todo: byCategory('todo'),
    inProgress: byCategory('in_progress'),
    done: byCategory('done'),
  };

  if (options.restrictTransitions === true) {
    await db.insert(workflowTransitions).values([
      { projectId: project.id, fromStatusId: refs.todo, toStatusId: refs.inProgress },
      { projectId: project.id, fromStatusId: refs.inProgress, toStatusId: refs.done },
    ]);
  }

  return {
    orgId: org.id,
    projectId: project.id,
    projectKey: key,
    statuses: refs,
    admin,
    member,
    viewer,
    outsider,
  };
}

let taskNumber = 0;
let lastRank: string | null = null;

/**
 * The next ascending rank for a fixture row.
 *
 * Chained through the shared generator rather than hand-formatted: a
 * fractional index is not an arbitrary sortable string — `generateKeyBetween`
 * validates the alphabet AND the length prefix, and a plausible-looking
 * `a0001` is rejected outright the moment production code tries to insert
 * after it.
 */
export function nextRank(): string {
  lastRank = rankBetween(lastRank, null);
  return lastRank;
}

export interface TaskFixtureOptions {
  title?: string;
  type?: 'epic' | 'story' | 'task' | 'bug' | 'subtask';
  statusId?: string;
  priority?: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
  assigneeId?: string | null;
  reporterId?: string | null;
  storyPoints?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  sprintId?: string | null;
  epicId?: string | null;
  parentId?: string | null;
  boardRank?: string;
  backlogRank?: string;
  resolvedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt?: Date;
}

/**
 * Insert one task row directly. Returns its id.
 *
 * The issue number comes from the project's counter with the same atomic
 * `UPDATE … RETURNING` the service uses — a fixture that invented its own
 * number would collide with the next task created through the API.
 */
export async function seedTask(world: World, options: TaskFixtureOptions = {}): Promise<string> {
  const [counter] = await db
    .update(projects)
    .set({ taskCounter: sql`${projects.taskCounter} + 1` })
    .where(eq(projects.id, world.projectId))
    .returning({ number: projects.taskCounter });
  if (!counter) throw new Error('seedTask could not allocate a number');
  taskNumber = counter.number;

  const [row] = await db
    .insert(tasks)
    .values({
      projectId: world.projectId,
      number: counter.number,
      title: options.title ?? `Task ${String(taskNumber)}`,
      type: options.type ?? 'task',
      statusId: options.statusId ?? world.statuses.todo,
      priority: options.priority ?? 'medium',
      assigneeId: options.assigneeId ?? null,
      reporterId: options.reporterId ?? world.member.id,
      storyPoints: options.storyPoints ?? null,
      startDate: options.startDate ?? null,
      dueDate: options.dueDate ?? null,
      sprintId: options.sprintId ?? null,
      epicId: options.epicId ?? null,
      parentId: options.parentId ?? null,
      boardRank: options.boardRank ?? nextRank(),
      backlogRank: options.backlogRank ?? nextRank(),
      resolvedAt: options.resolvedAt ?? null,
      deletedAt: options.deletedAt ?? null,
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error('seedTask inserted nothing');
  return row.id;
}

/** Insert a project label and return its id. */
export async function seedLabel(world: World, name?: string): Promise<string> {
  const [row] = await db
    .insert(labels)
    .values({
      projectId: world.projectId,
      name: name ?? `label-${String(nextId())}`,
      color: '#f97316',
    })
    .returning({ id: labels.id });
  if (!row) throw new Error('seedLabel inserted nothing');
  return row.id;
}

/** Attach an existing label to an existing task. */
export async function attachLabel(taskId: string, labelId: string): Promise<void> {
  await db.insert(taskLabels).values({ taskId, labelId });
}

export interface SprintFixtureOptions {
  name?: string;
  state?: 'planned' | 'active' | 'completed';
  /** `YYYY-MM-DD` — the planned window is a pair of `date` columns. */
  startDate?: string | null;
  endDate?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  committedPoints?: number | null;
  completedPoints?: number | null;
}

/** Insert one sprint row directly. Returns its id. */
export async function seedSprint(
  world: World,
  options: SprintFixtureOptions = {},
): Promise<string> {
  const [row] = await db
    .insert(sprints)
    .values({
      projectId: world.projectId,
      name: options.name ?? `Sprint ${String(nextId())}`,
      state: options.state ?? 'planned',
      startDate: options.startDate ?? null,
      endDate: options.endDate ?? null,
      startedAt: options.startedAt ?? null,
      completedAt: options.completedAt ?? null,
      committedPoints: options.committedPoints ?? null,
      completedPoints: options.completedPoints ?? null,
    })
    .returning({ id: sprints.id });
  if (!row) throw new Error('seedSprint inserted nothing');
  return row.id;
}

/** One recorded telemetry event, as the capture buffer stores it. */
export interface CapturedTelemetry {
  type: TelemetryEventType;
  payload: Record<string, unknown> | null;
  projectId: string | null;
}

/**
 * Capture telemetry instead of writing it.
 *
 * `record()` is fire-and-forget and never awaited, so an assertion has to wait
 * a tick for the sink to run — {@link flushAsync} is that tick.
 */
export function captureTelemetry(): CapturedTelemetry[] {
  const captured: CapturedTelemetry[] = [];
  setTelemetrySink((event) => {
    captured.push({
      type: event.type as TelemetryEventType,
      payload: (event.payload ?? null) as Record<string, unknown> | null,
      projectId: event.projectId ?? null,
    });
    return Promise.resolve();
  });
  return captured;
}

/** Detach the capture sink; `record()` goes back to being a no-op. */
export function stopTelemetry(): void {
  setTelemetrySink(null);
}

/** Capture every payload published for one domain event. */
export function captureDomainEvent<TName extends DomainEventName>(
  name: TName,
): DomainEventMap[TName][] {
  const captured: DomainEventMap[TName][] = [];
  onDomainEvent(name, (payload) => {
    captured.push(payload);
  });
  return captured;
}

/** Drop every subscriber registered by a suite. */
export function stopDomainEvents(): void {
  clearDomainEventHandlers();
}

/** Let fire-and-forget work (telemetry, event publishing) settle. */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}
