import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The empty / error / no-results panel.
 *
 * Every page in FlowBoard owes the user three states — loading, empty, error
 * (project checklist §B) — and this is the one component all of them render, so
 * "nothing to show" looks the same whether it is an unfiltered empty board or a
 * search with no matches.
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-9 items-center justify-center rounded-[var(--radius)] border border-border bg-surface-raised text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message ? <p className="max-w-sm text-xs text-muted-foreground">{message}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
