import type * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn ScrollArea on the unified `radix-ui` package. Radix computes the
 * scrollbar's side from the resolved writing direction (it reads the
 * `Direction.Provider` in `AppProviders`), so a vertical bar lands on the
 * reading-END edge under both `ltr` and `rtl` with no `rtl:` variant here.
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      {/*
        `[&>div]:!block` overrides the INLINE `display: table` Radix puts on the
        viewport's content wrapper.

        WHY IT MATTERS (WP3.8, found in the calendar's unscheduled tray). A
        `display: table` box shrink-wraps its content, so a child that is wider
        than the viewport widens the table — and every `min-w-0` / `flex-1` /
        `truncate` inside is then measured against that WIDER box and stops
        doing anything. The symptom is text running out of a fixed-width panel
        instead of ellipsing, which reads as a broken layout rather than as a
        scroll container doing its job. `block` makes the wrapper fill the
        viewport, which is what every consumer here actually wants; content that
        genuinely needs to scroll horizontally opts in with its own `w-max`.
      */}
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/25 [&>div]:!block"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors duration-[var(--speed)] select-none',
        orientation === 'vertical' && 'h-full w-2 border-s border-s-transparent',
        orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
