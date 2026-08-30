import type * as React from 'react';
import { ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * shadcn Breadcrumb on FlowBoard tokens — the only primitive in this folder
 * that wraps no Radix package, because a breadcrumb is markup and ARIA, not
 * behaviour: a `<nav>` naming itself, an ordered list, and one `aria-current`.
 *
 * TWO THINGS THAT ARE NOT COSMETIC:
 *
 *  - **The separator is `aria-hidden` and `role="presentation"`.** A screen
 *    reader walking an ordered list already hears "1 of 3"; a chevron announced
 *    between every pair is three extra words per crumb that say nothing.
 *  - **The chevron carries `rtl:rotate-180`.** It is a directional glyph
 *    pointing at the NEXT crumb, and the next crumb is to the left in Arabic.
 *    (Contrast the tooltip arrow and the dialog's `left-1/2`, which are
 *    deliberately physical — see the notes in those files.) Everything else
 *    here is logical, so the whole trail mirrors with the page.
 *
 * The `<nav>`'s accessible name comes from `common:nav.breadcrumb`; every other
 * string is the caller's, already translated in the page that built the trail.
 */
function Breadcrumb({ 'aria-label': ariaLabel, ...props }: React.ComponentProps<'nav'>) {
  const { t } = useTranslation(['common']);

  return (
    <nav aria-label={ariaLabel ?? t('common:nav.breadcrumb')} data-slot="breadcrumb" {...props} />
  );
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-xs break-words text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex items-center gap-1.5', className)}
      {...props}
    />
  );
}

/**
 * A crumb that navigates. `asChild` is the normal case: the caller passes a
 * router `<Link>` so the trail participates in client-side navigation instead
 * of reloading the app.
 */
function BreadcrumbLink({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'a';

  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        'rounded-[var(--btn-radius)] transition-colors duration-[var(--speed)] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The LAST crumb — the page you are on.
 *
 * `role="link"` with `aria-disabled` rather than an `<a>` without an `href`:
 * it reads as "the link you are already on" instead of as a broken link, and
 * it stays out of the tab order.
 */
function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn('font-medium text-foreground', className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden
      className={cn('[&>svg]:size-3', className)}
      {...props}
    >
      {children ?? <ChevronRightIcon className="rtl:rotate-180" />}
    </li>
  );
}

/**
 * The collapsed middle of a long trail. Named for assistive tech because the
 * glyph alone ("…") is not a word in any language; the caller supplies the
 * translated `label`.
 */
function BreadcrumbEllipsis({
  className,
  label,
  ...props
}: React.ComponentProps<'span'> & { label: string }) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      className={cn('flex size-5 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
