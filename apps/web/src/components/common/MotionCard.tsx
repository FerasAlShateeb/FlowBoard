import { useTranslation } from 'react-i18next';

import { setMotionPref, useMotionPref, type MotionPref } from '@/lib/motion-policy';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/**
 * `/me` → Motion: how much the interface is allowed to move.
 *
 * WHY IT IS A CARD OF ITS OWN, not a row inside the profile form. Every other
 * field on this page is part of the USER RECORD — it goes to
 * `PATCH /api/users/me`, it follows the account to another device, and it is
 * saved by pressing a button. This is none of those things: it describes THIS
 * BROWSER, it is written straight to `localStorage` by `lib/motion-policy`, and
 * it takes effect the instant it is clicked. Folding a device preference into
 * an account form would put an unsaved-changes guard around a setting that has
 * already applied itself, and a Save button next to a control that does not
 * need one.
 *
 * It also earns its own heading because reduced motion is an accessibility
 * setting people go LOOKING for by name; buried as the fourth row of an
 * "Account" card it is effectively unfindable.
 *
 * ── WHY THREE OPTIONS AND NOT A SWITCH ──────────────────────────────────────
 * "Follow system" is a genuinely different answer from either fixed value, and
 * the DEFAULT is `full` — which deliberately outranks an OS that reports
 * `prefers-reduced-motion: reduce`. A two-state switch cannot express that:
 * Windows' Accessibility → "Animation effects" toggle, some remote-desktop
 * sessions and some power-saving modes assert that media feature without the
 * user having asked FlowBoard for anything, and a binary control would leave
 * them with no way to say "I know what my OS says; animate anyway". The hint
 * under each option is what makes the third one legible.
 *
 * A radio group rather than a `Select`: three short, mutually exclusive
 * options, all worth reading side by side, with their trade-offs visible
 * without opening a menu. Radix gives it roving focus and the RTL-aware arrow
 * mapping through the `Direction.Provider` in `AppProviders`.
 */

/** The options, in the order they are offered. `full` first — it is the default. */
const MOTION_OPTIONS: readonly MotionPref[] = ['full', 'reduced', 'system'];

export default function MotionCard() {
  const { t } = useTranslation(['settings']);
  // `useSyncExternalStore` under the hood, so this re-renders if the preference
  // is changed anywhere else — including by the OS, while `system` is selected.
  const motion = useMotionPref();

  return (
    <Card data-testid="motion-card">
      <CardHeader>
        <CardTitle>{t('settings:motion.title')}</CardTitle>
        <CardDescription>{t('settings:motion.subtitle')}</CardDescription>
      </CardHeader>

      <RadioGroup
        value={motion}
        onValueChange={(value) => {
          // The value can only be one of the three rendered below; the cast
          // names that rather than widening the policy's own signature.
          setMotionPref(value as MotionPref);
        }}
        className="gap-1.5"
        aria-label={t('settings:motion.label')}
        data-testid="prefs-motion"
      >
        {MOTION_OPTIONS.map((option) => (
          <label
            key={option}
            className="flex cursor-default items-start gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5 text-sm"
          >
            <RadioGroupItem value={option} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{t(`settings:motion.options.${option}.label`)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`settings:motion.options.${option}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>

      <p className="text-[11px] text-muted-foreground">{t('settings:motion.deviceNote')}</p>
    </Card>
  );
}
