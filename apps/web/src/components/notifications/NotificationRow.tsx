import { useTranslation } from 'react-i18next';
import {
  AtSign,
  CalendarClock,
  CircleDot,
  Flag,
  FlagOff,
  MessageSquare,
  UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Notification, NotificationType } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format';
import { intlLocaleFor, useLang } from '@/lib/lang-policy';
import {
  notificationDetail,
  notificationSentence,
  type Translate,
} from '@/components/notifications/notification-sentence';

/**
 * One notification, rendered identically in the bell dropdown and on the
 * notification centre.
 *
 * IT IS A `<button>`, NOT AN `<a>`. Clicking a row does two things — marks it
 * read and navigates — and the mark-read half must happen even when the
 * navigation is to the page you are already on. A link would also invite
 * middle-click-to-open-in-a-tab, which would leave the row unread and the badge
 * wrong. The parent owns both effects and passes one `onOpen`.
 *
 * THE UNREAD TREATMENT IS THREE SIGNALS, not one: a filled dot, a stronger text
 * colour, and a visually-hidden "Unread" word for screen readers. Colour alone
 * fails a colour-blind reader; a dot alone says nothing out loud.
 */

/** Type → glyph. Exhaustive by its `Record` type, like the sentence map. */
const ICONS: Record<NotificationType, LucideIcon> = {
  task_assigned: UserPlus,
  mentioned: AtSign,
  status_changed: CircleDot,
  comment_added: MessageSquare,
  sprint_started: Flag,
  sprint_completed: FlagOff,
  due_soon: CalendarClock,
};

export function NotificationRow({
  notification,
  onOpen,
  compact = false,
}: {
  notification: Notification;
  onOpen: (notification: Notification) => void;
  /** The bell's tighter geometry: one line of detail, smaller type. */
  compact?: boolean;
}) {
  const { t } = useTranslation(['notifications']);
  const translate = t as Translate;
  const lang = useLang();
  const locale = intlLocaleFor(lang);

  const Icon = ICONS[notification.type];
  const unread = notification.readAt === null;
  const sentence = notificationSentence(notification, translate);
  const detail = notificationDetail(notification);

  return (
    <button
      type="button"
      data-testid="notification-row"
      data-unread={unread ? 'true' : 'false'}
      data-type={notification.type}
      onClick={() => {
        onOpen(notification);
      }}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-[var(--radius)] px-2 py-2 text-start transition-colors duration-[var(--speed)]',
        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        unread && 'bg-primary/[0.04]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border',
          unread ? 'bg-primary/12 text-primary' : 'bg-surface-raised text-muted-foreground',
        )}
      >
        <Icon className="size-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-xs',
            unread ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {unread ? <span className="sr-only">{t('notifications:unread')} — </span> : null}
          {sentence}
        </span>
        {detail && !compact ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{detail}</span>
        ) : null}
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {formatRelative(notification.createdAt, locale)}
        </span>
      </span>

      {unread ? (
        <span
          aria-hidden
          data-testid="notification-unread-dot"
          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </button>
  );
}

export default NotificationRow;
