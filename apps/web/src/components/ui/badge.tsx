import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Badge on FlowBoard tokens. The `soft` variants are the FlowBoard
 * addition: a tinted background at low alpha with the full-strength hue as the
 * text colour. That is the Linear treatment for status chips (priority, task
 * type, WIP warnings) — a solid fill at badge size is too loud in a dense board,
 * and the tint still passes contrast because the text stays saturated.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius)] border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-[var(--speed)] focus-visible:ring-2 focus-visible:ring-ring/60 [&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-primary-foreground',
        outline: 'border-border text-foreground',
        'soft-primary': 'border-transparent bg-primary/12 text-primary',
        'soft-success': 'border-transparent bg-success/12 text-success',
        'soft-warning': 'border-transparent bg-warning/14 text-warning',
        'soft-danger': 'border-transparent bg-danger/12 text-danger',
        'soft-info': 'border-transparent bg-info/12 text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
