import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { closeDb, db, users } from '../../db';
import { signAccessToken } from '../../utils/jwt';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  addOrgMember,
  addProjectMember,
  createOrg,
  createProject,
  createUser,
} from '../../routes/__tests__/fixtures';
import { presenceRoster } from '../presence';
import { PRESENCE_THROTTLE_MS } from '../rooms';
import {
  connectClient,
  joinProject,
  leaveProject,
  startGateway,
  waitFor,
  type Gateway,
} from './harness';

/**
 * THE GATEWAY: the handshake, `project:join`'s membership check, and presence.
 *
 * Everything here runs against a real Socket.IO server on a real port with real
 * `socket.io-client` connections — see the note in `harness.ts` for why a
 * mocked `io` cannot answer these questions.
 */

let gateway: Gateway;

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
  gateway = await startGateway();
});

afterEach(async () => {
  await gateway.close();
});

afterAll(async () => {
  await closeDb();
});

describe('handshake', () => {
  it('accepts a valid access token', async () => {
    const user = await createUser();
    const client = await connectClient(gateway, user.token);

    expect(client.connected).toBe(true);
    expect(client.id).toBeTruthy();
  });

  it('refuses a garbage token', async () => {
    await expect(connectClient(gateway, 'not-a-jwt')).rejects.toThrow();
  });

  it('refuses an empty token', async () => {
    await expect(connectClient(gateway, '')).rejects.toThrow();
  });

  /**
   * The reason the handshake pays for a database read at all: a socket lives
   * for hours, so a `token_version` bumped by a password change or an admin
   * force-revoke must be caught at connect time rather than whenever the
   * 15-minute access token happens to expire.
   */
  it('refuses a token whose tokenVersion has been revoked', async () => {
    const user = await createUser();
    await db.update(users).set({ tokenVersion: 7 }).where(eq(users.id, user.id));

    await expect(connectClient(gateway, user.token)).rejects.toThrow();
  });

  it('refuses a deactivated account', async () => {
    const user = await createUser();
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));

    await expect(connectClient(gateway, user.token)).rejects.toThrow();
  });

  it('refuses a token signed for a user that no longer exists', async () => {
    const ghost = signAccessToken({
      sub: '00000000-0000-4000-8000-0000000000ff',
      tokenVersion: 0,
      isGlobalAdmin: false,
    });

    await expect(connectClient(gateway, ghost)).rejects.toThrow();
  });
});

describe('project:join', () => {
  it('lets a project member in and acks ok', async () => {
    const org = await createOrg();
    const project = await createProject(org.id);
    const member = await createUser();
    await addOrgMember(org.id, member.id);
    await addProjectMember(project.id, member.id, 'member');

    const client = await connectClient(gateway, member.token);

    await expect(joinProject(client, project.id)).resolves.toEqual({ ok: true });
  });

  /** A viewer reads the board, and a project room only ever carries reads. */
  it('lets a viewer in — the room is read-only', async () => {
    const org = await createOrg();
    const project = await createProject(org.id);
    const viewer = await createUser();
    await addOrgMember(org.id, viewer.id);
    await addProjectMember(project.id, viewer.id, 'viewer');

    const client = await connectClient(gateway, viewer.token);

    await expect(joinProject(client, project.id)).resolves.toEqual({ ok: true });
  });

  it('refuses a non-member with FORBIDDEN', async () => {
    const org = await createOrg();
    const project = await createProject(org.id);
    const outsider = await createUser();

    const client = await connectClient(gateway, outsider.token);
    const ack = await joinProject(client, project.id);

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('FORBIDDEN');
  });

  it('refuses an org member who is not on the project', async () => {
    const org = await createOrg();
    const project = await createProject(org.id);
    const orgMember = await createUser();
    await addOrgMember(org.id, orgMember.id, 'member');

    const client = await connectClient(gateway, orgMember.token);
    const ack = await joinProject(client, project.id);

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('FORBIDDEN');
  });

  /** The inheritance chain the HTTP guards use, applied on the socket too. */
  it('lets an org admin in without an explicit project membership', async () => {
    const org = await createOrg();
    const project = await createProject(org.id);
    const orgAdmin = await createUser();
    await addOrgMember(org.id, orgAdmin.id, 'admin');

    const client = await connectClient(gateway, orgAdmin.token);

    await expect(joinProject(client, project.id)).resolves.toEqual({ ok: true });
  });

  it('lets a global admin in', async () => {
    const org = await createOrg();
    const project = await createProject(org.id);
    const admin = await createUser({ isGlobalAdmin: true });

    const client = await connectClient(gateway, admin.token);

    await expect(joinProject(client, project.id)).resolves.toEqual({ ok: true });
  });

  it('acks NOT_FOUND for a project id that does not exist', async () => {
    const user = await createUser({ isGlobalAdmin: true });
    const client = await connectClient(gateway, user.token);

    const ack = await joinProject(client, '00000000-0000-4000-8000-0000000000aa');

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('NOT_FOUND');
  });

  it('acks BAD_REQUEST for a malformed payload', async () => {
    const user = await createUser();
    const client = await connectClient(gateway, user.token);

    const ack = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      // Deliberately off-contract, which is exactly what a hostile client sends.
      client.emit('project:join', { projectId: 'not-a-uuid' }, resolve);
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('BAD_REQUEST');
  });
});

