import type { Notification, NotificationType } from '@flowboard/shared';

/**
 * The row's sentence — the only place a notification turns into words.
 *
 * ═══ WHY IT IS A PURE FUNCTION AND NOT JSX ════════════════════════════════
 *
 * Three surfaces render the same sentence: the bell dropdown, the notification
 * centre, and the accessible name of the row's link. Building it in a component
 * would mean either three copies or a component nobody can call from an
 * `aria-label`. As a function of `(notification, t)` it is one implementation,
 * testable in both languages without a DOM.
 *
 * ═══ EVERY VALUE HAS A FALLBACK ═══════════════════════════════════════════
 *
 * The payload is a SNAPSHOT and every field in it is optional: a row written
 * before a field existed, or one whose actor has since been deleted, still has
 * to read as a sentence. So `actor`, `task` and `sprint` each fall back to a
 * translated stand-in rather than interpolating `undefined` into the middle of
 * a line.
 */

/**
 * The minimal `t` shape this module needs.
 *
 * i18next's own `TFunction` is generic over the key union, so a helper that
 * takes it cannot be called with a computed key. The house pattern (see
 * `i18n/errors.ts`) is this narrow alias plus a cast at the call site — which
 * keeps the KEYS themselves checked, because they are declared here as
 * literals in an exhaustive record.
 */
export type Translate = (key: string, options?: Record<string, string>) => string;

/**
 * Type → catalog key, exhaustively.
 *
 * `Record<NotificationType, string>` is what makes an eighth notification type
 * a COMPILE error here rather than a row that renders its own key at runtime.
 */
export const SENTENCE_KEYS: Record<NotificationType, string> = {
  task_assigned: 'notifications:sentence.task_assigned',
  mentioned: 'notifications:sentence.mentioned',
  status_changed: 'notifications:sentence.status_changed',
  comment_added: 'notifications:sentence.comment_added',
  sprint_started: 'notifications:sentence.sprint_started',
  sprint_completed: 'notifications:sentence.sprint_completed',
  due_soon: 'notifications:sentence.due_soon',
};

/** The interpolation values, fallbacks already applied. */
export function sentenceValues(
  notification: Notification,
  t: Translate,
): { actor: string; task: string; sprint: string } {
  const { actorName, taskKey, taskTitle, sprintName } = notification.payload;
  return {
    actor: actorName ?? t('notifications:fallback.someone'),
    // The KEY, not the title: it is short, unique and the thing a reader
    // recognises. The title gets its own line underneath.
    task: taskKey ?? taskTitle ?? t('notifications:fallback.aTask'),
    sprint: sprintName ?? t('notifications:fallback.aSprint'),
  };
}

/** The one-line sentence a row shows. */
export function notificationSentence(notification: Notification, t: Translate): string {
  return t(SENTENCE_KEYS[notification.type], sentenceValues(notification, t));
}

/**
 * The optional second line: a comment excerpt when there is one, otherwise the
 * task's title. Empty string when the row carries neither — the caller renders
 * nothing rather than an empty element.
 */
export function notificationDetail(notification: Notification): string {
  return notification.payload.commentExcerpt ?? notification.payload.taskTitle ?? '';
}

/**
 * Day bucket for a notification, as `YYYY-MM-DD` in the reader's LOCAL zone.
 *
 * Local, because "Today" has to mean the reader's today — grouping on the UTC
 * date would file a 2am notification under yesterday for anyone east of
 * Greenwich. Returns `''` for an unparseable instant so a bad row falls into
 * one bucket instead of crashing the group pass.
 */
export function notificationDay(notification: Notification): string {
  const date = new Date(notification.createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

/** A day bucket with its rows, newest bucket first. */
export interface NotificationGroup {
  day: string;
  items: Notification[];
}

/**
 * Groups an ALREADY-SORTED list into consecutive day buckets.
 *
 * Consecutive, not keyed: the server hands back newest-first, so a single pass
 * that starts a new bucket whenever the day changes preserves that order
 * exactly. A `Map` keyed by day would too, but only by accident — and would
 * silently merge two runs of the same day if the order ever changed.
 */
export function groupByDay(items: readonly Notification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const item of items) {
    const day = notificationDay(item);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/**
 * A day bucket's heading: "Today", "Yesterday", or a formatted date.
 *
 * `today` is a parameter so the function stays pure and a test can pin the day
 * without mocking the clock.
 */
export function dayHeading(
  day: string,
  t: Translate,
  locale: string,
  now: Date = new Date(),
): string {
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(todayDate.getTime() - 86_400_000);
  const asIso = (date: Date): string =>
    `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;

  if (day === asIso(todayDate)) return t('notifications:groups.today');
  if (day === asIso(yesterday)) return t('notifications:groups.yesterday');

  const [year, month, date] = day.split('-').map(Number);
  if (year === undefined || month === undefined || date === undefined) return day;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, date));
}
