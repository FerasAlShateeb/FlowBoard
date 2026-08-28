import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { createStatusInputSchema } from '@flowboard/shared';

import { DEFAULT_STATUS_COLOR, STATUS_COLORS } from '@/lib/label-colors';
import { useCreateStatus } from '@/hooks/useWorkflow';
import FormDialog from '@/components/common/FormDialog';
import ColorSwatchPicker from '@/components/common/ColorSwatchPicker';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Add a board column.
 *
 * It appends at the END of the board — `createStatusInputSchema` carries no
 * position, and `reorderStatusesInputSchema` is the only way order changes.
 * That split is deliberate: a create that could also insert would need to
 * renumber every column in the same request, and the whole-set reorder already
 * does that atomically.
 *
 * THE CATEGORY IS THE FIELD THAT MATTERS and the one people skip, so its
 * meaning is spelled out under the select: `done` is what stamps `resolved_at`,
 * closes the burndown and strikes a dependency through; `in_progress` starts
 * the cycle-time clock. A column in the wrong category produces charts that are
 * quietly wrong, which is much worse than a column with the wrong colour.
 */

type StatusValues = z.input<typeof createStatusInputSchema>;

export function AddStatusDialog({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['workflow', 'common']);
  const [open, setOpen] = useState(false);
  const createStatus = useCreateStatus(projectId);

  const form = useForm<StatusValues>({
    resolver: zodResolver(createStatusInputSchema),
    defaultValues: {
      name: '',
      category: 'todo',
      color: DEFAULT_STATUS_COLOR,
      wipLimit: null,
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const category = form.watch('category');

  const openDialog = () => {
    form.reset({ name: '', category: 'todo', color: DEFAULT_STATUS_COLOR, wipLimit: null });
    setOpen(true);
  };

  const onSubmit = (values: StatusValues) => {
    createStatus.mutate(
      {
        name: values.name,
        category: values.category ?? 'todo',
        color: values.color,
        // The schema's default; `null` is "unlimited", never 0.
        wipLimit: values.wipLimit ?? null,
      },
      {
        onSuccess: () => {
          toast.success(t('workflow:statuses.created'));
          setOpen(false);
        },
      },
    );
  };

  return (
    <>
      <Button size="sm" disabled={disabled} onClick={openDialog}>
        <Plus aria-hidden />
        {t('workflow:statuses.add')}
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('workflow:statuses.addTitle')}
        description={t('workflow:statuses.addDescription')}
        form={form}
        onSubmit={onSubmit}
        submitLabel={t('common:actions.add')}
        isPending={createStatus.isPending}
        className="max-w-md"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('workflow:statuses.name')}</FormLabel>
              <FormControl>
                <Input {...field} autoFocus placeholder={t('workflow:statuses.namePlaceholder')} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('workflow:statuses.category')}</FormLabel>
              <Select value={field.value ?? 'todo'} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="todo">{t('workflow:categories.todo')}</SelectItem>
                  <SelectItem value="in_progress">
                    {t('workflow:categories.in_progress')}
                  </SelectItem>
                  <SelectItem value="done">{t('workflow:categories.done')}</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {category === 'done'
                  ? t('workflow:categories.doneHint')
                  : category === 'in_progress'
                    ? t('workflow:categories.in_progressHint')
                    : t('workflow:categories.todoHint')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="color"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('workflow:statuses.color')}</FormLabel>
              <ColorSwatchPicker
                value={field.value ?? DEFAULT_STATUS_COLOR}
                onChange={field.onChange}
                presets={STATUS_COLORS}
                label={t('workflow:statuses.color')}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="wipLimit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('workflow:statuses.wipLimit')}</FormLabel>
              <FormControl>
                <Input
                  value={
                    field.value === null || field.value === undefined ? '' : String(field.value)
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder={t('workflow:statuses.wipLimitNone')}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    // Empty means "unlimited", which the contract spells as
                    // `null` — never 0, which the schema refuses.
                    field.onChange(raw.length === 0 ? null : Number(raw));
                  }}
                />
              </FormControl>
              <FormDescription>{t('workflow:statuses.wipLimitHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </FormDialog>
    </>
  );
}

export default AddStatusDialog;
