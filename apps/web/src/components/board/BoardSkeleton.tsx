import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { COLUMN_WIDTH } from '@/components/board/BoardColumn';

/**
 * The board's loading state: column GHOSTS, not a spinner.
 *
 * The board's shape is known before its contents are — a project's columns come
 * from `useProject`, which usually resolves first — so the placeholder can be
 * the real number of columns at the real width. That makes the load read as
 * "the cards are coming" instead of "something is happening somewhere", and it
 * reserves the layout so nothing jumps when the data lands.
 *
 * The card heights are varied deliberately: a column of identical rectangles
 * reads as a broken render, while an uneven stack reads as content.
 */
const CARD_HEIGHTS = ['h-16', 'h-20', 'h-14', 'h-24', 'h-16'];

export function BoardSkeleton({ columns = 4 }: { columns?: number }) {
  const { t } = useTranslation(['board']);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('board:states.loading')}
      data-slot="board-skeleton"
      className="-mx-[var(--page-pad)] flex gap-[var(--gap)] overflow-hidden px-[var(--page-pad)]"
    >
      {Array.from({ length: columns }, (_, columnIndex) => (
        <div
          key={columnIndex}
          className={cn(
            COLUMN_WIDTH,
            'flex shrink-0 flex-col gap-2 rounded-[var(--card-radius)] border border-border bg-surface-raised/60 p-2',
          )}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ms-auto h-3 w-6" />
          </div>
          {CARD_HEIGHTS.slice(0, 3 + (columnIndex % 3)).map((height, cardIndex) => (
            <Skeleton
              key={cardIndex}
              className={cn(height, 'w-full rounded-[var(--card-radius)]')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default BoardSkeleton;
