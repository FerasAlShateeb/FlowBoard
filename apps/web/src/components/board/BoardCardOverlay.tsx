import { BoardCardFace, type BoardCardFaceProps } from '@/components/board/BoardCard';

/**
 * The card that rides the pointer inside dnd-kit's `DragOverlay`.
 *
 * WHY IT EXISTS AT ALL. The overlay is rendered OUTSIDE the scroll containers
 * (portal-adjacent, fixed to the viewport), which is the only way a card can
 * travel between two independently scrolling columns without being clipped by
 * the one it started in. The sortable card stays where it was, dimmed, so the
 * column keeps its height and its neighbours do not jump.
 *
 * WHY IT REUSES `BoardCardFace` RATHER THAN `BoardCard`. Two `useSortable`
 * hooks registered under one id is a broken drag: dnd-kit would measure the
 * overlay as the sortable node and the card would chase its own shadow.
 *
 * THE LIFT IS DELIBERATELY SMALL — about one degree of rotation and the
 * elevated shadow, both from `lifted`. Enough to read as "in the air"; not
 * enough to obscure what is under it, which is the thing the user is aiming at.
 */
export function BoardCardOverlay(props: Omit<BoardCardFaceProps, 'lifted'>) {
  return (
    <div
      data-slot="board-card-overlay"
      // `w-full` inside dnd-kit's overlay wrapper, which is already sized to
      // the source node — so the card in the air is exactly as wide as the gap
      // it left behind.
      className="w-full cursor-grabbing"
    >
      <BoardCardFace {...props} lifted />
    </div>
  );
}

export default BoardCardOverlay;
