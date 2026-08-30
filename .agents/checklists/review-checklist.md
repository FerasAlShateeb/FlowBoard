# Review Checklist

For reviewer subagents ([../subagents/reviewer.md](../subagents/reviewer.md),
Sonnet 5) and for anyone reviewing a change. Evaluate each item with a
**pass/fail plus evidence** (`file:line` or a test id). Reviewers read and
verify; they do not write product code.

**The boxes here stay empty.** This file is a template applied per change, not a
running record like `project-checklist.md` — a reviewer copies it, fills it in
against one diff, and the copy is the artefact. A tick committed here would be a
claim about a review that has already ended.

## 1. Layering and structure

- [ ] No Drizzle / database import in a route or a controller file. The **three**
      sanctioned exceptions elsewhere in the stack are `sockets/socket-reads.ts`,
      `bootstrap.ts` and `middlewares/require-roles.ts`
      ([../docs/architecture.md](../docs/architecture.md) §3.2–3.4) — a fourth is
      a finding, not a judgement call.
- [ ] No `req` / `res` object below the controller layer.
- [ ] Services own the business rules; controllers only translate HTTP.
- [ ] New API domains arrive as complete quartets: `*.routes.ts`, `*.controller.ts`,
      `*.service.ts`, `*.validation.ts`. The one shipped exception is `admin-logs`,
      which has no service because it reads an in-memory ring buffer rather than a
      table (§3.5) — do not treat it as a precedent for a domain that touches the db.
- [ ] Services publish domain events; they never import the socket layer.
- [ ] Multi-write operations are inside a transaction, together with their activity row, telemetry event, and domain event.
- [ ] Shared/router/index files were not edited by a non-integration agent mid-wave.

## 2. Types and the no-`any` gate

- [ ] Zero `any` — including `as any`, `any[]`, and `Record<string, any>`.
- [ ] `unknown` + a zod parse is used where the shape genuinely is not known.
- [ ] No `@ts-ignore` / `@ts-expect-error` without an explanatory comment naming the reason.
- [ ] `noUncheckedIndexedAccess` respected: indexed access is narrowed, not `!`-asserted.
- [ ] No non-null assertions used to silence a legitimate `undefined`.

## 3. Zod boundaries

- [ ] Every new endpoint validates params, query, and body through `validate(schema, part)`.
- [ ] Request/response schemas live in `@flowboard/shared`, not inline in the API.
- [ ] The web client parses the response — no `as Task` casts over `await res.json()`.
      **Check this one by reading**: `lib/api.ts` accepts a call with no schema and
      returns the body unparsed, so a missing parse fails nothing and the build stays
      green. It is a convention, not a gate (recorded in `project-checklist.md` §F2).
- [ ] Socket payloads are parsed before being handled.
- [ ] Forms use RHF + `zodResolver` over the same shared schema the API validates with.
- [ ] The response uses the `{success,data,meta?,error?}` envelope.
- [ ] Errors are thrown as `ApiError`; no hand-built error envelope outside the error handler.

## 4. Naming and conventions

- [ ] Components `PascalCase.tsx`, hooks `useThing.ts`, stores `useThingStore.ts`, everything else `kebab-case.ts`.
- [ ] Zod schema is `thingSchema` with a matching `type Thing`.
- [ ] Socket events are `scope:verb`.
- [ ] REST paths use plural nouns.
- [ ] localStorage keys are `fb-<name>-v1`.
- [ ] Query keys come from `lib/query-keys.ts` — none constructed inline.

## 5. i18n and RTL

