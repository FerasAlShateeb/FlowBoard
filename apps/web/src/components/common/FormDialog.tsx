import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { FieldValues, SubmitHandler, UseFormReturn } from 'react-hook-form';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';

/**
 * A dialog that IS a form — the shell behind every create/edit modal in the
 * product (create project, invite, add member, add status, edit label, team
 * roster).
 *
 * WHAT IT ACTUALLY REMOVES. Every one of those dialogs otherwise repeats the
 * same eight lines: the `<Form>` provider, a `<form>` with `noValidate` and a
 * `void form.handleSubmit(...)` wrapper, a footer with cancel + submit, the
 * `isSubmitting` spinner, and the disabled states. Repeated eight times, at
 * least one of them ends up missing `noValidate` and shows a browser bubble in
 * English on an Arabic page.
 *
 * THREE BEHAVIOURS WORTH NAMING:
 *
 * 1. **`noValidate` is not optional.** Native constraint validation would fire
 *    the browser's own bubbles — untranslatable, unstyled, and in a different
 *    language from the page. Zod owns validation; the browser must stay out.
 * 2. **Enter submits, Escape closes.** Enter comes free from a real `<form>`
 *    with a `type="submit"` button; Escape comes from Radix. Together they are
 *    the keyboard-complete requirement in checklist §B.
 * 3. **`void form.handleSubmit(onSubmit)(event)`.** `handleSubmit` returns a
 *    promise; letting it float out of a JSX handler is what the lint rule
 *    catches, and awaiting it in the handler would swallow the event.
 *
 * VALIDATION MESSAGES ARE NOT TRANSLATED HERE. Forms bind the SHARED zod
 * schemas, whose messages are the English wire contract; `ui/form`'s
 * `FormMessage` localizes each one at render. That is why no dialog below
 * builds a schema out of `t()`.
 */
export function FormDialog<TFieldValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  submitLabel,
  cancelLabel,
  isPending,
  className,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already translated. */
  title: string;
  description?: string;
  form: UseFormReturn<TFieldValues>;
  onSubmit: SubmitHandler<TFieldValues>;
  /** Defaults to `common:actions.save`. */
  submitLabel?: string;
  cancelLabel?: string;
  /**
   * Pending state from the MUTATION. `form.formState.isSubmitting` already
   * covers an awaited handler, but a handler that fires `mutate()` and returns
   * is not "submitting" by RHF's reckoning while the request is in flight.
   */
  isPending?: boolean;
  className?: string;
  /** Extra footer content, placed before the cancel/submit pair. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation(['common']);
  const busy = isPending === true || form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-lg', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <Form {...form}>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
          >
            {children}

            <DialogFooter>
              {footer}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {cancelLabel ?? t('common:actions.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {submitLabel ?? t('common:actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default FormDialog;
