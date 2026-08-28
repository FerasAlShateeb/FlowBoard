import type * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Tooltip on the unified `radix-ui` package.
 *
 * `TooltipProvider` is mounted ONCE in `AppProviders` (delay 200ms — long
 * enough not to fire on a mouse crossing the sidebar, short enough for a
 * deliberate hover). `Tooltip` therefore does NOT wrap itself in a provider the
 * way upstream shadcn does: nesting providers resets the shared "skip delay"
 * grace window, which is the thing that makes moving along a toolbar feel
 * instant after the first tooltip.
 */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // pointer-events-none: tooltips are informational and must never
          // swallow a click meant for the UI beneath them (they sit at z-110).
          'pointer-events-none z-[110] w-fit origin-(--radix-tooltip-content-transform-origin) rounded-[var(--radius)] border border-border bg-surface-raised px-2 py-1 text-xs text-balance text-foreground shadow-[var(--shadow-2)]',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        {/*
          The arrow's `border-r border-b` are PHYSICAL on purpose — do NOT
          "logicalise" them. It is the standard shadcn trick: a square rotated
          45deg with only the two edges facing the trigger stroked. `rotate-45`
          is a transform, and transforms are not mirrored by `direction`, so
          after the rotation `border-r`/`border-b` form a downward "V" that is
          mirror-symmetric about the vertical axis — already correct under RTL.
          Swapping to `border-s`/`border-e` would stroke the UPPER edges under
          RTL while the rotation stayed put, pointing the outline away from the
          trigger.
        */}
        <TooltipPrimitive.Arrow className="z-[110] size-2 translate-y-[calc(-50%_-_1px)] rotate-45 rounded-[2px] border-r border-b border-border bg-surface-raised fill-[var(--surface-raised)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
