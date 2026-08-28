import type * as React from 'react';
import { CircleIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn RadioGroup on the unified `radix-ui` package. Roving focus, arrow-key
 * navigation and the RTL-aware arrow mapping all come from Radix, which reads
 * the `Direction.Provider` mounted in `AppProviders`.
 *
 * The dot is centred with flexbox rather than upstream's
 * `absolute left-1/2 -translate-x-1/2`, so there is no physical inset to mirror.
 */
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border border-input bg-surface text-primary shadow-[var(--shadow-1)] transition-colors duration-[var(--speed)] outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <CircleIcon className="size-2 fill-primary text-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
