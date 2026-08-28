// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { TaskHeaderBar, statusMenuOptions } from '@/components/tasks/TaskHeaderBar';
import {
  IDS,
  RESTRICTED_TRANSITIONS,
  STATUSES,
  makeTask,
  renderWithProviders,
} from '@/components/tasks/__tests__/test-utils';

afterEach(cleanup);

/** Everything the bar needs, with spies the individual tests can inspect. */
function setup(overrides: Partial<Parameters<typeof TaskHeaderBar>[0]> = {}): {
  onChangeStatus: ReturnType<typeof vi.fn>;
  onChangeType: ReturnType<typeof vi.fn>;
  onToggleWatch: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
} {
  const spies = {
    onChangeStatus: vi.fn(),
    onChangeType: vi.fn(),
    onToggleWatch: vi.fn(),
    onDelete: vi.fn(),
  };

  renderWithProviders(
    <TaskHeaderBar
      task={makeTask()}
      statuses={STATUSES}
      transitions={[]}
      taskUrl="https://flowboard.test/o/acme/p/FLOW/board/t/FLOW-142"
      canEdit
      isWatching={false}
      isSaving={false}
      isDeleting={false}
      {...spies}
      {...overrides}
    />,
  );

  return spies;
}

describe('statusMenuOptions', () => {
  it('allows every target when the project has no transition rows', () => {
    // Zero rows = a fully open workflow, which is what a fresh project has.
    const options = statusMenuOptions(STATUSES, [], IDS.todo);
    expect(options.map((option) => option.allowed)).toEqual([true, true, true]);
  });

  it('honours a per-source whitelist, and always allows the current column', () => {
    // The fixture whitelists To Do → In Progress only.
    const options = statusMenuOptions(STATUSES, RESTRICTED_TRANSITIONS, IDS.todo);
    expect(
      Object.fromEntries(options.map((option) => [option.status.name, option.allowed])),
    ).toEqual({ 'To Do': true, 'In Progress': true, Done: false });
  });

  it('leaves a status with NO outgoing rows fully open', () => {
    // In Progress has no whitelist of its own, so nothing constrains it — the
    // rule is per SOURCE, not global.
    const options = statusMenuOptions(STATUSES, RESTRICTED_TRANSITIONS, IDS.doing);
    expect(options.every((option) => option.allowed)).toBe(true);
  });

  it('returns the columns in board order regardless of input order', () => {
    const shuffled = [...STATUSES].reverse();
    expect(statusMenuOptions(shuffled, [], IDS.todo).map((o) => o.status.name)).toEqual([
      'To Do',
      'In Progress',
      'Done',
    ]);
  });
});

describe('TaskHeaderBar', () => {
  it('shows the key, the type and the current status', () => {
    setup();

    expect(screen.getByText('FLOW-142')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change issue type' })).toHaveTextContent('Story');
    expect(screen.getByRole('button', { name: 'Change status' })).toHaveTextContent('To Do');
  });

  it('DISABLES a status the workflow forbids and enables the rest', async () => {
    const user = userEvent.setup();
    const { onChangeStatus } = setup({ transitions: RESTRICTED_TRANSITIONS });

    await user.click(screen.getByRole('button', { name: 'Change status' }));

    const menu = await screen.findByRole('menu');
    const done = within(menu).getByRole('menuitem', { name: /Done/u });
    const doing = within(menu).getByRole('menuitem', { name: /In Progress/u });

    // Forbidden targets are rendered and greyed rather than hidden — a column
    // visible on the board and absent from this menu explains nothing.
    expect(done).toHaveAttribute('aria-disabled', 'true');
    expect(doing).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(doing);
    expect(onChangeStatus).toHaveBeenCalledWith(IDS.doing);
  });

  it('does not re-patch when the CURRENT status is picked', async () => {
    const user = userEvent.setup();
    const { onChangeStatus } = setup();

    await user.click(screen.getByRole('button', { name: 'Change status' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /To Do/u }));

    expect(onChangeStatus).not.toHaveBeenCalled();
  });

  it('switches the issue type', async () => {
    const user = userEvent.setup();
    const { onChangeType } = setup();

    await user.click(screen.getByRole('button', { name: 'Change issue type' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Bug' }));

    expect(onChangeType).toHaveBeenCalledWith('bug');
  });

  it('toggles watching, and reflects the state in aria-pressed', async () => {
    const user = userEvent.setup();
    const { onToggleWatch } = setup();

    const watch = screen.getByRole('button', { name: 'Watch this task' });
    expect(watch).toHaveAttribute('aria-pressed', 'false');
    await user.click(watch);
    expect(onToggleWatch).toHaveBeenCalledWith(true);

    cleanup();
    const { onToggleWatch: off } = setup({ isWatching: true });
    await user.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(off).toHaveBeenCalledWith(false);
  });

  it('asks before deleting, and only then calls back', async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete task' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete FLOW-142?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides every write control from a viewer', () => {
    setup({ canEdit: false });

    // The type and status triggers stay visible (they SHOW the values) but are
    // disabled; the overflow menu is replaced by a read-only badge.
    expect(screen.getByRole('button', { name: 'Change status' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change issue type' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.getByText('You have read-only access to this project.')).toBeInTheDocument();
    // Watching is a READ-side affordance: a viewer may follow what they cannot
    // edit, so the toggle stays.
    expect(screen.getByRole('button', { name: 'Watch this task' })).toBeInTheDocument();
  });
});
