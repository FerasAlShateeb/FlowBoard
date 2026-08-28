import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ticket } from 'lucide-react';

import { useProjectScope } from '@/hooks/useProjects';
import { useTaskByKey } from '@/hooks/useTasks';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';

/**
 * The ROUTE-LAYERED task sheet.
 *
 * `/…/board/t/FB-142` renders the board underneath AND this sheet on top,
 * because the route is a CHILD of the view route rather than a sibling. That is
 * what makes a task link deep-linkable and shareable while still feeling like an
 * overlay: pasting the URL loads the board first and then opens the panel, and
 * closing it returns to the view with its scroll position, its filters and its
 * cached data intact.
 *
 * ── Closing is `navigate('..')`, not `navigate(-1)` ─────────────────────────
 *
 * A relative `..` resolves against the ROUTE, not the history stack, so it lands
 * on the parent view whether the user arrived by clicking a card (one entry
 * back) or by pasting the URL into a fresh tab (no entry back at all). `-1` is
 * correct only in the first case; in the second it walks out of the app
 * entirely. `replace` keeps the sheet out of the history a second time, so a
 * back-button press after closing does not reopen it.
 *
 * ── The key is the address ──────────────────────────────────────────────────
 *
 * `useTaskByKey` takes the FULL human key (`FLOW-142`) — the same string the URL
 * carries, uppercased by the hook — because that is what a person copies out of
 * a chat window. The result is also written to `qk.task.detail(id)`, so a deep
 * link and a board card share one cache entry rather than fetching twice.
 *
 * ── The three states, all inside the sheet ──────────────────────────────────
 *
 * Loading is a skeleton IN the panel rather than a spinner over the page: the
 * sheet is already open (it opens on mount), and a full-page loader would hide
 * the view the sheet is deliberately layered over. A 404 — a deleted task, or a
 * key from another project — is an error state with a way back, not a redirect;
 * silently bouncing to the board leaves the user wondering whether they mistyped.
 */
export default function TaskSheetPage() {
  const { taskKey = '' } = useParams<{ taskKey: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['tasks', 'common']);

  const { orgId, projectId, projectKey, role } = useProjectScope();
  const { data: task, isPending, error, refetch } = useTaskByKey(projectId, taskKey);

  /**
   * Back to the parent view — see the header note on why `..` and not `-1`.
   *
   * ROUTE-relative (the default), NOT `relative: 'path'`. Path-relative `..`
   * strips ONE URL segment, and this route owns two of them (`t/:taskKey`), so
   * it would land on `/…/board/t` — a URL nothing matches. Route-relative `..`
   * means "my parent route", which is the board however many segments it took.
   */
  const close = useCallback(() => {
    void navigate('..', { replace: true });
  }, [navigate]);

  /**
   * Navigating between tasks (a subtask row, a dependency) REPLACES the sheet's
   * entry rather than pushing a new one. Otherwise walking a chain of four
   * dependencies would leave four entries between the user and the board they
   * came from.
   */
  const openTask = useCallback(
    (nextKey: string) => {
      // `../t/<key>`, route-relative: `..` is the parent VIEW route, and the
      // sheet's own `t/` segment is re-added — the same reasoning as `close`.
      void navigate(`../t/${nextKey}`, { replace: true });
    },
    [navigate],
  );

  /**
   * The absolute deep link the header's copy button puts on the clipboard.
   *
   * Built from `window.location` rather than a configured base URL: the link has
   * to work for whoever receives it, which means the host the user is actually
   * on — the same reasoning `inviteLink()` documents.
   */
  const taskUrl = typeof window === 'undefined' ? '' : window.location.href;

  return (
    <Sheet
      // Open on mount and stay open: the ROUTE is the open state, so there is
      // nothing to toggle — only to navigate away from.
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent
        side="end"
        aria-label={t('tasks:sheet.label')}
        // Wider than the primitive's `max-w-md` default: this panel carries a
        // description, a fields column and a comment thread side by side.
        className="w-full gap-4 sm:max-w-[40rem]"
      >
        {isPending ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono" dir="ltr">
                {taskKey}
              </SheetTitle>
              <SheetDescription>{t('tasks:sheet.loading')}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-3" aria-busy>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          </>
        ) : error !== null || task === undefined ? (
          <>
            {/* A dialog owes a title and a description even in its error state —
                without them Radix has nothing to announce the panel by. */}
            <SheetHeader className="sr-only">
              <SheetTitle>{t('tasks:sheet.label')}</SheetTitle>
              <SheetDescription>{t('tasks:sheet.notFoundBody')}</SheetDescription>
            </SheetHeader>
            {error === null ? (
              <EmptyState
                icon={<Ticket className="size-4" />}
                title={t('tasks:sheet.notFoundTitle')}
                message={t('tasks:sheet.notFoundBody')}
                action={
                  <Button variant="outline" size="sm" onClick={close}>
                    {t('tasks:sheet.backToView')}
                  </Button>
                }
              />
            ) : (
              <ErrorState
                error={error}
                title={t('tasks:sheet.notFoundTitle')}
                onRetry={() => {
                  void refetch();
                }}
              />
            )}
          </>
        ) : (
          <>
            {/* The visible identity lives in `TaskHeaderBar`; this header is the
                accessible name Radix requires, kept off-screen so the panel is
                not titled twice. */}
            <SheetHeader className="sr-only">
              <SheetTitle>{`${task.key} ${task.title}`}</SheetTitle>
              <SheetDescription>{t('tasks:sheet.label')}</SheetDescription>
            </SheetHeader>

            <TaskDetailPanel
              task={task}
              orgId={orgId}
              projectId={projectId ?? task.projectId}
              projectKey={projectKey || task.projectKey}
              role={role}
              taskUrl={taskUrl}
              onOpenTask={openTask}
              onClose={close}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Re-exported so a caller can build a task deep link without re-deriving it. */
export function taskSheetPath(orgSlug: string, projectKey: string, view: string, taskKey: string) {
  return `/o/${orgSlug}/p/${projectKey}/${view}/t/${taskKey}`;
}
