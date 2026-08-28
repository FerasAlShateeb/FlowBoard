import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The heading block every page in FlowBoard opens with: a title, an optional
 * one-line description, and an action slot pinned to the reading-END side.
 *
 * ONE COMPONENT SO THE SPACING IS ONE DECISION. A dense Linear-style layout
 * lives or dies on the vertical rhythm above the fold, and six pages each
 * choosing their own `mb-` is exactly how that drifts. The `h1` is real (not a
 * styled div) so the page has a document outline, and it is the ONLY `h1` on
 * the page.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  /** Already translated — pages own their own `t()` call. */
  title: string;
  description?: string;
  /** Buttons, pinned to the end of the row and never wrapping under the title. */
  actions?: ReactNode;
  className?: string;
  /** A filter bar or tab strip, rendered under the heading row. */
  children?: ReactNode;
}) {
  return (
    <header
      data-slot="page-header"
      className={cn('mb-[var(--gap)] flex flex-col gap-2', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

export default PageHeader;
