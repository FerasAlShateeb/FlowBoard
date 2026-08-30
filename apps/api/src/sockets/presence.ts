/**
 * PRESENCE — who is looking at each project right now.
 *
 * Deliberately IN-PROCESS AND EPHEMERAL. Presence is the shortest-lived fact in
 * the product: it is true for as long as a socket is open and meaningless the
 * moment it closes. Persisting it would mean writing a row per navigation and
 * then owning the problem of stale rows after a crash — a table whose only
 * correct state is "empty" every time the process restarts. A `Map` restarts
 * empty for free, and FlowBoard runs a single Socket.IO node (the shared
 * contract declares `InterServerEvents` empty for exactly this reason).
 *
 * ── THE UNIT IS A SOCKET, THE ROSTER IS PER USER ────────────────────────────
 * Bookkeeping is keyed by SOCKET id, because that is what joins, leaves and
 * disconnects — a person with the board open in two tabs is two sockets, and
 * closing one must not remove them from the roster. The broadcast roster is
 * keyed by USER, because two tabs are still one avatar. {@link presenceRoster}
 * collapses the first into the second, preferring the tab that has a task open:
 * "Ada is reading FLOW-12" is strictly more informative than "Ada is here", and
 * a person who has a task open in one tab genuinely is reading it.
 *
 * ── WHY A SECOND INDEX ──────────────────────────────────────────────────────
 * A disconnect arrives with nothing but a socket id, and it has to leave every
 * room that socket was in. Scanning every project on every disconnect would be
 * O(projects); {@link socketProjects} makes it O(rooms this socket joined).
 * The two structures are only ever written through the functions below, which
 * is what keeps them from drifting apart.
 */
import type { PresenceEntry, UserSummary } from '@flowboard/shared';

/** One open tab, in one project. */
export interface PresenceRecord {
  socketId: string;
  user: UserSummary;
  /** The task this tab has open, or `null` for a project-level view. */
  taskId: string | null;
}

/** `projectId` → `socketId` → record. */
const byProject = new Map<string, Map<string, PresenceRecord>>();

/** `socketId` → the projects that socket is present in. The disconnect index. */
const socketProjects = new Map<string, Set<string>>();

/**
 * Add or replace this socket's presence in a project.
 *
 * Idempotent: a re-join (after a reconnect, or a StrictMode double-effect)
 * overwrites rather than duplicating.
 */
export function setPresence(projectId: string, record: PresenceRecord): void {
  const room = byProject.get(projectId) ?? new Map<string, PresenceRecord>();
  room.set(record.socketId, record);
  byProject.set(projectId, room);

  const projects = socketProjects.get(record.socketId) ?? new Set<string>();
  projects.add(projectId);
  socketProjects.set(record.socketId, projects);
}

/**
 * Point an already-present socket at a different task.
 *
 * @returns `false` when the socket is not present in that project — a
 * `presence:update` for a room the client never joined, which is ignored rather
 * than treated as an implicit join. Presence in a room the membership check
 * never ran on would be a way to appear inside a project you cannot read.
 */
export function updatePresenceTask(
  projectId: string,
  socketId: string,
  taskId: string | null,
): boolean {
  const existing = byProject.get(projectId)?.get(socketId);
  if (!existing) return false;
  if (existing.taskId === taskId) return false;
  setPresence(projectId, { ...existing, taskId });
  return true;
}

/**
 * Remove one socket from one project.
 *
 * @returns whether anything was actually removed, so a caller can skip a
 * pointless roster broadcast on a duplicate `project:leave`.
 */
export function removePresence(projectId: string, socketId: string): boolean {
  const room = byProject.get(projectId);
  const removed = room?.delete(socketId) ?? false;
  if (room && room.size === 0) byProject.delete(projectId);

  const projects = socketProjects.get(socketId);
  if (projects) {
    projects.delete(projectId);
    if (projects.size === 0) socketProjects.delete(socketId);
  }
  return removed;
}

/**
 * Remove a socket from every project it was present in — the disconnect path.
 *
 * @returns the project ids that need a fresh roster broadcast.
 */
export function removeSocket(socketId: string): string[] {
  const projects = socketProjects.get(socketId);
  if (!projects) return [];
  const affected = [...projects];
  for (const projectId of affected) removePresence(projectId, socketId);
  socketProjects.delete(socketId);
  return affected;
}

/**
 * Empty ONE project's roster, whoever is in it — the org-archive path (R2 W3.5).
 *
 * `removeSocket` empties a socket across projects; this is the other axis. It
 * exists because archiving an organization evicts every socket from that org's
 * project rooms at once (`sockets/realtime-bridge.ts` → `org.archived`), and the
 * roster is a `Map` rather than a projection of the Socket.IO rooms: leaving the
 * rooms without this would leave every evicted tab listed as "present" in a
 * project nobody can open any more.
 *
 * Both indexes are maintained, like every other mutator here — dropping the
 * project's map alone would leave `socketProjects` pointing at a room that no
 * longer exists, and the next disconnect would try to broadcast a roster for it.
 *
 * @returns the socket ids that were removed, so a caller can decide whether
 * anything happened at all.
 */
export function clearProjectPresence(projectId: string): string[] {
  const room = byProject.get(projectId);
  if (!room) return [];
  const socketIds = [...room.keys()];
  for (const socketId of socketIds) removePresence(projectId, socketId);
  return socketIds;
}

/** The projects a socket is currently present in. */
export function presenceProjectsOf(socketId: string): string[] {
  return [...(socketProjects.get(socketId) ?? [])];
}

/** Whether this socket is present in this project. */
export function isPresent(projectId: string, socketId: string): boolean {
  return byProject.get(projectId)?.has(socketId) ?? false;
}

/**
 * The roster to broadcast: one entry per PERSON, sorted by name so two clients
 * that receive the same set render the same order (an unordered roster would
 * make avatars shuffle on every unrelated join).
 */
export function presenceRoster(projectId: string): PresenceEntry[] {
  const room = byProject.get(projectId);
  if (!room) return [];

  const byUser = new Map<string, PresenceEntry>();
  for (const record of room.values()) {
    const current = byUser.get(record.user.id);
    // A tab with a task open wins over one that has not opened anything: it is
    // the more specific truth about where the person is.
    if (current && (current.taskId !== null || record.taskId === null)) continue;
    byUser.set(record.user.id, { user: record.user, taskId: record.taskId });
  }

  return [...byUser.values()].sort(
    (a, b) => a.user.name.localeCompare(b.user.name) || a.user.id.localeCompare(b.user.id),
  );
}

/** How many sockets are present in a project — diagnostics and tests. */
export function presenceSocketCount(projectId: string): number {
  return byProject.get(projectId)?.size ?? 0;
}

/** Drop everything. Test seam; never called from application code. */
export function clearPresence(): void {
  byProject.clear();
  socketProjects.clear();
}
