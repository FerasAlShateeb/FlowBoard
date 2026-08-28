import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Label, Status } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { BoardCardList, COLUMN_WIDTH } from '@/components/board/BoardColumn';
import type { Swimlane } from '@/components/board/swimlanes';

/**
 * One horizontal lane of the board: a header that spans every column, and the
 * row of drop cells under it.
 *
 * ── THE HEADER STICKS TO THE READING START ─────────────────────────────────
 * The board scrolls horizontally and a lane can be wider than the viewport, so
 * a header that scrolled with it would leave you looking at four unlabelled
 * cells. `sticky start-0` (logical — it pins to the RIGHT under Arabic) keeps
 * the label in view for the whole width of the lane. `w-fit` is what stops the
 * sticky box from also covering the cards it is meant to label.
 *
 * ── COLLAPSING IS A VIEW PREFERENCE, NOT A FILTER ──────────────────────────
 * A folded lane keeps its cards; it just stops drawing them. That is why the
 * collapsed set lives beside the filters in `useBoardFilterStore` but is NOT
 * cleared by "clear filters", and why the header keeps showing the lane's count
 * while folded — the number is the reason you would unfold it.
 *
 * ── DRAGGING INTO A FOLDED LANE ────────────────────────────────────────────
 * You cannot: a collapsed lane renders no droppable at all. That is deliberate
 * rather than a limitation — a drop you cannot see land is not a gesture anyone
 * can aim, and dnd-kit would have to measure a zero-height target.
 */
export function SwimlaneSection({
  lane,
  name,
  icon,
  statuses,
  collapsed,
  onToggle,
  projectKey,
  labelsById,
  canWrite,
  onOpen,
}: {
  lane: Swimlane;
  /** Already resolved and translated — the section does not look names up. */
  name: string;
  /** An avatar or a priority glyph, drawn before the name. */
  icon?: ReactNode;
  statuses: readonly Status[];
  collapsed: boolean;
  onToggle: () => void;
  projectKey: string;
  labelsById: ReadonlyMap<string, Label>;
  canWrite: boolean;
  onOpen: (taskKey: string) => void;
}) {
  const { t } = useTranslation(['board']);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <section data-slot="swimlane" data-lane-id={lane.id} className="flex flex-col">
      <div className="sticky start-0 z-10 w-fit">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t('board:swimlanes.expand', { name })
              : t('board:swimlanes.collapse', { name })
          }
          className={cn(
            'flex items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-xs font-medium text-foreground',
            'transition-colors duration-[var(--speed)] hover:bg-accent',
          )}
        >
          {/* The chevron is directional but NOT mirrored: it points DOWN when
              open and toward the reading start when closed, and `rtl:` handles
              that half. */}
          <Chevron className="size-3.5 text-muted-foreground rtl:rotate-180" aria-hidden />
          {icon}
          <span className="truncate">{name}</span>
          <span
            className="text-muted-foreground tabular-nums"
            aria-label={t('board:swimlanes.count', { count: lane.count })}
          >
            {lane.count}
          </span>
        </button>
      </div>

      {collapsed ? null : (
        <div className="flex items-start gap-[var(--gap)] pb-2">
          {statuses.map((status) => (
            <div key={status.id} className={cn(COLUMN_WIDTH, 'shrink-0')}>
              <BoardCardList
                statusId={status.id}
                statusName={status.name}
                laneId={lane.id}
                tasks={lane.columns[status.id] ?? []}
                projectKey={projectKey}
                labelsById={labelsById}
                resolved={status.category === 'done'}
                disabled={!canWrite}
                onOpen={onOpen}
                className="bg-surface-raised/40"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default SwimlaneSection;
