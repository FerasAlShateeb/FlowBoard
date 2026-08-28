import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Loading placeholder. `aria-hidden` by default — a placeholder has no content
 * worth announcing — but it sits BEFORE the spread so a call site can opt out.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-[var(--radius)] bg-secondary', className)}
      {...props}
    />
  );
}

export { Skeleton };
