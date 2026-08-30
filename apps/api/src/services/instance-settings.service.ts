/**
 * The `instance_settings` singleton: multi-org vs single-org, the default
 * organization, and the instance name.
 *
 * Three rules live here and nowhere else.
 *
 *  1. **The row is ensured lazily.** Migration `0001` inserts it, but the
 *     integration-test database is reset with `TRUNCATE` rather than by
 *     re-migrating, so every read goes through {@link readRow}, which inserts
 *     the defaults if the table is empty. Idempotent (`ON CONFLICT DO
 *     NOTHING`), so two boots racing on a fresh install both end up with the
 *     same one row.
 *
 *  2. **`defaultOrgSlug` is RESOLVED server-side, never stored.** The column is
 *     an id — a slug is a display detail an admin may rename, and binding the
 *     boot path to a renameable string is how single mode ends up pointing at
 *     nothing after an org is re-slugged. The client renders `/o/:orgSlug`
 *     links and must never have to join a settings payload against the org list
 *     to find one.
 *
 *  3. **"Single mode needs a default org that exists" is a DATABASE question**,
 *     which is why `updateInstanceSettingsInputSchema` deliberately does not
 *     express it (see its header in `@flowboard/shared`). It is answered here,
 *     as a 422 with its own code so the settings form can point at the right
 *     field:
 *
 *       - `default_org_invalid`  — the id you sent is unknown or archived.
 *       - `default_org_required` — you asked for single mode without naming a
 *         default, and there is more than one organization to choose from.
 *
 *     With EXACTLY ONE live organization, "which one?" has only one answer, so
 *     the service adopts it rather than refusing the request — the overwhelming
 *     majority of single-org installs have precisely one org, and making them
 *     type its id to say so would be ceremony. With ZERO, single mode is
 *     allowed and `defaultOrgSlug` stays `null`: a fresh install configured
 *     before its first organization exists is a real state, and the shell
 *     renders an empty state for it (the "zero-org single mode" case in the
 *     Round 2 plan).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  orgModeSchema,
  type InstanceConfig,
  type InstanceSettings,
  type OrgMode,
  type UpdateInstanceSettingsInput,
} from '@flowboard/shared';

import {
  db,
  instanceSettings,
  organizations,
  withTx,
  type Db,
  type InstanceSettingsRow,
  type Tx,
} from '../db';
import { ApiError } from '../utils/api-error';

/** `db` or an open transaction — every helper here accepts either. */
type Executor = Db | Tx;

/** The one and only row. Enforced by the `instance_settings_singleton` CHECK. */
const SINGLETON_ID = 1;

/**
 * Narrow the free-text `org_mode` column to the shipped modes.
 *
 * The column is `text` on purpose (adding a deployment shape must not be DDL),
 * so a row can legitimately hold a value this build has no behaviour for.
 * Falling back to `multi` beats failing the request: `GET /instance/config` is
 * read by EVERY session on boot, and the multi-org shape is the one that renders
 * every surface — a mistyped value degrades to "show everything" rather than to
 * a white screen. Same reasoning as `toLocale` in `services/auth/user-lookup.ts`.
 */
function toOrgMode(value: string): OrgMode {
  const parsed = orgModeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'multi';
}

/**
 * Read the singleton, creating it from the column defaults if it is missing.
 *
 * The insert is idempotent, so this is safe to call concurrently and safe to
 * call on a read path — it writes at most once in the life of a database.
 */
async function readRow(executor: Executor): Promise<InstanceSettingsRow> {
  const [existing] = await executor
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.id, SINGLETON_ID))
    .limit(1);
  if (existing) return existing;

  await executor.insert(instanceSettings).values({ id: SINGLETON_ID }).onConflictDoNothing();

  const [created] = await executor
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.id, SINGLETON_ID))
    .limit(1);
  if (!created) throw ApiError.internal('Instance settings row could not be created');
  return created;
}

interface LiveOrg {
  id: string;
  slug: string;
}

/** One organization by id, only if it is NOT soft-deleted. */
async function findLiveOrg(orgId: string, executor: Executor): Promise<LiveOrg | undefined> {
  const [row] = await executor
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .limit(1);
  return row;
}

/**
 * The oldest live organizations, up to `limit`.
 *
 * Ordered by creation so "the first organization" is a stable, meaningful
 * answer — on a single-org install it is THE organization, and on an install
 * that has since grown it is the one that was there first, not whichever row
 * Postgres happened to return.
 */
async function listLiveOrgs(executor: Executor, limit: number): Promise<LiveOrg[]> {
  return executor
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(isNull(organizations.deletedAt))
    .orderBy(asc(organizations.createdAt), asc(organizations.id))
    .limit(limit);
}

