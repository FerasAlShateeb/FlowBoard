# Workflow: Add a view

A "view" is a page plus the component family behind it. This procedure keeps the
nine registration points in step — the router, both navigation surfaces, the
query keys, both locale catalogs, the four render states, and the realtime cache.
Worked from **the Calendar (`pages/project/CalendarPage.tsx` +
`components/calendar/**`) — the smallest complete view in the repo**, cross-checked
against `TablePage.tsx` + `components/datatable/**`. See
`architecture.md` → frontend architecture and `design-system.md` → the design
direction.

## Steps

1. **Register the route (`apps/web/src/routes/index.tsx`).** Every page is
   `React.lazy`, so a first visit downloads the shell and one view. A project
   view MUST carry `taskSheetRoute()` as a child, or every deep link into a task
   from that view breaks:

   ```tsx
   const CalendarPage = lazy(() => import('@/pages/project/CalendarPage'));
   // …
   { path: '/o/:orgSlug/p/:projectKey/calendar', element: <CalendarPage />, children: [taskSheetRoute()] },
   ```

   The page then renders `<Outlet />` at the end of its tree — that is where the
   sheet layers over the view without unmounting it.

2. **Add BOTH navigation entries.** They are separate files and forgetting the
   second is the classic miss: `components/layout/Sidebar.tsx` (add the item to
   `projectSection()` **and** widen the `NavItem['labelKey']` union) and
   `components/palette/palette-items.ts` (`PROJECT_VIEWS`, whose order is the
   Ctrl+K keyboard contract). Both point at the same `common:nav.*` key, so the
   two surfaces can never disagree on the name.

3. **Use the data hook that exists; add a query key only if none fits.**
   `lib/query-keys.ts` is the registry, and it carries a deliberate negative
   entry worth reading before you add anything: there is **no `calendar` key**,
   because the Calendar's window is `dueFrom`/`dueTo`/`startFrom`/`startTo` —
   ordinary filters — so `qk.tasks.list(projectId, {...})` already gives it one
   cache entry per grid, and one a filter-bar change invalidates correctly. Wrap
   the shared hook in a view-local one (`components/calendar/useCalendarTasks.ts`)
   that owns the selection and memoization.

4. **Extract the pure logic into `kebab-case.ts` modules.** The page file owns
   only wiring — state and callbacks. Everything decidable without a DOM lives
   beside it and is unit-tested directly: `calendar-dates.ts` (the date
   arithmetic), `calendar-layout.ts` (bar geometry), `calendar-dnd.ts` (what a
   drop MEANS — `reschedulePatch`, `resizePatch`, `nextChipIndex`). This is what
   makes the view testable in milliseconds instead of through a rendered grid,
   and it is why `CalendarPage.tsx` is 400 lines rather than 1,200.

5. **Create the locale namespace in BOTH catalogs and register it twice.** Add
   `locales/en/<ns>.ts` and `locales/ar/<ns>.ts` — key for key — then import and
   list them in `locales/en/index.ts` **and** `locales/ar/index.ts`. The
   namespace list (`i18n/index.ts` → `NAMESPACES`) is derived from the English
   catalog, so registering it there is all it takes; `i18n/i18next.d.ts` types
   `t()` against the same object, which is why a typo'd key is a build error.
   Consume it as `useTranslation(['calendar', 'common'])`. Details in
   [add-translated-string.md](./add-translated-string.md).

6. **Build all four states from `components/common/*`.** A view with only the
   populated state is not done. Calendar's shape, in order:

   ```tsx
   if (isPending) return <PageSpinner />; // scope still resolving
   if (error) return <ErrorState error={error} />; // project failed to load
   // inside the frame: tasksError → <ErrorState onRetry={refetch} />
   //                  tasksPending → <CalendarSkeleton />  (same shape, no content)
   //                  tasks.length === 0 → <EmptyState icon title message />
   ```

   Two loading states, not one: the page-level `PageSpinner` while the project
   scope resolves, and a **skeleton in the grid's own shape** while the rows
   load, so paging the cursor does not blank the chrome.

7. **Do the RTL pass.** Logical Tailwind utilities only — `ms-`/`me-`/`ps-`/`pe-`/
   `start-`/`end-`, never `ml-`/`pr-`/`left-`. Anything that is genuinely
   physical (a `transform` is not mirrored by `direction`) is written with
   `ltr:`/`rtl:` variants, as the sidebar drawer does. Keyboard geometry needs
   the flag explicitly: `CalendarPage` passes `rtl` into `nextChipIndex` so
   ArrowRight moves the focus ring the way the reader expects. Numbers and dates
   go through `lib/format.ts` with `getIntlLocale()`.

8. **Keyboard first.** Visible focus, a real tab order, no traps. For
   drag-and-drop, ship a documented keyboard equivalent and translated dnd-kit
   `announcements` — the Calendar narrates the task key and the day through the
   same `formatFullDate`/locale pair the grid labels use, because dnd-kit's
   English default ("dropped over droppable area 17") names neither and leaks
   English onto an Arabic page.

9. **Colocate the tests.** Vitest units next to each pure module
   (`calendar-dates.test.ts`, `calendar-dnd.test.ts`, `calendar-layout.test.ts`),
   a component test for the grid (`CalendarMonthView.test.tsx`), a hook test
   (`useCalendarTasks.test.tsx`), and shared fixtures in
   `calendar-test-fixtures.ts`. Never edit `components/ui/*` — those primitives
   are frozen; a missing variant goes in the handover.

10. **Wire realtime if the view shows live data.** A new cache the view owns must
    get an entry in `lib/realtime-cache.ts`, mapped to a specific query key.
    Follow [add-socket-event.md](./add-socket-event.md) — patch what the payload
    names, invalidate only what it cannot.

## Checklist

- [ ] Lazy route registered with `taskSheetRoute()` as a child; the page renders `<Outlet />`.
- [ ] Sidebar item **and** palette entry added, sharing one `common:nav.*` key.
- [ ] Query key reused, or a new one justified in `lib/query-keys.ts`.
- [ ] Pure logic extracted to `kebab-case.ts` modules, unit-tested without a DOM.
- [ ] `locales/en/<ns>.ts` + `locales/ar/<ns>.ts`, both registered in their `index.ts`.
- [ ] Loading, empty, error and populated states all present; skeleton matches the layout.
- [ ] Logical utilities throughout; RTL verified in Arabic; formatting via `lib/format.ts`.
- [ ] Focus visible, tab order sane, dnd has a keyboard path and translated announcements.
- [ ] Colocated tests for every pure module plus the grid and the hook.
- [ ] `components/ui/*` untouched.
- [ ] `pnpm turbo run build lint typecheck test` green.

## Related

- [design-system.md](../docs/design-system.md) — tokens, the frozen primitives, density.
- [i18n.md](../docs/i18n.md) — RTL mechanics and the physical-property exception table.
- [realtime.md](../docs/realtime.md) — the web cache-write mapping table.
- [architecture.md](../docs/architecture.md) — frontend architecture, query keys, the shell.
- [add-translated-string.md](./add-translated-string.md) — the namespace mechanics in detail.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
