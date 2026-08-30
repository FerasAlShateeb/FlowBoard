import type * as React from 'react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Collapsible on the unified `radix-ui` package.
 *
 * Radix owns the whole contract: the trigger gets `aria-expanded` and
 * `aria-controls`, the content gets a matching `id` and `data-state`, and the
 * panel is REMOVED from the tree when closed (pass `forceMount` if a caller
 * needs it kept for a transition). Nothing here re-implements any of that — the
 * file exists to put FlowBoard's tokens on it and to stamp the `data-slot`
 * attributes the rest of the design system keys off.
 *
 * `overflow-hidden` on the content is load-bearing: without it a panel that is
 * fading/sliding shut paints outside the box for a frame at `--speed`.
 */
function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        'overflow-hidden',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
