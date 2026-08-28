import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/lang-policy';
import { Button } from '@/components/ui/button';
import type { CalendarView } from '@/components/calendar/calendar-dates';

/**
 * The calendar's chrome: where you are, how you move, and what you are looking
 * at.
 *
 * ═══ THE CHEVRONS ARE DIRECTION-AWARE ══════════════════════════════════════
 *
 * "Previous" points toward the reading START — left in English, RIGHT in
 * Arabic. This is one of the few places where a mirrored icon is not enough and
 * the icon COMPONENT has to swap, because `ChevronLeft` is a glyph, not a
 * layout: no logical CSS property can turn it around, and a page-wide
 * `rtl:rotate-180` (as `components/ui/calendar` uses on DayPicker's own nav)
 * would also flip the chevron inside any other control here. Swapping the two
 * components is the honest version, and it is one ternary.
 *
 * The BUTTON ORDER is left alone: they are laid out in the flex row's logical
 * order, so [prev][today][next] already mirrors itself.
 */

export interface CalendarToolbarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  /** The formatted period — `March 2026`, or the week's date range. */
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  trayOpen: boolean;
  onToggleTray: () => void;
  unscheduledCount: number;
}

export function CalendarToolbar({
  view,
  onViewChange,
  label,
  onPrevious,
  onNext,
  onToday,
  trayOpen,
  onToggleTray,
  unscheduledCount,
}: CalendarToolbarProps) {
  const { t } = useTranslation(['calendar', 'common']);
  const rtl = useLang() === 'ar';
  const PreviousIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onPrevious}
          aria-label={t('calendar:nav.previous')}
          title={t('calendar:nav.previous')}
        >
          <PreviousIcon aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          {t('calendar:nav.today')}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onNext}
          aria-label={t('calendar:nav.next')}
          title={t('calendar:nav.next')}
        >
          <NextIcon aria-hidden />
        </Button>
      </div>

      {/* `aria-live` so a screen reader announces the new period after a nav
          click — the button label never changes, only this does. */}
      <p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {label}
      </p>

      <div
        role="group"
        aria-label={t('calendar:views.label')}
        className="flex items-center rounded-[var(--btn-radius)] border border-border bg-surface p-0.5"
      >
        {(['month', 'week'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => onViewChange(option)}
            className={cn(
              'cursor-default rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium outline-none transition-colors duration-[var(--speed)] focus-visible:ring-2 focus-visible:ring-ring/60',
              view === option
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`calendar:views.${option}`)}
          </button>
        ))}
      </div>

      <Button
        variant={trayOpen ? 'secondary' : 'outline'}
        size="sm"
        onClick={onToggleTray}
        aria-pressed={trayOpen}
      >
        <Inbox aria-hidden />
        {t('calendar:tray.title')}
        {unscheduledCount > 0 ? (
          <span className="tabular-nums text-muted-foreground">{unscheduledCount}</span>
        ) : null}
      </Button>
    </div>
  );
}

export default CalendarToolbar;
