/**
 * `/api/instance/config` and `/api/admin/settings` — the deployment singleton.
 *
 * Three properties dominate this suite:
 *
 *  1. **The GUARD ASYMMETRY.** `/instance/config` is `requireAuth` only — every
 *     signed-in session reads it on boot, so putting it behind the admin gate
 *     would break the app for everyone who is not an administrator. `/admin/settings`
 *     is global-admin. Both halves are asserted, because the two live in one file
 *     and a copy-pasted guard is the obvious way to get this wrong.
 *  2. **`defaultOrgSlug` RESOLUTION**, which is a small state machine: configured
 *     org, archived configured org, no configured org in each mode, and no orgs
 *     at all. The client renders `/o/:orgSlug` links off this field, so every
 *     branch has to produce either a slug that resolves or an honest `null`.
 *  3. **The single-mode rule the SCHEMA cannot express** — "single mode needs a
 *     default organization that exists" is a database question, so it is a 422
 *     from the service with its own code, and the auto-adoption shortcut for the
 *     one-org case is the branch most installs will actually take.
 */
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, db, instanceSettings, organizations } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { bearer, createOrg, createUser, type TestUser } from './fixtures';
import { buildInstanceAdminApp } from './instance-admin-test-app';

const app = buildInstanceAdminApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

/**
 * An organization with an EXPLICIT creation instant.
 *
 * The "first live organization" fallback orders by `created_at`, and a fixture
 * that lets Postgres stamp `now()` would leave the assertion depending on how
 * fast two inserts ran.
 */
async function seedOrgAt(
  slug: string,
  createdAt: Date,
  options: { deleted?: boolean } = {},
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(organizations)
    .values({
      slug,
      name: slug.toUpperCase(),
      createdAt,
      updatedAt: createdAt,
      deletedAt: options.deleted === true ? new Date() : null,
    })
    .returning({ id: organizations.id });
  if (!row) throw new Error('org insert returned no row');
  return { id: row.id, slug };
}

async function admin(): Promise<TestUser> {
  return createUser({ isGlobalAdmin: true, name: 'Root' });
}

const getConfig = (user: TestUser) =>
  request(app).get('/api/instance/config').set('Authorization', bearer(user));

const getSettings = (user: TestUser) =>
  request(app).get('/api/admin/settings').set('Authorization', bearer(user));

const patchSettings = (user: TestUser, body: unknown) =>
  request(app).patch('/api/admin/settings').set('Authorization', bearer(user)).send(body);

