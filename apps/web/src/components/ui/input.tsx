import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn Input on FlowBoard tokens.
 *
 * `text-base md:text-sm` is not a style choice: iOS Safari auto-zooms the page
 * whenever a focused input renders below 16px, so the mobile size stays large
 * and only the desktop breakpoint drops to the dense 13px UI scale.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-[var(--input-radius)] border border-input bg-surface px-2.5 py-1 text-base text-foreground shadow-[var(--shadow-1)] transition-[color,border-color,box-shadow] duration-[var(--speed)] outline-none md:text-sm',
        'selection:bg-primary/30 placeholder:text-muted-foreground',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
