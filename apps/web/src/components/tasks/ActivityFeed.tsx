import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { Activity, Label as TaskLabel, Sprint, Status } from '@flowboard/shared';

import { useLang } from '@/lib/lang-policy';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelativeTime } from '@/components/tasks/task-dates';
import {
  activityFieldKey,
  activitySentenceKey,
  formatActivityValue,
  type ActivityNameLookup,
} from '@/components/tasks/activity-format';

/**
 * The audit history, one localized sentence per row.
 *
 * ── The sentence map is exhaustive by construction ──────────────────────────
 *
 * `activity-format.ts` holds a catalog key for every member of the closed
 * `activityActionSchema` enum, declared `satisfies Record<ActivityAction, …>` —
 * so an action added to the shared contract without a sentence is a compile
 * error here, not a raw `task.moved_sprint` appearing in prose a user is
 * reading. That is the entire reason the enum is closed.
 *
 * ── Ids become names, and unknown values become JSON ────────────────────────
 *
 * A row's `oldValue`/`newValue` are jsonb: usually a uuid (a status, an
 * assignee, a sprint), sometimes a number or a date, occasionally an array. The
 * {@link ActivityNameLookup} built below resolves the uuids this project knows
 * about; `formatActivityValue` zod-narrows the rest to a primitive and falls
 * back to a capped JSON rendering for anything it does not recognise. A feed
 * that threw on an unexpected shape would take the whole sheet down with it.
 *
 * Both sides substitute `activity.nothing` when they are empty — "changed the
 * due date from nothing to 3 Mar" reads; "changed the due date from  to 3 Mar"
 * looks like a bug.
 */

export interface ActivityFeedProps {
  entries: readonly Activity[];
  /** Everything the id → name lookup can resolve against. */
  statuses: readonly Status[];
  labels: readonly TaskLabel[];
  sprints: readonly Sprint[];
  /** Name lookups for the people this task already names (assignee, reporter). */
  people: readonly { id: string; name: string }[];
  isPending: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function ActivityFeed({
  entries,
  statuses,
  labels,
  sprints,
  people,
  isPending,
  isFetchingMore,
  hasMore,
  onLoadMore,
}: ActivityFeedProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const lang = useLang();

  /**
   * One id → name map for every kind of row a value can point at.
   *
   * They share a namespace safely because all of them are uuids: a collision
   * would mean two different tables minted the same v4 uuid.
   */
  const resolve = useMemo<ActivityNameLookup>(() => {
    const names = new Map<string, string>();
    for (const status of statuses) names.set(status.id, status.name);
    for (const label of labels) names.set(label.id, label.name);
    for (const sprint of sprints) names.set(sprint.id, sprint.name);
    for (const person of people) names.set(person.id, person.name);
    return (id) => names.get(id) ?? null;
  }, [statuses, labels, sprints, people]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">{t('tasks:activity.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2.5">
        {entries.map((entry) => {
          const nothing = t('tasks:activity.nothing');
          const actor = entry.actor?.name ?? t('tasks:activity.system');

          return (
            <li key={entry.id} className="flex items-start gap-2">
              <UserAvatar user={entry.actor} size="xs" label="" className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-xs text-foreground">
                  {t(activitySentenceKey(entry.action), {
                    actor,
                    field: t(activityFieldKey(entry.field)),
                    from: formatActivityValue(entry.oldValue, resolve) ?? nothing,
                    to: formatActivityValue(entry.newValue, resolve) ?? nothing,
                  })}
                </span>
                <time
                  dateTime={entry.createdAt}
                  title={formatDateTime(entry.createdAt, lang)}
                  className="text-[11px] text-muted-foreground"
                >
                  {formatRelativeTime(entry.createdAt, lang)}
                </time>
              </div>
            </li>
          );
        })}
      </ol>

      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={isFetchingMore}
          onClick={onLoadMore}
        >
          {isFetchingMore ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('tasks:activity.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

export default ActivityFeed;
