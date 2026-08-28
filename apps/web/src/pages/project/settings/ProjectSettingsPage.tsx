import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import PageSpinner from '@/components/common/PageSpinner';

/**
 * Project settings LAYOUT route: the section tabs plus an `<Outlet/>`.
 *
 * A layout (rather than four independent pages) so switching tabs keeps the
 * heading and the tab strip mounted — which is what makes the workflow editor's
 * unsaved-changes guard possible in WP2.4.
 *
 * Links are RELATIVE (`to="workflow"`, `to="."`), so this file never has to
 * know the `/o/:orgSlug/p/:projectKey/settings` prefix it is mounted under.
 */
const TABS = [
  { to: '.', end: true, labelKey: 'common:nav.general' },
  { to: 'workflow', end: false, labelKey: 'common:nav.workflow' },
  { to: 'members', end: false, labelKey: 'common:nav.members' },
  { to: 'labels', end: false, labelKey: 'common:nav.labels' },
] as const;

export default function ProjectSettingsPage() {
  const { t } = useTranslation(['common']);

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <h1 className="text-base font-semibold">{t('common:nav.projectSettings')}</h1>

      <nav
        aria-label={t('common:nav.projectSettings')}
        className="flex items-center gap-1 border-b border-border"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                // `-mb-px` pulls the active underline onto the container's own
                // border so the two read as one line rather than two.
                '-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors duration-[var(--speed)]',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<PageSpinner />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
