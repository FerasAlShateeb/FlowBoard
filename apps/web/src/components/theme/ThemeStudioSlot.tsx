import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';

import { useLayoutStore } from '@/stores/useLayoutStore';
import { registerTopbarSlot } from '@/components/layout/TopbarSlots';
import { navigateApp } from '@/components/palette/app-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ThemeStudioDrawer from '@/components/theme/ThemeStudioDrawer';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The Theme Studio's mount point: the topbar button, and the drawer itself.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ THE BUTTON ═══════════════════════════════════════════════════════════
 *
 * Registered through `TopbarSlots` (zone `end`, order 25 — between the bell at
 * 20 and diagnostics at 30) rather than by editing `Topbar.tsx`, which belongs
 * to W1.3 this round. `render` returns a COMPONENT, per that registry's
 * contract: hooks live inside `ThemeStudioTrigger`, never in `render` itself.
 *
 * Not session-gated, and it does not need to be: the registry only paints
 * where a `<TopbarSlotZone/>` is mounted, and the only topbar in the app lives
 * inside the authenticated `AppShell`. (The bell gates itself because it also
 * fires QUERIES; this button fires nothing.)
 *
 * ═══ WHY THE DRAWER IS RENDERED HERE, NOT FROM THE SLOT ════════════════════
 *
 * A slot renders inside the topbar's flex row, and `TopbarSlots` is explicit
 * that a slot is "an icon button sized `size-7`". A 380px modal panel rendered
 * from inside a `z-30` header would also be trapped in the header's stacking
 * context, where `z-[100]` means "above the other things in the topbar" and
 * nothing more — the sidebar (`z-50`) and every Radix overlay would paint over
 * it. So the drawer is a sibling of the app, mounted from `AppProviders`
 * alongside `<PaletteMount/>`, which is the same answer that package reached
 * for the same reason (`components/palette/app-router.ts` documents the
 * rejected alternatives).
 *
 * THE PRICE IS ROUTER CONTEXT, and `navigateApp` is the toll. `AppProviders`
 * sits ABOVE `<RouterProvider/>`, so `useNavigate()` throws there and `<Link>`
 * cannot render; the drawer's "Advanced editor" row therefore pushes into the
 * router OBJECT instead — the API the context is a convenience over. Injected
 * as a prop rather than imported by the drawer, so the drawer stays testable
 * with a `vi.fn()`.
 */

/** The topbar's entry point — a `size-7` icon button, per the slot contract. */
function ThemeStudioTrigger() {
  const { t } = useTranslation(['theme']);
  const setOpen = useLayoutStore((state) => state.setThemeStudioOpen);
  const open = useLayoutStore((state) => state.themeStudioOpen);

  const label = t('theme:studio.open');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="theme-studio-trigger"
          aria-label={label}
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
          }}
          className="inline-flex size-7 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <Palette aria-hidden className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The headless mount. One line in `AppProviders`:
 *
 *     <ThemeStudioSlot />
 */
export function ThemeStudioSlot() {
  // The effect RETURNS `registerTopbarSlot`'s own unregister function, which is
  // StrictMode- and HMR-safe by construction (see `TopbarSlots.tsx`).
  useEffect(
    () =>
      registerTopbarSlot({
        id: 'theme-studio',
        zone: 'end',
        order: 25,
        render: () => <ThemeStudioTrigger />,
      }),
    [],
  );

  return <ThemeStudioDrawer navigate={navigateApp} />;
}

export default ThemeStudioSlot;