describe('presence', () => {
  /** An org + project with two members, both connected and joined. */
  async function twoMembersInAProject() {
    const org = await createOrg();
    const project = await createProject(org.id);
    const one = await createUser({ name: 'Ada Lovelace' });
    const two = await createUser({ name: 'Bob Barker' });
    for (const person of [one, two]) {
      await addOrgMember(org.id, person.id);
      await addProjectMember(project.id, person.id, 'member');
    }
    return { project, one, two };
  }

  it('broadcasts the joiner to themselves — the initial roster', async () => {
    const { project, one } = await twoMembersInAProject();
    const client = await connectClient(gateway, one.token);

    const state = waitFor(client, 'presence:state');
    await joinProject(client, project.id);

    await expect(state).resolves.toEqual({
      projectId: project.id,
      entries: [{ user: { id: one.id, name: one.name, avatarUrl: null }, taskId: null }],
    });
  });

  it('broadcasts the full roster to everyone already in the room on a join', async () => {
    const { project, one, two } = await twoMembersInAProject();

    const first = await connectClient(gateway, one.token);
    await joinProject(first, project.id);

    const second = await connectClient(gateway, two.token);
    const state = waitFor(first, 'presence:state');
    await joinProject(second, project.id);

    const payload = await state;
    expect(payload.projectId).toBe(project.id);
    expect(payload.entries.map((entry) => entry.user.id).sort()).toEqual([one.id, two.id].sort());
  });

  it('moves a person onto a task on presence:update', async () => {
    const { project, one, two } = await twoMembersInAProject();
    const first = await connectClient(gateway, one.token);
    const second = await connectClient(gateway, two.token);
    await joinProject(first, project.id);
    await joinProject(second, project.id);

    const state = waitFor(second, 'presence:state');
    first.emit('presence:update', {
      projectId: project.id,
      taskId: '00000000-0000-4000-8000-0000000000c1',
    });

    const payload = await state;
    const entry = payload.entries.find((candidate) => candidate.user.id === one.id);
    expect(entry?.taskId).toBe('00000000-0000-4000-8000-0000000000c1');
  });

  /**
   * The throttle is SERVER-side on purpose: a client bug (or a hostile one)
   * firing presence in a loop would otherwise cost a broadcast to every socket
   * in the room per iteration.
   */
  it('ignores a second presence:update inside the throttle window', async () => {
    const { project, one } = await twoMembersInAProject();
    const client = await connectClient(gateway, one.token);
    await joinProject(client, project.id);

    const seen: (string | null)[] = [];
    client.on('presence:state', (payload) => {
      const entry = payload.entries.find((candidate) => candidate.user.id === one.id);
      seen.push(entry?.taskId ?? null);
    });

    client.emit('presence:update', {
      projectId: project.id,
      taskId: '00000000-0000-4000-8000-0000000000d1',
    });
    client.emit('presence:update', {
      projectId: project.id,
      taskId: '00000000-0000-4000-8000-0000000000d2',
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(PRESENCE_THROTTLE_MS).toBeGreaterThan(300);
    expect(seen).toEqual(['00000000-0000-4000-8000-0000000000d1']);
  });

  it('ignores presence for a project the socket never joined', async () => {
    const { project, one } = await twoMembersInAProject();
    const client = await connectClient(gateway, one.token);

    client.emit('presence:update', {
      projectId: project.id,
      taskId: '00000000-0000-4000-8000-0000000000e1',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(presenceRoster(project.id)).toEqual([]);
  });

  it('drops the leaver from the roster and tells the room', async () => {
    const { project, one, two } = await twoMembersInAProject();
    const first = await connectClient(gateway, one.token);
    const second = await connectClient(gateway, two.token);
    await joinProject(first, project.id);
    await joinProject(second, project.id);

    const state = waitFor(second, 'presence:state');
    await leaveProject(first, project.id);

    const payload = await state;
    expect(payload.entries.map((entry) => entry.user.id)).toEqual([two.id]);
  });

  it('prunes presence on disconnect and tells the room', async () => {
    const { project, one, two } = await twoMembersInAProject();
    const first = await connectClient(gateway, one.token);
    const second = await connectClient(gateway, two.token);
    await joinProject(first, project.id);
    await joinProject(second, project.id);

    const state = waitFor(second, 'presence:state');
    first.disconnect();

    const payload = await state;
    expect(payload.entries.map((entry) => entry.user.id)).toEqual([two.id]);
    expect(presenceRoster(project.id).map((entry) => entry.user.id)).toEqual([two.id]);
  });
});
