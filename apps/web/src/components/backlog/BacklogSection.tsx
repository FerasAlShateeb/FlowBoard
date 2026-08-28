import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronRight, Loader2, Plus, Search, X } from 'lucide-react';
import { createTaskInputSchema } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useBacklogBucket } from '@/hooks/useTasks';
import { useCreateTask } from '@/hooks/useTaskMutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BACKLOG_SECTION_ID } from '@/components/backlog/backlog-collapse';
import { bucketDroppableId } from '@/components/backlog/backlog-dnd';
import { doneStatusIds, summarizePoints } from '@/components/backlog/backlog-points';
import PointsSummaryChips from '@/components/backlog/PointsSummaryChips';
import TaskRowList, { type BacklogRowContext } from '@/components/backlog/TaskRowList';

/**
 * The backlog proper — the `sprintId: null` bucket, plus the two things only it
 * has: a text filter and an inline create.
 *
 * ── The filter is CLIENT-SIDE, and that is deliberate ───────────────────────
 * Sending it as a `q` param would change the query key of every bucket on the
 * page (one filter object feeds them all, and `useRankTask` splices by that same
 * key), so a filter meant to narrow the backlog would quietly empty the sprints
 * too. Narrowing the rendered rows instead keeps the sprints untouched — and
 * costs nothing in correctness, because the drag mapping reads the COMPLETE
 * cached lists, not what is on screen: dropping between two visible rows that
 * have a filtered-out row between them still ranks exactly where it landed.
 *
 * ── Quick-add is not optimistic ─────────────────────────────────────────────
 * A new task has no id, no `FLOW-142` and no rank until the server allocates
 * them, so `useCreateTask` waits (see its own note). The field clears on
 * SUCCESS, not on submit: a failed create that had already wiped the title
 * would have cost the user the sentence they typed.
 */
export function BacklogSection({
  projectId,
  context,
  isCollapsed,
  onToggle,
}: {
  projectId: string;
  context: BacklogRowContext;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation(['backlog', 'common']);

  const bucket = useBacklogBucket(projectId, null);
  const createTask = useCreateTask(projectId);
  const { setNodeRef, isOver } = useDroppable({ id: bucketDroppableId(null) });

  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');

  const tasks = useMemo(() => bucket.data ?? [], [bucket.data]);
  const doneIds = useMemo(() => doneStatusIds(context.statuses), [context.statuses]);
  // The chips describe the WHOLE bucket, not the filtered view: "how big is the
  // backlog" is not a question the search box should be able to change.
  const summary = useMemo(() => summarizePoints(tasks, doneIds), [tasks, doneIds]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (needle.length === 0) return tasks;
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(needle) ||
        `${context.projectKey}-${task.number}`.toLowerCase().includes(needle),
    );
  }, [tasks, needle, context.projectKey]);

  const submitDraft = () => {
    const title = draft.trim();
    if (title.length === 0 || createTask.isPending) return;

    // Parsed through the shared schema rather than hand-built: that is what
    // supplies every default the contract declares (type, priority, empty label
    // and watcher lists) instead of this call site guessing them.
    const input = createTaskInputSchema.parse({ title, sprintId: null });

    createTask.mutate(input, {
      onSuccess: (task) => {
        toast.success(t('backlog:quickAdd.created', { key: task.key }));
        setDraft('');
      },
    });
  };

  return (
    <section
      data-slot="backlog-section"
      className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface"
    >
      <div
        ref={isCollapsed ? setNodeRef : undefined}
        className={cn(
          'flex flex-wrap items-center gap-2 bg-surface-raised/60 px-2 py-1.5',
          isCollapsed && isOver && 'bg-brand-accent/16',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? t('backlog:actions.expand') : t('backlog:actions.collapse')}
          onClick={onToggle}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'transition-transform duration-[var(--speed)]',
              isCollapsed ? 'rtl:-rotate-180' : 'rotate-90',
            )}
          />
        </Button>

        <span className="px-1 text-sm font-medium text-foreground">
          {t('backlog:sections.backlog')}
        </span>

        <div className="relative w-48">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            type="search"
            aria-label={t('backlog:filter.label')}
            placeholder={t('backlog:filter.placeholder')}
            className="h-6 ps-7 pe-6 text-xs"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label={t('backlog:filter.clear')}
              className="absolute end-1 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              onClick={() => {
                setQuery('');
              }}
            >
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="ms-auto">
          <PointsSummaryChips summary={summary} />
        </div>
      </div>

      {isCollapsed ? null : (
        <>
          {context.canWrite ? (
            <form
              className="flex items-center gap-1.5 border-b border-border px-2 py-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                submitDraft();
              }}
            >
              <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                value={draft}
                className="h-7 flex-1 text-sm"
                aria-label={t('backlog:quickAdd.label')}
                placeholder={t('backlog:quickAdd.placeholder')}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
              <Button
                type="submit"
                size="xs"
                variant="secondary"
                disabled={draft.trim().length === 0 || createTask.isPending}
              >
                {createTask.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('backlog:quickAdd.submit')}
              </Button>
            </form>
          ) : null}

          <TaskRowList
            sprintId={null}
            tasks={visible}
            isPending={bucket.isPending}
            error={bucket.error}
            onRetry={() => {
              void bucket.refetch();
            }}
            emptyMessage={
              needle.length > 0
                ? t('backlog:sections.noMatches')
                : t('backlog:sections.emptyBacklog')
            }
            emptyHint={needle.length > 0 ? undefined : t('backlog:sections.emptyBacklogHint')}
            dropRef={setNodeRef}
            isOver={isOver}
            context={context}
          />
        </>
      )}
    </section>
  );
}

/** Re-exported so the page can key its collapse state without a magic string. */
export { BACKLOG_SECTION_ID };

export default BacklogSection;
