import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { serverToClientEventSchemas, type ServerToClientEvents } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import {
  cancelProjectRefresh,
  createRealtimeCacheHandlers,
  scheduleProjectRefresh,
} from '@/lib/realtime-cache';
import {
  connectSocket,
  emitPresence,
  emitProjectJoin,
  emitProjectLeave,
  getSocket,
  getSocketStatus,
  onSocketConnect,
  subscribeSocketStatus,
  type SocketStatus,
} from '@/lib/socket';
import { useAuthStore } from '@/stores/useAuthStore';
import { usePresenceStore } from '@/stores/usePresenceStore';

/**
 * THE SUBSCRIPTION SIDE OF REALTIME — the only place a component touches the
 * socket.
 *
 * `lib/socket.ts` owns the connection, `lib/realtime-cache.ts` owns what an
 * event does to the cache, and this file owns the LIFECYCLE that joins them:
 * connect while signed in, join the project room while a project is on screen,
 * unsubscribe on the way out, and re-validate after a reconnect.
 *
 * ═══ TWO SCOPES, TWO EFFECTS ═══════════════════════════════════════════════
 *
 * The gateway delivers to two kinds of room, and the app subscribes to them on
 * two different schedules:
 *
 *   - `user:{id}` is joined at the handshake and carries `notification:new`.
 *     The bell lives in the topbar on EVERY page, so this subscription is tied
 *     to the SESSION ({@link useGlobalRealtime}) — a user reading
 *     `/notifications` or `/admin/users` is inside no project and must still
 *     see a new notification arrive.
 *   - `project:{id}` is joined on demand, membership-checked, and carries
 *     everything else. That subscription is tied to the PROJECT
 *     ({@link useProjectRealtime}) and is torn down when the user leaves it.
 *
 * Folding the two together — the mistake this split exists to avoid — would
 * make the notification bell silently dead outside a project.
 *
 * ═══ EVERY INCOMING PAYLOAD IS PARSED ══════════════════════════════════════
 *
 * The server validates before it emits and this side validates before it
 * writes, because a socket payload is a boundary like any other, and a
 * mismatched deploy (an old tab left open across a release) is precisely the
 * case where the two ends disagree. A payload that fails to parse is a logged,
 * dropped event — not a board spliced with a field that is missing.
 *
 * ═══ EVERY JOIN IS A CACHE INVALIDATION — THE TWO ARE JUST SIZED DIFFERENTLY ═
 *
 * While the socket was down, every event the project produced was lost — there
 * is no replay buffer, and building one would mean the server holding per-tab
 * state for the length of a bad wifi hop. Instead the tab admits it missed
 * things: it re-joins the room (Socket.IO restores TRANSPORTS across a
 * reconnect, never rooms) and invalidates `['project', projectId]`, which
 * refetches exactly what is mounted. This is the plan's stated mitigation for
 * risk #3.
 *
 * A FIRST connect has a smaller version of the same gap, and it was missed
 * until WP5.6: the board query and the `project:join` ack are two independent
 * round trips, so anything broadcast in between lands in a room this tab has
 * not entered yet and is lost for good. That window is milliseconds rather than
 * minutes, so it is closed by MARKING the project prefix stale
 * (`refetchType: 'none'`) instead of refetching — the next focus or navigation
 * reconciles it, and opening a project still costs one round of queries.
 */

/** Server events that arrive in a PROJECT room. */
const PROJECT_EVENTS = [
  'task:created',
  'task:updated',
  'task:moved',
  'task:deleted',
  'comment:created',
  'comment:updated',
  'comment:deleted',
  'sprint:changed',
  'workflow:changed',
] as const satisfies readonly (keyof ServerToClientEvents)[];

/** Server events that arrive in the `user:{id}` room, on every page. */
const USER_EVENTS = ['notification:new'] as const satisfies readonly (keyof ServerToClientEvents)[];

/** How the app tells the socket which token to hand the gateway. */
function currentAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/**
 * Attach a parse-then-dispatch listener for each named event, and return the
 * teardown that removes every one of them.
 *
 * `dispatch` receives the event name and its PARSED payload as `unknown`; the
 * callers narrow it. TypeScript cannot follow the correlation between a key
 * drawn from a union and the payload type of that key's schema, so the cast
 * happens once here — where the pair provably came from the same registry
 * entry — rather than at every call site.
 */
function subscribe(
  names: readonly (keyof ServerToClientEvents)[],
  dispatch: (name: keyof ServerToClientEvents, payload: unknown) => void,
): () => void {
  const socket = getSocket();
  const attached: [keyof ServerToClientEvents, (payload: unknown) => void][] = [];

  for (const name of names) {
    const listener = (raw: unknown): void => {
      const parsed = serverToClientEventSchemas[name].safeParse(raw);
      if (!parsed.success) {
        // A contract mismatch between a stale tab and a freshly deployed server
        // is exactly what the browser console exists to surface.
        // eslint-disable-next-line no-console -- no logger in the web bundle
        console.warn(`[realtime] dropped a malformed ${name} payload`, parsed.error.issues);
        return;
      }
      dispatch(name, parsed.data);
    };

    socket.on(name, listener as ServerToClientEvents[typeof name]);
    attached.push([name, listener]);
  }

  return () => {
    for (const [name, listener] of attached) {
      socket.off(name, listener as ServerToClientEvents[typeof name]);
    }
  };
}

/**
 * Open the connection while a session exists, and keep the notification bell
 * live on every page.
 *
 * Called by {@link useProjectRealtime}, so mounting the bridge is enough; a
 * surface that wants notifications WITHOUT a project (the notifications page
 * mounted outside the shell, a test) can call it directly.
 */
