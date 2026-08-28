import type * as React from 'react';
import { Avatar as AvatarPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Avatar on the unified `radix-ui` package.
 *
 * The Root deliberately does NOT clip its children: `overflow-hidden` on a
 * `rounded-full` box erases anything pinned to a corner — which is exactly
 * where `AvatarBadge` (presence dots, Wave 4) sits, and where its `ring`
 * (a box-shadow, always outside the border-box) lives. The circle is clipped
 * where the round content actually is: `AvatarImage` and `AvatarFallback` each
 * carry their own `rounded-full`.
 */
function Avatar({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'default' | 'xs' | 'sm' | 'lg';
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-7 shrink-0 rounded-full select-none',
        'data-[size=xs]:size-5 data-[size=sm]:size-6 data-[size=lg]:size-9',
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full rounded-full object-cover', className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center overflow-hidden rounded-full bg-secondary text-[10px] font-medium text-muted-foreground uppercase',
        'group-data-[size=lg]/avatar:text-xs',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A corner badge (presence dot, watcher count). `end-0` is `inset-inline-end`,
 * not `right-0`: the badge belongs on the reading-END corner in both
 * directions. An overriding call site MUST also use `end-*` — tailwind-merge
 * dedupes within a group, and `right-*` / `end-*` are different groups.
 */
function AvatarBadge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        'absolute end-0 bottom-0 z-10 inline-flex size-2.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none',
        'group-data-[size=xs]/avatar:size-1.5 group-data-[size=sm]/avatar:size-2',
        className,
      )}
      {...props}
    />
  );
}

/** Overlapping stack, used for assignee/watcher rows and presence. */
function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-1.5 rtl:space-x-reverse *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
        className,
      )}
      {...props}
    />
  );
}

/** The "+3" tail of an `AvatarGroup`. */
function AvatarGroupCount({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        'relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground ring-2 ring-background',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount };
