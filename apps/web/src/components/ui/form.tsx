import * as React from 'react';
import { Slot, type Label as LabelPrimitive } from 'radix-ui';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { localizeValidationMessage } from '@/i18n/validation';
import { Label } from '@/components/ui/label';

/**
 * The react-hook-form ⇄ shadcn bridge.
 *
 * Composition is always the same five layers:
 *
 * ```tsx
 * <Form {...form}>
 *   <form onSubmit={form.handleSubmit(onSubmit)}>
 *     <FormField name="email" control={form.control} render={({ field }) => (
 *       <FormItem>
 *         <FormLabel>{t('auth:login.email')}</FormLabel>
 *         <FormControl><Input {...field} /></FormControl>
 *         <FormMessage />
 *       </FormItem>
 *     )} />
 * ```
 *
 * `FormItem` mints one `useId()` and `useFormField()` derives every ARIA id
 * from it, so the label's `htmlFor`, the control's `id`, and the
 * `aria-describedby` pointing at the error message are wired with no manual ids
 * anywhere. `FormControl` is a Radix `Slot`, so those attributes land on the
 * real `<input>`/`<textarea>` the caller supplied rather than on a wrapper.
 *
 * ERROR MESSAGES ARE LOCALIZED AT THE ONE RENDER POINT. Forms validate with the
 * SHARED zod schemas, which attach English text from
 * `packages/shared`'s validation-message constants (that text is the wire
 * contract — the API's 422 `error.details` carries it verbatim). `FormMessage`
 * therefore runs whatever it is about to render through
 * `localizeValidationMessage`, which swaps a known constant for the caller's
 * language and passes anything else through untouched. A page that supplies its
 * own already-translated message still renders it as-is; no form has to
 * remember to translate.
 */
const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  const value = React.useMemo<FormFieldContextValue>(() => ({ name: props.name }), [props.name]);
  return (
    <FormFieldContext.Provider value={value}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

interface FormItemContextValue {
  id: string;
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null);

/**
 * The ids + validation state for the enclosing field. Throws (rather than
 * returning a half-built object) when used outside the two providers: a silent
 * `undefined` id would produce a label pointing at nothing, which is an
 * accessibility bug that never shows up in a screenshot.
 */
const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();

  if (!fieldContext) throw new Error('useFormField must be used within <FormField>');
  if (!itemContext) throw new Error('useFormField must be used within <FormItem>');

  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  const id = React.useId();
  const value = React.useMemo<FormItemContextValue>(() => ({ id }), [id]);

  return (
    <FormItemContext.Provider value={value}>
      <div data-slot="form-item" className={cn('grid gap-1.5', className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn('data-[error=true]:text-destructive', className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function FormMessage({ className, children, ...props }: React.ComponentProps<'p'>) {
  const { error, formMessageId } = useFormField();
  const { t } = useTranslation('validation');
  const body = error ? localizeValidationMessage(t, String(error.message ?? '')) : children;

  if (!body) return null;

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      // `role="alert"` so a submit-time validation failure is announced rather
      // than merely appearing — the field itself may be off-screen.
      role="alert"
      className={cn('text-xs text-destructive', className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
