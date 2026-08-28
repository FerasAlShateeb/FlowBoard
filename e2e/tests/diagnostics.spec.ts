import { expect, test } from '../helpers/test';

import { signIn, waitForBoard } from '../helpers/app';
import { ADMIN, FLOW, ORG_ADMIN, viewPath } from '../helpers/seed';

/**
 * The diagnostics drawer — FlowBoard's log viewer.
 *
 * It is a global-admin surface with a keyboard-first contract, and almost every
 * clause of that contract is only observable in a browser: whether a chord is
 * registered at all for a non-admin, whether the poll actually picks up rows the
 * server produced after the drawer opened, whether the dock preference survives
 * a cycle, and whether the copy button reaches the real clipboard.
 */

test('the drawer belongs to global admins only', async ({ page }) => {
  // Maya is an ORG admin but not a global one — the distinction the drawer's
  // gate is made of. For her the component renders nothing at all, so the chord
  // is not merely inert: it was never registered.
  await signIn(page, ORG_ADMIN);
  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  await expect(page.getByTestId('fb-diag-trigger')).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(page.getByTestId('fb-diag-drawer')).toHaveCount(0);
});

test('Ctrl+J opens the drawer and rows stream in behind API activity', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  await page.keyboard.press('Control+j');
  const drawer = page.getByTestId('fb-diag-drawer');
  await expect(drawer).toBeVisible();

  // The drawer is NOT persisted across a page load — only the dock and the size
  // are (`useLayoutStore` leaves `diagOpen` out on purpose). So every navigation
  // from here on is a CLIENT-side one: a full `page.goto` would close the very
  // thing under test, which is exactly how this spec failed first time round.
  const rows = page.getByTestId('fb-diag-row');
  await expect.poll(async () => rows.count(), { timeout: 20_000 }).toBeGreaterThan(0);

  /**
   * The HIGHEST `data-log-id` on screen — not the row count.
   *
   * The ring holds 500 records and the list renders at most 500, so on a warm
   * server the count is pinned at the cap and could never grow however many new
   * lines arrived. The ids are monotonic, so they can.
   */
  const highestId = async (): Promise<number> =>
    rows.evaluateAll((nodes: Element[]) =>
      nodes.reduce((max, node) => Math.max(max, Number(node.getAttribute('data-log-id') ?? 0)), 0),
    );

  const before = await highestId();

  // WHAT ACTUALLY WRITES A LOG LINE. Ordinary requests do not: `requestLogger`
  // batches them into the `request_logs` TABLE, and the error handler only logs
  // 5xx. The pino stream the ring tails carries lifecycle events — and a second
  // tab opening the app connects a socket, which logs one ('Socket connected',
  // `sockets/io.ts`). So the trigger is a real client, not a navigation.
  const second = await page.context().newPage();
  await second.goto(viewPath(FLOW.key, 'board'));
  await expect(second.locator('[data-slot="board-column"]').first()).toBeVisible();
  await second.close();

  // BACK TO THE FRONT BEFORE POLLING. Opening the second tab pushed this one
  // into the background, and Chromium throttles a hidden page's timers — which
  // stalls the drawer's own 2 s `sinceId` poll and made this assertion fail
  // intermittently under the full suite while passing on its own. Closing the
  // other tab is not enough on its own; the visibility state has to be restored
  // before the thing under test is expected to tick.
  await page.bringToFront();
  await expect.poll(highestId, { timeout: 30_000 }).toBeGreaterThan(before);

  // The level filter narrows what the list is allowed to render.
  const shown = await rows.count();
  await page.getByTestId('fb-diag-level').click();
  await page.getByTestId('fb-diag-level-error').click();
  await expect(page.getByTestId('fb-diag-level')).toHaveAttribute('data-min-level', 'error');
  // A healthy run logs nothing at error level, so the honest assertion is that
  // the filter REMOVED rows and kept only ones that qualify — which is true
  // whether or not an error happens to be in the buffer.
  await expect.poll(async () => rows.count()).toBeLessThan(shown);
  for (const level of await rows.evaluateAll((nodes: Element[]) =>
    nodes.map((node) => node.getAttribute('data-level')),
  )) {
    expect(['error', 'fatal']).toContain(level);
  }

  await page.getByTestId('fb-diag-close').click();
  await expect(drawer).toBeHidden();
});

test('the dock cycles, the drawer resizes, and the rows copy as JSONL', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  await page.keyboard.press('Control+j');
  const drawer = page.getByTestId('fb-diag-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-dock', 'bottom');

  // `DIAG_DOCK_CYCLE` is bottom → right → left → top.
  await page.keyboard.press('Control+Shift+j');
  await expect(drawer).toHaveAttribute('data-dock', 'right');
  await page.getByTestId('fb-diag-dock-cycle').click();
  await expect(drawer).toHaveAttribute('data-dock', 'left');

  // Back to the bottom dock, where the handle resizes the HEIGHT and a change
  // is unambiguous.
  await page.getByTestId('fb-diag-dock-cycle').click();
  await page.getByTestId('fb-diag-dock-cycle').click();
  await expect(drawer).toHaveAttribute('data-dock', 'bottom');

  const handle = page.getByTestId('fb-diag-resize');
  const before = (await drawer.boundingBox())?.height ?? 0;
  await handle.focus();
  for (let i = 0; i < 6; i += 1) await handle.press('ArrowUp');
  await expect.poll(async () => (await drawer.boundingBox())?.height ?? 0).toBeGreaterThan(before);

  // Copy writes newline-delimited JSON through `navigator.clipboard`, which is
  // why the config grants the clipboard permissions up front.
  await expect.poll(async () => page.getByTestId('fb-diag-row').count()).toBeGreaterThan(0);
  await page.getByTestId('fb-diag-copy').click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const lines = clipboard.split('\n').filter((line) => line !== '');
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines.slice(0, 5)) {
    expect(() => JSON.parse(line) as unknown).not.toThrow();
  }
});
