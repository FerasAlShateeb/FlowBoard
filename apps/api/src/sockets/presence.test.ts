import { afterEach, describe, expect, it } from 'vitest';
import type { UserSummary } from '@flowboard/shared';

import {
  clearPresence,
  isPresent,
  presenceProjectsOf,
  presenceRoster,
  presenceSocketCount,
  removePresence,
  removeSocket,
  setPresence,
  updatePresenceTask,
} from './presence';

/**
 * The presence registry, driven directly — no sockets, no database.
 *
 * The interesting rules are all here rather than in the gateway: two tabs are
 * one avatar, a tab with a task open wins the tie, a disconnect has to leave
 * every room, and an update for a room you never joined is not an implicit
 * join. The gateway suite proves those reach the wire; this one proves they are
 * right.
 */

const PROJECT = 'p1';
const OTHER = 'p2';

function user(id: string, name: string): UserSummary {
  return { id, name, avatarUrl: null };
}

const ada = user('u-ada', 'Ada');
const bob = user('u-bob', 'Bob');

afterEach(() => {
  clearPresence();
});

describe('presence registry', () => {
  it('adds a socket and returns it in the roster', () => {
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });

    expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: null }]);
    expect(isPresent(PROJECT, 's1')).toBe(true);
  });

  it('is idempotent: re-joining replaces rather than duplicating', () => {
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });

    expect(presenceSocketCount(PROJECT)).toBe(1);
    expect(presenceRoster(PROJECT)).toHaveLength(1);
  });

  it('collapses two tabs of one person into one roster entry', () => {
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
    setPresence(PROJECT, { socketId: 's2', user: ada, taskId: null });

    expect(presenceSocketCount(PROJECT)).toBe(2);
    expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: null }]);
  });

  it('prefers the tab that has a task open when a person has two', () => {
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
    setPresence(PROJECT, { socketId: 's2', user: ada, taskId: 't-42' });

    expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: 't-42' }]);
  });

  it('sorts the roster by name so every client renders the same order', () => {
    setPresence(PROJECT, { socketId: 's2', user: bob, taskId: null });
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });

    expect(presenceRoster(PROJECT).map((entry) => entry.user.name)).toEqual(['Ada', 'Bob']);
  });

  it('keeps projects isolated', () => {
    setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
    setPresence(OTHER, { socketId: 's2', user: bob, taskId: null });

    expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: null }]);
    expect(presenceRoster(OTHER)).toEqual([{ user: bob, taskId: null }]);
  });

  it('returns an empty roster for a project nobody is in', () => {
    expect(presenceRoster('nobody-here')).toEqual([]);
  });

  describe('updatePresenceTask', () => {
    it('moves a present socket onto a task and reports the change', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });

      expect(updatePresenceTask(PROJECT, 's1', 't-9')).toBe(true);
      expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: 't-9' }]);
    });

    it('reports no change for a repeat of the same task, so no broadcast fires', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: 't-9' });

      expect(updatePresenceTask(PROJECT, 's1', 't-9')).toBe(false);
    });

    it('refuses a socket that never joined — an update is not an implicit join', () => {
      expect(updatePresenceTask(PROJECT, 'stranger', 't-9')).toBe(false);
      expect(presenceRoster(PROJECT)).toEqual([]);
    });
  });

  describe('removal', () => {
    it('removes one socket from one project and reports it', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });

      expect(removePresence(PROJECT, 's1')).toBe(true);
      expect(presenceRoster(PROJECT)).toEqual([]);
    });

    it('reports false for a duplicate leave, so no pointless broadcast fires', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
      removePresence(PROJECT, 's1');

      expect(removePresence(PROJECT, 's1')).toBe(false);
    });

    it('leaves the person on the roster while their other tab is open', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
      setPresence(PROJECT, { socketId: 's2', user: ada, taskId: null });

      removePresence(PROJECT, 's1');

      expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: null }]);
    });

    it('removeSocket clears every project the socket was in and names them', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
      setPresence(OTHER, { socketId: 's1', user: ada, taskId: null });

      expect(removeSocket('s1').sort()).toEqual([PROJECT, OTHER].sort());
      expect(presenceRoster(PROJECT)).toEqual([]);
      expect(presenceRoster(OTHER)).toEqual([]);
      expect(presenceProjectsOf('s1')).toEqual([]);
    });

    it('removeSocket is a no-op for a socket that joined nothing', () => {
      expect(removeSocket('never-joined')).toEqual([]);
    });

    it('drops both indices when the last tab in a project leaves', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });

      removePresence(PROJECT, 's1');

      // The project map and the disconnect index are only ever written through
      // these functions; leaving an empty room (or an empty socket entry)
      // behind is how the two structures start to drift apart.
      expect(presenceSocketCount(PROJECT)).toBe(0);
      expect(presenceProjectsOf('s1')).toEqual([]);
      expect(isPresent(PROJECT, 's1')).toBe(false);
    });

    it('keeps the socket s OTHER project when it leaves just one', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
      setPresence(OTHER, { socketId: 's1', user: ada, taskId: null });

      removePresence(PROJECT, 's1');

      expect(presenceProjectsOf('s1')).toEqual([OTHER]);
      expect(isPresent(OTHER, 's1')).toBe(true);
    });
  });

  describe('the read helpers on rooms that do not exist', () => {
    it('answer emptily rather than throwing', () => {
      expect(isPresent('never-a-project', 's1')).toBe(false);
      expect(presenceSocketCount('never-a-project')).toBe(0);
      expect(presenceProjectsOf('never-a-socket')).toEqual([]);
      expect(presenceRoster('never-a-project')).toEqual([]);
    });
  });

  describe('presenceSocketCount counts TABS, not people', () => {
    it('is two for one person with two tabs open', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
      setPresence(PROJECT, { socketId: 's2', user: ada, taskId: 't-1' });

      expect(presenceSocketCount(PROJECT)).toBe(2);
      // …while the roster, which is what people see, is still one avatar.
      expect(presenceRoster(PROJECT)).toHaveLength(1);
    });

    it('does not double-count a re-join of the same socket', () => {
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: null });
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: 't-1' });

      expect(presenceSocketCount(PROJECT)).toBe(1);
    });
  });

  describe('roster ordering', () => {
    it('breaks a name tie on user id, so two namesakes never shuffle', () => {
      // `localeCompare` returns 0 for two identical names; without the id
      // tie-break the order would fall back to Map insertion order, which
      // differs between clients that joined in a different sequence.
      const first = user('u-aaa', 'Sam');
      const second = user('u-zzz', 'Sam');
      setPresence(PROJECT, { socketId: 's2', user: second, taskId: null });
      setPresence(PROJECT, { socketId: 's1', user: first, taskId: null });

      expect(presenceRoster(PROJECT).map((entry) => entry.user.id)).toEqual(['u-aaa', 'u-zzz']);
    });

    it('keeps the FIRST task-open tab when a person has two of them', () => {
      // Both tabs are equally specific, so the tie-break is "do not churn":
      // the second one must not displace the first, or an unrelated join in a
      // third tab would make the avatar jump between two task links.
      setPresence(PROJECT, { socketId: 's1', user: ada, taskId: 't-1' });
      setPresence(PROJECT, { socketId: 's2', user: ada, taskId: 't-2' });

      expect(presenceRoster(PROJECT)).toEqual([{ user: ada, taskId: 't-1' }]);
    });

    it('sorts a mixed roster of several people by name', () => {
      setPresence(PROJECT, { socketId: 's1', user: bob, taskId: 't-9' });
      setPresence(PROJECT, { socketId: 's2', user: ada, taskId: null });

      expect(presenceRoster(PROJECT)).toEqual([
        { user: ada, taskId: null },
        { user: bob, taskId: 't-9' },
      ]);
    });
  });
});
