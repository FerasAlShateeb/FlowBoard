# Workflow: Add an API endpoint

Adds a REST endpoint to `apps/api` without breaking the three things that hold
the API together: the `{success,data,meta?,error?}` envelope, a zod parse at
every boundary, and the `routes → controllers → services → db` layering. Worked
end to end from **`labels.*` — the smallest complete quartet in the repo**
(four files, ~250 lines, one full role matrix). Read
`architecture.md` → the request lifecycle for the mechanics, and
`coding-standards.md` → services: layering, transactions, and the mutation trio
for what a mutation owes.

## Steps

1. **Define the contract in `packages/shared` first.** The entity, the request
   input, and the list response all live in one domain schema file —
   `packages/shared/src/projects.schema.ts` holds `labelSchema`,
   `createLabelInputSchema` and `updateLabelInputSchema`. Both ends import it,
   so a field rename is a compile error in the web app rather than a 422 nobody
   sees. Export it from `packages/shared/src/index.ts`.

2. **Write the validation file** — `apps/api/src/validation/<domain>.validation.ts`.
   It composes the shared body schemas with the route's own **params** shape and
   re-exports both plus their inferred types. This is the only file that knows
   the URL has a `:projectId` in it:

   ```ts
   // apps/api/src/validation/labels.validation.ts
   export const labelParamsSchema = z.object({ projectId: uuid, labelId: uuid });
   export type LabelParams = z.infer<typeof labelParamsSchema>;
   export { createLabelInputSchema, updateLabelInputSchema };
   export type CreateLabelBody = z.infer<typeof createLabelInputSchema>;
   ```

3. **Wire the route thin** — `apps/api/src/routes/<domain>.routes.ts`. Order is
   normative: `validate(params)` → role guard → `validate(body)` → handler.
   **The params parse must precede the guard**, because `requireProjectRole`
   reads `req.params` to resolve the project, and a non-uuid should be a 422
   from zod rather than a lookup miss. Wrap every handler in `asyncHandler`.

   ```ts
   labelsRouter.use(requireAuth);
   labelsRouter.post(
     '/',
     validate(labelListParamsSchema, 'params'),
     requireProjectRole('member', 'projectId'),
     validate(createLabelInputSchema),
     asyncHandler(createLabel),
   );
   ```

   **Pick the floor deliberately.** Labels sit at `member`, not `admin`, because
   tagging is part of doing the work — see the header comment in
   `labels.routes.ts`. Reads are `viewer`, writes `member`, settings `admin`.

4. **Write the controller** — `apps/api/src/controllers/<domain>.controller.ts`.
   It translates HTTP to a service call and back, and it reads its inputs
   through the **typed accessors, never off `req`**: `getParsed<T>(res, part)`
   returns the schema's own output type (Express 5 types `req.query` as
   `ParsedQs` forever), and `getProjectAccess(res)` returns the membership the
   guard already resolved. Answer through `respond` / `respondNoContent`; never
   build an envelope by hand.

   ```ts
   export async function createLabel(req: Request, res: Response): Promise<void> {
     const access = getProjectAccess(res);
     const body = getParsed<CreateLabelBody>(res);
     respond(
       res,
       await labelsService.createLabel(access.projectId, body, actorContext(req, res)),
       undefined,
       201,
     );
   }
   ```

   `actorContext(req, res)` is the local two-liner every controller in the
   domain shares: `{ actorId: requireUser(req).id, socketId: getSocketId(res) }`.
   The socket id comes from `X-Socket-Id` and is what makes echo suppression
   work three layers down — see `add-socket-event.md`.