/**
 * Which organization this instance actually points at, right now.
 *
 * ── THE RESOLUTION ORDER, AND WHY IT IS THE SAME FOR BOTH PAYLOADS ──────────
 *   1. the configured `default_org_id`, IF that organization is still live;
 *   2. otherwise, in `single` mode only, the first live organization;
 *   3. otherwise `null`.
 *
 * Step 2 is a READ-TIME fallback rather than a write: an install that is flipped
 * to single mode and then has its default organization archived must keep
 * booting, and "the one organization that is left" is the only sensible target.
 * Persisting the adoption would silently rewrite an administrator's setting
 * behind their back; resolving it keeps `GET /admin/settings` honest about what
 * is CONFIGURED (`defaultOrgId`) while `defaultOrgSlug` says what is IN EFFECT.
 *
 * In `multi` mode with nothing configured this is `null`, which is the normal
 * multi-org state — the shell has no default org and sends `/` to the last-used
 * one. A multi-mode install that HAS set a default still gets its slug: the
 * setting is what flipping to single mode would use, and the settings page shows
 * it. The shell simply ignores it while the mode is `multi`.
 */
async function resolveDefaultOrgSlug(
  row: InstanceSettingsRow,
  mode: OrgMode,
  executor: Executor,
): Promise<string | null> {
  if (row.defaultOrgId !== null) {
    const configured = await findLiveOrg(row.defaultOrgId, executor);
    if (configured) return configured.slug;
  }
  if (mode !== 'single') return null;
  const [first] = await listLiveOrgs(executor, 1);
  return first?.slug ?? null;
}

async function toConfig(row: InstanceSettingsRow, executor: Executor): Promise<InstanceConfig> {
  const orgMode = toOrgMode(row.orgMode);
  return {
    orgMode,
    defaultOrgSlug: await resolveDefaultOrgSlug(row, orgMode, executor),
    instanceName: row.instanceName,
  };
}

async function toSettings(row: InstanceSettingsRow, executor: Executor): Promise<InstanceSettings> {
  return {
    ...(await toConfig(row, executor)),
    defaultOrgId: row.defaultOrgId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `GET /api/instance/config` — any signed-in user.
 *
 * The smallest thing the web shell needs before it can lay itself out, and
 * nothing an administrator would call configuration: no ids, no timestamps.
 */
export async function getInstanceConfig(): Promise<InstanceConfig> {
  return toConfig(await readRow(db), db);
}

/** `GET /api/admin/settings` — the whole row, as the settings form edits it. */
export async function getInstanceSettings(): Promise<InstanceSettings> {
  return toSettings(await readRow(db), db);
}

/**
 * `PATCH /api/admin/settings` — global admin.
 *
 * Runs in ONE transaction because the single-mode rule is a read-then-write
 * (count the live organizations, then commit a mode that depends on that count);
 * two admins flipping the mode while an org is being archived must not be able
 * to interleave into a configuration neither of them asked for.
 *
 * @throws {ApiError} 422 `default_org_invalid` for an unknown or archived
 * organization, 422 `default_org_required` for single mode with no default and
 * more than one organization to choose from.
 */
export async function updateInstanceSettings(
  input: UpdateInstanceSettingsInput,
): Promise<InstanceSettings> {
  const row = await withTx(async (tx) => {
    const current = await readRow(tx);
    const nextMode = input.orgMode ?? toOrgMode(current.orgMode);

    // An id the caller SENT is validated whatever the mode: silently storing a
    // pointer to an archived org would turn a later mode flip into a 404.
    if (input.defaultOrgId !== undefined && input.defaultOrgId !== null) {
      const chosen = await findLiveOrg(input.defaultOrgId, tx);
      if (!chosen) {
        throw new ApiError(
          422,
          'default_org_invalid',
          'That organization does not exist, or has been archived',
        );
      }
    }

    let nextDefaultOrgId =
      input.defaultOrgId === undefined ? current.defaultOrgId : input.defaultOrgId;

    if (nextMode === 'single') {
      // A STALE stored id (its org was archived after it was chosen) is not the
      // caller's fault and must not block an unrelated edit — drop it and fall
      // through to the adoption rule below.
      if (nextDefaultOrgId !== null && !(await findLiveOrg(nextDefaultOrgId, tx))) {
        nextDefaultOrgId = null;
      }
      if (nextDefaultOrgId === null) {
        // Two rows is all it takes to answer "none / exactly one / more than one".
        const candidates = await listLiveOrgs(tx, 2);
        if (candidates.length > 1) {
          throw new ApiError(
            422,
            'default_org_required',
            'Single-organization mode needs a default organization when the instance has more than one',
          );
        }
        nextDefaultOrgId = candidates[0]?.id ?? null;
      }
    }

    const [updated] = await tx
      .update(instanceSettings)
      .set({
        orgMode: nextMode,
        defaultOrgId: nextDefaultOrgId,
        ...(input.instanceName === undefined ? {} : { instanceName: input.instanceName }),
      })
      .where(eq(instanceSettings.id, SINGLETON_ID))
      .returning();
    if (!updated) throw ApiError.internal('Instance settings update returned no row');
    return updated;
  });

  return toSettings(row, db);
}
