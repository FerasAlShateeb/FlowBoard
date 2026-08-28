import { useTranslation } from 'react-i18next';
import { Maximize2, LocateFixed, Waypoints } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ZOOM_LEVELS, type GanttZoom } from '@/components/gantt/useGanttGeometry';

/**
 * The roadmap toolbar: zoom, "today", fit, and the dependency toggle.
 *
 * The zoom control is a SEGMENTED group rather than a `<Select>`: there are
 * exactly three values, they are ordered, and the current one is worth showing
 * at all times — a dropdown would hide two thirds of a control the user changes
 * constantly. It is a `role="group"` of `aria-pressed` buttons, so a screen
 * reader reads it as three toggles with one on, which is what it is.
 */
export interface GanttZoomControlsProps {
  zoom: GanttZoom;
  onZoomChange: (zoom: GanttZoom) => void;
  onToday: () => void;
  /** False when today falls outside the derived range — the button is disabled. */
  todayAvailable: boolean;
  onFit: () => void;
  showDependencies: boolean;
  onToggleDependencies: (next: boolean) => void;
}

export function GanttZoomControls({
  zoom,
  onZoomChange,
  onToday,
  todayAvailable,
  onFit,
  showDependencies,
  onToggleDependencies,
}: GanttZoomControlsProps) {
  const { t } = useTranslation(['roadmap']);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div
        role="group"
        aria-label={t('roadmap:zoom.label')}
        className="flex items-center rounded-[var(--btn-radius)] border border-border bg-surface p-0.5"
      >
        {ZOOM_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={zoom === level}
            data-testid={`gantt-zoom-${level}`}
            className={cn(
              'rounded-[calc(var(--btn-radius)-2px)] px-2 py-0.5 text-xs font-medium transition-colors duration-[var(--speed)]',
              zoom === level
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              onZoomChange(level);
            }}
          >
            {t(`roadmap:zoom.${level}`)}
          </button>
        ))}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!todayAvailable}
            data-testid="gantt-today"
            onClick={onToday}
          >
            <LocateFixed aria-hidden />
            {t('roadmap:actions.today')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('roadmap:actions.todayHint')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('roadmap:actions.fit')}
            onClick={onFit}
          >
            <Maximize2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('roadmap:actions.fitHint')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={showDependencies ? 'secondary' : 'outline'}
            size="icon-sm"
            aria-pressed={showDependencies}
            aria-label={t('roadmap:actions.dependencies')}
            data-testid="gantt-dependencies-toggle"
            onClick={() => {
              onToggleDependencies(!showDependencies);
            }}
          >
            <Waypoints aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('roadmap:actions.dependenciesHint')}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export default GanttZoomControls;
