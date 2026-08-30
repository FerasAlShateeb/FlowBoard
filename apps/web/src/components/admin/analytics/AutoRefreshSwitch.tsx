import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** How often an armed switch re-reads. Exported so tests assert the number. */
export const AUTO_REFRESH_MS = 30_000;

/**
 * The opt-in 30-second refresh, for the two surfaces read while something is
 * on fire (the ops overview and the Traffic dashboard).
 *
 * ═══ OPT-IN, NEVER DEFAULT ═══════════════════════════════════════════════
 *
 * A dashboard that re-reads itself unasked is one that renumbers under a
 * reader's cursor mid-sentence, re-runs four aggregate scans against Postgres
 * every half minute for a tab nobody is looking at, and — before the store kept
 * warm data — flashed a skeleton over an answer someone was still reading. So
 * the interval is a control, off until somebody wants it, exactly as GameDash
 * ships it.
 *
 * ═══ THE INTERVAL IS RE-ARMED, NOT RE-CREATED ════════════════════════════
 *
 * `onRefresh` is a page-local closure and therefore a new function every
 * render; putting it in the dependency array would clear and restart the timer
 * on every keystroke elsewhere on the page, so the refresh could be starved
 * indefinitely and never actually fire. The callback lives in a ref that the
 * render updates, and the effect depends only on `enabled` — which is the one
 * fact that should ever start or stop a timer.
 *
 * The switch does NOT fire an immediate refresh when it is turned on: the page
 * was loaded moments ago, and a request on the click would read as the toggle
 * having a side effect rather than a schedule.
 */
export interface AutoRefreshSwitchProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** Called every {@link AUTO_REFRESH_MS} while `enabled`. */
  onRefresh: () => void;
  /** `data-testid` on the switch itself. */
  testId?: string;
}

export function AutoRefreshSwitch({
  enabled,
  onEnabledChange,
  onRefresh,
  testId = 'analytics-auto-refresh',
}: AutoRefreshSwitchProps) {
  const { t } = useTranslation(['analytics']);
  const id = useId();

  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      refreshRef.current();
    }, AUTO_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [enabled]);

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        size="sm"
        checked={enabled}
        onCheckedChange={onEnabledChange}
        title={t('analytics:autoRefresh.hint')}
        data-testid={testId}
      />
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {t('analytics:autoRefresh.label')}
      </Label>
    </div>
  );
}

export default AutoRefreshSwitch;
