/**
 * Project settings → Workflow: the status editor's full round trip.
 *
 * The workflow editor is the one settings surface where every control commits
 * on its own — the name input on blur, the category select on change, the WIP
 * input on blur — with no Save button anywhere. That design has a specific
 * failure mode: a field that repaints optimistically and never reaches the
 * server looks *exactly* like one that saved. Only a reload can tell them
 * apart, so every assertion here that matters is made after `page.reload()`.
 *
 * It also covers the delete path's `moveTasksTo`, which is the one destructive
 * operation in the product that moves data rather than removing it. A column
 * cannot simply vanish while it still holds cards, so the dialog asks where
 * they go and the server relocates them inside the delete transaction. The
 * test therefore parks a real task in the doomed column and asserts it comes
 * out the other side in the destination — deleting an empty column would
 * exercise none of that.
 *
 * ── Why it builds its own column instead of editing a seeded one ────────────
 * `workers: 1` and one shared seeded database mean the specs are neighbours.
 * FLOW's three seeded statuses are what `board.spec` and `sprint.spec` count,
 * drag between and assert on; renaming "In Progress" here would break them
 * somewhere else entirely. So this spec adds a column under a `unique()` name,
 * does its whole round trip on that, and deletes it — the teardown IS the last
 * assertion. `afterEach` sweeps up anything a mid-test failure left behind, so
 * one red test cannot cascade into the rest of the suite.
 */
import { expect, test } from '../helpers/test';
import { ApiClient, type Status } from '../helpers/api';
import { expectToast, signIn } from '../helpers/app';
import { FLOW, PROJECT_ADMIN, unique, viewPath } from '../helpers/seed';

/** `/o/acme/p/FLOW/settings/workflow` — the nested settings route. */
const WORKFLOW_PATH = viewPath(FLOW.key, 'settings/workflow');

/**
 * Every status this spec creates carries this marker, so the sweeper can
 * recognise its own litter without touching a seeded column.
 */
const FIXTURE_PREFIX = 'e2e-wf';

/**
 * Remove any fixture column a failed run left in FLOW.
 *
 * Signs in through the API only — no page, no browser — because this must work
 * even when the test failed because the UI is broken. `moveTasksTo` is omitted:
 * the server only demands it while the column still holds tasks, and if it
 * does, the first destination is as good an answer as any for a fixture.
 */
test.afterEach(async () => {
  const session = await ApiClient.session(PROJECT_ADMIN.email, PROJECT_ADMIN.password);
  const api = ApiClient.fromSession(session);
  const project = await api.project(FLOW.key);
  const statuses = await api.get<Status[]>(`/projects/${project.id}/statuses`);

  const litter = statuses.filter((status) => status.name.startsWith(FIXTURE_PREFIX));
  if (litter.length === 0) return;

  // A seeded column, so it is guaranteed to still be there to receive the cards.
  const survivor = statuses.find((status) => !status.name.startsWith(FIXTURE_PREFIX));
  for (const status of litter) {
    await api.delete(`/projects/${project.id}/statuses/${status.id}`, {
      moveTasksTo: survivor?.id,
    });
  }
});

test('a status survives being added, renamed and WIP-limited across a reload', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const created = unique(FIXTURE_PREFIX);
  const renamed = unique(FIXTURE_PREFIX);

  await page.goto(WORKFLOW_PATH);
  // The readiness signal is the Add button, not the "Statuses" card title:
  // `CardTitle` renders a `div`, so it has no heading role to wait on — and the
  // button is the better wait anyway, since it only renders for a project admin.
  const addStatus = page.getByRole('button', { name: 'Add status' });
  await expect(addStatus).toBeVisible();

  // ── Add ───────────────────────────────────────────────────────────────────
  await addStatus.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(created);
  // The category select is a Radix listbox, not a native <select>.
  await dialog.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'In progress' }).click();
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expectToast(page, 'Status added.');

  // Rows are <li>s and every one of them has a "Rename status" input, so the
  // row has to be pinned by something unique to it — its delete button carries
  // the status name.
  const row = (name: string) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: `Delete ${name}?` }) });

  await expect(row(created)).toBeVisible();

  // ── Rename, and set a WIP limit ───────────────────────────────────────────
  // Both commit on blur; Enter blurs. No Save button exists.
  const nameInput = row(created).getByLabel('Rename status');
  await nameInput.fill(renamed);
  await nameInput.press('Enter');
  await expectToast(page, 'Status updated.');

  const wipInput = row(renamed).getByLabel('WIP limit');
  await wipInput.fill('4');
  await wipInput.press('Enter');
  await expectToast(page, 'Status updated.');

  // ── The round trip ────────────────────────────────────────────────────────
  // THE POINT OF THE SPEC. Everything above repainted locally the instant it
  // was typed; this is the only step that proves any of it left the browser.
  await page.reload();

  const reloaded = row(renamed);
  await expect(reloaded).toBeVisible();
  await expect(reloaded.getByLabel('Rename status')).toHaveValue(renamed);
  await expect(reloaded.getByLabel('WIP limit')).toHaveValue('4');
  await expect(reloaded.getByRole('combobox', { name: 'Category' })).toHaveText('In progress');
  // The old name is gone rather than duplicated — a rename, not an insert.
  await expect(row(created)).toHaveCount(0);

  // …and the server agrees with what the page is drawing.
  const statuses = await api.get<Status[]>(`/projects/${project.id}/statuses`);
  const persisted = statuses.find((status) => status.name === renamed);
  expect(persisted).toBeDefined();
  expect(persisted?.category).toBe('in_progress');
  expect(persisted?.wipLimit).toBe(4);
});

test('deleting a status relocates its tasks to the chosen column', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const doomed = unique(FIXTURE_PREFIX);

  await page.goto(WORKFLOW_PATH);
  await page.getByRole('button', { name: 'Add status' }).click();
  const addDialog = page.getByRole('dialog');
  await addDialog.getByLabel('Name').fill(doomed);
  await addDialog.getByRole('button', { name: 'Add' }).click();
  await expectToast(page, 'Status added.');

  // Park a real card in the doomed column. Without this the delete would take
  // the empty-column shortcut and `moveTasksTo` would never be exercised.
  const statuses = await api.get<Status[]>(`/projects/${project.id}/statuses`);
  const target = statuses.find((status) => status.name === doomed);
  const destination = statuses.find((status) => status.name === 'To Do');
  expect(target).toBeDefined();
  expect(destination).toBeDefined();

  const task = await api.post<{ id: string }>(`/projects/${project.id}/tasks`, {
    title: unique('wf-card'),
    statusId: target?.id,
  });

  await page.reload();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: `Delete ${doomed}?` }) });
  await row.getByRole('button', { name: `Delete ${doomed}?` }).click();

  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText('Its tasks have to go somewhere first.')).toBeVisible();
  await confirm.getByRole('combobox', { name: 'Move its tasks to' }).click();
  await page.getByRole('option', { name: 'To Do', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expectToast(page, 'Status deleted.');

  await expect(row).toHaveCount(0);

  // The column is gone AFTER a reload too — not just hidden by an optimistic
  // cache write — and the card it held came out in To Do rather than vanishing
  // with it.
  await page.reload();
  await expect(page.getByRole('button', { name: `Delete ${doomed}?` })).toHaveCount(0);

  const after = await api.get<Status[]>(`/projects/${project.id}/statuses`);
  expect(after.some((status) => status.name === doomed)).toBe(false);

  const moved = await api.get<{ statusId: string }>(`/tasks/${task.id}`);
  expect(moved.statusId).toBe(destination?.id);

  await api.delete(`/tasks/${task.id}`);
});
