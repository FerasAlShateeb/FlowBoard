import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A page header: title and subtitle at the reading start, actions at the end.
 *
 * ═══ IT EMITS THE PAGE'S `<h1>` ══════════════════════════════════════════
 *
 * One per page, and it is the page's only level-one heading — which is what
 * makes "skip to the main heading" land somewhere useful and what the
 * breadcrumb trail's last crumb agrees with. Cards below use `<h2>`; nothing in
 * a dashboard needs to go deeper.
 *
 * `subtitle` is a NODE, not a string, because the analytics drill-down page
 * puts a "← back to Engagement" link in it: the sentence explaining where you
 * are is exactly where the way back belongs.
 *
 * ═══ WHY `justify-between` AND NOT A GRID ════════════════════════════════
 *
 * The actions cluster is optional and variable-width (one button, or a range
 * picker plus a refresh switch plus an export). `flex-wrap` lets it drop to its
 * own line on a narrow viewport instead of crushing the title, and
 * `justify-between` is writing-mode aware — the actions sit at the reading END
 * under both `ltr` and `rtl` with no `rtl:` variant.
 *
 * This component owns no copy: every string is the caller's, already translated.
 */
export interface SectionHeaderProps {
  /** The page title — rendered as the `<h1>`. */
  title: string;
  /** One line under it. A node, so it can carry a link. */
  subtitle?: ReactNode;
  /** Controls at the reading end (range picker, export, refresh). */
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, actions, className }: SectionHeaderProps) {
  return (
    <div
      data-slot="section-header"
      className={cn('flex flex-wrap items-start justify-between gap-3', className)}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl leading-tight font-semibold">{title}</h1>
        {subtitle === undefined ? null : (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
