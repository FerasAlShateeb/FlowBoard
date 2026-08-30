import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Check, ChevronsUpDown, Home, ShieldCheck } from 'lucide-react';

import { useRouteScope } from '@/hooks/useRouteScope';
import { useOrgs, useOrgsSearch, ORG_SERVER_SEARCH_THRESHOLD } from '@/hooks/useOrgs';
import { setLastOrgSlug } from '@/hooks/useLastOrg';
import { useInstanceConfig } from '@/hooks/useInstanceConfig';
import { useAuthStore } from '@/stores/useAuthStore';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The organization switcher.
 *
 * ═══ WHY IT IS A COMBOBOX AND NOT A MENU ═══════════════════════════════════
 *
 * The old switcher had two branches, and both were part of the admin trap. With
 * more than one org it was a `DropdownMenu` — fine, until an instance has
 * forty; with ONE org it was a **disabled button**, on the theory that "a
 * dropdown with one item is a click that teaches nothing". That reasoning was
 * right about the dropdown and wrong about the control: the switcher is not
 * only "change org", it is also the reader's statement of WHICH org they are in
 * and their route to the org list. Disabling it removed both, on precisely the
 * deployments (one org, one admin) where the rest of the chrome was thinnest.
 *
 * So there is now ONE control, always enabled, in the house command-in-popover
 * pattern (`Command` inside a `Popover`, the same shape `common/UserSelect`
 * uses): a filter field, the orgs with a check on the current one, and a footer
 * that ALWAYS offers "All organizations" and — for an effective global admin —
 * "Manage organizations". Those two rows are the escape route: they work on
 * `/admin/anything`, with no org in the URL and no membership anywhere.
 *
 * ═══ IT DISAPPEARS ENTIRELY IN SINGLE-ORG MODE ═════════════════════════════
 *
 * A single-org install has one workspace and no `/` picker worth the name, so a
 * switcher there is a control that can only ever do nothing. `useInstanceConfig`
 * degrades to `multi` when the config request has not answered, which is the
 * safe direction: a switcher that should have been hidden is clutter, whereas a
 * hidden switcher that should have been shown is the trap all over again.
 *
 * ═══ FILTERING: CLIENT UNTIL IT CANNOT BE ══════════════════════════════════
 *
 * `GET /orgs` returns the whole list and `useOrgs` caches it for five minutes,
 * so `ui/command`'s own matcher does the work — no request per keystroke, no
 * loading flicker inside an open popover. Past
 * {@link ORG_SERVER_SEARCH_THRESHOLD} the list is no longer a list you scroll,
 * and the needle goes to the server instead (`?q=`), with the client matcher
 * replaced by {@link MATCH_ALL} so the response is not filtered twice.
 */

/** The "server already filtered this" matcher. Stable identity by construction. */
const MATCH_ALL = () => true;

/** A footer row, dressed as a `CommandItem` so the popover reads as one list. */
const FOOTER_ROW =
  'flex w-full cursor-default items-center gap-2 rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-start text-sm transition-colors duration-[var(--speed)] hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none';

export default function OrgSwitcher() {
  const { t } = useTranslation(['common']);
  const navigate = useNavigate();
  const { orgSlug } = useRouteScope();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { orgMode } = useInstanceConfig();
  const effectiveAdmin = useAuthStore((state) => state.isEffectiveGlobalAdmin());

  const { data: orgs } = useOrgs();
  const all = orgs ?? [];
  const serverSearch = all.length > ORG_SERVER_SEARCH_THRESHOLD;
  // Only mounted past the threshold — below it this is a query that never runs.
  const { data: searched } = useOrgsSearch(query, { enabled: serverSearch && open });

  if (orgMode === 'single') return null;

  const options = serverSearch ? (searched ?? all) : all;
  const currentOrg = all.find((org) => org.slug === orgSlug) ?? null;

  const go = (to: string) => {
    setOpen(false);
    setQuery('');
    void navigate(to);
  };

  const chooseOrg = (slug: string) => {
    // Remembered BEFORE the navigation, so the sidebar's org fallback is
    // already right on the first render of the destination.
    setLastOrgSlug(slug);
    go(`/o/${slug}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="max-w-[12rem] gap-1.5 font-medium"
          data-testid="org-switcher"
          aria-label={t('common:nav.switchOrg')}
        >
          <Building2 className="size-3.5 shrink-0" aria-hidden />
          {/* An org NAME is user content: `dir="auto"` so a Latin name inside an
              Arabic session truncates from its tail rather than from the half
              that identifies it. */}
          <span dir="auto" className="truncate">
            {currentOrg?.name ?? t('common:nav.organizations')}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-0">
        {/* `filter` is what turns the client matcher OFF past the threshold: the
            server has already applied the needle, and matching the response a
            second time would drop every row whose match was on a field the
            client cannot see. Module scope, because `Command` memoises on the
            function's identity. */}
        <Command label={t('common:nav.switchOrg')} filter={serverSearch ? MATCH_ALL : undefined}>
          <CommandInput
            placeholder={t('common:nav.searchOrganizations')}
            // THE NEEDLE MIRROR. `Command` owns the input's value — its own
            // keyboard model depends on it — so the needle is read back out
            // with `onInput` rather than the field being controlled from here.
            // (`onChange` would be swallowed: the primitive's own handler is
            // what sets the state, and React lets only one own the prop.)
            onInput={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
          <CommandList>
            <CommandEmpty>{t('common:nav.noOrganizationsFound')}</CommandEmpty>

            <CommandGroup heading={t('common:nav.switchOrg')}>
              {options.map((org) => (
                <CommandItem
                  key={org.id}
                  // The NAME is what people type; the slug is what they saw in
                  // the address bar, so it rides along as a keyword.
                  value={org.name}
                  keywords={[org.slug]}
                  onSelect={() => {
                    chooseOrg(org.slug);
                  }}
                >
                  <Building2 aria-hidden />
                  <span dir="auto" className="truncate">
                    {org.name}
                  </span>
                  {org.slug === orgSlug ? <Check className="ms-auto size-3.5" aria-hidden /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          {/*
            THE ESCAPE ROUTE, and why it is a FOOTER rather than two more
            `CommandItem`s. A `CommandItem` is subject to the needle — the house
            primitive has no `forceMount` — so "All organizations" would vanish
            the moment somebody typed a name that does not exist, which is
            exactly the moment they most need a way out. Outside `CommandList`
            it is unconditional, and it is still keyboard-reachable: these are
            real buttons, one Tab from the field.
          */}
          <div className="border-t border-border p-1">
            <button
              type="button"
              className={FOOTER_ROW}
              onClick={() => {
                go('/');
              }}
            >
              <Home className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{t('common:nav.allOrganizations')}</span>
            </button>
            {effectiveAdmin ? (
              <button
                type="button"
                data-testid="org-switcher-manage"
                className={FOOTER_ROW}
                onClick={() => {
                  go('/admin/orgs');
                }}
              >
                <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{t('common:nav.manageOrganizations')}</span>
              </button>
            ) : null}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
