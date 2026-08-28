/**
 * What `apps/api/src/scripts/seed.ts` puts in the database, named once.
 *
 * Specs assert against these constants rather than against literals scattered
 * through fourteen files: when the seed changes, exactly one file has to.
 * Anything DERIVED from the seed's pseudo-random generator (which task sits in
 * which column, how many dependencies exist) is deliberately absent — those are
 * read from the API at test time, because pinning them here would turn a seed
 * tweak into a dozen unrelated failures.
 */

/**
 * ── WHO EACH SPEC SIGNS IN AS, AND WHY IT IS NOT ALL ONE ACCOUNT ────────────
 *
 * The specs are spread over the seeded people rather than all running as the one
 * global admin. The reason is COVERAGE, not rate limiting: most of the suite now
 * exercises the product as a non-global-admin, which is how it is actually used,
 * and a permission regression that only bites ordinary members now has something
 * to fail.
 *
 * It is worth saying what this does NOT do, because the obvious guess is wrong
 * and was tried. The API's 300-per-minute limiter reads as though it were keyed
 * by user id, but it is mounted ahead of every router — so `req.user` is unset
 * when the key is computed and every request keys by IP instead. Splitting the
 * suite across accounts therefore changes nothing about the ceiling; all of it
 * shares one bucket. `helpers/rate-budget.ts` is what keeps the suite inside
 * that bucket, and the mis-keying itself has been reported as a product bug.
 *
 * Roles that constrain the mapping (`requireProjectRole` in the routes):
 * everything in the task domain — create, patch, move, comment, attach, delete —
 * needs `member`; sprint START and COMPLETE need project `admin`; `/admin/**`
 * needs a global admin.
 */

/** Global admin. `admin.spec`, `auth.spec`, `diagnostics.spec`, `smoke.spec`. */
export const ADMIN = {
  email: 'admin@flowboard.dev',
  password: 'admin1234',
  name: 'Ada Lovelace',
} as const;

/**
 * An org ADMIN who is not a global admin — the subject of the `/admin` guard
 * test, and the driver for `board.spec` and `task.spec`.
 */
export const ORG_ADMIN = {
  email: 'maya@flowboard.dev',
  password: 'password1234',
  name: 'Maya Chen',
} as const;

/** Project admin on both FLOW and CORE. Named for the role the specs need. */
export const PROJECT_ADMIN = ORG_ADMIN;

/**
 * Project ADMIN on CORE and a member of FLOW — the only seeded account besides
 * Maya that may start and complete a sprint, which is what `sprint.spec` needs.
 * `roadmap.spec` uses her too.
 */
export const CORE_ADMIN = {
  email: 'nina@flowboard.dev',
  password: 'password1234',
  name: 'Nina Petrova',
} as const;

/**
 * A plain member of FLOW and CORE. The second browser context in
 * `realtime.spec`, the recipient in `notifications.spec`, and the driver for
 * `calendar.spec`.
 */
export const MEMBER = {
  email: 'sara@flowboard.dev',
  password: 'password1234',
  name: 'Sara Novak',
} as const;

/** Another plain member of FLOW. `table.spec`, `palette.spec`, `rtl.spec`. */
export const MEMBER_2 = {
  email: 'liam@flowboard.dev',
  password: 'password1234',
  name: 'Liam Okafor',
} as const;

/**
 * The account whose stored `locale` is `ar`.
 *
 * DELIBERATELY NOT one of the drivers above, including for `rtl.spec`. Whether
 * an account's saved locale is applied at boot is exactly the kind of thing that
 * could start being true, and on the day it did, every spec running as Omar
 * would fail on English locators for a reason that has nothing to do with the
 * feature under test. `rtl.spec` therefore signs in as an English account and
 * switches language THROUGH THE UI, which is both the safer fixture and the
 * behaviour worth testing. This constant is kept for a spec that wants to assert
 * the account-locale path itself.
 */
export const ARABIC_USER = {
  email: 'omar@flowboard.dev',
  password: 'password1234',
  name: 'Omar Haddad',
} as const;

/** Everyone except the global admin shares this password. */
export const MEMBER_PASSWORD = 'password1234';

export const ORG_SLUG = 'acme';
export const ORG_NAME = 'Acme Corporation';

/** The default-workflow project: three columns, NO transition rules, no WIP limit. */
export const FLOW = {
  key: 'FLOW',
  name: 'FlowBoard Web',
  statuses: ['To Do', 'In Progress', 'Done'],
  activeSprint: 'FLOW Sprint 2',
  completedSprint: 'FLOW Sprint 1',
  plannedSprint: 'FLOW Sprint 3',
} as const;

/**
 * The custom-workflow project: five columns, a WIP limit of 3 on "In Progress"
 * (seeded exactly full), and a transition whitelist.
 */
export const CORE = {
  key: 'CORE',
  name: 'Core Platform',
  statuses: ['Backlog', 'Selected', 'In Progress', 'In Review', 'Done'],
  wipColumn: 'In Progress',
  wipLimit: 3,
  activeSprint: 'CORE Sprint 7',
  /**
   * Moves the whitelist does NOT contain. `Backlog → Done` is the clearest of
   * them: both columns are always on screen, and neither is the WIP-limited one,
   * so a rejected drop there can only be the transition rule.
   */
  forbidden: { from: 'Backlog', to: 'Done' },
} as const;

/** Base path of a project's view, e.g. `/o/acme/p/FLOW/board`. */
export function viewPath(projectKey: string, view: string): string {
  return `/o/${ORG_SLUG}/p/${projectKey}/${view}`;
}

/** Base path of a task sheet layered over a view. */
export function taskSheetPath(projectKey: string, view: string, taskKey: string): string {
  return `${viewPath(projectKey, view)}/t/${taskKey}`;
}

/** A suffix unique to one test run, for fixtures that are created and left behind. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
