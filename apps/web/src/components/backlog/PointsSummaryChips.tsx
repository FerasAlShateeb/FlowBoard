import { useTranslation } from 'react-i18next';
import { CircleCheck, Hash, ListTree } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getIntlLocale, useLang } from '@/lib/lang-policy';
import { Badge } from '@/components/ui/badge';
import { formatPoints, type PointsSummary } from '@/components/backlog/backlog-points';

/**
 * The three figures in a section header: how many rows, how many points, how
 * many of those points are already done.
 *
 * WHY THREE CHIPS AND NOT A SENTENCE. This sits in a header row that also holds
 * a name, a state badge, a date range and a menu, in a layout that has to
 * survive a long Arabic sprint name. Three fixed-width-ish chips wrap
 * predictably; a sentence does not — and a sentence would need plurals, which
 * this namespace deliberately has none of.
 *
 * THE NUMBERS ARE LABELLED, NOT DECORATIVE. Each chip carries an `aria-label`
 * naming what the figure is, because "12 · 34 pts · 8 done" read aloud in
 * sequence is noise. The icons stay `aria-hidden` on top of that.
 */
export function PointsSummaryChips({
  summary,
  className,
}: {
  summary: PointsSummary;
  className?: string;
}) {
  const { t } = useTranslation(['backlog']);
  // Re-render (and re-format) when the language changes: `getIntlLocale()` is a
  // plain read, so without this the digits and separators would stay in the
  // previous locale until something else happened to re-render the header.
  useLang();
  const locale = getIntlLocale();

  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)}>
      <Badge variant="outline" aria-label={t('backlog:summary.tasksLabel')}>
        <ListTree aria-hidden />
        {new Intl.NumberFormat(locale).format(summary.count)}
      </Badge>

      <Badge variant="soft-primary" aria-label={t('backlog:summary.pointsLabel')}>
        <Hash aria-hidden />
        {t('backlog:summary.points', { points: formatPoints(summary.totalPoints, locale) })}
      </Badge>

      {/* Only once something is finished: a permanent "0 done" chip on a sprint
          nobody has started yet is noise, not information. */}
      {summary.donePoints > 0 ? (
        <Badge variant="soft-success" aria-label={t('backlog:summary.donePointsLabel')}>
          <CircleCheck aria-hidden />
          {t('backlog:summary.donePoints', { points: formatPoints(summary.donePoints, locale) })}
        </Badge>
      ) : null}
    </div>
  );
}

export default PointsSummaryChips;
