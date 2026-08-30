import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Eye, Languages, LogOut, Menu, Moon, PanelLeft, ShieldCheck, Sun } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { setLangPref, useLang, type Lang } from '@/lib/lang-policy';
import { trackThemeChanged } from '@/lib/telemetry-client';
import { useLogout, useMe } from '@/hooks/useAuth';
import { useRememberLastOrg } from '@/hooks/useLastOrg';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { useThemeStore } from '@/stores/useThemeStore';
import { TopbarSlotZone } from '@/components/layout/TopbarSlots';
import OrgSwitcher from '@/components/layout/OrgSwitcher';
import ViewAsPill, { useViewAsSwitch } from '@/components/layout/ViewAsPill';
import Breadcrumbs, { useCurrentPageTitle } from '@/components/navigation/Breadcrumbs';
import UserAvatar from '@/components/common/UserAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The 48px top bar: nav toggles, the org switcher, the breadcrumb trail, the
 * feature extension zones, and the appearance + account controls.
 *
 * EXTENSION POINT. The three `<TopbarSlotZone/>` elements are how feature
 * packages (notification bell, diagnostics toggle, palette trigger) reach the
 * topbar WITHOUT editing this file. See `TopbarSlots.tsx` for the full
 * rationale and the registration contract — that comment is the documentation.
 *
 * ═══ WHAT ROUND 2 CHANGED ══════════════════════════════════════════════════
 *
 *  - **The org switcher moved out** to `OrgSwitcher.tsx` and stopped being a
 *    disabled button for single-org users. It was half of the admin trap; its
 *    own header explains the rest.
 *  - **The breadcrumb slot is no longer empty.** It was reserved in Wave 1 for
 *    "a later wave with resolved names" and the later wave never came back.
 *    `<Breadcrumbs/>` renders there DIRECTLY rather than registering a slot:
 *    the trail is not a feature bolted onto the shell, it is the shell's own
 *    statement of where you are, and it must exist on every route including the
 *    ones no feature package owns. The `zone="start"` registry stays open for
 *    the features that do want it.
 *  - **The mobile `<h1>`** is the last crumb, from the same source — a phone
 *    has no room for a trail but is still owed the name of the page.
 *  - **The "viewing as member" pill** sits at the head of the end zone, where a
 *    warning belongs: before the controls, not buried behind the avatar.
 */

/** Shared icon-button recipe — a 28px square that disappears into the bar. */
const ICON_BTN =
  'inline-flex size-7 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground';

