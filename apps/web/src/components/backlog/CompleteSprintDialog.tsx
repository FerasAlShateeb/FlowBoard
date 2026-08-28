import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { completeSprintInputSchema, type Sprint, type Status } from '@flowboard/shared';

import { getIntlLocale, useLang } from '@/lib/lang-policy';
import { useBacklogBucket } from '@/hooks/useTasks';
import { useCompleteSprint } from '@/hooks/useSprints';
import FormDialog from '@/components/common/FormDialog';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { doneStatusIds, formatPoints, summarizePoints } from '@/components/backlog/backlog-points';

/**
 * Complete a sprint: the result, and where the leftovers go.
 *
 * ── There is no "leave them here" ───────────────────────────────────────────
 * `moveIncompleteTo` is REQUIRED by the contract — `'backlog'` or a planned
 * sprint's id — and that is the whole design: a completed sprint's
 * `completedPoints` is stamped at this moment and never recomputed, so anything
 * still open has to leave, or next month's velocity chart would be describing
 * work that finished after the sprint ended.
 *
 * ── The two figures are the sprint's epitaph ────────────────────────────────
 * Done vs not-done, in both counts and points, computed from the bucket that is
 * already cached. The server stamps its own authoritative `completedPoints` from
 * the same rows a moment later; this is the preview that makes the decision
 * informed rather than blind.
 *
 * ── Only PLANNED sprints are offered as a destination ───────────────────────
 * Not the active one (this IS it) and not a completed one (moving open work into
 * a finished sprint would reopen numbers that are supposed to be final).
 */

type CompleteValues = z.input<typeof completeSprintInputSchema>;

/** The contract's literal for "clear `sprint_id`". */
export const MOVE_TO_BACKLOG = 'backlog';

export function CompleteSprintDialog({
  projectId,
  sprint,
  statuses,
  plannedSprints,
  open,
  onOpenChange,
}: {
  projectId: string;
  sprint: Sprint;
  statuses: readonly Status[];
  /** Candidate destinations for whatever did not finish. */
  plannedSprints: readonly Sprint[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['backlog', 'common']);
  useLang();
  const locale = getIntlLocale();

  const bucket = useBacklogBucket(projectId, sprint.id);
  const completeSprint = useCompleteSprint(projectId);

  const summary = useMemo(
    () => summarizePoints(bucket.data ?? [], doneStatusIds(statuses)),
    [bucket.data, statuses],
  );

  const openCount = summary.count - summary.doneCount;
  const openPoints = Math.round((summary.totalPoints - summary.donePoints) * 100) / 100;

  const form = useForm<CompleteValues>({
    resolver: zodResolver(completeSprintInputSchema),
    // The backlog is the safe default: it is where unfinished work belongs until
    // somebody decides otherwise, and it is the only destination guaranteed to
    // exist.
    defaultValues: { moveIncompleteTo: MOVE_TO_BACKLOG },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = (values: CompleteValues) => {
    completeSprint.mutate(
      { sprintId: sprint.id, ...completeSprintInputSchema.parse(values) },
      {
        onSuccess: () => {
          toast.success(t('backlog:complete.completed', { name: sprint.name }));
          onOpenChange(false);
        },
      },
    );
  };

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('backlog:complete.title', { name: sprint.name })}
      description={t('backlog:complete.description')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={t('backlog:complete.confirm')}
      isPending={completeSprint.isPending}
      className="max-w-md"
    >
      {bucket.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-[var(--radius)] border border-border bg-surface-raised p-3">
            <dt className="text-[11px] text-muted-foreground">{t('backlog:complete.done')}</dt>
            <dd className="text-sm font-medium text-success">
              {number(summary.doneCount)} · {formatPoints(summary.donePoints, locale)}
            </dd>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-surface-raised p-3">
            <dt className="text-[11px] text-muted-foreground">{t('backlog:complete.notDone')}</dt>
            <dd className="text-sm font-medium text-foreground">
              {number(openCount)} · {formatPoints(openPoints, locale)}
            </dd>
          </div>
        </dl>
      )}

      {openCount === 0 && !bucket.isPending ? (
        <p className="text-xs text-muted-foreground">{t('backlog:complete.allDone')}</p>
      ) : null}

      <FormField
        control={form.control}
        name="moveIncompleteTo"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('backlog:complete.moveIncompleteTo')}</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="gap-1.5"
                aria-label={t('backlog:complete.moveIncompleteTo')}
              >
                <label className="flex cursor-default items-center gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5 text-sm">
                  <RadioGroupItem value={MOVE_TO_BACKLOG} />
                  {t('backlog:complete.toBacklog')}
                </label>

                {plannedSprints.map((target) => (
                  <label
                    key={target.id}
                    className="flex cursor-default items-center gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5 text-sm"
                  >
                    <RadioGroupItem value={target.id} />
                    <span className="truncate">{target.name}</span>
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}

export default CompleteSprintDialog;
