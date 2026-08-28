import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  notificationTypeSchema,
  type Notification,
  type NotificationType,
} from '@flowboard/shared';

import en from '@/locales/en/notifications';
import ar from '@/locales/ar/notifications';
import {
  dayHeading,
  groupByDay,
  notificationDay,
  notificationDetail,
  notificationSentence,
  SENTENCE_KEYS,
  type Translate,
} from '@/components/notifications/notification-sentence';

/**
 * The sentence layer, in BOTH languages.
 *
 * ═══ WHAT THIS SUITE IS ACTUALLY GUARDING ═════════════════════════════════
 *
 * The seven notification types come from a shared zod enum, and each one needs
 * a catalog entry in two languages. Three separate things can drift — the enum,
 * the English catalog, the Arabic catalog — and every drift produces the same
 * symptom: a bell row rendering a raw key like
 * `notifications:sentence.due_soon`. So the exhaustiveness is driven by
 * `notificationTypeSchema.options`, not by a hand-written list: adding an
 * eighth type fails here on the day it is added.
 *
 * A REAL i18next INSTANCE, not a stub: the failure mode being tested is
 * "i18next cannot resolve this key", which a hand-rolled lookup would not
 * reproduce. Its own instance rather than the app's, because the app's loads
 * Arabic lazily and a test must not race a dynamic import.
 */

const TYPES: NotificationType[] = notificationTypeSchema.options;

/** A `t` bound to one language. See `notification-sentence.ts` on the cast. */
type RawTranslate = (key: string, options?: Record<string, string>) => unknown;

function translatorFor(lng: 'en' | 'ar'): Translate {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: 'en',
    ns: ['notifications'],
    defaultNS: 'notifications',
    resources: { en: { notifications: en }, ar: { notifications: ar } },
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  const raw = instance.t as unknown as RawTranslate;
  return (key, options) => String(raw(key, options));
}

let english: Translate;
let arabic: Translate;

beforeAll(() => {
  english = translatorFor('en');
  arabic = translatorFor('ar');
});

function makeNotification(type: NotificationType): Notification {
  return {
    id: `id-${type}`,
    recipientId: '22222222-2222-4222-8222-222222222222',
    type,
    payload: {
      taskId: '33333333-3333-4333-8333-333333333333',
      taskKey: 'FLOW-142',
      taskTitle: 'Rebalance fractional ranks',
      projectKey: 'FLOW',
      orgSlug: 'acme',
      actorName: 'Ada Lovelace',
      sprintName: 'Sprint 9',
    },
    readAt: null,
    createdAt: '2026-03-02T10:00:00.000Z',
  };
}

describe('the sentence map', () => {
  it('covers every type in the shared enum', () => {
    expect(Object.keys(SENTENCE_KEYS).sort()).toEqual([...TYPES].sort());
  });

  it.each(TYPES)('resolves `%s` to English prose, not to its key', (type) => {
    const sentence = notificationSentence(makeNotification(type), english);
    expect(sentence).not.toContain('notifications:');
    expect(sentence).not.toContain('{{');
    expect(sentence.length).toBeGreaterThan(3);
  });

  it.each(TYPES)('resolves `%s` to Arabic, not to the English string', (type) => {
    const notification = makeNotification(type);
    const arabicSentence = notificationSentence(notification, arabic);
    expect(arabicSentence).not.toContain('notifications:');
    expect(arabicSentence).not.toContain('{{');
    expect(arabicSentence).not.toBe(notificationSentence(notification, english));
    // Arabic script, not a Latin fallback that happened to differ.
    expect(arabicSentence).toMatch(/\p{Script=Arabic}/u);
  });

  it('names the actor and the task key in the sentence', () => {
    expect(notificationSentence(makeNotification('comment_added'), english)).toBe(
      'Ada Lovelace commented on FLOW-142',
    );
  });

  it('falls back to translated stand-ins for a sparse snapshot', () => {
    const sparse: Notification = { ...makeNotification('comment_added'), payload: {} };
    expect(notificationSentence(sparse, english)).toBe('Someone commented on a task');
    expect(notificationSentence(sparse, arabic)).toContain('أحدهم');
  });

  it('uses the task title when the snapshot has no key', () => {
    const noKey: Notification = {
      ...makeNotification('mentioned'),
      payload: { taskTitle: 'Rebalance fractional ranks', actorName: 'Grace' },
    };
    expect(notificationSentence(noKey, english)).toBe(
      'Grace mentioned you in Rebalance fractional ranks',
    );
  });
});

describe('notificationDetail', () => {
  it('prefers the comment excerpt over the task title', () => {
    const withComment: Notification = {
      ...makeNotification('comment_added'),
      payload: { taskTitle: 'A title', commentExcerpt: 'Looks good to me' },
    };
    expect(notificationDetail(withComment)).toBe('Looks good to me');
  });

  it('is an empty string when the row carries neither', () => {
    expect(notificationDetail({ ...makeNotification('due_soon'), payload: {} })).toBe('');
  });
});

describe('grouping by day', () => {
  function at(createdAt: string, id: string): Notification {
    return { ...makeNotification('comment_added'), id, createdAt };
  }

  it('buckets consecutive rows and preserves their order', () => {
    // Local noon, so the bucket cannot slide across a date boundary in any zone.
    const groups = groupByDay([
      at('2026-03-02T12:00:00', 'a'),
      at('2026-03-02T09:00:00', 'b'),
      at('2026-03-01T12:00:00', 'c'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['c']);
  });

  it('groups an empty list into nothing', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('buckets an unparseable timestamp rather than throwing', () => {
    expect(notificationDay(at('not-a-date', 'x'))).toBe('');
  });
});

describe('dayHeading', () => {
  const now = new Date(2026, 2, 10, 15, 0, 0);

  it('says Today and Yesterday in both languages', () => {
    expect(dayHeading('2026-03-10', english, 'en-US', now)).toBe('Today');
    expect(dayHeading('2026-03-09', english, 'en-US', now)).toBe('Yesterday');
    expect(dayHeading('2026-03-10', arabic, 'ar-u-nu-latn', now)).toBe('اليوم');
  });

  it('formats an older day with Intl', () => {
    expect(dayHeading('2026-02-14', english, 'en-US', now)).toBe('Feb 14, 2026');
  });

  it('returns the raw bucket for a malformed day', () => {
    expect(dayHeading('', english, 'en-US', now)).toBe('');
  });
});
