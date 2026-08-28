// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { OrgUser } from '@flowboard/shared';

import { MentionTextarea } from '@/components/tasks/MentionTextarea';
import { ADA, GRACE, IDS, renderWithProviders } from '@/components/tasks/__tests__/test-utils';

/**
 * The composer's @mention autocomplete.
 *
 * The org directory is stubbed at the HOOK, not at the transport: this suite is
 * about the caret arithmetic and the keyboard model, and routing a fake fetch
 * through TanStack Query would only add a `waitFor` to every assertion.
 */
const DIRECTORY: OrgUser[] = [
  { user: ADA, email: 'ada@flowboard.dev', role: 'member' },
  { user: GRACE, email: 'grace@flowboard.dev', role: 'admin' },
];

vi.mock('@/hooks/useOrgs', () => ({
  useOrgUsers: () => ({ data: DIRECTORY }),
}));

afterEach(cleanup);

/** A controlled host, because the component is controlled by design. */
function Host({
  onSubmit,
  onCancel,
  initial = '',
}: {
  onSubmit?: () => void;
  onCancel?: () => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MentionTextarea
        orgId={IDS.org}
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        onCancel={onCancel}
        ariaLabel="Body"
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('MentionTextarea', () => {
  it('opens a listbox when an @ token is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    const field = screen.getByRole('combobox', { name: 'Body' });
    expect(field).toHaveAttribute('aria-expanded', 'false');

    await user.click(field);
    await user.keyboard('ping @ad');

    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ada Lovelace/u })).toBeInTheDocument();
    // Grace does not match "ad" — the list narrows client-side as well as
    // server-side, so it never shows a stale result set.
    expect(screen.queryByRole('option', { name: /Grace/u })).not.toBeInTheDocument();
    // Focus never leaves the field: the ARIA combobox contract.
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('aria-expanded', 'true');
  });

  it('inserts the ENCODED form on Enter and keeps typing afterwards', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.click(screen.getByRole('combobox', { name: 'Body' }));
    await user.keyboard('ping @ad');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}');

    // The wire form, not the friendly one — the server parses the stored body
    // to decide who gets notified.
    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent(`ping @[Ada Lovelace](${IDS.ada})`);
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // The trailing space put the caret somewhere a new word can start.
    await user.keyboard('thanks');
    expect(screen.getByTestId('value')).toHaveTextContent(
      `ping @[Ada Lovelace](${IDS.ada}) thanks`,
    );
  });

  it('accepts a suggestion with the arrow keys', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.click(screen.getByRole('combobox', { name: 'Body' }));
    await user.keyboard('@');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent(`@[Grace Hopper](${IDS.grace})`);
    });
  });

  it('never triggers on an email address', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.click(screen.getByRole('combobox', { name: 'Body' }));
    await user.keyboard('mail ada@flow');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('layers Escape: the first press closes the LIST, the second cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<Host onCancel={onCancel} />);

    await user.click(screen.getByRole('combobox', { name: 'Body' }));
    await user.keyboard('@ad');
    await screen.findByRole('listbox');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // A single Escape that also threw away a half-written comment would be a
    // bad trade — that is the whole reason the two are layered.
    expect(onCancel).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('submits on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<Host onSubmit={onSubmit} initial="looks right" />);

    await user.click(screen.getByRole('combobox', { name: 'Body' }));
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does NOT submit on a bare Enter — a body is multi-line', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<Host onSubmit={onSubmit} initial="line one" />);

    await user.click(screen.getByRole('combobox', { name: 'Body' }));
    await user.keyboard('{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
