import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Notification } from '@flowboard/shared';

import { intlLocaleFor, useLang } from '@/lib/lang-policy';
import {
  flattenNotifications,
  notificationHref,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/hooks/useNotifications';
import {
  dayHeading,
  groupByDay,
  type Translate,
} from '@/components/notifications/notification-sentence';
import NotificationRow from '@/components/notifications/NotificationRow';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * `/notifications` — the notification centre, and the bell's "View all" target.
 *
 * ═══ TABS, NOT A FILTER BAR ═══════════════════════════════════════════════
 *
 * There are exactly two views (All / Unread) and they are mutually exclusive,
 * which is the definition of a tab strip. Each tab is its OWN infinite query
 * (`qk.notifications.list(unreadOnly)`), so switching back and forth does not
 * refetch, and marking a row read does not renumber the pages of the list you
 * are not looking at.
 *
 * ═══ GROUPED BY DAY, HEADINGS FROM `Intl` ═════════════════════════════════
 *
 * "Today" / "Yesterday" / a formatted date, computed in the reader's LOCAL zone
 * — see `notification-sentence.ts`. The grouping is a single pass over an
 * already-sorted list, so the server stays the only authority on order.
 *
 * ═══ THE THREE STATES ═════════════════════════════════════════════════════
 *
 * Loading, empty and error are all real (project checklist §B), and the empty
 * state differs per tab: an empty All list means "nothing has happened yet",
 * while an empty Unread list means "you are caught up" — opposite feelings that
 * deserve opposite words.
 */
export default function NotificationsPage() {
  const { t } = useTranslation(['notifications']);
  const translate = t as Translate;
  const navigate = useNavigate();
  const lang = useLang();
  const locale = intlLocaleFor(lang);

  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useNotifications(unreadOnly);
  const { data: unreadCount = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = flattenNotifications(query.data);
  const groups = groupByDay(items);

  const openRow = (notification: Notification) => {
    if (notification.readAt === null) markRead.mutate(notification.id);
    void navigate(notificationHref(notification));
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title={t('notifications:title')}
        description={t('notifications:description')}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={unreadCount === 0 || markAllRead.isPending}
            data-testid="mark-all-read"
            onClick={() => {
              markAllRead.mutate(undefined, {
                onSuccess: () => {
                  toast(t('notifications:markedAllRead'));
                },
              });
            }}
          >
            <CheckCheck aria-hidden />
            {t('notifications:actions.markAllRead')}
          </Button>
        }
      >
        <Tabs
          value={unreadOnly ? 'unread' : 'all'}
          onValueChange={(value) => {
            setUnreadOnly(value === 'unread');
          }}
        >
          <TabsList>
            <TabsTrigger value="all">{t('notifications:tabs.all')}</TabsTrigger>
            <TabsTrigger value="unread">{t('notifications:tabs.unread')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>

      {query.isError ? (
        <ErrorState
          error={query.error}
          title={t('notifications:states.errorTitle')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : query.isPending ? (
        <p className="px-2 py-10 text-center text-xs text-muted-foreground">
          {t('notifications:states.loading')}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-4" />}
          title={t(
            unreadOnly
              ? 'notifications:states.emptyUnreadTitle'
              : 'notifications:states.emptyTitle',
          )}
          message={t(
            unreadOnly ? 'notifications:states.emptyUnreadBody' : 'notifications:states.emptyBody',
          )}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.day} aria-label={dayHeading(group.day, translate, locale)}>
              <h2 className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {dayHeading(group.day, translate, locale)}
              </h2>
              <div className="flex flex-col rounded-[var(--radius)] border border-border bg-surface-raised/40 p-1">
                {group.items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={openRow}
                  />
                ))}
              </div>
            </section>
          ))}

          {query.hasNextPage ? (
            <div className="flex justify-center py-2">
              <Button
                variant="outline"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => {
                  void query.fetchNextPage();
                }}
              >
                {query.isFetchingNextPage ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                {t('notifications:actions.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
