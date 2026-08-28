import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  ChartGantt,
  CircleUser,
  LayoutDashboard,
  ListOrdered,
  Palette,
  Settings,
  ShieldCheck,
  SquareKanban,
  Table2,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { orgPath, projectPath, useRouteScope } from '@/hooks/useRouteScope';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import BrandMark from '@/components/common/BrandMark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The primary navigation column.
 *
 * THREE SECTIONS, and which of them exist depends on where you are:
 *   - **Project** — only inside `/o/:orgSlug/p/:projectKey/*`. These are the
 *     five views plus the dashboard, and their paths are built from the CURRENT
 *     org/project via `useRouteScope()`, so the same component serves every
 *     project without a single hard-coded slug.
 *   - **Workspace** — the org pages plus the personal ones. Always present once
 *     an org is in scope.
 *   - **Administration** — global-admin only, hidden entirely otherwise (the
 *     API re-checks; this is chrome, not a security boundary).
 *
 * COLLAPSED MODE keeps the icons and drops the labels, and each item grows a
 * tooltip — an icon rail with no names is a memory test.
 *
 * MOBILE is the same element as an off-canvas drawer: `fixed` + a translate
 * that is written with `ltr:`/`rtl:` variants, because a transform is not
 * mirrored by `direction` the way a logical inset is.
 */

interface NavItem {
  id: string;
  to: string;
  labelKey:
    | 'common:nav.board'
    | 'common:nav.backlog'
    | 'common:nav.roadmap'
    | 'common:nav.table'
    | 'common:nav.calendar'
    | 'common:nav.dashboard'
    | 'common:nav.projectSettings'
    | 'common:nav.organization'
    | 'common:nav.teams'
    | 'common:nav.members'
    | 'common:nav.orgSettings'
    | 'common:nav.notifications'
    | 'common:nav.profile'
    | 'common:nav.theme'
    | 'common:nav.adminUsers'
    | 'common:nav.adminTelemetry';
  icon: ComponentType<{ className?: string }>;
  /** Exact match only — for a path that is a prefix of its own children. */
  end?: boolean;
}

interface NavSection {
  id: string;
  titleKey: 'common:nav.projectSection' | 'common:nav.workspaceSection' | 'common:nav.adminSection';
  items: NavItem[];
}

function projectSection(orgSlug: string, projectKey: string): NavSection {
  const at = (view: string) => projectPath(orgSlug, projectKey, view);
  return {
    id: 'project',
    titleKey: 'common:nav.projectSection',
    items: [
      { id: 'board', to: at('board'), labelKey: 'common:nav.board', icon: SquareKanban },
      { id: 'backlog', to: at('backlog'), labelKey: 'common:nav.backlog', icon: ListOrdered },
      { id: 'roadmap', to: at('roadmap'), labelKey: 'common:nav.roadmap', icon: ChartGantt },
      { id: 'table', to: at('table'), labelKey: 'common:nav.table', icon: Table2 },
      { id: 'calendar', to: at('calendar'), labelKey: 'common:nav.calendar', icon: CalendarDays },
      {
        id: 'dashboard',
        to: at('dashboard'),
        labelKey: 'common:nav.dashboard',
        icon: LayoutDashboard,
      },
      {
        id: 'project-settings',
        to: at('settings'),
        labelKey: 'common:nav.projectSettings',
        icon: Settings,
      },
    ],
  };
}

function workspaceSection(orgSlug: string | null): NavSection {
  const items: NavItem[] = [];

  if (orgSlug) {
    items.push(
      {
        id: 'org-home',
        to: orgPath(orgSlug),
        labelKey: 'common:nav.organization',
        icon: Building2,
        end: true,
      },
      { id: 'org-teams', to: orgPath(orgSlug, 'teams'), labelKey: 'common:nav.teams', icon: Users },
      {
        id: 'org-members',
        to: orgPath(orgSlug, 'members'),
        labelKey: 'common:nav.members',
        icon: Users,
      },
      {
        id: 'org-settings',
        to: orgPath(orgSlug, 'settings'),
        labelKey: 'common:nav.orgSettings',
        icon: Settings,
      },
    );
  }

  items.push(
    { id: 'notifications', to: '/notifications', labelKey: 'common:nav.notifications', icon: Bell },
    { id: 'profile', to: '/me', labelKey: 'common:nav.profile', icon: CircleUser },
    { id: 'theme', to: '/theme', labelKey: 'common:nav.theme', icon: Palette },
  );

  return { id: 'workspace', titleKey: 'common:nav.workspaceSection', items };
}