export default function Topbar() {
  const { t } = useTranslation(['common', 'auth']);
  const navigate = useNavigate();
  const lang = useLang();
  const pageTitle = useCurrentPageTitle();
  const { realAdmin, viewingAsMember, switchView } = useViewAsSwitch();

  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const setMobileNavOpen = useLayoutStore((s) => s.setMobileNavOpen);
  const setThemeStudioOpen = useLayoutStore((s) => s.setThemeStudioOpen);

  const dark = useThemeStore((s) => s.dark);
  const toggleDark = useThemeStore((s) => s.toggleDark);

  // `/auth/me` is the authority on who is signed in; the persisted session is
  // the instant fallback so the avatar does not pop in a beat after the shell.
  const { data: session } = useMe();
  const storedUser = useAuthStore((s) => s.user);
  // `/auth/me` answers a session; the topbar only ever renders its `user` half.
  const user = session?.user ?? storedUser;
  const logout = useLogout();

  // One observer, high in the tree, catches every `/o/:orgSlug/*` navigation —
  // including a deep link straight to a board, which is exactly the visit worth
  // remembering.
  useRememberLastOrg();

  const displayName = user?.name ?? user?.email ?? '';

  /**
   * The language is device-local POLICY, not store state: `setLangPref` writes
   * it, restamps `<html lang|dir>`, and wakes both i18next and every
   * `useLang()` subscriber in one synchronous call.
   */
  const chooseLang = (next: Lang) => {
    setLangPref(next);
    // Named in the language it switches TO — a confirmation you can read after
    // the interface has already flipped. English resolves synchronously; the
    // Arabic catalog may land a tick later, which the fallback covers.
    toast(
      t('common:language.changed', {
        name: t(next === 'ar' ? 'common:language.arabic' : 'common:language.english'),
      }),
    );
  };

  /**
   * Sign out.
   *
   * The navigation happens in `onSettled`, not on success: `useLogout` already
   * tears the local session down whatever the server said, so the UI must
   * follow it out. An app that stays signed in because a request 500'd is a
   * security surprise, not a graceful failure.
   */
  const signOut = () => {
    logout.mutate(
      {},
      {
        onSettled: () => {
          toast(t('auth:session.signedOut'));
          void navigate('/login', { replace: true });
        },
      },
    );
  };

  /**
   * The light/dark toggle, plus its telemetry.
   *
   * `dark` is the value BEFORE the toggle, so the event reports the mode being
   * switched TO — which is what "theme_changed" has to mean for the admin
   * dashboard's counts to be readable.
   *
   * The value is a stable identity (`'light'` / `'dark'`), never a localized
   * label: an analytics stream that changes shape with the reader's language
   * cannot be grouped. That is the same rule the Theme Studio's preset switch
   * follows (`ColorsPanel` sends `'Ocean'`, not the translated card title), and
   * the two emitters share one event type on purpose — "what appearance did
   * people choose" is one question.
   *
   * `send()` is fire-and-forget and no-ops when signed out, so there is nothing
   * to guard and nothing that can make the toggle fail.
   */
  const toggleAppearance = () => {
    toggleDark();
    trackThemeChanged(dark ? 'light' : 'dark');
  };

  return (
    <header
      data-testid="topbar"
      className="relative z-30 flex h-[var(--topbar-h)] shrink-0 items-center gap-1.5 border-b border-border bg-[var(--topbar)] px-2 md:px-3"
    >
      <button
        type="button"
        className={cn(ICON_BTN, 'md:hidden')}
        aria-label={t('common:nav.openMenu')}
        onClick={() => {
          setMobileNavOpen(true);
        }}
      >
        <Menu className="size-4" />
      </button>

      <button
        type="button"
        className={cn(ICON_BTN, 'hidden md:inline-flex')}
        data-testid="topbar-collapse"
        aria-label={collapsed ? t('common:nav.expandSidebar') : t('common:nav.collapseSidebar')}
        aria-pressed={collapsed}
        onClick={toggleSidebar}
      >
        <PanelLeft className="size-4" />
      </button>

      <OrgSwitcher />

      {/*
        THE TRAIL. `<Breadcrumbs/>` renders here directly; the `zone="start"`
        registry stays open after it for feature packages that want to sit
        beside the trail. Desktop only — the `<h1>` below is the phone's answer
        to the same question.

        A `<div>`, not a `<nav>`: W3.1 moved the trail onto `ui/breadcrumb`, and
        that primitive's `<Breadcrumb>` IS the `<nav>` (it carries the same
        `common:nav.breadcrumb` accessible name). Keeping one here would nest a
        landmark inside a landmark — and would put the slot registry, which is
        not part of the trail, inside the trail's own navigation region.
      */}
      <div
        data-testid="breadcrumb-slot"
        className="hidden min-w-0 flex-1 items-center gap-1 md:flex"
      >
        <Breadcrumbs />
        <TopbarSlotZone zone="start" />
      </div>

      {/*
        The mobile page title — the last crumb, from the same builder, so the
        two surfaces can never disagree about what this page is called.

        NOT an `<h1>`, deliberately, even though GameDash's port is one:
        `common/PageHeader` already renders the page's real `h1` (and its own
        comment commits to being the ONLY one). A second `h1` naming the same
        page would give every mobile screen two competing document outlines. It
        stays a `span` — visible context while the content scrolls, and no new
        landmark for a screen reader that already has the heading below it.
      */}
      <span
        dir="auto"
        data-testid="topbar-page-title"
        className="min-w-0 flex-1 truncate text-sm font-semibold md:hidden"
      >
        {pageTitle}
      </span>

      {/* Centre zone: the command-palette trigger lands here (WP4.6). */}
      <div className="flex items-center gap-1">
        <TopbarSlotZone zone="center" />
      </div>

      <div className="ms-auto flex items-center gap-1">
        <ViewAsPill />

        {/* End zone: notification bell (WP4.2), diagnostics toggle (WP4.4). */}
        <TopbarSlotZone zone="end" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={ICON_BTN}
              data-testid="dark-toggle"
              aria-label={
                dark ? t('common:appearance.toggleLight') : t('common:appearance.toggleDark')
              }
              aria-pressed={dark}
              onClick={toggleAppearance}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {dark ? t('common:appearance.toggleLight') : t('common:appearance.toggleDark')}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ICON_BTN} aria-label={t('common:language.label')}>
              <Languages className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('common:language.label')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={lang}
              onValueChange={(value) => {
                chooseLang(value === 'ar' ? 'ar' : 'en');
              }}
            >
              <DropdownMenuRadioItem value="en">
                {t('common:language.english')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ar">
                {t('common:language.arabic')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={t('common:nav.userMenu')}
              data-testid="user-menu"
            >
              <UserAvatar
                user={user ? { id: user.id, name: displayName, avatarUrl: user.avatarUrl } : null}
                size="sm"
                label=""
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {/* An unauthenticated topbar is not reachable (RequireAuth wraps the
                shell), but the label still degrades rather than rendering an
                empty row if the store is mid-clear. */}
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-foreground">
                {displayName || t('common:nav.userMenu')}
              </span>
              {user?.email ? (
                <span className="truncate text-[11px] font-normal text-muted-foreground" dir="ltr">
                  {user.email}
                </span>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void navigate('/me');
              }}
            >
              {t('common:nav.profile')}
            </DropdownMenuItem>
            {/*
              THE DRAWER, NOT THE PAGE (W3.1).

              Round 2 made the Theme Studio a slide-over: it applies live over
              whatever you are looking at, which is the whole point of choosing
              a theme — you judge it against a real board, not against an empty
              settings page. Navigating away to `/theme` threw that context out
              and, worse, threw away the user's place in the app for a decision
              they usually reverse in ten seconds.

              `/theme` still exists as the ADVANCED editor (the raw token table
              plus its dirty-state guard) and the drawer's footer links to it,
              so nothing became unreachable — the default door just stopped
              being the deep one.
            */}
            <DropdownMenuItem
              data-testid="user-menu-theme"
              onSelect={() => {
                setThemeStudioOpen(true);
              }}
            >
              {t('common:nav.theme')}
            </DropdownMenuItem>

            {/*
              THE VIEW SWITCH — gated on the REAL admin flag, never the
              effective one. Gating it on `isEffectiveGlobalAdmin()` would make
              the control that turns member view OFF disappear the instant it
              was turned on, which is a one-way door with a `localStorage` key
              behind it. (The pill is the other way back; both must work.)
            */}
            {realAdmin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="view-as-toggle"
                  onSelect={() => {
                    switchView(!viewingAsMember);
                  }}
                >
                  {viewingAsMember ? <ShieldCheck /> : <Eye />}
                  {viewingAsMember ? t('common:nav.viewAsAdmin') : t('common:nav.viewAsMember')}
                </DropdownMenuItem>
              </>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={logout.isPending} onSelect={signOut}>
              <LogOut />
              {t('common:actions.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
