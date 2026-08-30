import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn Alert, re-skinned onto the FlowBoard tokens.
 *
 * ── ROLE IS A PROP, NOT A CONSTANT ─────────────────────────────────────────
 *
 * Upstream shadcn hard-codes `role="alert"` on the root, which makes EVERY
 * alert an assertive live region — including the static "this instance runs in
 * single-organization mode" banner that was on the page before the user
 * arrived. An assertive region interrupts a screen reader mid-sentence, so it
 * belongs to messages that appear IN RESPONSE to something.
 *
 * The default here is therefore `role="note"` (a static remark), and a caller
 * announcing a fresh failure passes `role="alert"` explicitly. FlowBoard's
 * transient feedback lives in Sonner toasts, which own their own live region —
 * this primitive is for the banner that stays on the page.
 *
 * ── THE 12% TINT ───────────────────────────────────────────────────────────
 *
 * Backgrounds are `color-mix(in oklab, var(--token) 12%, transparent)` — the
 * house tint recipe (design-system §6), the same one the label chips, the Gantt
 * bars and the diagnostics chrome use. Mixing in `oklab` rather than `srgb` is
 * what keeps the tint from going muddy for the warm tokens, and mixing toward
 * `transparent` rather than toward the page background is what keeps it correct
 * on `--surface`, `--surface-raised` and inside a dialog alike.
 *
 * Every string is the caller's, already translated: this primitive owns no copy.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-[var(--card-radius)] border px-3 py-2.5 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-2.5 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface-raised text-foreground [&>svg]:text-muted-foreground',
        info: 'border-transparent bg-[color-mix(in_oklab,var(--info)_12%,transparent)] text-foreground [&>svg]:text-info',
        success:
          'border-transparent bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-foreground [&>svg]:text-success',
        warning:
          'border-transparent bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-foreground [&>svg]:text-warning',
        destructive:
          'border-transparent bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-foreground [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant = 'default',
  role = 'note',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-title" className={cn('col-start-2 font-medium', className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
