import { Suspense, lazy, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Direction } from 'radix-ui';

import { queryClient } from '@/lib/query-client';
import { useLang } from '@/lib/lang-policy';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import PaletteMount from '@/components/palette/PaletteMount';
import ThemeStudioSlot from '@/components/theme/ThemeStudioSlot';

/**
 * Every context the app needs, in one place.
 *
 * ORDER MATTERS, outermost first:
 *
 * 1. `QueryClientProvider` — the server-state cache. Outermost so a provider
 *    below it (or any devtool) can reach the client.
 * 2. `Direction.Provider` — NOT redundant with `<html dir>`. Radix primitives
 *    read direction from THIS CONTEXT, not from the DOM, and default to `ltr`
 *    when no provider is mounted. Without it an Arabic session gets a correctly
 *    mirrored layout whose dropdowns, selects and sliders still open and
 *    arrow-key the English way. `useLang()` (not `i18n.language`) is the
 *    source: the policy is the one synchronous, subscribable answer, and it is
 *    already what stamped `<html dir>` — so the DOM and this context can never
 *    disagree.
 * 3. `TooltipProvider` — mounted ONCE here rather than per tooltip, so the
 *    shared "skip delay" grace window works: after the first tooltip opens,
 *    moving along a toolbar shows the rest instantly.
 *
 * `Direction` comes off the unified `radix-ui` package (it re-exports
 * `@radix-ui/react-direction` as `Direction`), which is why no separate
 * `@radix-ui/react-direction` dependency is installed.
 *
 * ═══ WP4.6: `<PaletteMount/>` — the keyboard layer ═════════════════════════
 *
 * The command palette, the `?` cheat sheet, the `c` quick-create and the single
 * global keydown listener, mounted AFTER `{children}` so their overlays paint
 * above the app rather than under it.
 *
 * IT IS OUTSIDE ROUTER CONTEXT, ON PURPOSE AND UNAVOIDABLY: `main.tsx` renders
 * `<AppProviders><RouterProvider/></AppProviders>`, so `{children}` IS the
 * router and a sibling of it cannot call `useNavigate()`. `PaletteMount` reads
 * the location off the router object instead and passes navigation down as a
 * prop — see `components/palette/app-router.ts` for why that is the right
 * answer here and what the rejected alternatives were. Everything else it
 * needs — the query client, i18n, the direction and tooltip providers — is in
 * scope precisely BECAUSE it sits here.
 */

/**
 * TanStack Query's devtools — DEV ONLY, and genuinely absent from the
 * production bundle.
 *
 * The shape of this expression is load-bearing. Vite replaces
 * `import.meta.env.DEV` with the literal `false` in a production build, which
 * makes the whole consequent dead code — so Rollup drops the `lazy()` call AND
 * the `import()` inside it, and the ~230KB devtools chunk is never emitted.
 *
 * Writing it the obvious way instead — `const X = lazy(() => import(…))` at
 * module scope, rendered behind `{dev ? <X/> : null}` — does NOT work: the
 * dynamic import sits outside the branch, so it stays in the module graph and
 * ships as a real chunk that production never loads. (Verified against the
 * build output; this was that mistake, fixed.)
 */
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const mod = await import('@tanstack/react-query-devtools');
      return { default: mod.ReactQueryDevtools };
    })
  : null;

export default function AppProviders({ children }: { children: ReactNode }) {
  const lang = useLang();

  return (
    <QueryClientProvider client={queryClient}>
      <Direction.Provider dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <TooltipProvider>
          {children}
          {/* The keyboard layer: Ctrl+K, `?`, `c`. See the note above — it is
              deliberately a sibling of the router, not a child of it. */}
          <PaletteMount />
          {/* The Theme Studio drawer (Round 2 §Theme D5) and its topbar button.
              Here, beside the palette, for the same two reasons: a modal panel
              belongs above the app rather than inside the topbar's `z-30`
              stacking context, and this is the one place a feature can mount
              itself without editing the shell. It navigates through the router
              OBJECT (`navigateApp`) because, like the palette, it is above
              `<RouterProvider/>` — see `components/theme/ThemeStudioSlot.tsx`. */}
          <ThemeStudioSlot />
          {/* The single toast host. Inside the direction provider so an Arabic
              toast lays out right-to-left. */}
          <Toaster />
          {ReactQueryDevtools ? (
            <Suspense fallback={null}>
              <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
            </Suspense>
          ) : null}
        </TooltipProvider>
      </Direction.Provider>
    </QueryClientProvider>
  );
}
