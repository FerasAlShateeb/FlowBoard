import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import type { Notification } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import {
  BELL_ROW_COUNT,
  flattenNotifications,
  notificationHref,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/hooks/useNotifications';
import NotificationRow from '@/components/notifications/NotificationRow';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The topbar bell: an icon button, an unread badge, and the latest few rows.
 *
 * ═══ WHY THE DROPDOWN IS A POPOVER, NOT A MENU ════════════════════════════
 *
 * A Radix `DropdownMenu` puts its items in the roving-tabindex menu pattern,
 * where every item is a menuitem and arrow keys move between them. That is the
 * right model for a list of COMMANDS and the wrong one for a list of CONTENT
 * with a footer of two buttons — the footer would become two more menu items,
 * and "Mark all as read" would close the menu it is trying to update. A popover
 * keeps ordinary tab order and lets the rows be ordinary buttons.
 *
 * ═══ THE BADGE ═══════════════════════════════════════════════════════════
 *
 * Capped at 99+ because the topbar is 48px tall and a four-digit badge would
 * push the bar's layout around. The count is never left to the glyph alone: the
 * button's accessible name carries the number
 * ("Notifications, unread: 3"), which is the only version a screen reader gets.
 */

/** The badge's display cap. Above this, the exact number stops being useful. */
const BADGE_CAP = 99;

export function NotificationBell() {
  const { t } = useTranslation(['notifications']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useUnreadCount();
  // Only fetched while the popover is open — the badge is what the closed bell
  // shows, and it has its own one-number endpoint.
  const list = useNotifications(false, BELL_ROW_COUNT);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const rows = flattenNotifications(list.data).slice(0, BELL_ROW_COUNT);

  const openRow = (notification: Notification) => {
    if (notification.readAt === null) markRead.mutate(notification.id);
    setOpen(false);
    void navigate(notificationHref(notification));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="notification-bell"
          aria-label={t('notifications:bell.unreadLabel', { count: unreadCount })}
          className="relative inline-flex size-7 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Bell className="size-4" aria-hidden />
          {unreadCount > 0 ? (
            <span
              aria-hidden
              data-testid="notification-badge"
              className={cn(
                'absolute -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground',
                // Logical inset: the badge sits on the reading-END corner, so it
                // mirrors with the rest of the bar under RTL.
                '-end-0.5',
              )}
            >
              {unreadCount > BADGE_CAP ? t('notifications:bell.overflow') : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-medium text-foreground">{t('notifications:bell.heading')}</p>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px]"
              disabled={markAllRead.isPending}
              onClick={() => {
                markAllRead.mutate();
              }}
            >
              <CheckCheck className="size-3" aria-hidden />
              {t('notifications:actions.markAllRead')}
            </Button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {list.isPending ? t('notifications:states.loading') : t('notifications:bell.empty')}
            </p>
          ) : (
            rows.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onOpen={openRow}
                compact
              />
            ))
          )}
        </div>

        <div className="border-t border-border p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-center text-xs"
            onClick={() => {
              setOpen(false);
              void navigate('/notifications');
            }}
          >
            {t('notifications:bell.viewAll')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