const ADMIN_SECTION: NavSection = {
  id: 'admin',
  titleKey: 'common:nav.adminSection',
  items: [
    {
      id: 'admin-users',
      to: '/admin/users',
      labelKey: 'common:nav.adminUsers',
      icon: ShieldCheck,
    },
    {
      id: 'admin-telemetry',
      to: '/admin/telemetry',
      labelKey: 'common:nav.adminTelemetry',
      icon: Activity,
      end: true,
    },
  ],
};

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation(['common']);
  const closeMobileNav = useLayoutStore((s) => s.setMobileNavOpen);
  const Icon = item.icon;
  const label = t(item.labelKey);

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={() => {
        closeMobileNav(false);
      }}
      className={({ isActive }) =>
        cn(
          'group/nav-link relative flex h-7 items-center gap-2 rounded-[var(--btn-radius)] px-2 text-xs font-medium transition-colors duration-[var(--speed)]',
          collapsed && 'md:justify-center md:px-0',
          isActive
            ? 'bg-sidebar-accent text-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The active marker is an inset-inline-start bar, so it mirrors under
              RTL with no variant. Rendered inside the link (not as a border) so
              it can be shorter than the row. */}
          <span
            aria-hidden
            className={cn(
              'absolute start-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-[var(--speed)]',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Icon className="size-4 shrink-0" />
          <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return <li>{link}</li>;

  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </li>
  );
}

export default function Sidebar() {
  const { t } = useTranslation(['common']);
  const { orgSlug, projectKey } = useRouteScope();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const mobileNavOpen = useLayoutStore((s) => s.mobileNavOpen);
  const isGlobalAdmin = useAuthStore((s) => s.isGlobalAdmin());

  // On mobile the drawer always shows full labels, whatever the desktop
  // collapse says — a 56px rail is not a mobile navigation pattern.
  const showCollapsed = collapsed && !mobileNavOpen;

  const sections: NavSection[] = [];
  if (orgSlug && projectKey) sections.push(projectSection(orgSlug, projectKey));
  sections.push(workspaceSection(orgSlug));
  if (isGlobalAdmin) sections.push(ADMIN_SECTION);

  return (
    <aside
      aria-label={t('common:nav.sidebarLabel')}
      data-testid="sidebar"
      className={cn(
        // Mobile: fixed off-canvas drawer.
        'fixed inset-y-0 start-0 z-50 flex w-[var(--sidebar-w)] flex-col border-e border-border bg-sidebar',
        'transition-transform duration-[var(--speed)]',
        mobileNavOpen
          ? 'max-md:translate-x-0'
          : 'max-md:ltr:-translate-x-full max-md:rtl:translate-x-full',
        // Desktop: a static column whose width is a token.
        'md:static md:z-auto md:translate-x-0 md:transition-[width]',
        collapsed ? 'md:w-[var(--sidebar-wc)]' : 'md:w-[var(--sidebar-w)]',
      )}
    >
      <div
        className={cn(
          'flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-border px-3',
          showCollapsed && 'md:justify-center md:px-0',
        )}
      >
        <BrandMark size={22} />
        {/* The product name is a BRAND — never translated, in any locale. */}
        <span className={cn('truncate text-sm font-semibold', showCollapsed && 'md:hidden')}>
          FlowBoard
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((section) => (
          <div key={section.id} className="mb-3 last:mb-0">
            <div
              className={cn(
                'mb-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase',
                showCollapsed && 'md:hidden',
              )}
            >
              {t(section.titleKey)}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarLink key={item.id} item={item} collapsed={showCollapsed} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
