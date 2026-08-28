/**
 * The `test` every spec imports, instead of `@playwright/test` directly.
 *
 * It is the stock one plus a single automatic fixture, which does two things no
 * spec should have to think about: it counts the API requests the browser makes,
 * and it holds the test at the starting line if the last minute is already too
 * full to absorb what the test is about to spend. See `helpers/rate-budget.ts`
 * for why that is necessary, and for the two approaches that did not work.
 *
 * `expect` is re-exported so a spec needs one import line rather than two, and
 * so nothing is tempted to reach past this module back to `@playwright/test` —
 * which would silently opt that file out of the budget.
 */
import { test as base, expect } from '@playwright/test';

import { awaitApiCapacity, observeApiCalls } from './rate-budget';

export const test = base.extend<{ apiBudget: void }>({
  apiBudget: [
    async ({ context }, use) => {
      // Observe the whole CONTEXT, so a spec that opens a second tab in it is
      // counted without having to opt in.
      observeApiCalls(context);
      await awaitApiCapacity();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Locator, Page } from '@playwright/test';