describe('the guards on the instance pair', () => {
  it('401s GET /instance/config without a session', async () => {
    const res = await request(app).get('/api/instance/config');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('serves /instance/config to a plain member — its floor is auth, not admin', async () => {
    const member = await createUser();
    const res = await getConfig(member);
    expect(res.status).toBe(200);
    expect(res.body.data.orgMode).toBe('multi');
  });

  it('401s /admin/settings without a session', async () => {
    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
  });

  it('403s GET /admin/settings for a non-admin', async () => {
    const res = await getSettings(await createUser());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('403s PATCH /admin/settings for a non-admin', async () => {
    const res = await patchSettings(await createUser(), { instanceName: 'Nope' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/instance/config', () => {
  it('answers from the shipped defaults when the table is empty, creating the row', async () => {
    const res = await getConfig(await admin());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      orgMode: 'multi',
      defaultOrgSlug: null,
      instanceName: 'FlowBoard',
    });

    // The lazy ensure actually wrote it — a TRUNCATEd test database has no row
    // until something reads one.
    const rows = await db.select().from(instanceSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(1);
  });

  it('reports no default org in multi mode even when organizations exist', async () => {
    await createOrg({ name: 'Acme' });
    await createOrg({ name: 'Globex' });

    const res = await getConfig(await admin());

    expect(res.body.data.orgMode).toBe('multi');
    expect(res.body.data.defaultOrgSlug).toBeNull();
  });

  it('resolves the configured default org to its slug', async () => {
    const root = await admin();
    const acme = await seedOrgAt('acme', new Date('2026-01-01T00:00:00Z'));
    await seedOrgAt('globex', new Date('2026-02-01T00:00:00Z'));

    await patchSettings(root, { defaultOrgId: acme.id });

    expect((await getConfig(root)).body.data.defaultOrgSlug).toBe('acme');
  });

  it('falls back to the FIRST live org in single mode with nothing configured', async () => {
    const root = await admin();
    await seedOrgAt('older', new Date('2026-01-01T00:00:00Z'));
    await seedOrgAt('newer', new Date('2026-02-01T00:00:00Z'));

    // Configure single mode past the "more than one org" rule, then clear the
    // default to reach the read-time fallback.
    await db.insert(instanceSettings).values({ id: 1, orgMode: 'single', defaultOrgId: null });

    const res = await getConfig(root);
    expect(res.body.data.orgMode).toBe('single');
    expect(res.body.data.defaultOrgSlug).toBe('older');
  });

  it('falls back when the configured default org has been archived', async () => {
    const root = await admin();
    const gone = await seedOrgAt('gone', new Date('2026-01-01T00:00:00Z'));
    await seedOrgAt('survivor', new Date('2026-02-01T00:00:00Z'));

    await db.insert(instanceSettings).values({ id: 1, orgMode: 'single', defaultOrgId: gone.id });
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, gone.id));

    const res = await getConfig(root);
    expect(res.body.data.defaultOrgSlug).toBe('survivor');
    // The CONFIGURED id is untouched — the fallback resolves, it does not rewrite.
    expect((await getSettings(root)).body.data.defaultOrgId).toBe(gone.id);
  });

  it('reports a null slug for single mode on an install with no organizations', async () => {
    const root = await admin();
    await patchSettings(root, { orgMode: 'single' });

    const res = await getConfig(root);
    expect(res.body.data).toEqual({
      orgMode: 'single',
      defaultOrgSlug: null,
      instanceName: 'FlowBoard',
    });
  });

  it('carries the instance name a PATCH set, immediately', async () => {
    const root = await admin();
    await patchSettings(root, { instanceName: 'Globex Internal' });

    expect((await getConfig(root)).body.data.instanceName).toBe('Globex Internal');
  });

  it('falls back to multi for an org_mode value this build does not know', async () => {
    const root = await admin();
    // The column is plain `text` on purpose (adding a mode must not be DDL), so
    // a hand-edited row can hold anything. The boot payload must still render.
    await db.insert(instanceSettings).values({ id: 1, orgMode: 'federated' });

    expect((await getConfig(root)).body.data.orgMode).toBe('multi');
  });
});

describe('GET /api/admin/settings', () => {
  it('adds the raw id and the timestamps the config payload omits', async () => {
    const root = await admin();
    const acme = await createOrg({ name: 'Acme' });
    await patchSettings(root, { defaultOrgId: acme.id });

    const res = await getSettings(root);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      orgMode: 'multi',
      defaultOrgId: acme.id,
      defaultOrgSlug: acme.slug,
      instanceName: 'FlowBoard',
    });
    expect(typeof res.body.data.createdAt).toBe('string');
    expect(typeof res.body.data.updatedAt).toBe('string');
  });
});

describe('PATCH /api/admin/settings', () => {
  it('422s an empty body — at least one field is required', async () => {
    const res = await patchSettings(await admin(), {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('renames the instance without touching the mode', async () => {
    const root = await admin();
    const res = await patchSettings(root, { instanceName: 'Acme Delivery' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ instanceName: 'Acme Delivery', orgMode: 'multi' });
  });

  it('sets a default org and answers with the resolved slug', async () => {
    const root = await admin();
    const acme = await createOrg({ name: 'Acme' });

    const res = await patchSettings(root, { defaultOrgId: acme.id });

    expect(res.status).toBe(200);
    expect(res.body.data.defaultOrgId).toBe(acme.id);
    expect(res.body.data.defaultOrgSlug).toBe(acme.slug);
  });

  it('clears the default org back to null', async () => {
    const root = await admin();
    const acme = await createOrg();
    await patchSettings(root, { defaultOrgId: acme.id });

    const res = await patchSettings(root, { defaultOrgId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.defaultOrgId).toBeNull();
    expect(res.body.data.defaultOrgSlug).toBeNull();
  });

  it('422s `default_org_invalid` for an organization that does not exist', async () => {
    const res = await patchSettings(await admin(), {
      defaultOrgId: '00000000-0000-4000-8000-000000000000',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('default_org_invalid');
  });

  it('422s `default_org_invalid` for an ARCHIVED organization', async () => {
    const archived = await createOrg({ deleted: true });

    const res = await patchSettings(await admin(), { defaultOrgId: archived.id });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('default_org_invalid');
  });

  it('422s a defaultOrgId that is not a uuid, at the boundary', async () => {
    const res = await patchSettings(await admin(), { defaultOrgId: 'acme' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('422s `default_org_required` for single mode with more than one organization', async () => {
    await createOrg({ name: 'Acme' });
    await createOrg({ name: 'Globex' });

    const res = await patchSettings(await admin(), { orgMode: 'single' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('default_org_required');
  });

  it('does not commit the mode when the single-mode rule refuses it', async () => {
    const root = await admin();
    await createOrg();
    await createOrg();

    await patchSettings(root, { orgMode: 'single' });

    expect((await getSettings(root)).body.data.orgMode).toBe('multi');
  });

  it('ADOPTS the only live organization when switching to single mode', async () => {
    const root = await admin();
    const only = await createOrg({ name: 'Only' });
    await createOrg({ name: 'Archived', deleted: true });

    const res = await patchSettings(root, { orgMode: 'single' });

    expect(res.status).toBe(200);
    expect(res.body.data.defaultOrgId).toBe(only.id);
    expect(res.body.data.defaultOrgSlug).toBe(only.slug);
  });

  it('allows single mode on an install with zero organizations', async () => {
    const res = await patchSettings(await admin(), { orgMode: 'single' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ orgMode: 'single', defaultOrgId: null });
    expect(res.body.data.defaultOrgSlug).toBeNull();
  });

  it('accepts single mode plus an explicit default in one request', async () => {
    const root = await admin();
    await createOrg({ name: 'Acme' });
    const chosen = await createOrg({ name: 'Globex' });

    const res = await patchSettings(root, { orgMode: 'single', defaultOrgId: chosen.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ orgMode: 'single', defaultOrgId: chosen.id });
  });

  it('re-adopts when a stale default was archived and one org is left', async () => {
    const root = await admin();
    const gone = await createOrg({ name: 'Gone' });
    const left = await createOrg({ name: 'Left' });
    await patchSettings(root, { defaultOrgId: gone.id });
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, gone.id));

    const res = await patchSettings(root, { orgMode: 'single' });

    expect(res.status).toBe(200);
    expect(res.body.data.defaultOrgId).toBe(left.id);
  });

  it('keeps the configured default when flipping back to multi', async () => {
    const root = await admin();
    const only = await createOrg();
    await patchSettings(root, { orgMode: 'single' });

    const res = await patchSettings(root, { orgMode: 'multi' });

    expect(res.body.data).toMatchObject({
      orgMode: 'multi',
      defaultOrgId: only.id,
      defaultOrgSlug: only.slug,
    });
  });

  it('422s an unknown org mode', async () => {
    const res = await patchSettings(await admin(), { orgMode: 'federated' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });
});
