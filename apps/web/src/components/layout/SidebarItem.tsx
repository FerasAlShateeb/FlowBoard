import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { isRTL, useLang } from '@/lib/lang-policy';
import { useLayoutStore } from '@/stores/useLayoutStore';
import type { NavItem } from '@/components/navigation/nav.config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * One sidebar row.
 *
 * Split out of `Sidebar.tsx` in Round 2 for the reason every leaf eventually
 * gets its own file: the COLLAPSED branch is where all the subtlety is, and it
 * was buried under the section-building logic that this component no longer
 * knows anything about (that now lives in `navigation/nav.config.ts`).
 *
 * ── THE COLLAPSED RAIL ──────────────────────────────────────────────────────
 *
 * Collapsed, a row is an icon with no words, so the label has to come from
 * somewhere. It is the house `Tooltip`, configured per item:
 *
 *  - `delayDuration={150}` — `0` makes every icon flash as the pointer merely
 *    travels down the rail; 150 ms kills the drive-by flicker and still feels
 *    instant on a deliberate hover.
 *  - `disableHoverableContent` — the bubble must not be reachable: moving
 *    toward it closes it, exactly like a native `title` would.
 *
 * THE TRIGGER IS THE SPAN IDIOM (`<span className="contents">` inside
 * `TooltipTrigger asChild`), never `asChild` wrapped straight around the
 * `NavLink`. `asChild` merges Radix's `data-state`/`data-slot` onto its child,
 * and a `NavLink` also owns `aria-current` and a function-child render — the
 * span is what absorbs the Radix props so neither library is editing the
 * other's element. React's focus events bubble, so focusing the inner link
 * still opens the tooltip: keyboard parity with hover, for free.
 *
 * The EXPANDED path mounts no tooltip at all — the label is already on screen.
 */

export interface SidebarItemProps {
  item: NavItem;
  /** True on the desktop icon rail. The mobile drawer is never collapsed. */
  collapsed: boolean;
}

export default function SidebarItem({ item, collapsed }: SidebarItemProps) {
  const { t } = useTranslation(['common']);
  const setMobileNavOpen = useLayoutStore((s) => s.setMobileNavOpen);
  // Subscribing to the language is what re-renders the tooltip onto the other
  // physical side when the interface flips — `isRTL()` is a plain read and
  // would otherwise stay whatever it was at mount.
  useLang();

  const Icon = item.icon;
  const label = t(item.labelKey);

  const link = (
    <NavLink
      to={item.path}
      end={item.end ?? item.path === '/'}
      onClick={() => {
        setMobileNavOpen(false);
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
          {/* The active marker is an inset-inline-START bar, so it mirrors under
              RTL with no variant. Rendered inside the link (not as a border) so
              it can be shorter than the row. */}
          <span
            aria-hidden
            className={cn(
              'absolute start-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-[var(--speed)]',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return <li>{link}</li>;

  return (
    <li>
      <Tooltip delayDuration={150} disableHoverableContent>
        {/* `contents` so the wrapper adds no box of its own — the row's height
            and hit area stay exactly what the link declares. */}
        <TooltipTrigger asChild>
          <span className="contents">{link}</span>
        </TooltipTrigger>
        {/* A PHYSICAL side, chosen from the direction: the rail sits at the
            inline start, so the bubble always opens away from it — right under
            LTR, left under RTL. `side="right"` alone put it on top of the rail
            in Arabic. */}
        <TooltipContent side={isRTL() ? 'left' : 'right'}>{label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