- [ ] No hardcoded user-facing strings; everything goes through `t()`.
- [ ] New keys exist in **both** `locales/en/<ns>.ts` and `locales/ar/<ns>.ts` — the Arabic catalogue is complete and stays complete; `locales.test.ts` fails on a gap.
- [ ] Plural keys carry the **full CLDR set for Arabic** (`zero/one/two/few/many/other`), not just `one`/`other`.
- [ ] Keys are named for meaning, not for the English text.
- [ ] Interpolation is used instead of string concatenation.
- [ ] **Only logical properties**: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`. No `ml-`, `pr-`, `left-`, `right-`, `text-left` — **unless the file is on the exemption table in [../docs/i18n.md](../docs/i18n.md)**, and adding to that table needs a stated reason.
- [ ] Any new `dir="ltr"` island is deliberate, bounded, and documented (the Gantt axis, charts, and the diagnostics dock are the existing ones).
- [ ] User-generated text (titles, comments, names) renders with `dir="auto"` so a mixed-script string does not scramble the line. (`dir="auto"` is the convention; `<bdi>` is not used anywhere — do not add a second one.)
- [ ] Directional icons mirror in RTL — either by `rtl:rotate-180` (the default) or,
      where a blanket rotate would also catch icons that must not move, by swapping
      the icon component. Both techniques are in use and tabulated in
      [../docs/i18n.md](../docs/i18n.md) §5.3; a new one needs a row there.
- [ ] Numbers render as Western digits in Arabic, formatted through `lib/format.ts` — never hand-concatenated.
- [ ] A form does not translate its own field errors; shared zod messages are translated once in `FormMessage`.
- [ ] **Shared chrome does not call `t()` at a call site.** A string rendered by
      `components/dashboard/**` comes from `chrome-copy.ts`, and any **new borrow
      from another namespace has a row in that file's KEPT/MINTED table with a
      reason**. A borrow whose source key names a different thing that merely
      reads the same today should be minted into `common:grid.*` instead — that
      is the mistake the W3.1 review found three times.
- [ ] A config module that stores an i18n key stores a **typed literal**
      (`NavLabelKey`, `AnalyticsKey`, `labelKey`) and resolves it at the render
      site — never `t()` at module scope
      ([../docs/i18n.md](../docs/i18n.md) §2.5, §11.1).

## 6. Tokens and design

- [ ] No hex, `rgb()`, or raw colour literal — the legitimate holders are a **closed exemption table** in [../docs/design-system.md](../docs/design-system.md); a new one outside it is a finding.
- [ ] Charts read `--chart-*` only.
- [ ] Both light and dark are complete for the new UI, and the Theme Studio's tokens still drive it (no value hard-coded past `applyTheme()`).
- [ ] `components/ui/*` primitives were used as-is, not edited (that folder is frozen).
- [ ] Loading, empty, and error states all exist.
- [ ] Focus-visible styling present; keyboard path works; overlays trap and restore focus.
- [ ] New global chords are registered through `lib/shortcuts.ts` — not a loose `keydown` listener — so the `?` cheat sheet stays truthful.
- [ ] Every failed mutation surfaces a toast.
- [ ] **Anything that moves is either a `--speed` transition or a registry
      entry.** A new animation needs a row in `lib/motion-registry.ts` with all
      three answers filled in — what CSS could not express, how it is driven, and
      **what the reduced branch renders** — and a `motion` import needs its file
      in `MOTION_LIBRARY_FILES`. The reduced branch must keep the same copy,
      affordances and `data-testid`. Prefer a `data-motion`-gated keyframe in
      `index.css` §B, which enforces itself, over the library
      ([../docs/motion.md](../docs/motion.md) §4, §7).
- [ ] **A range control uses the vocabulary that answers its question.**
      `7d/30d/90d/12m` → `components/dashboard/RangePicker`; sprints →
      `reports/ReportRangePicker`; 24 h or "All time" →
      `admin/TelemetryRangePicker`. A fourth picker, or a fourth preset list, is
      a finding ([../docs/design-system.md](../docs/design-system.md) §10.3).
- [ ] The right card: `ReportCard` for a grid of same-shaped chart tiles,
      `PanelCard` for a page of differently-shaped panels — and a `PanelCard`
      states a skeleton that reserves the height its content will take
      (design-system.md §10.2).
- [ ] A new grid's filters, sort and paging round-trip through
      `useGridUrlState`; column visibility, order and density stay in memory.

## 7. Data correctness

- [ ] Soft-delete filters (`deleted_at IS NULL`) present on every new read path.
- [ ] Pagination applied where a list can grow, with a deterministic `ORDER BY`.
- [ ] New query paths have a supporting index.
- [ ] Rank changes recompute server-side from neighbour ids, never trusting the client value.
- [ ] Permission guard present and correct on every new route — especially that a viewer cannot write.

## 8. Realtime, notifications, telemetry

- [ ] A new socket event is in `packages/shared/src/socket/events.schema.ts`, named `scope:verb`, and is **parsed before it is emitted** by the bridge.
- [ ] The emit is scoped to a room and excludes `originSocketId` — the actor must not receive their own echo.
- [ ] The web side maps the event to a specific query key in `lib/realtime-cache.ts`; a blanket invalidate is a fallback, not the design.
- [ ] A new notification trigger fans out to the right audience (assignee, mentions, watchers) with a **denormalized** payload — no live joins at read time.
- [ ] The mutation records its telemetry event exactly once, and `record()` is **not** awaited.
- [ ] Any new admin aggregation is computed in SQL, not in JavaScript, and keeps the documented math (percentile, half-open buckets, 5xx-only error rate).
- [ ] A log line you expect to see in the diagnostics drawer goes through pino, not `console`.

## 9. Tests

- [ ] Tests are colocated `*.test.ts` beside the code they test.
- [ ] New endpoints have supertest coverage for the happy path, a zod rejection, and the role matrix.
- [ ] New pure logic (rank, geometry, aggregation) has unit tests.
- [ ] Tests assert behaviour, not implementation details.
- [ ] No test was skipped or weakened to make the suite pass.
- [ ] `pnpm turbo run build lint typecheck test` is green on the change.

Back to [checklists/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
