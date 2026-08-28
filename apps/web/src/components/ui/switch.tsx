import type * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Switch on FlowBoard tokens.
 *
 * The thumb travel uses `translate-x`, which is PHYSICAL — and that is correct:
 * Radix mirrors the whole control under `dir="rtl"` via the writing mode, so a
 * logical translate would double-mirror and send the thumb the wrong way.
 * `rtl:data-[state=checked]:-translate-x-*` is the compensation.
 */
function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-[var(--speed)] outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[size=default]:h-[18px] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-surface shadow-[var(--shadow-1)] ring-0 transition-transform duration-[var(--speed)]',
          'group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5',
          'data-[state=unchecked]:translate-x-0.5',
          'ltr:data-[state=checked]:translate-x-[calc(100%+2px)]',
          'rtl:data-[state=checked]:-translate-x-[calc(100%+2px)]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
