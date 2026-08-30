import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn ToggleGroup on the unified `radix-ui` package, FlowBoard tokens.
 *
 * ── WHY THE `toggleVariants` RECIPE LIVES HERE ─────────────────────────────
 *
 * Upstream shadcn splits this into `toggle.tsx` (the recipe + a standalone
 * Toggle) and `toggle-group.tsx` (the group that imports it). FlowBoard has no
 * standalone-toggle call site — a lone two-state button is `Button` with
 * `aria-pressed`, which is what the table's density control and the board's
 * filter chips already do — so a second file would exist only to be imported
 * once. The recipe is exported, so a future `toggle.tsx` can lift it out
 * without touching a call site.
 *
 * ── SIZE AND VARIANT TRAVEL BY CONTEXT ─────────────────────────────────────
 *
 * The group's `size`/`variant` reach the items through a React context rather
 * than being spread onto each one. It is the difference between
 * `<ToggleGroup size="sm">` styling three children and the caller repeating
 * `size="sm"` three times and getting it wrong on the fourth. An item may still
 * override both explicitly.
 *
 * ── SEGMENT GEOMETRY IS LOGICAL ────────────────────────────────────────────
 *
 * In `outline` variant the group reads as ONE control: the items sit flush,
 * share borders, and only the two ends are rounded. Those ends are
 * `rounded-s-*` / `rounded-e-*` and the shared border is `border-s`, so the
 * strip mirrors under RTL instead of rounding the wrong end and doubling a
 * border at the seam.
 *
 * ── A11Y ───────────────────────────────────────────────────────────────────
 *
 * Radix supplies the roving tabindex and `aria-pressed`/`aria-checked`. It does
 * NOT supply a name for the group: pass `aria-label` (already translated) or
 * the whole strip announces as an anonymous group of buttons.
 */
const toggleVariants = cva(
  "inline-flex shrink-0 cursor-default items-center justify-center gap-1.5 rounded-[var(--btn-radius)] text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-[var(--speed)] outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-border bg-surface shadow-[var(--shadow-1)]',
      },
      size: {
        default: 'h-8 min-w-8 px-2.5',
        sm: 'h-7 min-w-7 px-2 text-xs',
        lg: 'h-9 min-w-9 px-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ToggleVariantProps = VariantProps<typeof toggleVariants>;

const ToggleGroupContext = React.createContext<ToggleVariantProps>({
  variant: 'default',
  size: 'default',
});

function ToggleGroup({
  className,
  variant = 'default',
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & ToggleVariantProps) {
  // Memoized so a parent re-render does not invalidate every item's context
  // read — the group is often inside a toolbar that re-renders on every filter
  // change.
  const context = React.useMemo(() => ({ variant, size }), [variant, size]);

  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        'group/toggle-group flex w-fit items-center',
        variant === 'outline' &&
          'rounded-[var(--btn-radius)] border border-border bg-surface shadow-[var(--shadow-1)]',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={context}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & ToggleVariantProps) {
  const context = React.useContext(ToggleGroupContext);
  const resolvedVariant = variant ?? context.variant;
  const resolvedSize = size ?? context.size;

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      className={cn(
        toggleVariants({ variant: resolvedVariant, size: resolvedSize }),
        // Inside an `outline` group the strip owns the border and the corners;
        // the items give theirs up and share one seam. Logical, so it mirrors.
        resolvedVariant === 'outline' &&
          'rounded-none border-0 border-s border-border shadow-none first:border-s-0 first:rounded-s-[calc(var(--btn-radius)-1px)] last:rounded-e-[calc(var(--btn-radius)-1px)]',
        'min-w-0 flex-1 shrink-0',
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem, toggleVariants };
