import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { startSprintInputSchema, type Sprint, type Status } from '@flowboard/shared';

import { getIntlLocale, useLang } from '@/lib/lang-policy';
import { useBacklogBucket } from '@/hooks/useTasks';
import { useStartSprint } from '@/hooks/useSprints';
import FormDialog from '@/components/common/FormDialog';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { addDaysIso, todayIso } from '@/components/backlog/backlog-dates';
import { doneStatusIds, formatPoints, summarizePoints } from '@/components/backlog/backlog-points';

/**
 * Start a sprint: two dates, and the commitment those dates are attached to.
 *
 * ── Why the scope is shown here and nowhere else ────────────────────────────
 * `POST /sprints/:id/start` stamps `committedPoints` from whatever is in scope
 * at that instant, and that stamp is IMMUTABLE — it is the denominator of every
 * velocity figure the team will plan against for the rest of the project. So the
 * number being committed to is on screen, above the button, at the one moment it
 * can still be changed by closing this dialog and dragging something out.
 *
 * ── The one-active-sprint conflict ──────────────────────────────────────────
 * A project may have at most one running sprint, enforced by a partial unique
 * index, so this request can come back 409 `SPRINT_ALREADY_ACTIVE` even though
 * the button was enabled — another planner may have started theirs a second
 * ago. `useStartSprint` already routes that through the shared
 * `code → catalog` toast (`errors:sprint_already_active`), and the dialog stays
 * OPEN on failure: the dates are still typed, and the fix is to complete the
 * other sprint, not to retype these.
 *
 * ── Two weeks, because someone has to say a number ──────────────────────────
 * The default range is the sprint's own planned dates when it has them, and
 * today + 13 days when it does not — a fortnight counted inclusively, which is
 * what a "two-week sprint" means on a calendar.
 */

type StartValues = z.input<typeof startSprintInputSchema>;

const DEFAULT_LENGTH_DAYS = 13;

export function StartSprintDialog({
  projectId,
  sprint,
  statuses,
  open,
  onOpenChange,
}: {
  projectId: string;
  sprint: Sprint;
  statuses: readonly Status[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['backlog', 'common']);
  useLang();
  const locale = getIntlLocale();

  const bucket = useBacklogBucket(projectId, sprint.id);
  const startSprint = useStartSprint(projectId);

  const summary = useMemo(
    () => summarizePoints(bucket.data ?? [], doneStatusIds(statuses)),
    [bucket.data, statuses],
  );

  const form = useForm<StartValues>({
    resolver: zodResolver(startSprintInputSchema),
    defaultValues: (() => {
      const start = sprint.startDate ?? todayIso();
      return {
        startDate: start,
        endDate: sprint.endDate ?? addDaysIso(start, DEFAULT_LENGTH_DAYS),
      };
    })(),
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = (values: StartValues) => {
    startSprint.mutate(
      { sprintId: sprint.id, ...startSprintInputSchema.parse(values) },
      {
        onSuccess: () => {
          toast.success(t('backlog:start.started', { name: sprint.name }));
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('backlog:start.title', { name: sprint.name })}
      description={t('backlog:start.description')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={t('backlog:start.confirm')}
      isPending={startSprint.isPending}
      className="max-w-md"
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="startDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('backlog:form.startDate')}</FormLabel>
              <FormControl>
                {/* `type="date"` reads and writes `YYYY-MM-DD` — the wire format
                    itself, so no `Date` is built anywhere in this flow. */}
                <Input {...field} type="date" autoFocus />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="endDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('backlog:form.endDate')}</FormLabel>
              <FormControl>
                <Input {...field} type="date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div
        data-slot="start-scope"
        className="rounded-[var(--radius)] border border-border bg-surface-raised p-3"
      >
        <p className="text-xs font-medium text-foreground">{t('backlog:start.scope')}</p>

        {bucket.isPending ? (
          <Skeleton className="mt-2 h-4 w-40" />
        ) : summary.count === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('backlog:start.empty')}</p>
        ) : (
          <dl className="mt-2 flex items-center gap-6">
            <div>
              <dt className="text-[11px] text-muted-foreground">{t('backlog:summary.tasks')}</dt>
              <dd className="text-sm font-medium text-foreground">
                {new Intl.NumberFormat(locale).format(summary.count)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t('backlog:summary.storyPoints')}
              </dt>
              <dd className="text-sm font-medium text-foreground">
                {formatPoints(summary.totalPoints, locale)}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </FormDialog>
  );
}

export default StartSprintDialog;
