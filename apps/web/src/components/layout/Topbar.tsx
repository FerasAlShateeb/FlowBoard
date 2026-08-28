import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Languages, LogOut, Menu, Moon, PanelLeft, Sun } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { setLangPref, useLang, type Lang } from '@/lib/lang-policy';
import { trackThemeChanged } from '@/lib/telemetry-client';
import { useRouteScope } from '@/hooks/useRouteScope';
import { useLogout, useMe } from '@/hooks/useAuth';
import { useOrgs } from '@/hooks/useOrgs';
import { setLastOrgSlug, useRememberLastOrg } from '@/hooks/useLastOrg';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { useThemeStore } from '@/stores/useThemeStore';
import { TopbarSlotZone } from '@/components/layout/TopbarSlots';
import UserAvatar from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
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
 * The 48px top bar: nav toggles, the org switcher, a breadcrumb slot, the
 * feature extension zones, and the appearance + account controls.
 *
 * EXTENSION POINT. The three `<TopbarSlotZone/>` elements are how Wave 4
 * features (notification bell, diagnostics toggle, palette trigger) reach the
 * topbar WITHOUT editing this file. See `TopbarSlots.tsx` for the full
 * rationale and the registration contract — that comment is the documentation.
 *
 * ORG SWITCHER (WP2.4) is fed by `useOrgs()` and remembers its choice under
 * `fb-last-org-v1`, which is what lets `/` resume where the user left off
 * rather than always landing on a picker.
 */

/** Shared icon-button recipe — a 28px square that disappears into the bar. */
const ICON_BTN =
  'inline-flex size-7 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground';

export default function Topbar() {
  const { t } = useTranslation(['common', 'auth']);
  const navigate = useNavigate();
  const lang = useLang();
  const { orgSlug } = useRouteScope();

  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const setMobileNavOpen = useLayoutStore((s) => s.setMobileNavOpen);

  const dark = useThemeStore((s) => s.dark);
  const toggleDark = useThemeStore((s) => s.toggleDark);

  // `/auth/me` is the authority on who is signed in; the persisted session is
  // the instant fallback so the avatar does not pop in a beat after the shell.
  const { data: session } = useMe();
  const storedUser = useAuthStore((s) => s.user);
  // `/auth/me` answers a session; the topbar only ever renders its `user` half.
  const user = session?.user ?? storedUser;
  const logout = useLogout();

  const { data: orgs } = useOrgs();
  const currentOrg = orgs?.find((org) => org.slug === orgSlug) ?? null;

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

  /** Switch organizations: remember the choice, then go to its home. */
  const chooseOrg = (slug: string) => {
    setLastOrgSlug(slug);
    void navigate(`/o/${slug}`);
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

      {/* Org switcher, fed by `qk.orgs.mine()`. A plain button (not a menu)
          when the user belongs to a single org: a dropdown with one item is a
          click that teaches nothing. */}
      {orgs && orgs.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="max-w-[12rem] gap-1.5 font-medium"
              data-testid="org-switcher"
              aria-label={t('common:nav.switchOrg')}
            >
              <Building2 className="size-3.5" aria-hidden />
              <span className="truncate">
                {currentOrg?.name ?? orgSlug ?? t('common:nav.noOrganization')}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>{t('common:nav.switchOrg')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onSelect={() => {
                  chooseOrg(org.slug);
                }}
              >
                <Building2 aria-hidden />
                <span className="truncate">{org.name}</span>
                {org.slug === orgSlug ? <Check className="ms-auto size-3.5" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="max-w-[12rem] gap-1.5 font-medium"
          data-testid="org-switcher"
          aria-label={t('common:nav.switchOrg')}
          disabled={!currentOrg}
          onClick={() => {
            if (currentOrg) chooseOrg(currentOrg.slug);
          }}
        >
          <Building2 className="size-3.5" aria-hidden />
          <span className="truncate">
            {currentOrg?.name ?? orgSlug ?? t('common:nav.noOrganization')}
          </span>
        </Button>
      )}

      {/*
        BREADCRUMB SLOT. Left empty in Wave 1 — a breadcrumb needs resolved
        names (project title, task summary) that only WP2.4's hooks can supply.
        Features that want to contribute to the START of the bar register a
        `zone: 'start'` slot rather than editing this file.
      */}
      <nav
        aria-label={t('common:nav.breadcrumb')}
        data-testid="breadcrumb-slot"
        className="hidden min-w-0 flex-1 items-center gap-1 md:flex"
      >
        <TopbarSlotZone zone="start" />
      </nav>

      {/* Centre zone: the command-palette trigger lands here (WP4.6). */}
      <div className="flex items-center gap-1">
        <TopbarSlotZone zone="center" />
      </div>

      <div className="ms-auto flex items-center gap-1">
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
            <DropdownMenuItem
              onSelect={() => {
                void navigate('/theme');
              }}
            >
              {t('common:nav.theme')}
            </DropdownMenuItem>
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
