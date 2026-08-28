import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { createSprintInputSchema, updateSprintInputSchema, type Sprint } from '@flowboard/shared';

import { useCreateSprint, useUpdateSprint } from '@/hooks/useSprints';
import FormDialog from '@/components/common/FormDialog';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Create or edit a sprint — one dialog for both, because the fields are
 * identical and the only difference is which endpoint the submit lands on.
 *
 * ── Which schema validates what ─────────────────────────────────────────────
 * The FORM binds `createSprintInputSchema`: it carries the field rules and, more
 * importantly, the cross-field `endDate >= startDate` refinement, and its shape
 * (name required, the rest nullable) is exactly what these four inputs produce
 * in both modes. An edit then re-parses the same values through
 * `updateSprintInputSchema` on the way out, so the PATCH body is checked against
 * ITS own contract — including the "at least one field" rule — rather than being
 * assumed compatible. Binding the update schema to the resolver directly is what
 * this avoids: its every-field-optional shape would type the form's values as
 * partial and make `name` optional in a dialog where it never is.
 *
 * ── Dates are strings, start to finish ──────────────────────────────────────
 * `<input type="date">` reads and writes `YYYY-MM-DD` natively, which is the
 * wire format, so no `Date` is constructed anywhere in this file. That is the
 * whole reason it is a native input rather than the calendar popover: a sprint
 * boundary is a calendar day, and the round trip through a `Date` is where a day
 * gets lost to a timezone.
 */

type SprintFormValues = z.input<typeof createSprintInputSchema>;

const BLANK: SprintFormValues = { name: '', goal: null, startDate: null, endDate: null };

export function SprintFormDialog({
  projectId,
  sprint,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** `null` creates; a sprint edits it. */
  sprint: Sprint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['backlog', 'common']);
  const createSprint = useCreateSprint(projectId);
  const updateSprint = useUpdateSprint(projectId);

  const form = useForm<SprintFormValues>({
    resolver: zodResolver(createSprintInputSchema),
    defaultValues: BLANK,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const { reset } = form;
  const sprintId = sprint?.id ?? null;

  // Re-seed every time the dialog OPENS, not on every render: reopening after a
  // cancel must not arrive holding the abandoned draft, and reopening on a
  // different sprint must not show the previous one's goal.
  useEffect(() => {
    if (!open) return;
    reset(
      sprint
        ? {
            name: sprint.name,
            goal: sprint.goal,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
          }
        : BLANK,
    );
    // `sprintId` rather than `sprint`: the object identity churns with every
    // sprint-list refetch, and re-seeding mid-edit would discard what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [open, sprintId, reset]);

  const onSubmit = (values: SprintFormValues) => {
    const fields = {
      name: values.name,
      goal: values.goal ?? null,
      startDate: values.startDate ?? null,
      endDate: values.endDate ?? null,
    };

    if (sprint) {
      updateSprint.mutate(
        { sprintId: sprint.id, ...updateSprintInputSchema.parse(fields) },
        {
          onSuccess: () => {
            toast.success(t('backlog:form.updated'));
            onOpenChange(false);
          },
        },
      );
      return;
    }

    createSprint.mutate(createSprintInputSchema.parse(fields), {
      onSuccess: () => {
        toast.success(t('backlog:form.created'));
        onOpenChange(false);
      },
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={sprint ? t('backlog:form.editTitle') : t('backlog:form.createTitle')}
      description={sprint ? t('backlog:form.editDescription') : t('backlog:form.createDescription')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={sprint ? t('common:actions.save') : t('common:actions.create')}
      isPending={createSprint.isPending || updateSprint.isPending}
      className="max-w-md"
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('backlog:form.name')}</FormLabel>
            <FormControl>
              <Input {...field} autoFocus placeholder={t('backlog:form.namePlaceholder')} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="goal"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('backlog:form.goal')}</FormLabel>
            <FormControl>
              <Textarea
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                rows={3}
                placeholder={t('backlog:form.goalPlaceholder')}
                value={field.value ?? ''}
                onChange={(event) => {
                  // An emptied box is "no goal" — `null`, which is what the
                  // contract stores — never an empty string.
                  const raw = event.target.value;
                  field.onChange(raw.trim().length === 0 ? null : raw);
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="startDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('backlog:form.startDate')}</FormLabel>
              <FormControl>
                <Input
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  type="date"
                  value={field.value ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value;
                    field.onChange(raw.length === 0 ? null : raw);
                  }}
                />
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
                <Input
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  type="date"
                  value={field.value ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value;
                    field.onChange(raw.length === 0 ? null : raw);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* A plain paragraph, not `FormDescription`: that primitive reads the
          field context to wire `aria-describedby`, and this hint belongs to the
          date PAIR rather than to either input. */}
      <p className="-mt-1 text-xs text-muted-foreground">{t('backlog:form.datesHint')}</p>
    </FormDialog>
  );
}

export default SprintFormDialog;
