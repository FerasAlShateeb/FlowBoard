import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The shadcn Card API surface, re-skinned onto the `.fb-card` recipe from
 * `index.css`:
 *
 *   background `--surface` · 1px `--border` · radius `--card-radius`
 *   padding `--card-pad` · shadow `--shadow-1`
 *
 * Consequence of `.fb-card`'s UNIFORM padding: it lives on the ROOT, not on
 * Header/Content/Footer (upstream shadcn puts `py-6` on the root and `px-6` on
 * each part). Sub-parts are therefore padding-free, so a `<Card>` and a
 * `<div className="fb-card">` are the same box.
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-[var(--gap)] rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-pad)] text-card-foreground shadow-[var(--shadow-1)]',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-[var(--card-pad)]',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-sm leading-none font-semibold', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/**
 * `justify-self-end` is writing-mode aware, so the action mirrors under RTL
 * with no `rtl:` variant.
 */
function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2 [.border-t]:pt-[var(--card-pad)]', className)}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
