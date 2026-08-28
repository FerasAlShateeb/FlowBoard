import { expect, test } from '../helpers/test';

import { ApiClient, taskKey, type TaskDetail } from '../helpers/api';
import { LIFECYCLE_TEST_COST, reserveApiBudget } from '../helpers/rate-budget';
import { expectToast, signIn, waitForBoard } from '../helpers/app';
import { PROJECT_ADMIN, FLOW, MEMBER, unique, viewPath } from '../helpers/seed';

/**
 * One task, from the "c" that creates it to the confirmation that deletes it.
 *
 * It is deliberately ONE journey rather than a dozen independent cases. Half of
 * what the detail sheet does only exists in relation to the rest of it — an
 * activity feed has nothing to show until fields have changed, a cycle cannot be
 * rejected until an edge exists, an attachment cannot be downloaded until it has
 * been uploaded — and splitting that into isolated tests would mean rebuilding
 * the same context in each of them and testing the rebuild instead of the app.
 *
 * The fixture is created and destroyed inside the test, so the seed is exactly
 * as it was found and a second run behaves like the first.
 */

test('a task is created, edited, discussed, attached to, and deleted', async ({ page }) => {
  // Real servers, a real browser, a real S3 round trip and roughly twenty
  // mutations. The default 90 s budget is a hang detector for a single
  // interaction, not for a lifecycle.
  test.setTimeout(180_000);

  // This one test spends more requests than most FILES do, so it waits for a
  // window it can fit inside rather than starting against a nearly-full minute
  // and tripping the API's limiter halfway through — see `helpers/rate-budget.ts`.
  await reserveApiBudget(LIFECYCLE_TEST_COST);

  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const sara = await ApiClient.signIn(MEMBER.email, MEMBER.password);
  const title = unique('lifecycle');

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  let task: TaskDetail;

  await test.step('"c" opens the create dialog and lands on the new task', async () => {
    // A bare printable chord: it fires only because nothing has focus and no
    // overlay is open, which is itself part of the shortcut contract.
    await page.keyboard.press('c');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create task' })).toBeVisible();

    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await page.waitForURL(/\/t\/FLOW-\d+$/u);
    await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();

    const key = /\/t\/(FLOW-\d+)$/u.exec(page.url())?.[1] ?? '';
    task = await api.taskByKey(project.id, key);
    expect(task.title).toBe(title);
  });

  const sheet = page.locator('[data-slot="sheet-content"]');

  await test.step('the sidebar fields write through to the server', async () => {
    await sheet.getByRole('combobox', { name: 'Assignee' }).click();
    await page.getByRole('option', { name: MEMBER.name }).click();

    // HALVES ARE LEGAL. `storyPoints` is a numeric input with `step={0.5}`, and
    // the field parses with `parseFloat` rather than rounding — a regression to
    // integers would be invisible everywhere except here.
    const points = sheet.getByLabel('Story points');
    await points.fill('0.5');
    await points.blur();

    await sheet.getByRole('button', { name: 'Due date' }).click();
    // Day buttons are named by their full date ("Saturday, August 15th, 2026"),
    // so they are matched on the visible number instead — the month on screen is
    // whatever month the run happens in, and the 15th is in all of them.
    await page.getByRole('grid').getByRole('button').filter({ hasText: /^15$/u }).first().click();

    await expect
      .poll(async () => {
        const current = await api.task(task.id);
        return {
          assignee: current.assignee?.id ?? null,
          points: current.storyPoints,
          hasDue: current.dueDate !== null,
        };
      })
      .toEqual({ assignee: sara.user.id, points: 0.5, hasDue: true });
  });

  await test.step('a subtask is added under it', async () => {
    const subtaskTitle = unique('subtask');
    const subtasks = sheet.getByRole('region', { name: 'Subtasks' });
    await subtasks.getByLabel('Add a subtask').fill(subtaskTitle);
    await subtasks.getByRole('button', { name: 'Add' }).click();

    await expect(subtasks.getByText(subtaskTitle)).toBeVisible();
    const children = await api.get<{ id: string; title: string }[]>(
      `/projects/${project.id}/tasks?parentId=${task.id}`,
    );
    expect(children.map((child) => child.title)).toContain(subtaskTitle);
  });

  await test.step('a dependency that would close a cycle is refused', async () => {
    // The cycle is ARRANGED through the API — the point under test is the
    // refusal, and building the precondition by hand through two more popovers
    // would only add ways for the test to fail for the wrong reason.
    const others = Object.values(await api.board(project.id))
      .flat()
      .filter((candidate) => candidate.id !== task.id);
    const [b, c] = others;
    if (!b || !c) throw new Error('the seeded board needs at least two other tasks');
    const bKey = taskKey(FLOW.key, b);
    const cKey = taskKey(FLOW.key, c);

    // A CHAIN, not a pair. The picker hides tasks this one is already linked to
    // (`DependencySection` filters them out), so a two-node loop is unreachable
    // through the UI by construction — the shortest cycle a person can actually
    // build is three long: A → B → C, then C → A.
    await api.post(`/tasks/${task.id}/dependencies`, { blockedTaskId: b.id });
    await api.post(`/tasks/${b.id}/dependencies`, { blockedTaskId: c.id });

    await page.reload();
    await expect(sheet).toBeVisible();
    const dependencies = sheet.getByRole('region', { name: 'Dependencies' });
    await expect(dependencies.getByText(bKey)).toBeVisible();

    await dependencies.getByRole('button', { name: 'Add a blocker' }).click();
    await page.getByPlaceholder('Search tasks by key or title…').fill(cKey);
    await page.getByRole('option').filter({ hasText: cKey }).first().click();

    await expectToast(page, 'That would create a circular dependency.');
    // Refused, not merely complained about.
    const { edges } = await api.get<{ edges: { blockerTaskId: string; blockedTaskId: string }[] }>(
      `/projects/${project.id}/dependencies`,
    );
    // The specific edge, not "any edge from C" — C is a seeded task and may well
    // block something else already.
    expect(
      edges.some((edge) => edge.blockerTaskId === c.id && edge.blockedTaskId === task.id),
    ).toBe(false);
  });

  await test.step('a comment mentions someone', async () => {
    // `role="combobox"`, not `textbox`: `MentionTextarea` is a textarea wearing
    // the combobox pattern, because the `@` autocomplete has to announce its
    // listbox and its active option to assistive tech.
    const composer = sheet.getByRole('combobox', { name: 'Comments' });
    await composer.click();
    await composer.pressSequentially('@Sara');

    // The mention list is a combobox over `/orgs/:orgId/users`, and accepting an
    // option rewrites the caret token into `@[Name](userId)` — the wire format
    // the renderer and the notification fan-out both read.
    const options = page.getByRole('listbox', { name: 'Mention someone' });
    await expect(options).toBeVisible();
    await composer.press('Enter');
    await composer.pressSequentially(' please take a look.');

    await sheet.getByRole('button', { name: 'Comment' }).click();

    await expect(sheet.getByText('please take a look.')).toBeVisible();
    // Polled, because what is on screen may be the optimistic paint — the stored
    // body is the thing that has to carry the `@[Name](id)` token, since that is
    // what the fan-out reads to decide who gets notified.
    await expect
      .poll(async () => {
        const comments = await api.get<{ body: string }[]>(`/tasks/${task.id}/comments`);
        return comments.map((comment) => comment.body).join('\n');
      })
      .toContain(`@[${MEMBER.name}](${sara.user.id})`);
  });

  await test.step('a file uploads to S3 and comes back down again', async () => {
    const contents = `flowboard e2e attachment ${title}`;
    await sheet.getByLabel('Choose files to attach').setInputFiles({
      name: 'evidence.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(contents, 'utf8'),
    });

    await expect(sheet.getByText('evidence.txt')).toBeVisible({ timeout: 30_000 });

    // THE ROUND TRIP, not just the row. `presign → PUT → confirm` leaves three
    // places where the s3 key can drift; the only proof that it did not is
    // reading the bytes back through a freshly minted download URL.
    const list = async (): Promise<{ id: string; fileName: string }[]> =>
      api.get<{ id: string; fileName: string }[]>(`/tasks/${task.id}/attachments`);
    await expect
      .poll(async () => (await list()).map((item) => item.fileName))
      .toContain('evidence.txt');

    const uploaded = (await list()).find((item) => item.fileName === 'evidence.txt');
    if (!uploaded) throw new Error('the attachment vanished between two reads');
    const { url } = await api.get<{ url: string }>(`/attachments/${uploaded.id}/url`);
    const downloaded = await fetch(url);
    expect(downloaded.ok).toBe(true);
    expect(await downloaded.text()).toBe(contents);
  });

  await test.step('watching is a toggle, and it sticks', async () => {
    // Start from a KNOWN state. The creator is auto-subscribed as the reporter,
    // so "read the current value, click, expect the opposite" races the query
    // that decides what the current value is.
    await api.delete(`/tasks/${task.id}/watchers/me`);
    await page.reload();

    const watch = sheet.getByRole('button', { name: 'Watch this task' });
    await expect(watch).toHaveAttribute('aria-pressed', 'false');
    await watch.click();

    /**
     * THE BUTTON FLIPS IMMEDIATELY — no reload, no refetch.
     *
     * This step used to assert the weaker "correct after a reload", because
     * `useWatchTask` wrote only `qk.task.detail(taskId)` while a sheet opened
     * from a URL renders out of `qk.tasks.byKey(projectId, key)`. Two entries
     * hold the same task's detail payload and only one of them was being
     * updated, so the toggle stayed visually stuck on a task reached by link.
     *
     * `useWatchers` now updates EVERY cache entry holding this task's detail —
     * optimistically on click, and again on settle — selected by a predicate
     * over the cached shape rather than by one hard-coded key. So the strong
     * assertion is the correct one, and it is the one that would catch a
     * regression back to the single-key write: the reload-then-check version
     * passed just as happily while the bug was live.
     */
    await expect(sheet.getByRole('button', { name: 'Stop watching' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Stop watching' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // …and the optimistic flip was backed by a real write, not just a repaint.
    await expect.poll(async () => (await api.task(task.id)).watcherIds).toContain(api.user.id);

    // It also survives a reload, which is what "it sticks" means: the server
    // agrees, and the fresh render reads the same answer the optimistic one did.
    await page.reload();
    await expect(sheet.getByRole('button', { name: 'Stop watching' })).toBeVisible();
  });

  await test.step('the activity feed shows the trail the edits left', async () => {
    await sheet.getByRole('tab', { name: 'Activity' }).click();
    const feed = sheet.getByRole('tabpanel');
    await expect(feed).toBeVisible();
    // Every mutation above wrote an activity row inside its own transaction, so
    // the feed is the audit of this test.
    await expect(
      feed.getByText(new RegExp(`${PROJECT_ADMIN.name}.*(created|changed|added)`, 'iu')).first(),
    ).toBeVisible();
    await expect(feed.getByText(/story points/iu).first()).toBeVisible();
  });

  await test.step('deleting it closes the sheet and removes it everywhere', async () => {
    await sheet.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete task' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await page.waitForURL((url) => !url.pathname.includes('/t/'));
    await expect(sheet).toHaveCount(0);

    const gone = await api.expectFailure('GET', `/tasks/${task.id}`);
    expect(gone.status).toBe(404);
  });
});
