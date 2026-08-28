import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@flowboard/shared';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The footer: "1–25 of 312", the page controls, and the page-size picker.
 *
 * THE RANGE IS COMPUTED, NOT COUNTED. `rows.length` would say "25" on a page
 * that happens to be short, and the last page of 312 rows holds 12 — so the
 * range comes from `meta`, which the server is the authority on. When `meta` is
 * missing (the very first render, before the query resolves) the footer renders
 * its controls disabled rather than disappearing, so the layout does not jump.
 *
 * THE CHEVRONS ARE MIRRORED BY CSS, NOT BY CODE. `rtl:rotate-180` flips them
 * with the document direction; branching on the language here would put a
 * second source of truth for "which way is forward" next to the one `<html
 * dir>` already provides.
 *
 * DIGITS STAY WESTERN (`tabular-nums`, `dir="ltr"` on the numeric spans) in
 * both languages — see `lib/lang-policy`.
 */

/** The offered page sizes. 100 is the API's documented maximum. */
export const PAGE_SIZES = [25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export function TablePagination({
  meta,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  /** `undefined` until the first page resolves. */
  meta: PaginationMeta | undefined;
  page: number;
  pageSize: PageSize;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: PageSize) => void;
}) {
  const { t } = useTranslation(['table']);

  const total = meta?.total ?? 0;
  const totalPages = Math.max(meta?.totalPages ?? 1, 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
      <p aria-live="polite" className="tabular-nums">
        {total === 0 ? (
          t('table:footer.empty')
        ) : (
          <span dir="ltr">{t('table:footer.range', { from, to, total })}</span>
        )}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">{t('table:footer.rowsPerPage')}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(next) => {
              onPageSizeChange(Number(next) as PageSize);
            }}
          >
            <SelectTrigger size="sm" className="w-[4.5rem] tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} className="tabular-nums">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('table:footer.previous')}
            disabled={page <= 1}
            onClick={() => {
              onPageChange(page - 1);
            }}
          >
            <ChevronLeft aria-hidden className="rtl:rotate-180" />
          </Button>

          <span className="min-w-24 text-center tabular-nums" dir="ltr">
            {t('table:footer.page', { page, pages: totalPages })}
          </span>

          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('table:footer.next')}
            disabled={page >= totalPages}
            onClick={() => {
              onPageChange(page + 1);
            }}
          >
            <ChevronRight aria-hidden className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TablePagination;