5. **Write the service** — `apps/api/src/services/<domain>.service.ts`. The only
   layer allowed to import `../db`. A mutation opens `withTx`, and **inside the
   transaction** writes the row and appends the activity entry
   (`recordActivity`, or a domain wrapper like `recordWorkflowChange`); **after
   it commits** it calls `record()` for telemetry and `publishDomainEvent()`.
   Publishing inside the transaction would broadcast a change that then rolled
   back. Map pg errors with `isUniqueViolation` / `isForeignKeyViolation` from
   `services/pg-errors.ts` and throw `ApiError.conflict(...)`; the single
   `errorHandler` owns every error envelope.

   ```ts
   const created = await withTx(async (tx) => {
     try {
       [row] = await tx
         .insert(labels)
         .values({ projectId, ...input })
         .returning();
     } catch (error) {
       if (isUniqueViolation(error))
         throw ApiError.conflict('A label with that name already exists in this project');
       throw error;
     }
     await recordWorkflowChange(tx, projectId, context, 'label', null, {
       id: row.id,
       name: row.name,
     });
     return row;
   });
   announceWorkflowChange(projectId, context, 'labels'); // publishes after commit
   ```

6. **Mount it in `apps/api/src/routes/index.ts`.** Mount order is normative —
   **specific prefixes before root-stacked routers** — and the file's header
   explains the three deliberate cross-mount overlaps. `labelsRouter` is
   composed by `projects.routes.ts`, not mounted here; a genuinely new top-level
   domain gets one line in the registry and one line in the barrel export.

7. **Test with supertest** — `apps/api/src/routes/__tests__/<domain>.routes.test.ts`,
   modelled on `labels.routes.test.ts`. Build the app with `createTestApp()` and
   the world with `createProjectWorld()` from `./fixtures`; `ensureTestDb()` in
   `beforeAll`, `truncateAllTables()` in `beforeEach`. Cover, at minimum: the
   happy path and its envelope, **422** (`color: 'slate'`), **409** (duplicate),
   **404** (an id from another project), and the **role matrix** — a viewer is
   refused a write, an org member with no project role is refused a read. If the
   mutation publishes, assert it: subscribe with `onDomainEvent(...)`, push into
   an array, and `clearDomainEventHandlers()` in `afterEach`.

8. **Add the web hook and its query key.** `apps/web/src/lib/query-keys.ts`
   first — check whether a key already exists before inventing one. Then a hook
   in `apps/web/src/hooks/`, parsing the response with the same shared schema
   (`useLabels` / `useCreateLabel` in `hooks/useProjects.ts`), and invalidating
   every cache the write touches — `useLabelInvalidation` invalidates both
   `qk.project.labels` and `qk.project.detail`, because the project payload
   embeds its own copy.

9. **Update the docs.** The endpoint table in the relevant `.agents/docs/*.md`,
   and tick the row in [../checklists/project-checklist.md](../checklists/project-checklist.md).

## Checklist

- [ ] Request + response zod schemas in `@flowboard/shared`, exported from the barrel.
- [ ] Validation file composes shared body schemas with the route's params shape.
- [ ] Route is thin: `validate(params)` → guard → `validate(body)` → `asyncHandler`.
- [ ] Role floor chosen deliberately (viewer / member / admin) and justified in a comment.
- [ ] Controller uses `getParsed` + `getProjectAccess`; answers via `respond`.
- [ ] Service owns Drizzle; activity inside `withTx`, telemetry + domain event after commit.
- [ ] pg errors mapped to `ApiError`; no hand-built error envelopes.
- [ ] Mounted in `routes/index.ts` respecting the specific-before-root ordering.
- [ ] Supertest covers happy + 422 + 409/404 + the role matrix + the published event.
- [ ] Web hook + query key added; every affected cache invalidated.
- [ ] `pnpm turbo run build lint typecheck test` green.

## Related

- [architecture.md](../docs/architecture.md) — the request lifecycle, the layering rule and its two exceptions.
- [coding-standards.md](../docs/coding-standards.md) — zod at every boundary; the mutation trio a service owes.
- [auth.md](../docs/auth.md) — the role-resolution chain behind `requireProjectRole`.
- [testing.md](../docs/testing.md) — the supertest app builders and the one test database.
- [add-socket-event.md](./add-socket-event.md) — when the mutation must reach other tabs.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
