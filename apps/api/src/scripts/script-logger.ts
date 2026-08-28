/* eslint-disable no-console -- CLI scripts write to stdout by design: pino's
   multistream/ring-buffer transport belongs to the running server, and booting
   it just to print "seeded 61 tasks" would hide the output behind JSON. This is
   the ONE file in the API allowed to call console; every other script goes
   through the helpers below. */

/**
 * Tiny stdout logger for `db:migrate` / `db:seed` / `db:reset`.
 *
 * No colours, no timestamps, no dependency — the audience is a developer
 * watching a terminal and CI capturing a log file.
 */

/** A section heading, e.g. `▸ seeding tasks`. */
export function step(message: string): void {
  console.log(`▸ ${message}`);
}

/** An indented detail line under the current step. */
export function detail(message: string): void {
  console.log(`  ${message}`);
}

/** A successful outcome. */
export function done(message: string): void {
  console.log(`✔ ${message}`);
}

/** A non-fatal warning. */
export function warn(message: string): void {
  console.warn(`! ${message}`);
}

/**
 * Report a failure to stderr. Does NOT exit — the caller decides, so a script
 * can still close its connection pool before dying.
 */
export function failure(message: string, error?: unknown): void {
  console.error(`✖ ${message}`);
  if (error !== undefined) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
}
