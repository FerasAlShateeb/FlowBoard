import type * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Side drawer, built on the SAME unified `radix-ui` Dialog primitive as
 * `ui/dialog.tsx` (the repo never uses the split `@radix-ui/react-*` packages),
 * so Escape, scrim click, focus trapping and `aria-modal` behave identically.
 *
 * GameDash has no `sheet` — this is adapted from its `dialog` + `drawer` pair.
 *
 * WHY `side` IS LOGICAL. Upstream shadcn takes `side="left" | "right"`. This
 * app is fully bidirectional, and every consumer of a sheet means "the edge the
 * reader's eye ends on" — the task-detail panel (WP3.2 mounts it as a
 * route-layered sheet over the board), filter panels, the org switcher. So the
 * prop is `'start' | 'end' | 'top' | 'bottom'` and resolves through
 * `inset-inline-*`, which mirrors for free.
 *
 * The SLIDE, though, cannot be logical: `slide-in-from-right` is a physical
 * transform and transforms are not mirrored by `direction`. Each logical side
 * therefore names both physical animations behind `ltr:` / `rtl:` variants.
 */
function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-[100] bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

/** Logical sheet edge. `start`/`end` mirror under RTL; `top`/`bottom` do not. */
export type SheetSide = 'start' | 'end' | 'top' | 'bottom';

const SIDE_CLASSES: Record<SheetSide, string> = {
  start: cn(
    'inset-y-0 start-0 h-full w-full max-w-md border-e',
    'ltr:data-[state=open]:slide-in-from-left ltr:data-[state=closed]:slide-out-to-left',
    'rtl:data-[state=open]:slide-in-from-right rtl:data-[state=closed]:slide-out-to-right',
  ),
  end: cn(
    'inset-y-0 end-0 h-full w-full max-w-md border-s',
    'ltr:data-[state=open]:slide-in-from-right ltr:data-[state=closed]:slide-out-to-right',
    'rtl:data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-left',
  ),
  top: cn(
    'inset-x-0 top-0 h-auto max-h-[85dvh] border-b',
    'data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
  ),
  bottom: cn(
    'inset-x-0 bottom-0 h-auto max-h-[85dvh] border-t',
    'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  ),
};

function SheetContent({
  className,
  children,
  side = 'end',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: SheetSide;
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation(['common']);

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-[100] flex flex-col gap-4 overflow-y-auto border-border bg-surface p-[var(--card-pad)] text-foreground shadow-[var(--shadow-2)] duration-[var(--speed)]',
          'data-[state=closed]:animate-out data-[state=open]:animate-in',
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            className="absolute end-3 top-3 rounded-[var(--btn-radius)] p-1 text-muted-foreground opacity-70 transition-opacity duration-[var(--speed)] outline-hidden hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:pointer-events-none [&_svg]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t('common:actions.close')}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 text-start', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-sm leading-none font-semibold', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
