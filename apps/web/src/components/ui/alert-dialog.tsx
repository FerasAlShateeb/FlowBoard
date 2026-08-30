import type * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * shadcn AlertDialog on the unified `radix-ui` package, FlowBoard tokens.
 *
 * ── WHY THIS EXISTS ALONGSIDE `dialog.tsx` ─────────────────────────────────
 *
 * A Dialog is a surface; an AlertDialog is a QUESTION with exactly two answers,
 * and Radix enforces the difference where it matters:
 *
 *  - `role="alertdialog"` plus a required `Description`, so the consequence is
 *    announced with the title rather than discovered by reading the buttons.
 *  - **Focus lands on Cancel**, not on the destructive Action — a confirmation
 *    that opens with Delete focused turns a stray Enter into a deletion. Radix
 *    does this via `AlertDialogCancel`; that is the whole reason "Cancel" is a
 *    dedicated component rather than another button.
 *  - **No dismiss-by-outside-click and no corner X.** The user has to answer.
 *    Escape still cancels, because a keyboard user needs a way out that does
 *    not involve reading the button order first.
 *
 * So: destructive and irreversible confirmations use this; everything else —
 * forms, detail panels, pickers — uses `dialog.tsx`.
 *
 * Z-SCALE (see `dialog.tsx`): modal layers 100, floating primitives that must
 * open on top of a modal 110. This is a modal layer.
 *
 * COPY IS THE CALLER'S. Unlike `Dialog`, there is no corner X for this file to
 * name, so it owns no strings at all; `common:confirm.*` and
 * `common:actions.{cancel,delete,confirm}` are what the call sites reach for.
 */
function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        'fixed inset-0 z-[100] bg-black/50 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        // `left-1/2` is PHYSICAL on purpose and must not be "logicalised" — it
        // pairs with `-translate-x-1/2`, and transforms are not mirrored by
        // `direction`. Centring is symmetric; there is nothing to mirror. Same
        // reasoning as `dialog.tsx`.
        className={cn(
          'fixed top-1/2 left-1/2 z-[100] grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--card-radius)] border border-border bg-surface p-[var(--card-pad)] text-foreground shadow-[var(--shadow-2)] duration-[var(--speed)]',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-1.5 text-start', className)}
      {...props}
    />
  );
}

/**
 * `flex-col-reverse` below `sm` is not a stylistic flourish: stacked vertically
 * the CONFIRM must sit on top and Cancel underneath (thumb-reach order), while
 * in DOM order Cancel comes first so it is the first tab stop and the focus
 * target. Reversing the visual axis satisfies both.
 */
function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-sm leading-none font-semibold', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants(), className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
