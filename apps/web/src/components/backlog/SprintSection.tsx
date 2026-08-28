import { useEffect, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCheck, ChevronRight, Ellipsis, Pencil, Play, Trash2 } from 'lucide-react';
import type { Sprint } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { getIntlLocale, useLang } from '@/lib/lang-policy';
import { useBacklogBucket } from '@/hooks/useTasks';
import { useUpdateSprint } from '@/hooks/useSprints';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { bucketDroppableId } from '@/components/backlog/backlog-dnd';
import { formatDay } from '@/components/backlog/backlog-dates';
import { doneStatusIds, summarizePoints } from '@/components/backlog/backlog-points';
import PointsSummaryChips from '@/components/backlog/PointsSummaryChips';
import TaskRowList, { type BacklogRowContext } from '@/components/backlog/TaskRowList';

/**
 * One sprint, as a collapsible section: header line, chips, actions, rows.
 *
 * ── The section owns its own query ──────────────────────────────────────────
 * `useBacklogBucket` is called HERE rather than in the page, because the number
 * of sprints changes and a page-level loop of hooks would break the rules of
 * hooks the moment a sprint is created. The page reads what it needs for the
 * drag mapping straight out of the query CACHE instead, which is the same data
 * one indirection earlier.
 *
 * ── A collapsed section is still a drop target ──────────────────────────────
 * Folding a sprint away is how a planner makes room, and "drag this into the
 * sprint I am not currently looking at" is the move that follows. So the section
 * registers ONE droppable and attaches it to whichever element can accept a drop
 * right now: the header when collapsed, the empty placeholder when open and
 * empty, the strip under the last row otherwise. One id, three attachment
 * points, never two at once.
 *
 * ── The rename is inline, the rest is a dialog ──────────────────────────────
 * Renaming is the edit that happens during planning ("Sprint 4" → "Sprint 4 —
 * payments"), and interrupting a planning session with a modal for it is
 * friction. Goals and dates are edited rarely and together, which is exactly
 * what a form dialog is for.
 */
