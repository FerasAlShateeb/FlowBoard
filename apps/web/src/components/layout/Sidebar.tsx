import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useRouteScope } from '@/hooks/useRouteScope';
import { getLastOrgSlug } from '@/hooks/useLastOrg';
import { useInstanceConfig } from '@/hooks/useInstanceConfig';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { buildSections } from '@/components/navigation/nav.config';
import SidebarItem from '@/components/layout/SidebarItem';
import BrandMark from '@/components/common/BrandMark';

/**
 * The primary navigation column.
 *
 * ═══ WHAT ROUND 2 CHANGED, AND WHY ═════════════════════════════════════════
 *
 * This file used to BUILD the navigation as well as render it, and it built it
 * from `useRouteScope().orgSlug` alone. On `/admin/users` — a route with no
 * `/o/:orgSlug` in it — that produced a Workspace section with no organization
 * links at all. Add a brand mark that was not a link and an org switcher that
 * rendered as a *disabled* button for anyone in a single org, and a global
 * admin who walked into the console had no chrome route back out of it. That is
 * the "admin trap" the Round 2 audit named.
 *
 * The model now lives in `components/navigation/nav.config.ts`, which resolves
 * the org from `orgSlug ?? lastOrgSlug ?? defaultOrgSlug` and always emits a
 * Home row. This file is what is left once the decisions moved out: three
 * layout behaviours and a loop.
 *
 *   - **COLLAPSED MODE** keeps the icons and drops the labels; each row grows a
 *     tooltip (`SidebarItem`), because an icon rail with no names is a memory
 *     test.
 *   - **MOBILE** is the same element as an off-canvas drawer: `fixed` plus a
 *     translate written with `ltr:`/`rtl:` variants, because a transform is not
 *     mirrored by `direction` the way a logical inset is.
 *   - **THE BRAND IS A LINK.** One escape route that needs no org, no
 *     membership and no resolved query — and the one every user already expects
 *     a product's logo to be.
 */
export default function Sidebar() {
  const { t } = useTranslation(['common']);
  const { orgSlug, projectKey } = useRouteScope();
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const mobileNavOpen = useLayoutStore((s) => s.mobileNavOpen);
  // EFFECTIVE, not real: an admin previewing the product as a member must not
  // see the two admin sections. The API re-checks every one of those routes.
  const effectiveAdmin = useAuthStore((s) => s.isEffectiveGlobalAdmin());
  const { defaultOrgSlug } = useInstanceConfig();

  const sections = useMemo(
    () =>
      buildSections({
        orgSlug,
        projectKey,
        effectiveAdmin,
        defaultOrgSlug,
        // Read at render rather than held in state: it is a single string in
        // `localStorage` that changes on navigation, and every navigation
        // re-renders this component anyway.
        lastOrgSlug: getLastOrgSlug(),
      }),
    [orgSlug, projectKey, effectiveAdmin, defaultOrgSlug],
  );

  // On mobile the drawer always shows full labels, whatever the desktop
  // collapse says — a 56px rail is not a mobile navigation pattern.
  const showCollapsed = collapsed && !mobileNavOpen;

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
          'flex h-[var(--topbar-h)] shrink-0 items-center border-b border-border px-3',
          showCollapsed && 'md:justify-center md:px-0',
        )}
      >
        <Link
          to="/"
          data-testid="brand-home"
          aria-label={t('common:nav.home')}
          onClick={() => {
            useLayoutStore.getState().setMobileNavOpen(false);
          }}
          className="flex min-w-0 items-center gap-2 rounded-[var(--btn-radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <BrandMark size={22} />
          {/* The product name is a BRAND — never translated, in any locale. */}
          <span className={cn('truncate text-sm font-semibold', showCollapsed && 'md:hidden')}>
            FlowBoard
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((section) => (
          <div key={section.id} className="mb-3 last:mb-0">
            {/* Collapsed, the heading has nowhere to go, so the grouping is
                carried by a hairline instead — the rail keeps its rhythm
                without pretending an 11px word fits in 56px. */}
            {showCollapsed ? (
              <div className="mx-2 mb-2 hidden border-t border-border first:border-t-0 md:block" />
            ) : null}
            <div
              className={cn(
                'mb-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase',
                showCollapsed && 'md:hidden',
              )}
            >
              {t(section.labelKey)}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarItem key={item.id} item={item} collapsed={showCollapsed} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
