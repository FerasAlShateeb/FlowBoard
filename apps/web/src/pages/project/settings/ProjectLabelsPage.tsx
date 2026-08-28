import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { createLabelInputSchema, type Label as TaskLabel } from '@flowboard/shared';

import { DEFAULT_LABEL_COLOR, LABEL_COLORS } from '@/lib/label-colors';
import {
  canAdminProject,
  useCreateLabel,
  useDeleteLabel,
  useLabels,
  useProjectScope,
  useUpdateLabel,
} from '@/hooks/useProjects';
import FormDialog from '@/components/common/FormDialog';
import PageSpinner from '@/components/common/PageSpinner';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ColorSwatchPicker from '@/components/common/ColorSwatchPicker';
import { LabelChip } from '@/components/common/LabelDot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

/**
 * Project settings → Labels.
 *
 * THE COLOUR PICKER IS A FIXED PALETTE, not a free hex field. Ten swatches
 * (`lib/label-colors.ts`) chosen to stay distinguishable at the 8px a label dot
 * renders on a board card, and to stay legible on both surfaces. A free picker
 * reliably produces one label that is invisible in dark mode and another that
 * is invisible in light — and a board's labels are only useful if they can be
 * told apart at a glance.
 */

type LabelValues = z.input<typeof createLabelInputSchema>;

export default function ProjectLabelsPage() {
  const { t } = useTranslation(['settings', 'common']);
  const { projectId, project, role, isPending, error } = useProjectScope();
  const canAdmin = canAdminProject(role);

  const {
    data: labels,
    isPending: labelsPending,
    error: labelsError,
    refetch,
  } = useLabels(projectId);
  const deleteLabel = useDeleteLabel(projectId ?? '');

  const [editing, setEditing] = useState<TaskLabel | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TaskLabel | null>(null);

  if (isPending) return <PageSpinner />;
  if (error) return <ErrorState error={error} />;

  const confirmDelete = () => {
    if (!deleting) return;
    deleteLabel.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(t('settings:labels.deleted'));
        setDeleting(null);
      },
    });
  };

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('settings:labels.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('settings:labels.subtitle', { project: project?.name ?? '' })}
          </p>
        </div>
        {canAdmin ? (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            {t('settings:labels.create')}
          </Button>
        ) : null}
      </div>

      {labelsError ? (
        <ErrorState
          error={labelsError}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : labelsPending ? (
        <PageSpinner />
      ) : (labels?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Tag className="size-4" />}
          title={t('settings:labels.empty')}
          message={t('settings:labels.emptyBody')}
        />
      ) : (
        <Card className="gap-0 divide-y divide-border p-0">
          {(labels ?? []).map((label) => (
            <div key={label.id} className="flex items-center gap-2 px-[var(--card-pad)] py-2">
              <LabelChip label={label} />
              <span className="ms-auto flex items-center gap-0.5">
                {canAdmin ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('settings:labels.editTitle')}
                      onClick={() => {
                        setEditing(label);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('settings:labels.deleteTitle', { name: label.name })}
                      onClick={() => {
                        setDeleting(label);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </Card>
      )}

      {canAdmin ? (
        <>
          <LabelFormDialog
            projectId={projectId ?? ''}
            open={creating}
            onOpenChange={setCreating}
            label={null}
          />
          <LabelFormDialog
            key={editing?.id ?? 'edit'}
            projectId={projectId ?? ''}
            open={editing !== null}
            onOpenChange={(next) => {
              if (!next) setEditing(null);
            }}
            label={editing}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(next) => {
              if (!next) setDeleting(null);
            }}
            title={t('settings:labels.deleteTitle', { name: deleting?.name ?? '' })}
            description={t('settings:labels.deleteBody')}
            confirmLabel={t('common:actions.delete')}
            isPending={deleteLabel.isPending}
            onConfirm={confirmDelete}
          />
        </>
      ) : null}
    </div>
  );
}

/** Create or edit — one form; the fields are identical. */
function LabelFormDialog({
  projectId,
  open,
  onOpenChange,
  label,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: TaskLabel | null;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const createLabel = useCreateLabel(projectId);
  const updateLabel = useUpdateLabel(projectId);

  const form = useForm<LabelValues>({
    resolver: zodResolver(createLabelInputSchema),
    defaultValues: { name: label?.name ?? '', color: label?.color ?? DEFAULT_LABEL_COLOR },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: label?.name ?? '', color: label?.color ?? DEFAULT_LABEL_COLOR });
    }
    // deps are the FIELD VALUES, not the objects: `form` is stable across renders (RHF) and the
    // data object is rebuilt every render, so depending on either would reset the form under
    // the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [open, label?.name, label?.color]);

  const onSubmit = (values: LabelValues) => {
    const done = (message: string) => () => {
      toast.success(message);
      onOpenChange(false);
    };

    if (label) {
      updateLabel.mutate(
        { labelId: label.id, ...values },
        { onSuccess: done(t('settings:labels.updated')) },
      );
      return;
    }
    createLabel.mutate(values, { onSuccess: done(t('settings:labels.created')) });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={label ? t('settings:labels.editTitle') : t('settings:labels.createTitle')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={label ? t('common:actions.save') : t('common:actions.create')}
      isPending={createLabel.isPending || updateLabel.isPending}
      className="max-w-md"
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('settings:labels.name')}</FormLabel>
            <FormControl>
              <Input {...field} autoFocus placeholder={t('settings:labels.namePlaceholder')} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="color"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('settings:labels.color')}</FormLabel>
            <ColorSwatchPicker
              value={field.value}
              onChange={field.onChange}
              presets={LABEL_COLORS}
              label={t('settings:labels.color')}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}