export function SprintSection({
  projectId,
  sprint,
  context,
  isCollapsed,
  onToggle,
  onEdit,
  onStart,
  onComplete,
  onDelete,
}: {
  projectId: string;
  sprint: Sprint;
  context: BacklogRowContext;
  isCollapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onStart: () => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(['backlog', 'common']);
  useLang();
  const locale = getIntlLocale();

  const bucket = useBacklogBucket(projectId, sprint.id);
  const updateSprint = useUpdateSprint(projectId);

  const { setNodeRef, isOver } = useDroppable({ id: bucketDroppableId(sprint.id) });

  const tasks = useMemo(() => bucket.data ?? [], [bucket.data]);
  const doneIds = useMemo(() => doneStatusIds(context.statuses), [context.statuses]);
  const summary = useMemo(() => summarizePoints(tasks, doneIds), [tasks, doneIds]);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sprint.name);
  const nameRef = useRef<HTMLInputElement>(null);

  // Re-seed from the server: another planner's rename, or this one's own
  // mutation resolving with a trimmed value.
  useEffect(() => {
    setName(sprint.name);
  }, [sprint.name]);

  useEffect(() => {
    if (renaming) nameRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    setRenaming(false);
    const next = name.trim();
    if (next.length === 0) {
      // Not a save — a mistake. Put the old name back rather than sending a
      // request `nameSchema` will refuse.
      setName(sprint.name);
      return;
    }
    if (next === sprint.name) return;
    updateSprint.mutate(
      { sprintId: sprint.id, name: next },
      {
        onSuccess: () => {
          toast.success(t('backlog:form.updated'));
        },
        onError: () => {
          setName(sprint.name);
        },
      },
    );
  };

  // The planned range, for every combination of the two nullable days. Built
  // inline rather than in a helper: passing `t` out of a component narrows to
  // `(key: string) => string` and loses the compile-time key checking that is
  // the entire reason the catalogs are TypeScript.
  const startDay = sprint.startDate ? formatDay(sprint.startDate, locale) : null;
  const endDay = sprint.endDate ? formatDay(sprint.endDate, locale) : null;
  const dates =
    startDay && endDay
      ? t('backlog:dates.range', { start: startDay, end: endDay })
      : startDay
        ? t('backlog:dates.startOnly', { start: startDay })
        : endDay
          ? t('backlog:dates.endOnly', { end: endDay })
          : t('backlog:dates.none');

  return (
    <section
      data-slot="sprint-section"
      data-state={sprint.state}
      className={cn(
        'overflow-hidden rounded-[var(--radius)] border bg-surface',
        // The running sprint is the one thing on this page that is not a plan.
        sprint.state === 'active' ? 'border-brand-accent/60' : 'border-border',
      )}
    >
      <div
        // The header doubles as the drop target while the section is folded.
        ref={isCollapsed ? setNodeRef : undefined}
        className={cn(
          'flex flex-wrap items-center gap-2 px-2 py-1.5',
          sprint.state === 'active' ? 'bg-brand-accent/6' : 'bg-surface-raised/60',
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
              // Pointing at the body: down when open. The closed state points
              // along the reading direction, which is what `rtl:` flips.
              isCollapsed ? 'rtl:-rotate-180' : 'rotate-90',
            )}
          />
        </Button>

        {renaming ? (
          <Input
            ref={nameRef}
            value={name}
            className="h-6 w-48 text-xs"
            aria-label={t('backlog:actions.renameSprint')}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setName(sprint.name);
                setRenaming(false);
              }
            }}
          />
        ) : context.canWrite ? (
          <button
            type="button"
            className="max-w-64 truncate rounded-[var(--radius-sm)] px-1 text-sm font-medium text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            title={t('backlog:actions.renameSprint')}
            onClick={() => {
              setRenaming(true);
            }}
          >
            {sprint.name}
          </button>
        ) : (
          <span className="max-w-64 truncate px-1 text-sm font-medium text-foreground">
            {sprint.name}
          </span>
        )}

        <Badge variant={STATE_VARIANT[sprint.state]}>{t(STATE_KEYS[sprint.state])}</Badge>

        <span className="truncate text-xs text-muted-foreground">{dates}</span>

        <div className="ms-auto flex items-center gap-1">
          <PointsSummaryChips summary={summary} />

          {context.canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={t('backlog:actions.sprintMenu')}>
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {sprint.state === 'planned' ? (
                  <DropdownMenuItem onSelect={onStart}>
                    <Play aria-hidden />
                    {t('backlog:actions.startSprint')}
                  </DropdownMenuItem>
                ) : null}
                {sprint.state === 'active' ? (
                  <DropdownMenuItem onSelect={onComplete}>
                    <CheckCheck aria-hidden />
                    {t('backlog:actions.completeSprint')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil aria-hidden />
                  {t('backlog:actions.editSprint')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 aria-hidden />
                  {t('backlog:actions.deleteSprint')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {sprint.goal ? (
          // `dir="auto"`: a goal is user prose, and a Latin one inside an RTL
          // row had its full stop dragged to the front of the line.
          <p dir="auto" className="w-full truncate ps-7 text-xs text-muted-foreground">
            {sprint.goal}
          </p>
        ) : null}
      </div>

      {isCollapsed ? null : (
        <TaskRowList
          sprintId={sprint.id}
          tasks={tasks}
          isPending={bucket.isPending}
          error={bucket.error}
          onRetry={() => {
            void bucket.refetch();
          }}
          emptyMessage={t('backlog:sections.emptySprint')}
          dropRef={setNodeRef}
          isOver={isOver}
          context={context}
        />
      )}
    </section>
  );
}

/** Literal keys so a catalog rename is a build error, not a blank badge. */
const STATE_KEYS = {
  planned: 'backlog:states.planned',
  active: 'backlog:states.active',
  completed: 'backlog:states.completed',
} as const;

/**
 * Planned is neutral, active is the product's one accent, completed is muted —
 * the same visual grammar the board's status chips use.
 */
const STATE_VARIANT = {
  planned: 'outline',
  active: 'soft-primary',
  completed: 'soft-success',
} as const;

export default SprintSection;
