/**
 * Custom, DB-backed product telemetry.
 *
 * `record()` is fire-and-forget by contract: it returns `void`, never awaits,
 * never throws, and never rejects. A caller can drop it on the last line of a
 * mutation without a `try`/`catch` and without changing that mutation's
 * failure modes — which is the only way "every mutation records telemetry"
 * survives contact with real code.
 *
 * ── Injection ───────────────────────────────────────────────────────────────
 * WP1.2 must compile with zero imports from `src/db/**`, so the insert arrives
 * through `setTelemetrySink()`. With no sink configured `record()` is a no-op,
 * which is exactly what unit tests and the pre-integration build want.
 */
import type { TelemetryEventType } from '@flowboard/shared';
import type { TelemetryEventInsert } from '../types/persistence';

/**
 * Event vocabulary — the CLOSED zod enum in `@flowboard/shared`
 * (`telemetryEventTypeSchema`). The column is `text` validated by that enum
 * precisely so adding an event type is a shared-package change and a deploy,
 * never a migration; the type union is what makes a typo at a `record()` call
 * site a compile error rather than an unchartable row.
 */
export type { TelemetryEventType };

/** Persists one telemetry row. Injected by the integrator at boot. */
export type TelemetrySink = (event: TelemetryEventInsert) => Promise<void>;

/**
 * Optional entity ids to stamp on the event — the three the `telemetry_events`
 * table has COLUMNS for, and the three the admin dashboards group by.
 *
 * There is deliberately no `taskId` here. A per-task drill-down is not one of
 * the questions the analytics endpoints answer, and a fourth indexed FK column
 * that nothing charts is write amplification on the hottest append-only stream
 * in the product. A task id belongs in the `payload` bag:
 *
 *   record('task_created', { taskId: task.id, type: task.type }, { userId, projectId });
 */
export interface TelemetryContext {
  userId?: string | null;
  orgId?: string | null;
  projectId?: string | null;
}

let sink: TelemetrySink | null = null;

/**
 * Wire the persistence sink.
 *
 * INJECTION POINT — call once from the composition root:
 * `setTelemetrySink((event) => db.insert(telemetryEvents).values(event).then(() => undefined))`.
 * Pass `null` to detach (tests).
 */
export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next;
}

/** Whether a sink is currently wired — diagnostics and tests. */
export function hasTelemetrySink(): boolean {
  return sink !== null;
}

function noop(): void {
  /* telemetry is best-effort; failures are never surfaced */
}

/**
 * Record a telemetry event.
 *
 * @example
 *   record('task_created', { taskId: task.id, type: task.type }, { userId: actorId, projectId });
 */
export function record(
  type: TelemetryEventType,
  payload?: Record<string, unknown> | null,
  context: TelemetryContext = {},
): void {
  const current = sink;
  if (!current) return;

  const event: TelemetryEventInsert = {
    type,
    userId: context.userId ?? null,
    orgId: context.orgId ?? null,
    projectId: context.projectId ?? null,
    payload: payload ?? null,
  };

  try {
    void current(event).catch(noop);
  } catch {
    // A sink that throws SYNCHRONOUSLY (a mis-wired injection) must not take
    // the caller's mutation with it.
    noop();
  }
}