export function useGlobalRealtime(): void {
  const queryClient = useQueryClient();
  const isSignedIn = useAuthStore((state) => state.accessToken !== null);
  const clearPresence = usePresenceStore((state) => state.clearAll);

  useEffect(() => {
    if (!isSignedIn) return;

    connectSocket(currentAccessToken);

    const handlers = createRealtimeCacheHandlers(queryClient);
    const unsubscribe = subscribe(USER_EVENTS, (name, payload) => {
      if (name !== 'notification:new') return;
      handlers['notification:new'](payload as Parameters<(typeof handlers)['notification:new']>[0]);
    });

    return () => {
      unsubscribe();
      // A dropped session must not leave a roster of people on screen.
      clearPresence();
    };
  }, [isSignedIn, queryClient, clearPresence]);
}

/**
 * Keep this tab's caches and presence roster in sync with one project.
 *
 * Mount it once per open project — the headless `RealtimeBridge` does that from
 * the route, so no view has to remember to.
 *
 * `projectId` may be null (the URL is not inside a project, or the key→id
 * lookup has not resolved), in which case no room is joined and no project
 * listener is attached. That is the common case on org-level pages and it must
 * not cost a connection — but the connection itself and the notification
 * subscription stay up, because {@link useGlobalRealtime} owns those.
 */
export function useProjectRealtime(projectId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const isSignedIn = useAuthStore((state) => state.accessToken !== null);
  const setRoster = usePresenceStore((state) => state.setRoster);
  const clearProject = usePresenceStore((state) => state.clearProject);

  useGlobalRealtime();

  useEffect(() => {
    if (!isSignedIn || projectId === null || projectId === undefined) return;

    const handlers = createRealtimeCacheHandlers(queryClient);

    const unsubscribeEvents = subscribe([...PROJECT_EVENTS, 'presence:state'], (name, payload) => {
      if (name === 'presence:state') {
        const roster = payload as Parameters<ServerToClientEvents['presence:state']>[0];
        // Ignore a roster for a different project: a tab that just switched can
        // still receive one in-flight broadcast from the room it left.
        if (roster.projectId !== projectId) return;
        setRoster(roster.projectId, roster.entries);
        return;
      }
      // Narrowed by construction: `name` came from PROJECT_EVENTS, every member
      // of which has a handler, and `payload` was parsed by that same name's
      // schema.
      const handler = handlers[name as (typeof PROJECT_EVENTS)[number]] as (value: unknown) => void;
      handler(payload);
    });

    const join = (isReconnect: boolean): void => {
      void emitProjectJoin(projectId).then((ack) => {
        if (!ack.ok) {
          // A denied join means this tab will render a board that silently
          // never updates — indistinguishable from a quiet project. Say so.
          // eslint-disable-next-line no-console -- no logger in the web bundle
          console.warn(`[realtime] project:join refused (${ack.code ?? 'unknown'})`);
          return;
        }

        if (isReconnect) {
          // A RE-connect missed an unbounded stretch of events, so the project
          // is re-fetched — debounced, because a flaky link produces bursts.
          scheduleProjectRefresh(queryClient, projectId);
          return;
        }

        // A FIRST connect has a gap too, and it is the one that used to be
        // missed. The board fetch and the room join are two independent round
        // trips: everything broadcast between the query resolving and the ack
        // arriving reaches a room this tab was not yet in, and there is no
        // replay buffer. On a busy project that is a card that stays wrong
        // until something else happens to invalidate it — forever, on a board
        // nobody touches again.
        //
        // `refetchType: 'none'` is the whole difference from the reconnect
        // path: the entries are MARKED stale so the next focus, navigation or
        // mount reconciles them, without firing a second copy of every query
        // the mount just issued. The gap is milliseconds wide and the events in
        // it are rare; paying a full project refetch on every project open to
        // close it would be the worse trade.
        void queryClient.invalidateQueries({
          queryKey: qk.project.all(projectId),
          refetchType: 'none',
        });
      });
    };

    // The join has to happen on every connect, not once on mount: Socket.IO
    // restores the transport across a reconnect, never the rooms.
    const unsubscribeConnect = onSocketConnect(join);

    // …and if the socket is ALREADY connected (a project switch inside one
    // session) no `connect` event is coming, so the join fires directly.
    if (getSocket().connected) join(false);

    return () => {
      unsubscribeConnect();
      unsubscribeEvents();
      cancelProjectRefresh(projectId);
      void emitProjectLeave(projectId);
      clearProject(projectId);
    };
  }, [projectId, isSignedIn, queryClient, setRoster, clearProject]);
}

/**
 * The connection status, for chrome that wants to show it.
 *
 * `useSyncExternalStore` rather than local state because the status lives in a
 * module singleton that several components read independently — the React
 * 18/19 sanctioned way to subscribe to exactly that.
 */
export function useRealtimeConnection(): { status: SocketStatus; isConnected: boolean } {
  const status = useSyncExternalStore<SocketStatus>(
    subscribeSocketStatus,
    getSocketStatus,
    () => 'disconnected',
  );
  return { status, isConnected: status === 'connected' };
}

/**
 * Tell the room which task this tab is reading (or `null` for a project-level
 * view), so other people see a dot on that person's avatar.
 *
 * The server throttles to one update per second per socket and DROPS the
 * excess (presence is a current-state fact, so the next update supersedes a
 * dropped one), which is why a component may call this as freely as its own
 * state changes.
 */
export function useReportPresence(
  projectId: string | null | undefined,
  taskId: string | null,
): void {
  useEffect(() => {
    if (projectId === null || projectId === undefined) return;
    emitPresence(projectId, taskId);
  }, [projectId, taskId]);
}
