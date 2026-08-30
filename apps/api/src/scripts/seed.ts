/**
 * `pnpm --filter @flowboard/api db:seed`
 *
 * Fills a freshly migrated database with demo organizations that make EVERY
 * FlowBoard view render non-empty: a board with cards in every column, a
 * backlog, a completed sprint (so velocity has a bar) next to an active one (so
 * burndown has a line), epics with children and date ranges (roadmap), tasks
 * with due dates in the past and the future (calendar + gantt), comments with a
 * mention, an activity stream, notifications, and two weeks of telemetry.
 *
 * TWO ORGANIZATIONS, not one. `acme` is the deep one — every view, every edge
 * case, both workflow shapes. `globex` is the second TENANT, and it exists so
 * that the surfaces which only make sense across organizations are not
 * degenerate: the admin Organizations table, the cross-org Projects list, the
 * org switcher, `?scope=member`, and the growth analytics domain all read a
 * one-row database as if they were broken. It is deliberately smaller, younger
 * and simpler than Acme so the two are distinguishable rows rather than a copy.
 *
 * DESIGN NOTES
 * - **Deterministic.** All randomness comes from one seeded LCG, so two runs
 *   produce byte-identical data and a screenshot or a failing report is
 *   reproducible.
 * - **All-or-nothing.** The whole seed is one transaction. A crash halfway
 *   leaves an empty database rather than a half-populated one that lies.
 * - **Idempotent from empty only.** It refuses to run against a database that
 *   already has users; use `pnpm db:reset && pnpm db:seed`.
 * - **No RUNTIME `@flowboard/shared` import.** The seed must be able to
 *   bootstrap the database that the shared package's own integration tests run
 *   against, so it hand-rolls its fractional ranks (see `seed-utils.ts`).
 *   TYPE-only imports are fine and are used deliberately below: they are erased
 *   at compile time, and they are what makes a contract typo (`comment.created`
 *   for `comment.added`) a build error instead of a 422 nobody sees until a
 *   feed request lands.
 */
import { HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import type { ActivityAction } from '@flowboard/shared';

import {
  activity,
  attachments,
  closeDb,
  comments,
  db,
  instanceSettings,
  invites,
  labels,
  notifications,
  orgMembers,
  organizations,
  projectMembers,
  projects,
  requestLogs,
  sprints,
  statuses,
  taskDependencies,
  taskLabels,
  taskWatchers,
  tasks,
  teamMembers,
  teams,
  telemetryEvents,
  users,
  workflowTransitions,
  type NewActivityRow,
  type NewAttachmentRow,
  type NewCommentRow,
  type NewNotificationRow,
  type NewRequestLogRow,
  type NewTaskRow,
  type NewTelemetryEventRow,
  type OrgRole,
  type ProjectRole,
  type StatusCategory,
  type TaskPriority,
  type TaskType,
  type Tx,
} from '../db';
import { env } from '../config/env';
import { hashPassword } from '../utils/password';
import { S3_BUCKET, s3Client } from '../utils/s3';
import { detail, done, failure, step } from './script-logger';
import {
  addDays,
  addMinutes,
  between,
  chunk,
  createRandom,
  createRankAllocator,
  isoDate,
  type Random,
} from './seed-utils';

// ─────────────────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'admin@flowboard.dev';
const ADMIN_PASSWORD = 'admin1234';
/** Everyone else. Deliberately one shared literal — this is demo data. */
const MEMBER_PASSWORD = 'password1234';

/** Change this and the entire generated dataset changes, reproducibly. */
const RANDOM_SEED = 20260827;

/** Chunk size for the bulk streams; keeps each INSERT well under Postgres' 65535 parameters. */
const INSERT_CHUNK = 200;

/**
 * How long to wait for the object store before giving up on it.
 *
 * Short on purpose: `pnpm db:seed` must stay usable when MinIO is not running
 * (a fresh clone that only started Postgres, CI, a colleague reproducing a
 * data bug). The attachment ROWS are seeded either way; only the bytes are
 * optional, and waiting 30 seconds to learn that would be worse than the empty
 * download it prevents.
 */
const S3_PROBE_TIMEOUT_MS = 2000;

/**
 * The objects the seeded `attachments` rows promise the store holds.
 *
 * Filled inside the transaction, uploaded by {@link main} AFTER it commits:
 * network I/O inside a database transaction holds a connection open across an
 * unbounded wait, and a failed upload must not roll back 60 issues.
 */
const seededObjects: { key: string; body: string; mimeType: string }[] = [];

/** Is the object store up and does the bucket exist? Never throws. */
async function objectStoreReachable(): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(S3_PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * PUT the seeded attachment bodies, or explain why the tab's Download button
 * will 404. Never throws — the database is already committed and correct.
 *
 * This is the ONLY place in the codebase where the server writes object bytes;
 * the request path always presigns and lets the browser transfer them
 * (`utils/s3.ts`). A seed has no browser to presign for.
 */
async function uploadSeededObjects(): Promise<void> {
  if (seededObjects.length === 0) return;

  if (!(await objectStoreReachable())) {
    detail(
      `object store unreachable at ${env.S3_ENDPOINT} — ${String(seededObjects.length)} attachment rows seeded WITHOUT their files.`,
    );
    detail('  start it with `docker compose -f docker-compose.dev.yml up -d` and re-seed to fix.');
    return;
  }

  try {
    for (const object of seededObjects) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: object.key,
          Body: object.body,
          ContentType: object.mimeType,
          ContentLength: Buffer.byteLength(object.body, 'utf8'),
        }),
      );
    }
    detail(`${seededObjects.length} attachment objects uploaded to ${S3_BUCKET}`);
  } catch (error) {
    detail(`attachment upload failed (rows are still seeded): ${String(error)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// People
// ─────────────────────────────────────────────────────────────────────────────

interface UserSpec {
  readonly key: string;
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly isGlobalAdmin: boolean;
  readonly isActive: boolean;
  readonly locale: string;
  readonly orgRole: OrgRole;
}

const USER_SPECS: readonly UserSpec[] = [
  {
    key: 'ada',
    email: ADMIN_EMAIL,
    name: 'Ada Lovelace',
    password: ADMIN_PASSWORD,
    isGlobalAdmin: true,
    isActive: true,
    locale: 'en',
    orgRole: 'admin',
  },
  // An org admin who is NOT a global admin — the role matrix needs one to be
  // meaningful (she can manage Acme, she cannot reach /admin).
  {
    key: 'maya',
    email: 'maya@flowboard.dev',
    name: 'Maya Chen',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'admin',
  },
  // Arabic locale, so the RTL boot path has a real account to log in with.
  {
    key: 'omar',
    email: 'omar@flowboard.dev',
    name: 'Omar Haddad',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'ar',
    orgRole: 'member',
  },
  {
    key: 'sara',
    email: 'sara@flowboard.dev',
    name: 'Sara Novak',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'member',
  },
  {
    key: 'liam',
    email: 'liam@flowboard.dev',
    name: 'Liam Okafor',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'member',
  },
  {
    key: 'nina',
    email: 'nina@flowboard.dev',
    name: 'Nina Petrova',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'member',
  },
  {
    key: 'tom',
    email: 'tom@flowboard.dev',
    name: 'Tom Ridley',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'member',
  },
  // Read-only on both projects — the "viewer cannot write" tests need a subject.
  {
    key: 'yuki',
    email: 'yuki@flowboard.dev',
    name: 'Yuki Tanaka',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'member',
  },
  // Deactivated, so the admin user list has a row in every state.
  {
    key: 'dana',
    email: 'dana@flowboard.dev',
    name: 'Dana Weiss',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: false,
    locale: 'en',
    orgRole: 'member',
  },
];

/**
 * Accounts that exist ONLY in the second organization.
 *
 * Kept out of {@link USER_SPECS} because that list doubles as Acme's membership
 * roster (`USER_SPECS.map(spec => ({ orgId: acme.id, role: spec.orgRole }))`).
 * Priya belongs to Globex and nowhere else, which is the state the admin user
 * directory's memberships column and the cross-org filters need to have a
 * meaningful row: an account whose org list is NOT "all of them".
 *
 * `orgRole` here means her role in GLOBEX.
 */
const GLOBEX_USER_SPECS: readonly UserSpec[] = [
  {
    key: 'priya',
    email: 'priya@flowboard.dev',
    name: 'Priya Raman',
    password: MEMBER_PASSWORD,
    isGlobalAdmin: false,
    isActive: true,
    locale: 'en',
    orgRole: 'member',
  },
];

/** Every account the seed creates, in insert order. */
const ALL_USER_SPECS: readonly UserSpec[] = [...USER_SPECS, ...GLOBEX_USER_SPECS];

/**
 * Globex's membership: four accounts borrowed from Acme plus Priya.
 *
 * The OVERLAP is the point. `ada` is in both, so the org switcher has something
 * to switch between; `nina` is a plain member of Acme and an ADMIN of Globex,
 * which is the case that proves org roles are per-org rather than global.
 */
const GLOBEX_MEMBER_SPECS: ReadonlyArray<{ key: string; role: OrgRole }> = [
  { key: 'ada', role: 'admin' },
  { key: 'nina', role: 'admin' },
  { key: 'liam', role: 'member' },
  { key: 'tom', role: 'member' },
  { key: 'priya', role: 'member' },
];

const TEAM_SPECS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly memberKeys: readonly string[];
}> = [
  {
    name: 'Platform',
    description: 'API, database, realtime and everything under the surface.',
    memberKeys: ['maya', 'omar', 'sara', 'liam'],
  },
  {
    name: 'Product',
    description: 'Views, design system and the parts users actually touch.',
    memberKeys: ['maya', 'nina', 'tom', 'yuki'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Projects & workflow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status and label colours as HEX literals, matching the shared `hexColor`
 * contract and the ten swatches the web's pickers offer
 * (`apps/web/src/lib/label-colors.ts`).
 *
 * They are NOT design-token names. A label's colour is user-chosen data that
 * has to mean the same thing in both themes and in a CSV export, so it is
 * stored as the value rather than as a name something else has to resolve —
 * which is also why `hexColor` rejects `'slate'` outright. Seeding token names
 * would have produced demo rows the API's own response schema refuses.
 */
const SEED_COLORS = {
  slate: '#64748b',
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#22c55e',
  teal: '#14b8a6',
  blue: '#3b82f6',
  violet: '#8b5cf6',
  pink: '#ec4899',
} as const;

interface StatusSpec {
  readonly name: string;
  readonly category: StatusCategory;
  readonly color: string;
  readonly wipLimit: number | null;
}

/** FLOW keeps the DEFAULT workflow: three columns, and no transition rows at all. */
const FLOW_STATUSES: readonly StatusSpec[] = [
  { name: 'To Do', category: 'todo', color: SEED_COLORS.slate, wipLimit: null },
  { name: 'In Progress', category: 'in_progress', color: SEED_COLORS.blue, wipLimit: null },
  { name: 'Done', category: 'done', color: SEED_COLORS.green, wipLimit: null },
];

/** CORE exercises the custom-workflow path: five columns, a WIP limit, a whitelist. */
const CORE_STATUSES: readonly StatusSpec[] = [
  { name: 'Backlog', category: 'todo', color: SEED_COLORS.slate, wipLimit: null },
  { name: 'Selected', category: 'todo', color: SEED_COLORS.violet, wipLimit: null },
  { name: 'In Progress', category: 'in_progress', color: SEED_COLORS.blue, wipLimit: 3 },
  { name: 'In Review', category: 'in_progress', color: SEED_COLORS.amber, wipLimit: null },
  { name: 'Done', category: 'done', color: SEED_COLORS.green, wipLimit: null },
];

/**
 * CORE's transition whitelist. Note what is NOT here: `Backlog → Done`,
 * `Selected → Done`, `Backlog → In Progress`. Dragging a card that way must be
 * rejected by the board and by PATCH, which is exactly what the workflow tests
 * assert.
 */
const CORE_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ['Backlog', 'Selected'],
  ['Selected', 'Backlog'],
  ['Selected', 'In Progress'],
  ['In Progress', 'Selected'],
  ['In Progress', 'In Review'],
  ['In Review', 'In Progress'],
  ['In Review', 'Done'],
  ['Done', 'In Progress'],
];

const FLOW_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'frontend', color: SEED_COLORS.blue },
  { name: 'backend', color: SEED_COLORS.violet },
  { name: 'design', color: SEED_COLORS.pink },
  { name: 'tech-debt', color: SEED_COLORS.amber },
  { name: 'docs', color: SEED_COLORS.slate },
];

const CORE_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'api', color: SEED_COLORS.violet },
  { name: 'infra', color: SEED_COLORS.teal },
  { name: 'security', color: SEED_COLORS.red },
  { name: 'performance', color: SEED_COLORS.amber },
  { name: 'dx', color: SEED_COLORS.slate },
];

/**
 * Globex's two projects both keep the DEFAULT three-column workflow.
 *
 * Acme already exercises the custom-workflow path (CORE's five columns, its
 * transition whitelist and its WIP limit). The second organization exists to
 * make the CROSS-ORG surfaces non-empty — the admin Organizations and Projects
 * tables, the org switcher, the growth analytics domain — and giving it a second
 * bespoke workflow would add setup nothing in Round 2 reads.
 */
const GLOBEX_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'storefront', color: SEED_COLORS.pink },
  { name: 'billing', color: SEED_COLORS.green },
  { name: 'ops', color: SEED_COLORS.teal },
  { name: 'compliance', color: SEED_COLORS.red },
];

const OPS_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'logistics', color: SEED_COLORS.blue },
  { name: 'vendor', color: SEED_COLORS.amber },
  { name: 'reporting', color: SEED_COLORS.violet },
];

// ─────────────────────────────────────────────────────────────────────────────
// Task copy
// ─────────────────────────────────────────────────────────────────────────────

const FLOW_TITLES: readonly string[] = [
  'Drag a card between board columns',
  'Show the WIP limit badge on column headers',
  'Persist board filters per project',
  'Swimlanes grouped by assignee',
  'Card avatars overflow past four members',
  'Keyboard sensor for dnd-kit',
  'Optimistic rank flickers on a slow network',
  'Board column collapses when it is empty',
  'Sticky column headers while scrolling',
  'Burndown chart should skip weekend days',
  'Velocity chart shows only the last six sprints',
  'Cumulative flow diagram legend overlaps the axis',
  'Split cycle time into p50 and p90',
  'Workload report must count unassigned work',
  'Export the table view to CSV',
  'Inline editor for story points',
  'Column config popover forgets its selection',
  'Virtualize the table beyond 500 rows',
  'Drag to reschedule in the calendar month view',
  'Unscheduled tray beside the calendar',
  'Gantt bar resize should snap to whole days',
  'Dependency arrows cross the wrong columns',
  'Today line drifts in non-local timezones',
  'Epic roll-up bar should span its children',
  'Roadmap zoom levels: week, month, quarter',
  'Deep link straight to the task detail sheet',
  'Markdown preview for task descriptions',
  'Mention autocomplete inside comments',
  'Progress bar for attachment uploads',
  'Subtask checklist progress on the card',
  'Empty state for a brand-new board',
  'Focus ring missing on card actions',
  'Arabic layout must mirror the board',
  'Command palette opens with Ctrl+K',
  'Toast on every failed mutation',
  'Skeleton loaders while the board is fetching',
];

const CORE_TITLES: readonly string[] = [
  'Rotate refresh tokens on every use',
  'Single-flight refresh in the API client',
  'Rate limit the login endpoint',
  'Invite link expiry is not enforced',
  'Deactivating a user must revoke live sessions',
  'AuthProvider interface for a future LDAP swap',
  'Global admin can reset a password',
  'Audit log for admin actions',
  'Batch request-log inserts in the middleware',
  'Telemetry overview endpoint',
  'Top-endpoints aggregation is slow',
  'Latency percentiles from request_logs',
  'Ring buffer must drop the oldest at 500',
  'Log drawer polls with sinceId',
  'Health endpoint reports database latency',
  'Socket handshake re-checks tokenVersion',
  'Echo suppression via X-Socket-Id',
  'Presence state leaks after a reconnect',
  'Type the domain-events bus end to end',
  'Cycle detection for task dependencies',
  'Atomic task counter under concurrent creates',
  'Partial unique index for the active sprint',
  'Rebalance fractional ranks past 60 characters',
  'Presigned URL expiry is too short',
  'S3 key collision on duplicate filenames',
  'Structured error envelope on every route',
  'Validation messages are not translated',
  'Seed script must fill every view',
];

const GX_TITLES: readonly string[] = [
  'Guest checkout drops the cart on refresh',
  'Product grid needs a skeleton state',
  'Apply promo codes at the basket level',
  'Address autocomplete for the shipping form',
  'Stock badge lies when a variant sells out',
  'Split the payment step into its own route',
  'Order confirmation email template',
  'Wishlist sync across devices',
  'Search facets for size and colour',
  'Currency switcher rounds the wrong way',
  'Recently viewed rail on the home page',
  'Accessible focus order in the basket drawer',
  'Cache the category tree at the edge',
  'Refund flow for a partially shipped order',
];

const OPS_TITLES: readonly string[] = [
  'Warehouse pick list export',
  'Courier webhook retries forever on a 500',
  'Daily stock reconciliation job',
  'Vendor onboarding checklist',
  'Returns dashboard for the support team',
  'Label printer times out over VPN',
  'Forecast restock dates per SKU',
  'Nightly finance reconciliation report',
  'Audit trail for manual stock adjustments',
  'Escalation rota for out-of-hours incidents',
];

const SUBTASK_TITLES: readonly string[] = [
  'Write the unit tests',
  'Update the docs',
  'Add the telemetry event',
  'Code review and polish',
  'Add an Arabic translation',
  'Wire the loading state',
  'Backfill the migration',
];

const COMMENT_BODIES: readonly string[] = [
  'Picked this up — the tricky part is the rank recompute on the server side.',
  'Reproduced on Firefox as well, so it is not a Chromium quirk.',
  'I think we can reuse the geometry hook here instead of recomputing offsets.',
  'Blocked until the workflow whitelist lands, otherwise the drop is rejected.',
  'Nice catch. Added a regression test so it cannot come back.',
  'Rebased and pushed. Ready for review whenever someone has a slot.',
  'Do we want this behind a feature flag, or straight to everyone?',
  'The p90 looks fine now — down from 480ms to 90ms after the index.',
  'Design signed off on the spacing, one tweak left on the empty state.',
  'Moving this to the next sprint, the dependency is still open.',
  'Confirmed against the seeded data: the chart is no longer empty.',
  'Left a couple of notes inline, nothing blocking.',
];

/**
 * Product telemetry event types.
 *
 * `telemetry_events.type` is plain `text` validated by the shared zod enum, so
 * these strings must stay in sync with `packages/shared`'s telemetry enum —
 * they are not enforced by the database. Wave 4's telemetry work owns that
 * reconciliation.
 */
const TELEMETRY_TYPES: readonly string[] = [
  'page_view',
  'login_succeeded',
  'task_created',
  'task_updated',
  'task_moved',
  'comment_created',
  'search_performed',
  'sprint_started',
  'csv_exported',
  'theme_changed',
  'language_changed',
];

/** Normalized route patterns — never concrete URLs, or "top endpoints" is useless. */
const REQUEST_ROUTES: ReadonlyArray<{ method: string; path: string; weight: number }> = [
  { method: 'GET', path: '/api/projects/:projectId/tasks', weight: 22 },
  { method: 'GET', path: '/api/projects/:projectId', weight: 12 },
  { method: 'GET', path: '/api/tasks/:taskId', weight: 11 },
  { method: 'PATCH', path: '/api/tasks/:taskId', weight: 8 },
  { method: 'POST', path: '/api/tasks/:taskId/move', weight: 8 },
  { method: 'GET', path: '/api/notifications/unread-count', weight: 8 },
  { method: 'GET', path: '/api/notifications', weight: 5 },
  { method: 'GET', path: '/api/orgs', weight: 5 },
  { method: 'GET', path: '/api/projects/:projectId/sprints', weight: 4 },
  { method: 'GET', path: '/api/projects/:projectId/reports/burndown', weight: 4 },
  { method: 'POST', path: '/api/auth/refresh', weight: 4 },
  { method: 'POST', path: '/api/auth/login', weight: 3 },
  { method: 'GET', path: '/api/admin/logs', weight: 3 },
  { method: 'GET', path: '/api/health', weight: 3 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Draft types — the in-memory shape before ids exist
// ─────────────────────────────────────────────────────────────────────────────

interface TaskDraft {
  readonly localId: string;
  readonly projectKey: string;
  readonly number: number;
  readonly title: string;
  readonly type: TaskType;
  readonly statusName: string;
  readonly priority: TaskPriority;
  readonly assigneeKey: string | null;
  readonly reporterKey: string;
  readonly storyPoints: number | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly sprintName: string | null;
  readonly epicLocalId: string | null;
  readonly parentLocalId: string | null;
  readonly labelNames: readonly string[];
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly description: string | null;
}

interface ProjectContext {
  readonly id: string;
  readonly key: string;
  readonly statusIdByName: ReadonlyMap<string, string>;
  readonly categoryByStatusName: ReadonlyMap<string, StatusCategory>;
  readonly labelIdByName: ReadonlyMap<string, string>;
  readonly sprintIdByName: ReadonlyMap<string, string>;
}

/**
 * The status HISTORY a seeded task should look as though it lived.
 *
 * ── The bug this exists to fix (WP3.8) ─────────────────────────────────────
 *
 * The seed used to record a status change as a `task.field_changed` row with
 * `newValue: { name: 'Done' }`, and it wrote `task.created` with no `newValue`
 * at all. Both reports that REPLAY the activity stream read neither shape:
 * `cumulativeFlow` and `cycleTime` (`reports.service.ts`) look for
 * `task.created` / `task.status_changed` and pull a status ID out of
 * `newValue`. The result was a cumulative-flow chart that showed every task
 * frozen in one band and a cycle-time scatter that was EMPTY on a fully seeded
 * database — because no task had ever been recorded entering an `in_progress`
 * column, which is where a cycle starts.
 *
 * ── What it produces ───────────────────────────────────────────────────────
 *
 * Every task is born in the project's FIRST column and walks forward, one
 * column at a time, to the one it is in now. So a CORE task sitting in "In
 * Review" has passed through Backlog → Selected → In Progress → In Review, and
 * the pair of instants the cycle-time report needs (first `in_progress`, and
 * `resolved_at`) both exist. A task still in the first column has no hops,
 * which is exactly right — nothing has happened to it yet.
 *
 * The hops are spread evenly between creation and the END of the journey, and
 * the end is pinned to `resolvedAt` for a finished task so the activity stream
 * and the `resolved_at` column cannot disagree about when it was done.
 */
function statusJourney(
  context: ProjectContext,
  draft: TaskDraft,
): { birth: string; hops: { statusName: string; at: Date }[] } {
  // Insertion order IS column order — the maps are built from the ordered
  // `*_STATUSES` specs above.
  const columns = [...context.statusIdByName.keys()];
  const birth = columns[0] ?? draft.statusName;
  const targetIndex = columns.indexOf(draft.statusName);

  // An unknown status (or the first column) means nothing to replay.
  if (targetIndex <= 0) return { birth, hops: [] };

  const path = columns.slice(1, targetIndex + 1);

  /**
   * Where the journey ends. A resolved task ends AT its resolution; an
   * unresolved one is given two days of plausible history, clamped so a task
   * created yesterday does not report progress from tomorrow.
   */
  const end =
    draft.resolvedAt ?? new Date(Math.min(addDays(draft.createdAt, 2).getTime(), Date.now()));

  // A minute per hop is the floor: two transitions cannot share an instant, or
  // the "first time it was in progress" lookup becomes order-dependent.
  const span = Math.max(end.getTime() - draft.createdAt.getTime(), path.length * 60_000);

  return {
    birth,
    hops: path.map((statusName, index) => ({
      statusName,
      at: new Date(draft.createdAt.getTime() + (span * (index + 1)) / path.length),
    })),
  };
}

const PRIORITIES: readonly TaskPriority[] = ['lowest', 'low', 'medium', 'high', 'highest'];
const POINTS: readonly number[] = [1, 2, 3, 5, 8];

function requireEntry<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`seed: missing ${what} for ${String(key)}`);
  }
  return value;
}

/** Expand `[['To Do', 4], ['Done', 3]]` into a flat list of status names. */
function expand(pairs: ReadonlyArray<readonly [string, number]>): string[] {
  const out: string[] = [];
  for (const [name, times] of pairs) {
    for (let i = 0; i < times; i += 1) {
      out.push(name);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The seed
// ─────────────────────────────────────────────────────────────────────────────

interface SeedSummary {
  readonly [table: string]: number;
}

async function seed(tx: Tx): Promise<SeedSummary> {
  const random = createRandom(RANDOM_SEED);
  const now = new Date();

  // ── Users ────────────────────────────────────────────────────────────────
  step('users');
  // Two distinct passwords, two scrypt runs — hashing nine times would add
  // roughly a second for no benefit.
  const hashByPassword = new Map<string, string>();
  for (const password of new Set(ALL_USER_SPECS.map((spec) => spec.password))) {
    hashByPassword.set(password, await hashPassword(password));
  }

  const userRows = await tx
    .insert(users)
    .values(
      ALL_USER_SPECS.map((spec) => ({
        email: spec.email,
        passwordHash: requireEntry(hashByPassword, spec.password, 'password hash'),
        name: spec.name,
        isGlobalAdmin: spec.isGlobalAdmin,
        isActive: spec.isActive,
        locale: spec.locale,
      })),
    )
    .returning({ id: users.id, email: users.email });

  const userIdByEmail = new Map(userRows.map((row) => [row.email, row.id]));
  const userIdByKey = new Map(
    ALL_USER_SPECS.map((spec) => [spec.key, requireEntry(userIdByEmail, spec.email, 'user id')]),
  );
  const userNameByKey = new Map(ALL_USER_SPECS.map((spec) => [spec.key, spec.name]));
  const userId = (key: string): string => requireEntry(userIdByKey, key, 'user');
  detail(`${userRows.length} users`);

  // ── Organizations, teams, invites ────────────────────────────────────────
  step('organizations, teams and invites');
  const [org] = await tx
    .insert(organizations)
    .values({
      slug: 'acme',
      name: 'Acme Corporation',
      description: 'The demo organization every FlowBoard view is rendered against.',
      createdById: userId('ada'),
    })
    .returning();
  if (!org) {
    throw new Error('seed: organization insert returned nothing');
  }

  /**
   * The SECOND organization.
   *
   * Round 2's whole instance-administration surface — the admin Organizations
   * table, the cross-org Projects list, the growth analytics domain, the org
   * switcher as a searchable combobox — is indistinguishable from broken on a
   * one-org database: a table with a single row cannot show that filtering,
   * sorting or scoping works, and "orgs created over time" is a flat line. Globex
   * is deliberately SMALLER and YOUNGER than Acme (fewer people, no teams, no
   * custom workflow) so the two are visibly different rows rather than a copy.
   *
   * It is also created a fortnight after Acme so `orgsCreatedSeries` has two
   * distinct buckets instead of one.
   */
  const [globex] = await tx
    .insert(organizations)
    .values({
      slug: 'globex',
      name: 'Globex Corp',
      description: 'A second tenant, so every cross-organization surface has more than one row.',
      createdById: userId('ada'),
      createdAt: addDays(now, -45),
      updatedAt: addDays(now, -45),
    })
    .returning();
  if (!globex) {
    throw new Error('seed: second organization insert returned nothing');
  }

  await tx
    .insert(orgMembers)
    .values(
      USER_SPECS.map((spec) => ({ orgId: org.id, userId: userId(spec.key), role: spec.orgRole })),
    );

  await tx.insert(orgMembers).values(
    GLOBEX_MEMBER_SPECS.map((spec) => ({
      orgId: globex.id,
      userId: userId(spec.key),
      role: spec.role,
    })),
  );

  const teamRows = await tx
    .insert(teams)
    .values(
      TEAM_SPECS.map((spec) => ({ orgId: org.id, name: spec.name, description: spec.description })),
    )
    .returning({ id: teams.id, name: teams.name });
  const teamIdByName = new Map(teamRows.map((row) => [row.name, row.id]));

  const teamMemberRows = TEAM_SPECS.flatMap((spec) =>
    spec.memberKeys.map((key) => ({
      teamId: requireEntry(teamIdByName, spec.name, 'team'),
      userId: userId(key),
    })),
  );
  await tx.insert(teamMembers).values(teamMemberRows);
  detail(
    `2 organizations (acme, globex), ${teamRows.length} teams, ${teamMemberRows.length} team memberships`,
  );

  // ── Projects ─────────────────────────────────────────────────────────────
  step('projects, workflow, labels and sprints');
  const projectRows = await tx
    .insert(projects)
    .values([
      {
        orgId: org.id,
        key: 'FLOW',
        name: 'FlowBoard Web',
        description: 'The product itself. Default three-column workflow, no transition rules.',
        teamId: requireEntry(teamIdByName, 'Product', 'team'),
        leadId: userId('maya'),
        avatarColor: 'indigo',
      },
      {
        orgId: org.id,
        key: 'CORE',
        name: 'Core Platform',
        description: 'API, auth and infrastructure. Custom five-column workflow with a WIP limit.',
        teamId: requireEntry(teamIdByName, 'Platform', 'team'),
        leadId: userId('nina'),
        avatarColor: 'teal',
      },
    ])
    .returning({ id: projects.id, key: projects.key });

  const globexProjectRows = await tx
    .insert(projects)
    .values([
      {
        orgId: globex.id,
        key: 'GX',
        name: 'Globex Storefront',
        description: 'Customer-facing commerce. Default three-column workflow.',
        leadId: userId('nina'),
        // Token NAMES, from the same palette `SEED_COLORS` is keyed by —
        // `avatar_color` is chrome, not user data (see database.md).
        avatarColor: 'violet',
        createdAt: addDays(now, -44),
        updatedAt: addDays(now, -44),
      },
      {
        orgId: globex.id,
        key: 'OPS',
        name: 'Globex Operations',
        description: 'Warehouse, couriers and the reporting behind them.',
        leadId: userId('tom'),
        avatarColor: 'amber',
        createdAt: addDays(now, -38),
        updatedAt: addDays(now, -38),
      },
    ])
    .returning({ id: projects.id, key: projects.key });

  const projectIdByKey = new Map(
    [...projectRows, ...globexProjectRows].map((row) => [row.key, row.id]),
  );
  const flowId = requireEntry(projectIdByKey, 'FLOW', 'project');
  const coreId = requireEntry(projectIdByKey, 'CORE', 'project');
  const gxId = requireEntry(projectIdByKey, 'GX', 'project');
  const opsId = requireEntry(projectIdByKey, 'OPS', 'project');

  const projectMemberSpecs: ReadonlyArray<{
    projectId: string;
    key: string;
    role: ProjectRole;
  }> = [
    { projectId: flowId, key: 'ada', role: 'admin' },
    { projectId: flowId, key: 'maya', role: 'admin' },
    { projectId: flowId, key: 'omar', role: 'member' },
    { projectId: flowId, key: 'sara', role: 'member' },
    { projectId: flowId, key: 'liam', role: 'member' },
    { projectId: flowId, key: 'nina', role: 'member' },
    { projectId: flowId, key: 'yuki', role: 'viewer' },
    { projectId: coreId, key: 'maya', role: 'admin' },
    { projectId: coreId, key: 'nina', role: 'admin' },
    { projectId: coreId, key: 'sara', role: 'member' },
    { projectId: coreId, key: 'tom', role: 'member' },
    { projectId: coreId, key: 'omar', role: 'member' },
    { projectId: coreId, key: 'yuki', role: 'viewer' },
    // Globex. Only its own members — a project-member row for someone outside
    // the organization would be access the org-scoped guards can never grant,
    // and the admin Projects table's member counts would then not add up.
    { projectId: gxId, key: 'ada', role: 'admin' },
    { projectId: gxId, key: 'nina', role: 'admin' },
    { projectId: gxId, key: 'liam', role: 'member' },
    { projectId: gxId, key: 'priya', role: 'member' },
    { projectId: opsId, key: 'nina', role: 'admin' },
    { projectId: opsId, key: 'tom', role: 'member' },
    { projectId: opsId, key: 'liam', role: 'member' },
    { projectId: opsId, key: 'priya', role: 'viewer' },
  ];
  await tx.insert(projectMembers).values(
    projectMemberSpecs.map((spec) => ({
      projectId: spec.projectId,
      userId: userId(spec.key),
      role: spec.role,
    })),
  );

  // Invites: one open, one locked to an address, one already expired — so the
  // invite list has a row in each state.
  await tx.insert(invites).values([
    {
      orgId: org.id,
      token: 'seed-invite-open-0000000000000001',
      email: null,
      orgRole: 'member',
      invitedById: userId('maya'),
      expiresAt: addDays(now, 7),
    },
    {
      orgId: org.id,
      token: 'seed-invite-core-0000000000000002',
      email: 'contractor@example.com',
      orgRole: 'member',
      projectId: coreId,
      projectRole: 'viewer',
      invitedById: userId('nina'),
      expiresAt: addDays(now, 14),
    },
    {
      orgId: org.id,
      token: 'seed-invite-stale-000000000000003',
      email: 'lapsed@example.com',
      orgRole: 'member',
      invitedById: userId('ada'),
      expiresAt: addDays(now, -2),
    },
    /**
     * Globex's four, two of them ACCEPTED.
     *
     * `accepted_at` / `accepted_by_id` are what the growth analytics domain
     * counts: `invitesSentSeries`, `invitesAcceptedSeries` and the acceptance
     * rate between them. Acme's three invites are all outstanding by design (the
     * invite LIST needs a row in every state), so without these the acceptance
     * rate on a freshly seeded database is a flat zero and the chart says
     * nothing.
     *
     * Both accepted rows point at accounts that really are Globex members, so
     * the invite list and the member list agree with each other.
     */
    {
      orgId: globex.id,
      token: 'seed-invite-globex-accepted-0001',
      email: 'priya@flowboard.dev',
      orgRole: 'member',
      invitedById: userId('ada'),
      expiresAt: addDays(now, -33),
      acceptedAt: addDays(now, -38),
      acceptedById: userId('priya'),
      createdAt: addDays(now, -40),
    },
    {
      orgId: globex.id,
      token: 'seed-invite-globex-accepted-0002',
      email: 'tom@flowboard.dev',
      orgRole: 'member',
      invitedById: userId('nina'),
      expiresAt: addDays(now, -15),
      acceptedAt: addDays(now, -19),
      acceptedById: userId('tom'),
      createdAt: addDays(now, -22),
    },
    {
      orgId: globex.id,
      token: 'seed-invite-globex-open-000000003',
      email: null,
      orgRole: 'member',
      invitedById: userId('nina'),
      expiresAt: addDays(now, 10),
      createdAt: addDays(now, -4),
    },
    {
      orgId: globex.id,
      token: 'seed-invite-globex-stale-00000004',
      email: 'supplier@example.com',
      orgRole: 'member',
      projectId: opsId,
      projectRole: 'viewer',
      invitedById: userId('tom'),
      expiresAt: addDays(now, -3),
      createdAt: addDays(now, -17),
    },
  ]);

  // ── Statuses, transitions, labels ────────────────────────────────────────
  const statusRows = await tx
    .insert(statuses)
    .values([
      ...FLOW_STATUSES.map((spec, index) => ({
        projectId: flowId,
        name: spec.name,
        category: spec.category,
        color: spec.color,
        position: index,
        wipLimit: spec.wipLimit,
      })),
      ...CORE_STATUSES.map((spec, index) => ({
        projectId: coreId,
        name: spec.name,
        category: spec.category,
        color: spec.color,
        position: index,
        wipLimit: spec.wipLimit,
      })),
      // Globex: the default workflow, twice, and no transition rows — an empty
      // whitelist means every move is legal, which is what a default project
      // must feel like.
      ...[gxId, opsId].flatMap((projectId) =>
        FLOW_STATUSES.map((spec, index) => ({
          projectId,
          name: spec.name,
          category: spec.category,
          color: spec.color,
          position: index,
          wipLimit: spec.wipLimit,
        })),
      ),
    ])
    .returning({ id: statuses.id, projectId: statuses.projectId, name: statuses.name });

  const statusIdFor = (projectId: string, name: string): string => {
    const row = statusRows.find((item) => item.projectId === projectId && item.name === name);
    if (!row) {
      throw new Error(`seed: no status "${name}" in project ${projectId}`);
    }
    return row.id;
  };

  // FLOW gets ZERO transition rows on purpose: an empty whitelist means every
  // move is legal, which is what a default project must feel like.
  await tx.insert(workflowTransitions).values(
    CORE_TRANSITIONS.map(([from, to]) => ({
      projectId: coreId,
      fromStatusId: statusIdFor(coreId, from),
      toStatusId: statusIdFor(coreId, to),
    })),
  );

  const labelRows = await tx
    .insert(labels)
    .values([
      ...FLOW_LABELS.map((spec) => ({ projectId: flowId, name: spec.name, color: spec.color })),
      ...CORE_LABELS.map((spec) => ({ projectId: coreId, name: spec.name, color: spec.color })),
      ...GLOBEX_LABELS.map((spec) => ({ projectId: gxId, name: spec.name, color: spec.color })),
      ...OPS_LABELS.map((spec) => ({ projectId: opsId, name: spec.name, color: spec.color })),
    ])
    .returning({ id: labels.id, projectId: labels.projectId, name: labels.name });

  // ── Sprints (points stamped later, once tasks exist) ─────────────────────
  const sprintRows = await tx
    .insert(sprints)
    .values([
      {
        projectId: flowId,
        name: 'FLOW Sprint 1',
        goal: 'Get the board dragging and the reports drawing.',
        state: 'completed' as const,
        startDate: isoDate(addDays(now, -28)),
        endDate: isoDate(addDays(now, -14)),
        startedAt: addDays(now, -28),
        completedAt: addDays(now, -14),
      },
      {
        projectId: flowId,
        name: 'FLOW Sprint 2',
        goal: 'Roadmap, calendar and the task detail sheet.',
        state: 'active' as const,
        startDate: isoDate(addDays(now, -3)),
        endDate: isoDate(addDays(now, 11)),
        startedAt: addDays(now, -3),
      },
      {
        projectId: flowId,
        name: 'FLOW Sprint 3',
        goal: 'Polish, accessibility and the Arabic pass.',
        state: 'planned' as const,
        startDate: isoDate(addDays(now, 12)),
        endDate: isoDate(addDays(now, 26)),
      },
      {
        projectId: coreId,
        name: 'CORE Sprint 7',
        goal: 'Auth hardening and the telemetry pipeline.',
        state: 'active' as const,
        startDate: isoDate(addDays(now, -5)),
        endDate: isoDate(addDays(now, 9)),
        startedAt: addDays(now, -5),
      },
      {
        projectId: gxId,
        name: 'GX Sprint 4',
        goal: 'Basket and promo codes.',
        state: 'completed' as const,
        startDate: isoDate(addDays(now, -25)),
        endDate: isoDate(addDays(now, -11)),
        startedAt: addDays(now, -25),
        completedAt: addDays(now, -11),
      },
      {
        projectId: gxId,
        name: 'GX Sprint 5',
        goal: 'Checkout rebuild, phase one.',
        state: 'active' as const,
        startDate: isoDate(addDays(now, -4)),
        endDate: isoDate(addDays(now, 10)),
        startedAt: addDays(now, -4),
      },
      {
        projectId: opsId,
        name: 'OPS Sprint 2',
        goal: 'Courier webhooks and the returns dashboard.',
        state: 'active' as const,
        startDate: isoDate(addDays(now, -6)),
        endDate: isoDate(addDays(now, 8)),
        startedAt: addDays(now, -6),
      },
    ])
    .returning({ id: sprints.id, projectId: sprints.projectId, name: sprints.name });
  const sprintIdByName = new Map(sprintRows.map((row) => [row.name, row.id]));

  const flowContext: ProjectContext = {
    id: flowId,
    key: 'FLOW',
    statusIdByName: new Map(FLOW_STATUSES.map((s) => [s.name, statusIdFor(flowId, s.name)])),
    categoryByStatusName: new Map(FLOW_STATUSES.map((s) => [s.name, s.category])),
    labelIdByName: new Map(
      labelRows.filter((row) => row.projectId === flowId).map((row) => [row.name, row.id]),
    ),
    sprintIdByName,
  };
  const coreContext: ProjectContext = {
    id: coreId,
    key: 'CORE',
    statusIdByName: new Map(CORE_STATUSES.map((s) => [s.name, statusIdFor(coreId, s.name)])),
    categoryByStatusName: new Map(CORE_STATUSES.map((s) => [s.name, s.category])),
    labelIdByName: new Map(
      labelRows.filter((row) => row.projectId === coreId).map((row) => [row.name, row.id]),
    ),
    sprintIdByName,
  };
  /** Both Globex projects run the default workflow, so they share its shape. */
  const globexContext = (id: string, key: string): ProjectContext => ({
    id,
    key,
    statusIdByName: new Map(FLOW_STATUSES.map((s) => [s.name, statusIdFor(id, s.name)])),
    categoryByStatusName: new Map(FLOW_STATUSES.map((s) => [s.name, s.category])),
    labelIdByName: new Map(
      labelRows.filter((row) => row.projectId === id).map((row) => [row.name, row.id]),
    ),
    sprintIdByName,
  });
  const gxContext = globexContext(gxId, 'GX');
  const opsContext = globexContext(opsId, 'OPS');
  detail(
    `4 projects, ${statusRows.length} statuses, ${CORE_TRANSITIONS.length} transitions, ${labelRows.length} labels, ${sprintRows.length} sprints`,
  );

  // ── Task drafts ──────────────────────────────────────────────────────────
  step('tasks');
  // Acme FIRST, and the order matters: the generator is one seeded LCG, so
  // appending Globex leaves every Acme draw — and therefore every Acme row —
  // byte-identical to what this seed produced before the second org existed.
  const acmeDrafts: TaskDraft[] = [
    ...buildFlowDrafts(random, now),
    ...buildCoreDrafts(random, now),
  ];
  const globexDrafts: TaskDraft[] = [
    ...buildGlobexStorefrontDrafts(random, now),
    ...buildGlobexOpsDrafts(random, now),
  ];
  const drafts: TaskDraft[] = [...acmeDrafts, ...globexDrafts];

  const boardRank = createRankAllocator();
  const backlogRank = createRankAllocator();
  const contextByProjectKey = new Map<string, ProjectContext>([
    ['FLOW', flowContext],
    ['CORE', coreContext],
    ['GX', gxContext],
    ['OPS', opsContext],
  ]);
  const taskIdByLocalId = new Map<string, string>();

  const toRow = (draft: TaskDraft): NewTaskRow => {
    const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
    const statusId = requireEntry(context.statusIdByName, draft.statusName, 'status');
    const sprintId =
      draft.sprintName === null
        ? null
        : requireEntry(context.sprintIdByName, draft.sprintName, 'sprint');
    return {
      projectId: context.id,
      number: draft.number,
      title: draft.title,
      description: draft.description,
      type: draft.type,
      statusId,
      priority: draft.priority,
      assigneeId: draft.assigneeKey === null ? null : userId(draft.assigneeKey),
      reporterId: userId(draft.reporterKey),
      storyPoints: draft.storyPoints,
      startDate: draft.startDate,
      dueDate: draft.dueDate,
      sprintId,
      epicId:
        draft.epicLocalId === null
          ? null
          : requireEntry(taskIdByLocalId, draft.epicLocalId, 'epic'),
      parentId:
        draft.parentLocalId === null
          ? null
          : requireEntry(taskIdByLocalId, draft.parentLocalId, 'parent task'),
      boardRank: boardRank(`${context.id}:${statusId}`),
      backlogRank: backlogRank(`${context.id}:${sprintId ?? 'backlog'}`),
      resolvedAt: draft.resolvedAt,
      createdAt: draft.createdAt,
      updatedAt: draft.resolvedAt ?? draft.createdAt,
    };
  };

  // Three waves: epics exist before anything links to them, parents before
  // subtasks. `toRow` resolves those links out of `taskIdByLocalId`.
  const waves: ReadonlyArray<readonly TaskDraft[]> = [
    drafts.filter((draft) => draft.type === 'epic'),
    drafts.filter((draft) => draft.type !== 'epic' && draft.parentLocalId === null),
    drafts.filter((draft) => draft.type !== 'epic' && draft.parentLocalId !== null),
  ];

  for (const wave of waves) {
    if (wave.length === 0) {
      continue;
    }
    const inserted = await tx
      .insert(tasks)
      .values(wave.map(toRow))
      .returning({ id: tasks.id, projectId: tasks.projectId, number: tasks.number });
    for (const draft of wave) {
      const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
      const row = inserted.find(
        (item) => item.projectId === context.id && item.number === draft.number,
      );
      if (!row) {
        throw new Error(`seed: task ${draft.projectKey}-${draft.number} was not returned`);
      }
      taskIdByLocalId.set(draft.localId, row.id);
    }
  }
  detail(`${drafts.length} tasks (${acmeDrafts.length} acme, ${globexDrafts.length} globex)`);

  const taskId = (localId: string): string => requireEntry(taskIdByLocalId, localId, 'task');

  // ── Labels, watchers, dependencies ───────────────────────────────────────
  step('labels, watchers and dependencies');
  const taskLabelRows = drafts.flatMap((draft) => {
    const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
    return draft.labelNames.map((name) => ({
      taskId: taskId(draft.localId),
      labelId: requireEntry(context.labelIdByName, name, 'label'),
    }));
  });
  if (taskLabelRows.length > 0) {
    await tx.insert(taskLabels).values(taskLabelRows);
  }

  /**
   * Who may be added as an EXTRA watcher, per project.
   *
   * Scoped to the project's own organization: a watcher outside the org would be
   * notified about work the guards would then refuse to show them, which reads
   * as a broken notification rather than as seed data. Acme's pool is the
   * original list, unchanged, so its rows are untouched by the second org.
   */
  const watcherPoolByProjectKey = new Map<string, readonly string[]>([
    ['FLOW', ['maya', 'sara', 'nina', 'tom', 'liam', 'omar']],
    ['CORE', ['maya', 'sara', 'nina', 'tom', 'liam', 'omar']],
    ['GX', ['ada', 'nina', 'liam', 'priya']],
    ['OPS', ['nina', 'tom', 'liam', 'priya']],
  ]);

  const watcherRows = drafts.flatMap((draft) => {
    const keys = new Set<string>([draft.reporterKey]);
    if (draft.assigneeKey !== null) {
      keys.add(draft.assigneeKey);
    }
    if (random.chance(0.35)) {
      keys.add(
        random.pick(requireEntry(watcherPoolByProjectKey, draft.projectKey, 'watcher pool')),
      );
    }
    return [...keys].map((key) => ({
      taskId: taskId(draft.localId),
      userId: userId(key),
      // A muted watcher exists so the notification fan-out has something to skip.
      isMuted: key === 'tom' && random.chance(0.3),
    }));
  });
  await tx.insert(taskWatchers).values(watcherRows);

  // A four-link chain plus a few independent pairs. The chain is what the
  // gantt's arrow layer and the cycle-detection tests need.
  const flowSprint2 = drafts.filter(
    (draft) => draft.sprintName === 'FLOW Sprint 2' && draft.type !== 'subtask',
  );
  const flowBacklog = drafts.filter(
    (draft) => draft.projectKey === 'FLOW' && draft.sprintName === null && draft.type !== 'epic',
  );
  const coreSprint = drafts.filter(
    (draft) => draft.sprintName === 'CORE Sprint 7' && draft.type !== 'subtask',
  );

  const dependencyPairs: Array<readonly [TaskDraft, TaskDraft]> = [];
  for (let i = 0; i + 1 < Math.min(flowSprint2.length, 4); i += 1) {
    const blocker = flowSprint2[i];
    const blocked = flowSprint2[i + 1];
    if (blocker && blocked) {
      dependencyPairs.push([blocker, blocked]);
    }
  }
  const extraPairs: ReadonlyArray<readonly [TaskDraft | undefined, TaskDraft | undefined]> = [
    [flowSprint2[5], flowBacklog[0]],
    [flowSprint2[6], flowBacklog[1]],
    [coreSprint[0], coreSprint[3]],
    [coreSprint[1], coreSprint[4]],
  ];
  for (const [blocker, blocked] of extraPairs) {
    if (blocker && blocked && blocker.localId !== blocked.localId) {
      dependencyPairs.push([blocker, blocked]);
    }
  }
  await tx.insert(taskDependencies).values(
    dependencyPairs.map(([blocker, blocked]) => ({
      blockerTaskId: taskId(blocker.localId),
      blockedTaskId: taskId(blocked.localId),
      createdById: userId('maya'),
    })),
  );
  detail(
    `${taskLabelRows.length} task labels, ${watcherRows.length} watchers, ${dependencyPairs.length} dependencies`,
  );

  // ── Comments (one carries a mention) ─────────────────────────────────────
  step('comments');
  const commentableDrafts = random
    .shuffle(acmeDrafts.filter((draft) => draft.type !== 'epic'))
    .slice(0, 18);
  const commentRows: NewCommentRow[] = [];
  const authorKeys = ['maya', 'sara', 'nina', 'tom', 'liam', 'omar'] as const;

  for (const draft of commentableDrafts) {
    const howMany = random.int(1, 3);
    for (let i = 0; i < howMany; i += 1) {
      const createdAt = between(random, draft.createdAt, now);
      commentRows.push({
        taskId: taskId(draft.localId),
        authorId: userId(random.pick(authorKeys)),
        body: random.pick(COMMENT_BODIES),
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  // Globex gets its own, smaller thread set — from ITS OWN members, so a task's
  // comment authors are all people who can actually see the task.
  const globexCommentable = random
    .shuffle(globexDrafts.filter((draft) => draft.type !== 'epic'))
    .slice(0, 7);
  const globexAuthorKeys = ['nina', 'tom', 'liam', 'priya', 'ada'] as const;
  for (const draft of globexCommentable) {
    const howMany = random.int(1, 2);
    for (let i = 0; i < howMany; i += 1) {
      const createdAt = between(random, draft.createdAt, now);
      commentRows.push({
        taskId: taskId(draft.localId),
        authorId: userId(random.pick(globexAuthorKeys)),
        body: random.pick(COMMENT_BODIES),
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  // THE mention. `@[Display Name](userId)` is the wire format the markdown
  // renderer and the notification fan-out both parse.
  const mentionTarget = commentableDrafts[0];
  if (!mentionTarget) {
    throw new Error('seed: no task available to attach the mention comment to');
  }
  const saraId = userId('sara');
  const saraName = requireEntry(userNameByKey, 'sara', 'user name');
  commentRows.push({
    taskId: taskId(mentionTarget.localId),
    authorId: userId('maya'),
    body: `@[${saraName}](${saraId}) could you take a look? The rank recompute is yours originally.`,
    createdAt: addDays(now, -1),
    updatedAt: addDays(now, -1),
  });

  const insertedComments = await tx.insert(comments).values(commentRows).returning({
    id: comments.id,
    taskId: comments.taskId,
    authorId: comments.authorId,
    createdAt: comments.createdAt,
  });
  const mentionCommentId = insertedComments[insertedComments.length - 1]?.id;
  detail(`${insertedComments.length} comments (1 with an @mention)`);

  // ── Activity stream ──────────────────────────────────────────────────────
  step('activity');
  /**
   * The action strings this seed writes, TYPED against the shared contract.
   *
   * `activity.action` is a plain `text` column (adding an action must not be a
   * migration), so the database accepts anything — but the API parses every row
   * back through `activitySchema`, whose `action` is a CLOSED zod enum. A typo
   * here is therefore invisible until a feed request 422s, which is exactly how
   * `comment.created` survived Wave 1.
   */
  const activityRows: (NewActivityRow & { action: ActivityAction })[] = [];
  for (const draft of drafts) {
    const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
    const journey = statusJourney(context, draft);
    const birthStatusId = requireEntry(context.statusIdByName, journey.birth, 'status');

    activityRows.push({
      projectId: context.id,
      taskId: taskId(draft.localId),
      actorId: userId(draft.reporterKey),
      action: 'task.created',
      // SHAPED LIKE THE SERVICE'S (`tasks.service.ts` → `createTask`). The CFD
      // report replays this stream and reads the status out of `newValue`;
      // without it, every seeded task is invisible to the chart at birth.
      newValue: { statusId: birthStatusId, type: draft.type },
      createdAt: draft.createdAt,
    });

    if (draft.assigneeKey !== null) {
      activityRows.push({
        projectId: context.id,
        taskId: taskId(draft.localId),
        actorId: userId(draft.reporterKey),
        action: 'task.field_changed',
        field: 'assigneeId',
        oldValue: null,
        newValue: { id: userId(draft.assigneeKey), name: userNameByKey.get(draft.assigneeKey) },
        createdAt: addMinutes(draft.createdAt, 4),
      });
    }

    let fromStatusId = birthStatusId;
    for (const hop of journey.hops) {
      const toStatusId = requireEntry(context.statusIdByName, hop.statusName, 'status');
      activityRows.push({
        projectId: context.id,
        taskId: taskId(draft.localId),
        actorId: userId(draft.assigneeKey ?? draft.reporterKey),
        action: 'task.status_changed',
        field: 'statusId',
        oldValue: fromStatusId,
        newValue: toStatusId,
        createdAt: hop.at,
      });
      fromStatusId = toStatusId;
    }
  }
  for (const comment of insertedComments) {
    const draft = drafts.find((item) => taskIdByLocalId.get(item.localId) === comment.taskId);
    if (!draft) {
      continue;
    }
    const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
    activityRows.push({
      projectId: context.id,
      taskId: comment.taskId,
      // The comment's OWN author. This used to be hardcoded to `maya`, which was
      // harmless while every seeded comment lived in Acme and became a lie the
      // moment a second organization got threads of its own — a project feed
      // attributing a Globex comment to someone who cannot see the project.
      actorId: comment.authorId,
      // `comment.ADDED`, matching the shared `activityActionSchema` — which is
      // what `GET /projects/:id/activity` parses every row through. This row
      // said `comment.created` (the SOCKET event's name, a different namespace)
      // until WP2.5, which made the project feed 422 on any seeded database.
      // The `ActivityAction` type on `activityRows` stops that recurring.
      action: 'comment.added',
      createdAt: comment.createdAt,
    });
  }
  for (const batch of chunk(activityRows, INSERT_CHUNK)) {
    await tx.insert(activity).values(batch);
  }
  detail(`${activityRows.length} activity entries`);

  // ── Attachments ──────────────────────────────────────────────────────────
  /**
   * Three CONFIRMED attachments, so the task sheet's Attachments tab has
   * something in it on a fresh seed.
   *
   * `confirmed_at` is what makes a row visible: the upload flow writes a pending
   * row, the browser PUTs to the presigned URL, and `/confirm` stamps it. A seed
   * has no browser, so it writes the finished state directly — an unconfirmed
   * row would be indistinguishable from an abandoned upload and would render as
   * an empty tab all the same.
   *
   * The matching OBJECTS are uploaded after the transaction commits (see
   * `seededObjects` and `main`), which is what makes Download work in dev. The
   * rows are written either way: a demo database that is missing a file is far
   * less confusing than one whose Attachments tab is permanently empty, and the
   * download button's failure is honest and local.
   */
  step('attachments');
  const attachmentTargets = [
    mentionTarget,
    ...commentableDrafts.filter((draft) => draft.localId !== mentionTarget.localId).slice(0, 2),
  ];
  const attachmentSpecs = [
    { fileName: 'acceptance-criteria.txt', uploaderKey: 'maya' },
    { fileName: 'repro-steps.txt', uploaderKey: 'sara' },
    { fileName: 'review-notes.txt', uploaderKey: 'tom' },
  ] as const;

  const attachmentRows: NewAttachmentRow[] = [];
  for (const [index, draft] of attachmentTargets.entries()) {
    const spec = attachmentSpecs[index];
    if (spec === undefined) continue;
    const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
    // The same `{orgId}/{projectId}/{taskId}/{uuid}-{name}` shape
    // `attachments.service.buildAttachmentKey` produces, with a FIXED uuid per
    // slot rather than a random one — the whole seed is reproducible from
    // `RANDOM_SEED`, and a key that changed every run would defeat that.
    const key = `${org.id}/${context.id}/${taskId(draft.localId)}/0000000${String(index)}-0000-4000-8000-00000000000${String(index)}-${spec.fileName}`;
    const body = [
      `${draft.projectKey} — ${draft.title}`,
      '',
      `Seeded demo attachment (${spec.fileName}).`,
      'Replace it by uploading a real file from the task sheet.',
      '',
    ].join('\n');
    seededObjects.push({ key, body, mimeType: 'text/plain' });

    const createdAt = between(random, draft.createdAt, now);
    attachmentRows.push({
      taskId: taskId(draft.localId),
      uploadedById: userId(spec.uploaderKey),
      fileName: spec.fileName,
      mimeType: 'text/plain',
      // `Buffer.byteLength`, not `body.length`: the column is the STORED size,
      // and the presign contract signs `ContentLength`.
      sizeBytes: Buffer.byteLength(body, 'utf8'),
      s3Key: key,
      confirmedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
  }
  await tx.insert(attachments).values(attachmentRows);
  detail(`${attachmentRows.length} attachments`);

  // ── Notifications ────────────────────────────────────────────────────────
  step('notifications');
  const notifiableDrafts = drafts.filter((draft) => draft.assigneeKey !== null).slice(0, 4);
  const notificationRows: NewNotificationRow[] = [];

  if (mentionCommentId !== undefined) {
    notificationRows.push({
      recipientId: saraId,
      actorId: userId('maya'),
      type: 'mentioned',
      projectId: requireEntry(contextByProjectKey, mentionTarget.projectKey, 'project context').id,
      taskId: taskId(mentionTarget.localId),
      commentId: mentionCommentId,
      payload: {
        taskTitle: mentionTarget.title,
        actorName: requireEntry(userNameByKey, 'maya', 'user name'),
      },
      readAt: null,
      createdAt: addDays(now, -1),
    });
  }

  for (const [index, draft] of notifiableDrafts.entries()) {
    const context = requireEntry(contextByProjectKey, draft.projectKey, 'project context');
    const recipientKey = draft.assigneeKey;
    if (recipientKey === null) {
      continue;
    }
    notificationRows.push({
      recipientId: userId(recipientKey),
      actorId: userId(draft.reporterKey),
      type: index % 2 === 0 ? 'task_assigned' : 'status_changed',
      projectId: context.id,
      taskId: taskId(draft.localId),
      payload: {
        taskTitle: draft.title,
        actorName: userNameByKey.get(draft.reporterKey),
      },
      // Half read, half unread, so the badge shows a count and the "mark all
      // read" button has something to do.
      readAt: index % 2 === 0 ? null : addDays(now, -2),
      createdAt: addDays(now, -index - 1),
    });
  }
  await tx.insert(notifications).values(notificationRows);
  detail(`${notificationRows.length} notifications`);

  // ── Telemetry & request logs ─────────────────────────────────────────────
  step('telemetry and request logs');
  const activeUserKeys = USER_SPECS.filter((spec) => spec.isActive).map((spec) => spec.key);
  const telemetryRows: NewTelemetryEventRow[] = [];
  for (let i = 0; i < 200; i += 1) {
    // Spread across 14 days with a mild recency bias — real usage is not flat.
    const dayOffset = -Math.floor(Math.pow(random.next(), 1.5) * 14);
    const createdAt = addMinutes(addDays(now, dayOffset), random.int(-600, 600));
    const type = random.pick(TELEMETRY_TYPES);
    const projectId = random.chance(0.7) ? random.pick([flowId, coreId]) : null;
    telemetryRows.push({
      type,
      userId: random.chance(0.9) ? userId(random.pick(activeUserKeys)) : null,
      orgId: org.id,
      projectId,
      payload:
        type === 'page_view'
          ? {
              path: random.pick([
                '/board',
                '/backlog',
                '/roadmap',
                '/table',
                '/calendar',
                '/dashboard',
              ]),
            }
          : { source: 'seed' },
      sessionId: `seed-session-${random.int(1, 24)}`,
      createdAt,
    });
  }

  /**
   * Globex's share of the product analytics.
   *
   * Fewer events than Acme, on purpose: the growth domain's `byOrg` table and
   * every "which tenant is busiest?" question need the two organizations to be
   * DIFFERENT sizes, and two orgs with identical traffic prove a chart renders
   * without proving it discriminates. Attributed with `org_id`, which is the
   * column those aggregations group by — an event with a null org is invisible
   * to them.
   */
  const globexActiveUserKeys = GLOBEX_MEMBER_SPECS.map((spec) => spec.key);
  for (let i = 0; i < 60; i += 1) {
    const dayOffset = -Math.floor(Math.pow(random.next(), 1.5) * 14);
    const createdAt = addMinutes(addDays(now, dayOffset), random.int(-600, 600));
    const type = random.pick(TELEMETRY_TYPES);
    telemetryRows.push({
      type,
      userId: random.chance(0.9) ? userId(random.pick(globexActiveUserKeys)) : null,
      orgId: globex.id,
      projectId: random.chance(0.7) ? random.pick([gxId, opsId]) : null,
      payload:
        type === 'page_view'
          ? { path: random.pick(['/board', '/backlog', '/table', '/dashboard']) }
          : { source: 'seed' },
      sessionId: `seed-session-globex-${random.int(1, 8)}`,
      createdAt,
    });
  }

  for (const batch of chunk(telemetryRows, INSERT_CHUNK)) {
    await tx.insert(telemetryEvents).values(batch);
  }

  const weightedRoutes = REQUEST_ROUTES.flatMap((route) =>
    Array.from({ length: route.weight }, () => route),
  );
  const requestRows: NewRequestLogRow[] = [];
  for (let i = 0; i < 500; i += 1) {
    const route = random.pick(weightedRoutes);
    const createdAt = addMinutes(addDays(now, -random.int(0, 6)), random.int(-700, 700));
    // Mostly success, a sprinkle of client errors, a rare 500 — enough for the
    // error-rate panel to have a non-zero but sane value.
    const roll = random.next();
    // Creates answer 201; auth POSTs and everything else answer 200.
    let statusCode = route.method === 'POST' && !route.path.startsWith('/api/auth') ? 201 : 200;
    if (roll > 0.97) {
      statusCode = 500;
    } else if (roll > 0.94) {
      statusCode = 404;
    } else if (roll > 0.91) {
      statusCode = 403;
    } else if (roll > 0.88) {
      statusCode = 401;
    } else if (roll > 0.86) {
      statusCode = 400;
    }
    // A long tail so p90/p99 are meaningfully above p50.
    const durationMs = random.chance(0.08) ? random.int(400, 1600) : random.int(4, 180);
    requestRows.push({
      method: route.method,
      path: route.path,
      statusCode,
      durationMs,
      userId: random.chance(0.85) ? userId(random.pick(activeUserKeys)) : null,
      ip: `10.0.${random.int(0, 3)}.${random.int(2, 250)}`,
      userAgent: random.pick([
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/18.0',
        'Mozilla/5.0 (X11; Linux x86_64) Firefox/136.0',
      ]),
      createdAt,
    });
  }
  for (const batch of chunk(requestRows, INSERT_CHUNK)) {
    await tx.insert(requestLogs).values(batch);
  }
  detail(`${telemetryRows.length} telemetry events, ${requestRows.length} request logs`);

  // ── Stamp derived counters ───────────────────────────────────────────────
  step('stamping counters');
  for (const [key, projectId] of [
    ['FLOW', flowId],
    ['CORE', coreId],
    ['GX', gxId],
    ['OPS', opsId],
  ] as const) {
    const highest = drafts
      .filter((draft) => draft.projectKey === key)
      .reduce((max, draft) => Math.max(max, draft.number), 0);
    await tx.update(projects).set({ taskCounter: highest }).where(eq(projects.id, projectId));
  }

  const pointsIn = (sprintName: string, onlyResolved: boolean): number =>
    drafts
      .filter(
        (draft) => draft.sprintName === sprintName && (!onlyResolved || draft.resolvedAt !== null),
      )
      .reduce((sum, draft) => sum + (draft.storyPoints ?? 0), 0);

  const sprintStamps: ReadonlyArray<{
    name: string;
    committed: number;
    completed: number | null;
  }> = [
    // +5 committed but not completed: one task was pulled out at completion,
    // which is what makes a velocity chart look like a real team's.
    {
      name: 'FLOW Sprint 1',
      committed: pointsIn('FLOW Sprint 1', false) + 5,
      completed: pointsIn('FLOW Sprint 1', true),
    },
    { name: 'FLOW Sprint 2', committed: pointsIn('FLOW Sprint 2', false), completed: null },
    { name: 'CORE Sprint 7', committed: pointsIn('CORE Sprint 7', false), completed: null },
    {
      name: 'GX Sprint 4',
      committed: pointsIn('GX Sprint 4', false) + 3,
      completed: pointsIn('GX Sprint 4', true),
    },
    { name: 'GX Sprint 5', committed: pointsIn('GX Sprint 5', false), completed: null },
    { name: 'OPS Sprint 2', committed: pointsIn('OPS Sprint 2', false), completed: null },
  ];
  for (const stamp of sprintStamps) {
    await tx
      .update(sprints)
      .set({ committedPoints: stamp.committed, completedPoints: stamp.completed })
      .where(eq(sprints.id, requireEntry(sprintIdByName, stamp.name, 'sprint')));
  }

  // ── Instance settings ────────────────────────────────────────────────────
  /**
   * The deployment singleton, written EXPLICITLY rather than left to migration
   * `0001`'s backfill.
   *
   * The seed's contract is "this transaction produces the whole demo dataset",
   * and a row that only exists because a migration put it there is a row this
   * script cannot describe, cannot count in its summary, and could not change if
   * the demo wanted a different default. `onConflictDoUpdate` because the
   * migration DID insert it on a normal `db:reset && db:seed`, and the seed
   * must state the values rather than inherit whatever was already there.
   *
   * `multi` with no default org is the shipped shape: both organizations are
   * visible, the switcher renders, and W3.1 flips this one row to walk the
   * single-org path end to end.
   */
  step('instance settings');
  await tx
    .insert(instanceSettings)
    .values({ id: 1, orgMode: 'multi', defaultOrgId: null, instanceName: 'FlowBoard' })
    .onConflictDoUpdate({
      target: instanceSettings.id,
      set: { orgMode: 'multi', defaultOrgId: null, instanceName: 'FlowBoard' },
    });
  detail('1 instance settings row (orgMode=multi)');

  return {
    users: userRows.length,
    instance_settings: 1,
    organizations: 2,
    teams: teamRows.length,
    team_members: teamMemberRows.length,
    org_members: USER_SPECS.length + GLOBEX_MEMBER_SPECS.length,
    invites: 7,
    projects: projectRows.length + globexProjectRows.length,
    project_members: projectMemberSpecs.length,
    statuses: statusRows.length,
    workflow_transitions: CORE_TRANSITIONS.length,
    labels: labelRows.length,
    sprints: sprintRows.length,
    tasks: drafts.length,
    task_labels: taskLabelRows.length,
    task_watchers: watcherRows.length,
    task_dependencies: dependencyPairs.length,
    comments: insertedComments.length,
    attachments: attachmentRows.length,
    activity: activityRows.length,
    notifications: notificationRows.length,
    telemetry_events: telemetryRows.length,
    request_logs: requestRows.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft builders
// ─────────────────────────────────────────────────────────────────────────────

interface BucketSpec {
  readonly sprintName: string | null;
  readonly statusNames: readonly string[];
  /** How the bucket's dates and resolution stamps are shaped. */
  readonly mode: 'completed' | 'active' | 'backlog';
  readonly windowStart: Date;
  readonly windowEnd: Date;
}

function buildDrafts(
  random: Random,
  now: Date,
  options: {
    projectKey: string;
    titles: readonly string[];
    doneStatusNames: readonly string[];
    epics: ReadonlyArray<{
      title: string;
      statusName: string;
      startOffset: number;
      dueOffset: number;
      resolved: boolean;
    }>;
    buckets: readonly BucketSpec[];
    labelNames: readonly string[];
    assigneeKeys: readonly string[];
    reporterKeys: readonly string[];
    subtaskCount: number;
    subtaskSprintName: string;
    /**
     * Restrict which columns subtasks may be created in. A subtask inherits its
     * parent's status, so without this a WIP-limited column silently ends up
     * over its own limit and the board renders "4 / 3" on first load.
     */
    subtaskParentStatusNames?: readonly string[];
  },
): TaskDraft[] {
  const drafts: TaskDraft[] = [];
  let nextNumber = 1;
  const titlePool = [...options.titles];
  const takeTitle = (): string => {
    const title = titlePool.shift();
    if (title === undefined) {
      throw new Error(`seed: ran out of titles for ${options.projectKey}`);
    }
    return title;
  };
  const pickLabels = (): string[] => {
    const howMany = random.int(0, 2);
    return random.shuffle(options.labelNames).slice(0, howMany);
  };
  const isDone = (statusName: string): boolean => options.doneStatusNames.includes(statusName);

  // ── Epics first: everything else can link to them. ───────────────────────
  const epicLocalIds: string[] = [];
  for (const epic of options.epics) {
    const localId = `${options.projectKey}-epic-${epicLocalIds.length}`;
    epicLocalIds.push(localId);
    const start = addDays(now, epic.startOffset);
    const due = addDays(now, epic.dueOffset);
    drafts.push({
      localId,
      projectKey: options.projectKey,
      number: nextNumber,
      title: epic.title,
      type: 'epic',
      statusName: epic.statusName,
      priority: 'high',
      assigneeKey: random.pick(options.assigneeKeys),
      reporterKey: random.pick(options.reporterKeys),
      storyPoints: null,
      startDate: isoDate(start),
      dueDate: isoDate(due),
      sprintName: null,
      epicLocalId: null,
      parentLocalId: null,
      labelNames: pickLabels(),
      createdAt: addDays(now, epic.startOffset - 2),
      resolvedAt: epic.resolved ? addDays(now, epic.dueOffset) : null,
      description: `Umbrella epic. Children roll up into this bar on the roadmap.`,
    });
    nextNumber += 1;
  }

  // ── Buckets ──────────────────────────────────────────────────────────────
  for (const bucket of options.buckets) {
    for (const statusName of bucket.statusNames) {
      const type: TaskType = random.chance(0.2) ? 'bug' : random.chance(0.5) ? 'story' : 'task';
      const resolved = isDone(statusName);

      let createdAt: Date;
      let startDate: string | null;
      let dueDate: string | null;
      let resolvedAt: Date | null = null;

      if (bucket.mode === 'completed') {
        createdAt = addDays(bucket.windowStart, -random.int(1, 6));
        startDate = isoDate(addDays(bucket.windowStart, random.int(0, 3)));
        dueDate = isoDate(addDays(bucket.windowEnd, -random.int(0, 3)));
        resolvedAt = between(random, bucket.windowStart, bucket.windowEnd);
      } else if (bucket.mode === 'active') {
        createdAt = addDays(bucket.windowStart, -random.int(1, 10));
        startDate = isoDate(addDays(bucket.windowStart, random.int(0, 4)));
        dueDate = isoDate(addDays(bucket.windowEnd, -random.int(0, 5)));
        resolvedAt = resolved ? between(random, bucket.windowStart, now) : null;
      } else {
        createdAt = addDays(now, -random.int(0, 20));
        // Half the backlog is unscheduled — the calendar's "unscheduled tray"
        // and the gantt's undated rows both need rows to show.
        if (random.chance(0.55)) {
          const start = addDays(now, random.int(5, 40));
          startDate = isoDate(start);
          dueDate = isoDate(addDays(start, random.int(2, 20)));
        } else {
          startDate = null;
          dueDate = null;
        }
      }

      const localId = `${options.projectKey}-task-${nextNumber}`;
      drafts.push({
        localId,
        projectKey: options.projectKey,
        number: nextNumber,
        title: takeTitle(),
        type,
        statusName,
        priority: random.pick(PRIORITIES),
        // Roughly one in eight is unassigned, so the workload report has an
        // "Unassigned" bar and the board has cards without an avatar.
        assigneeKey: random.chance(0.88) ? random.pick(options.assigneeKeys) : null,
        reporterKey: random.pick(options.reporterKeys),
        storyPoints: random.pick(POINTS),
        startDate,
        dueDate,
        sprintName: bucket.sprintName,
        epicLocalId: random.chance(0.7) ? random.pick(epicLocalIds) : null,
        parentLocalId: null,
        labelNames: pickLabels(),
        createdAt,
        resolvedAt,
        description: random.chance(0.6)
          ? 'Repro steps and acceptance criteria live here. Markdown is supported.'
          : null,
      });
      nextNumber += 1;
    }
  }

  // ── Subtasks, hung off tasks in the named sprint ─────────────────────────
  const allowedParentStatuses = options.subtaskParentStatusNames;
  const parents = drafts.filter(
    (draft) =>
      draft.sprintName === options.subtaskSprintName &&
      draft.type !== 'epic' &&
      (allowedParentStatuses === undefined || allowedParentStatuses.includes(draft.statusName)),
  );
  for (let i = 0; i < options.subtaskCount; i += 1) {
    const parent = parents[i % Math.max(parents.length, 1)];
    if (!parent) {
      break;
    }
    // A subtask lives in its parent's column — that is what makes the parent's
    // progress chip add up.
    const statusName = parent.statusName;
    drafts.push({
      localId: `${options.projectKey}-subtask-${nextNumber}`,
      projectKey: options.projectKey,
      number: nextNumber,
      title: `${SUBTASK_TITLES[i % SUBTASK_TITLES.length] ?? 'Follow-up'} (${parent.title.slice(0, 28)}…)`,
      type: 'subtask',
      statusName,
      priority: 'medium',
      assigneeKey: parent.assigneeKey,
      reporterKey: parent.reporterKey,
      storyPoints: random.int(1, 3),
      startDate: parent.startDate,
      dueDate: parent.dueDate,
      sprintName: parent.sprintName,
      epicLocalId: null,
      parentLocalId: parent.localId,
      labelNames: [],
      createdAt: addMinutes(parent.createdAt, 30),
      resolvedAt: isDone(statusName) ? parent.resolvedAt : null,
      description: null,
    });
    nextNumber += 1;
  }

  return drafts;
}

function buildFlowDrafts(random: Random, now: Date): TaskDraft[] {
  return buildDrafts(random, now, {
    projectKey: 'FLOW',
    titles: FLOW_TITLES,
    doneStatusNames: ['Done'],
    epics: [
      {
        title: 'Kanban board experience',
        statusName: 'In Progress',
        startOffset: -30,
        dueOffset: 20,
        resolved: false,
      },
      {
        title: 'Reporting and insights',
        statusName: 'To Do',
        startOffset: -10,
        dueOffset: 45,
        resolved: false,
      },
      {
        title: 'Accessibility and RTL polish',
        statusName: 'Done',
        startOffset: -60,
        dueOffset: -5,
        resolved: true,
      },
    ],
    buckets: [
      {
        sprintName: 'FLOW Sprint 1',
        statusNames: random.shuffle(expand([['Done', 9]])),
        mode: 'completed',
        windowStart: addDays(now, -28),
        windowEnd: addDays(now, -14),
      },
      {
        sprintName: 'FLOW Sprint 2',
        statusNames: random.shuffle(
          expand([
            ['To Do', 4],
            ['In Progress', 4],
            ['Done', 3],
          ]),
        ),
        mode: 'active',
        windowStart: addDays(now, -3),
        windowEnd: addDays(now, 11),
      },
      {
        sprintName: null,
        statusNames: expand([['To Do', 11]]),
        mode: 'backlog',
        windowStart: now,
        windowEnd: addDays(now, 60),
      },
    ],
    labelNames: FLOW_LABELS.map((label) => label.name),
    assigneeKeys: ['maya', 'omar', 'sara', 'liam', 'nina'],
    reporterKeys: ['ada', 'maya', 'nina'],
    subtaskCount: 4,
    subtaskSprintName: 'FLOW Sprint 2',
  });
}

function buildCoreDrafts(random: Random, now: Date): TaskDraft[] {
  return buildDrafts(random, now, {
    projectKey: 'CORE',
    titles: CORE_TITLES,
    doneStatusNames: ['Done'],
    epics: [
      {
        title: 'Authentication hardening',
        statusName: 'In Progress',
        startOffset: -20,
        dueOffset: 30,
        resolved: false,
      },
      {
        title: 'Platform observability',
        statusName: 'Selected',
        startOffset: 5,
        dueOffset: 60,
        resolved: false,
      },
    ],
    buckets: [
      {
        sprintName: 'CORE Sprint 7',
        // Two here plus the "Authentication hardening" epic = exactly 3, the
        // column's WIP limit: the board opens showing a full column rather than
        // a seed that violates its own rule.
        statusNames: random.shuffle(
          expand([
            ['Selected', 3],
            ['In Progress', 2],
            ['In Review', 1],
            ['Done', 2],
          ]),
        ),
        mode: 'active',
        windowStart: addDays(now, -5),
        windowEnd: addDays(now, 9),
      },
      {
        sprintName: null,
        statusNames: expand([['Backlog', 10]]),
        mode: 'backlog',
        windowStart: now,
        windowEnd: addDays(now, 60),
      },
    ],
    labelNames: CORE_LABELS.map((label) => label.name),
    assigneeKeys: ['maya', 'nina', 'tom', 'sara', 'omar'],
    reporterKeys: ['nina', 'maya'],
    subtaskCount: 3,
    subtaskSprintName: 'CORE Sprint 7',
    // "In Progress" is capped at 3 and already holds 3 — subtasks must land
    // elsewhere or the seeded board opens already over its WIP limit.
    subtaskParentStatusNames: ['Selected', 'In Review', 'Done'],
  });
}

/**
 * Globex's two projects.
 *
 * Both keep the default three-column workflow, and between them they hold ~29
 * issues spread across every type and across past, present and future dates —
 * enough that the admin Projects table shows two live rows with real counts and
 * a real "last activity", and that the growth analytics domain has a second
 * tenant to compare against rather than a single bar.
 */
function buildGlobexStorefrontDrafts(random: Random, now: Date): TaskDraft[] {
  return buildDrafts(random, now, {
    projectKey: 'GX',
    titles: GX_TITLES,
    doneStatusNames: ['Done'],
    epics: [
      {
        title: 'Checkout rebuild',
        statusName: 'In Progress',
        startOffset: -24,
        dueOffset: 18,
        resolved: false,
      },
      {
        title: 'Catalogue performance',
        statusName: 'To Do',
        startOffset: -6,
        dueOffset: 40,
        resolved: false,
      },
    ],
    buckets: [
      {
        sprintName: 'GX Sprint 4',
        statusNames: random.shuffle(expand([['Done', 3]])),
        mode: 'completed',
        windowStart: addDays(now, -25),
        windowEnd: addDays(now, -11),
      },
      {
        sprintName: 'GX Sprint 5',
        statusNames: random.shuffle(
          expand([
            ['To Do', 3],
            ['In Progress', 2],
            ['Done', 2],
          ]),
        ),
        mode: 'active',
        windowStart: addDays(now, -4),
        windowEnd: addDays(now, 10),
      },
      {
        sprintName: null,
        statusNames: expand([['To Do', 3]]),
        mode: 'backlog',
        windowStart: now,
        windowEnd: addDays(now, 60),
      },
    ],
    labelNames: GLOBEX_LABELS.map((label) => label.name),
    assigneeKeys: ['nina', 'liam', 'priya', 'ada'],
    reporterKeys: ['ada', 'nina'],
    subtaskCount: 2,
    subtaskSprintName: 'GX Sprint 5',
  });
}

function buildGlobexOpsDrafts(random: Random, now: Date): TaskDraft[] {
  return buildDrafts(random, now, {
    projectKey: 'OPS',
    titles: OPS_TITLES,
    doneStatusNames: ['Done'],
    epics: [
      {
        title: 'Fulfilment automation',
        statusName: 'In Progress',
        startOffset: -15,
        dueOffset: 25,
        resolved: false,
      },
    ],
    buckets: [
      {
        sprintName: null,
        statusNames: random.shuffle(expand([['Done', 2]])),
        mode: 'completed',
        windowStart: addDays(now, -34),
        windowEnd: addDays(now, -20),
      },
      {
        sprintName: 'OPS Sprint 2',
        statusNames: random.shuffle(
          expand([
            ['To Do', 2],
            ['In Progress', 2],
            ['Done', 1],
          ]),
        ),
        mode: 'active',
        windowStart: addDays(now, -6),
        windowEnd: addDays(now, 8),
      },
      {
        sprintName: null,
        statusNames: expand([['To Do', 2]]),
        mode: 'backlog',
        windowStart: now,
        windowEnd: addDays(now, 60),
      },
    ],
    labelNames: OPS_LABELS.map((label) => label.name),
    assigneeKeys: ['nina', 'tom', 'priya', 'liam'],
    reporterKeys: ['nina', 'tom'],
    subtaskCount: 2,
    subtaskSprintName: 'OPS Sprint 2',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    failure(
      'the database already contains users — the seed only runs against an empty database.\n' +
        '  Run `pnpm --filter @flowboard/api db:reset` first (this DESTROYS all data), then seed again.',
    );
    await closeDb();
    process.exit(1);
  }

  const summary = await db.transaction((tx) => seed(tx));

  // After the commit, and never able to fail it — see `uploadSeededObjects`.
  await uploadSeededObjects();

  done('seed complete');
  for (const [table, rows] of Object.entries(summary)) {
    detail(`${table.padEnd(22)} ${String(rows).padStart(5)}`);
  }
  detail('');
  detail(`sign in as ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (global admin)`);
  detail(`every other account uses ${MEMBER_PASSWORD}`);
}

main().then(
  async () => {
    await closeDb();
    process.exit(0);
  },
  async (error: unknown) => {
    failure('seed failed', error);
    await closeDb();
    process.exit(1);
  },
);
