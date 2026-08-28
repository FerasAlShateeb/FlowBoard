// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { TaskFieldsSidebar } from '@/components/tasks/TaskFieldsSidebar';
import {
  ADA,
  IDS,
  LABELS,
  SPRINTS,
  makeSummary,
  makeTask,
  renderWithProviders,
} from '@/components/tasks/__tests__/test-utils';

/** `UserSelect` reads the org directory; the assignee row is not what is under
 *  test here, so the hook is stubbed rather than routed through a transport. */
vi.mock('@/hooks/useOrgs', () => ({
  useOrgUsers: () => ({ data: [{ user: ADA, email: 'ada@flowboard.dev', role: 'member' }] }),
}));

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof TaskFieldsSidebar>[0]> = {}) {
  const onPatch = vi.fn();
  renderWithProviders(
    <TaskFieldsSidebar
      task={makeTask()}
      orgId={IDS.org}
      sprints={SPRINTS}
      epics={[makeSummary({ id: IDS.epic, type: 'epic', title: 'Ranking overhaul' })]}
      labels={LABELS}
      canEdit
      isSaving={false}
      onPatch={onPatch}
      {...overrides}
    />,
  );
  return { onPatch };
}

describe('TaskFieldsSidebar — story points', () => {
  it('commits a FRACTIONAL estimate without rounding it', async () => {
    // The bug this guards: `parseInt` (or a `step=1` input) silently turns 0.5
    // into 0, which reads as the server rejecting a perfectly legal value.
    const user = userEvent.setup();
    const { onPatch } = setup();

    const points = screen.getByRole('spinbutton', { name: 'Story points' });
    await user.clear(points);
    await user.type(points, '0.5');
    await user.tab();

    expect(onPatch).toHaveBeenCalledWith({ storyPoints: 0.5 });
  });

  it('offers half-point steps in the stepper itself', () => {
    setup();
    expect(screen.getByRole('spinbutton', { name: 'Story points' })).toHaveAttribute('step', '0.5');
  });

  it('sends null when the estimate is cleared', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup();

    await user.clear(screen.getByRole('spinbutton', { name: 'Story points' }));
    await user.tab();

    // `null`, not `0` and not `''` — "unestimated" is a distinct state.
    expect(onPatch).toHaveBeenCalledWith({ storyPoints: null });
  });

  it('does NOT patch when the value is unchanged', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup();

    // The fixture's estimate is already 3. Focusing and leaving must be silent —
    // every field commits on change, so a no-op commit is a wasted request and
    // a spurious activity row.
    await user.click(screen.getByRole('spinbutton', { name: 'Story points' }));
    await user.tab();

    expect(onPatch).not.toHaveBeenCalled();
  });

  it('commits on Enter as well as on blur', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup();

    const points = screen.getByRole('spinbutton', { name: 'Story points' });
    await user.clear(points);
    await user.type(points, '8{Enter}');

    expect(onPatch).toHaveBeenCalledWith({ storyPoints: 8 });
  });
});

describe('TaskFieldsSidebar — the other fields', () => {
  it('patches the priority', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup();

    await user.click(screen.getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: 'Lowest' }));

    expect(onPatch).toHaveBeenCalledWith({ priority: 'lowest' });
  });

  it('maps the "Backlog" sprint option to a null sprintId', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup();

    await user.click(screen.getByRole('combobox', { name: 'Sprint' }));
    await user.click(await screen.findByRole('option', { name: 'Backlog' }));

    // Radix has no empty-string value, so the option carries a sentinel — this
    // asserts the sentinel is translated back to a real `null` on the wire.
    expect(onPatch).toHaveBeenCalledWith({ sprintId: null });
  });

  it('excludes nothing but offers "No epic" as a real choice', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup({ task: makeTask({ epicId: IDS.epic }) });

    await user.click(screen.getByRole('combobox', { name: 'Epic' }));
    await user.click(await screen.findByRole('option', { name: 'No epic' }));

    expect(onPatch).toHaveBeenCalledWith({ epicId: null });
  });

  it('clears a due date without going near a Date round trip', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup();

    // The two clear buttons are named after their FIELDS, so this addresses one
    // of them unambiguously.
    await user.click(screen.getByRole('button', { name: 'Clear Due date' }));

    expect(onPatch).toHaveBeenCalledWith({ dueDate: null });
  });

  it('renders the dates as the calendar days they are', () => {
    setup();
    // `2026-03-02`, not `1 Mar` — the local conversion must not shift the day.
    expect(screen.getByRole('button', { name: 'Start date' })).toHaveTextContent('Mar 2, 2026');
    expect(screen.getByRole('button', { name: 'Due date' })).toHaveTextContent('Mar 9, 2026');
  });

  it('toggles a label into the labelIds array', async () => {
    const user = userEvent.setup();
    const { onPatch } = setup({ task: makeTask({ labels: [] }) });

    await user.click(screen.getByRole('combobox', { name: 'Labels' }));
    await user.click(await screen.findByText('backend'));

    expect(onPatch).toHaveBeenCalledWith({ labelIds: [IDS.label] });
  });

  it('shows the reporter read-only and the saving indicator on demand', () => {
    cleanup();
    setup({ isSaving: true });

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('disables every control for a viewer', () => {
    setup({ canEdit: false });

    expect(screen.getByRole('spinbutton', { name: 'Story points' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start date' })).toBeDisabled();
    // The clear affordance disappears entirely rather than appearing dead.
    expect(screen.queryByRole('button', { name: /^Clear/u })).not.toBeInTheDocument();
  });
});
