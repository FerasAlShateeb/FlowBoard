import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn Textarea on FlowBoard tokens. `field-sizing-content` grows the box
 * with its content (no resize observer, no auto-grow hook) — which is what the
 * task description editor and the comment composer both want.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-[var(--input-radius)] border border-input bg-surface px-2.5 py-2 text-base text-foreground shadow-[var(--shadow-1)] transition-[color,border-color,box-shadow] duration-[var(--speed)] outline-none md:text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
