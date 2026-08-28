# checklists — Verify-Against Lists

The lists used to track FlowBoard's progress and to verify it against its spec.

| File                                           | What it's for                                                                                                                                                                                                                                                                                                                                                                        | Who uses it                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [project-checklist.md](./project-checklist.md) | The **master verification checklist** — 263 granular items across sections A–E: functionality (auth, roles, workflow, tasks, sprints, ranking, the five views, palette, realtime, all seven notification types, telemetry + diagnostics, CSV), design/UX, i18n/RTL, standards, and ops. Rows describe shipped behaviour, so an unticked box means "not verified", never "not built". | Everyone. The final review pass runs it end to end.                    |
| [review-checklist.md](./review-checklist.md)   | The per-change spot-check list — 62 items over nine sections: layering, the no-`any` gate, zod boundaries, naming, i18n/RTL (including both exemption tables), tokens and design, data correctness, realtime/notifications/telemetry, and tests.                                                                                                                                     | Reviewer subagents (Sonnet 5), and anyone opening a change for review. |

**Evidence, not opinion.** Both lists are pass/fail _with evidence_ — a
`file:line`, a test id, or pasted command output. An item you did not actually
observe stays unticked with a note explaining what is missing. A checklist full
of optimistic ticks is worse than no checklist, because it makes the gap
invisible.

See the master [.agents/INDEX.md](../INDEX.md).
