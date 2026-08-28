import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Web unit tests.
 *
 * THE DEFAULT ENVIRONMENT IS `node`, NOT `jsdom`, and it stays that way. Most
 * web suites cover pure logic — envelope unwrapping, the single-flight refresh
 * against a mocked `fetch`, the query-key factory, the board-cache reducer —
 * and none of it touches the DOM. Booting jsdom for those would tax every suite
 * with a startup it gets nothing from.
 *
 * A SUITE THAT RENDERS COMPONENTS OPTS IN PER FILE, with a pragma on the very
 * first line:
 *
 *     // @vitest-environment jsdom
 *     import { render, screen } from '@testing-library/react';
 *
 * That is a Vitest feature, not a workaround, and it is preferred over a second
 * `projects` entry here: the opt-in lives next to the code that needs it, so
 * nobody has to keep a glob in this file in sync with which files happen to
 * render. `jsdom` and the Testing Library packages are devDependencies of this
 * workspace — see `.agents/docs/testing.md`.
 *
 * `setupFiles` brings the localStorage shim up before any store module is
 * imported — see `src/test/setup.ts`. It deliberately does NOT pull in
 * `@testing-library/jest-dom`: that would load DOM matchers into the
 * node-environment suites too. Import it from the file that needs it.
 *
 * ── WHY THE TIMEOUTS ARE RAISED ─────────────────────────────────────────────
 *
 * Vitest's 5 000 ms default is tuned for node-environment unit tests that
 * finish in single-digit milliseconds. The heaviest jsdom suites here do not:
 * `ThemePage.test.tsx` renders the whole Theme Studio — three tab panels plus a
 * live preview of the app chrome — inside a real memory router, and costs
 * **700–1000 ms per test on an idle machine**. `TaskCreateDialog.test.tsx` and
 * the other `userEvent`-driven suites are in the same range, because
 * `userEvent` awaits the event loop between every keystroke and Radix does real
 * focus work on each one.
 *
 * Five seconds is therefore only about 5× the cost of the slowest test, and a
 * full-suite run — 90 files across every core, next to the API's Supertest
 * suites under `turbo run test` — routinely eats that margin. The result was a
 * suite that passed standalone and failed one or two arbitrary tests under
 * load: a coin flip, not a signal. (Ruled out first: module-scope pollution
 * between suites. Running every theme, store and page suite in ONE process with
 * `--no-isolate --no-file-parallelism` passes all 255 tests, so the stores'
 * `beforeEach` re-baselining already isolates them correctly.)
 *
 * A TIMEOUT IS A DEADLOCK DETECTOR, NOT A PERFORMANCE BUDGET. Sizing it to the
 * fastest possible machine converts every busy CI box into a false failure,
 * while 20 s still surfaces a genuinely hung test promptly. If a suite ever
 * needs more than this, the suite is wrong — not this number.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
