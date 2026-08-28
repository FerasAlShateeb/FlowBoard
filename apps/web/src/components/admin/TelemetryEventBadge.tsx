import { useTranslation } from 'react-i18next';
import type { TelemetryEventType } from '@flowboard/shared';

import { Badge } from '@/components/ui/badge';

/**
 * One event type, as a tinted chip.
 *
 * ── COLOUR ENCODES THE KIND OF EVENT, NOT THE EVENT ─────────────────────────
 * Twelve distinct hues would be a colour key nobody memorises. The twelve types
 * collapse into four FAMILIES a reader can learn in one glance and then use to
 * skim a hundred rows:
 *
 *     session   (auth_login, page_view)                      → info
 *     write     (task_created, task_moved, comment_added,
 *                sprint_started)                             → primary
 *     complete  (task_completed, sprint_completed)           → success
 *     passive   (search_performed, notification_opened,
 *                theme_changed, export_csv)                  → neutral
 *
 * The distinction that actually matters when scanning the feed is "did somebody
 * change something", and the write/complete pair is what answers it.
 *
 * ── THE LABEL IS TRANSLATED, THE TYPE IS NOT ────────────────────────────────
 * The chip shows a localized phrase; the raw `type` stays in the `title` so an
 * admin comparing the UI against a SQL query or a log line has the exact string
 * to search for.
 */

type EventFamily = 'session' | 'write' | 'complete' | 'passive';

const FAMILY: Readonly<Record<TelemetryEventType, EventFamily>> = {
  auth_login: 'session',
  page_view: 'session',
  task_created: 'write',
  task_moved: 'write',
  comment_added: 'write',
  sprint_started: 'write',
  task_completed: 'complete',
  sprint_completed: 'complete',
  search_performed: 'passive',
  notification_opened: 'passive',
  theme_changed: 'passive',
  export_csv: 'passive',
};

const VARIANT: Readonly<
  Record<EventFamily, 'soft-info' | 'soft-primary' | 'soft-success' | 'secondary'>
> = {
  session: 'soft-info',
  write: 'soft-primary',
  complete: 'soft-success',
  passive: 'secondary',
};

/**
 * The localized name of an event type.
 *
 * A `switch` over literal keys rather than `t('admin:eventType.' + type)`:
 * a template string type-checks as `string` and silently opts out of the
 * catalog's compile-time key checking, which is the entire reason the locale
 * files are TypeScript modules rather than JSON.
 */
export function useEventTypeLabel(): (type: TelemetryEventType) => string {
  const { t } = useTranslation(['admin']);

  return (type) => {
    switch (type) {
      case 'auth_login':
        return t('admin:eventType.auth_login');
      case 'page_view':
        return t('admin:eventType.page_view');
      case 'task_created':
        return t('admin:eventType.task_created');
      case 'task_moved':
        return t('admin:eventType.task_moved');
      case 'task_completed':
        return t('admin:eventType.task_completed');
      case 'sprint_started':
        return t('admin:eventType.sprint_started');
      case 'sprint_completed':
        return t('admin:eventType.sprint_completed');
      case 'comment_added':
        return t('admin:eventType.comment_added');
      case 'search_performed':
        return t('admin:eventType.search_performed');
      case 'notification_opened':
        return t('admin:eventType.notification_opened');
      case 'theme_changed':
        return t('admin:eventType.theme_changed');
      default:
        return t('admin:eventType.export_csv');
    }
  };
}

export function TelemetryEventBadge({ type }: { type: TelemetryEventType }) {
  const label = useEventTypeLabel();

  return (
    <Badge variant={VARIANT[FAMILY[type]]} title={type} data-event-type={type}>
      {label(type)}
    </Badge>
  );
}

export default TelemetryEventBadge;
