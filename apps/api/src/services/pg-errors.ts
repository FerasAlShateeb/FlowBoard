/**
 * SQLSTATE narrowing for the two constraint failures FlowBoard's services turn
 * into meaningful HTTP answers.
 *
 * Every uniqueness rule here is also pre-checked with a `SELECT` so the common
 * path produces a specific message ("that slug is taken"). These predicates
 * cover the race the pre-check cannot: two requests that both read "free"
 * before either writes. Catching the constraint is what makes that a 409 rather
 * than a 500.
 *
 * ── Why the cause chain is walked ───────────────────────────────────────────
 * Drizzle wraps whatever the driver threw in a `DrizzleQueryError` and hangs the
 * original off `cause`, so the `postgres-js` `PostgresError` carrying `code` is
 * one or more links down. Matching only the top-level error silently stopped
 * working when that wrapper was introduced — and the symptom is a 500 where a
 * 409 belongs, which no type checks. The chain is walked structurally (never
 * `instanceof`) so the driver's error class stays out of the service layer.
 */

/** Wrappers are shallow in practice; the bound just guarantees termination. */
const MAX_CAUSE_DEPTH = 5;

interface PgErrorShape {
  code?: unknown;
  constraint_name?: unknown;
}

/** Every error in the `cause` chain, nearest first. */
function chain(error: unknown): PgErrorShape[] {
  const found: PgErrorShape[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    found.push(current as PgErrorShape);
    current = (current as { cause?: unknown }).cause;
  }
  return found;
}

/** True when any error in the chain carries `sqlState`. */
function hasSqlState(error: unknown, sqlState: string, constraintName?: string): boolean {
  return chain(error).some((link) => {
    if (link.code !== sqlState) return false;
    return constraintName === undefined || link.constraint_name === constraintName;
  });
}

/** `23505 unique_violation`. Optionally scoped to one constraint name. */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  return hasSqlState(error, '23505', constraintName);
}

/**
 * `23503 foreign_key_violation` — in this work package, always the
 * `tasks.status_id` RESTRICT refusing to let a column that still holds work
 * disappear.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasSqlState(error, '23503');
}
