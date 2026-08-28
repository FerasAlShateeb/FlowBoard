import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { TelemetryEventRow } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import TelemetryEventBadge from './TelemetryEventBadge';
import { useTelemetryFormat } from './telemetry-format';

/**
 * The raw event stream, one row per event.
 *
 * ── THE PAYLOAD IS BEHIND AN EXPANDER, AND THAT IS THE DESIGN ───────────────
 * `payload` is an uninterpreted jsonb bag whose shape differs per event type:
 * a `page_view` carries a path, a `search_performed` a query and a result
 * count. Rendering it inline would either need one column per key (impossible —
 * the keys are open) or a truncated blob in a cell nobody can read. So the
 * table stays four scannable columns and the detail is one click away, which is
 * the same trade the diagnostics drawer makes with a log line's context.
 *
 * The expanded row is a real `<tr>` with a `colSpan`, not an absolutely
 * positioned popover: it has to be copy-pasteable, and a popover that closes on
 * blur is not.
 *
 * ── THE ACTOR CELL IS A FILTER ──────────────────────────────────────────────
 * Clicking a name filters the feed to that user. This is why the page needs no
 * user picker: FlowBoard has no global user-directory endpoint that is not
 * org-scoped, and "the person on the row in front of me" is the only actor
 * anyone actually wants to filter by while reading a feed.
 *
 * ── DIRECTION ───────────────────────────────────────────────────────────────
 * Timestamps and the payload JSON are `dir="ltr"` islands inside an otherwise
 * mirrored table, for the same reason a path is: they are machine text, and a
 * brace or a colon rendered at the reading end of an RTL run lands in the wrong
 * place.
 */
export function TelemetryEventsTable({
  rows,
  onFilterUser,
  className,
}: {
  rows: readonly TelemetryEventRow[];
  /** Clicking an actor narrows the feed to them. Omitted: names are plain text. */
  onFilterUser?: (userId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation(['admin']);
  const format = useTelemetryFormat();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {/* The expander column has no visible header; the empty cell keeps
              the column count honest for assistive technology. */}
          <TableHead className="w-8">
            <span className="sr-only">{t('admin:events.column.details')}</span>
          </TableHead>
          <TableHead>{t('admin:events.column.time')}</TableHead>
          <TableHead>{t('admin:events.column.type')}</TableHead>
          <TableHead>{t('admin:events.column.user')}</TableHead>
          <TableHead>{t('admin:events.column.project')}</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => {
          const isOpen = expanded.has(row.id);
          const hasPayload = row.payload !== null && Object.keys(row.payload).length > 0;

          return (
            <Fragment key={row.id}>
              <TableRow data-testid="telemetry-event-row">
                <TableCell>
                  {hasPayload ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-expanded={isOpen}
                      aria-label={t('admin:events.column.details')}
                      onClick={() => {
                        toggle(row.id);
                      }}
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn(
                          'transition-transform duration-[var(--speed)] rtl:-rotate-180',
                          isOpen && 'rotate-90 rtl:-rotate-90',
                        )}
                      />
                    </Button>
                  ) : null}
                </TableCell>

                <TableCell
                  dir="ltr"
                  className="whitespace-nowrap text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
                >
                  {format.stamp(row.createdAt)}
                </TableCell>

                <TableCell>
                  <TelemetryEventBadge type={row.type} />
                </TableCell>

                <TableCell className="max-w-40 truncate text-xs">
                  {row.userName === null || row.userId === null ? (
                    <span className="text-muted-foreground">{t('admin:events.system')}</span>
                  ) : onFilterUser ? (
                    <button
                      type="button"
                      className="truncate text-foreground underline-offset-2 hover:underline"
                      onClick={() => {
                        onFilterUser(row.userId ?? '');
                      }}
                    >
                      {row.userName}
                    </button>
                  ) : (
                    <span className="text-foreground">{row.userName}</span>
                  )}
                </TableCell>

                <TableCell dir="ltr" className="max-w-40 truncate font-mono text-[11px]">
                  {row.projectId ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>

              {isOpen && row.payload ? (
                <TableRow data-testid="telemetry-event-payload">
                  <TableCell colSpan={5} className="bg-surface-raised/40">
                    <pre
                      dir="ltr"
                      className="overflow-x-auto rounded-[var(--radius)] border border-border bg-surface p-2 font-mono text-[11px] text-muted-foreground"
                    >
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default TelemetryEventsTable;
