import { SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TableChromeCopy } from '@/components/dashboard/chrome-copy';

/** One hideable column, as the menu sees it. */
export interface ColumnToggle {
  id: string;
  label: string;
  visible: boolean;
  onToggle: (visible: boolean) => void;
}

/**
 * The "Columns" dropdown for {@link import('../DataTable').DataTable} — one
 * checkbox item per hideable column.
 *
 * Columns declared `enableHiding: false` (and the table's own selection and
 * actions cells, which are not TanStack columns at all) never reach this list,
 * so a caller cannot hide a row's identity or its escape hatch.
 *
 * ═══ `onSelect` IS PREVENTED ON EVERY ITEM ═══════════════════════════════
 *
 * Radix closes a menu when an item is selected, which is right for a command
 * and wrong for a checkbox: hiding four columns would mean opening the menu
 * four times. `event.preventDefault()` keeps it open, and the menu closes on
 * Escape or an outside click like any other.
 *
 * ═══ NO `aria-label` ON THE ITEMS ════════════════════════════════════════
 *
 * A checkbox item's accessible name is its visible text, which is already the
 * column's name. An `aria-label` would REPLACE that name, so the item a sighted
 * user calls "Assignee" would announce as something else — and the e2e specs
 * address these by name.
 *
 * Renders nothing when no column can be hidden: an empty menu is a control that
 * lies about having options.
 */
export function ColumnsMenu({ columns, copy }: { columns: ColumnToggle[]; copy: TableChromeCopy }) {
  if (columns.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="table-columns-menu">
          <SlidersHorizontal className="size-3.5" aria-hidden />
          {copy.columns.button}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{copy.columns.heading}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            onCheckedChange={(next) => {
              column.onToggle(next === true);
            }}
            onSelect={(event) => {
              event.preventDefault();
            }}
            data-testid={`table-column-${column.id}`}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
