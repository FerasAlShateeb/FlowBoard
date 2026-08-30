// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * The confirmation contract — the four behaviours that make an AlertDialog
 * different from a Dialog, and the reason destructive actions use this one.
 */

installJsdomStubs();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ onConfirm = () => undefined }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger>Delete org</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Acme?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Delete org' }));
  return screen.getByRole('alertdialog');
};

describe('AlertDialog', () => {
  it('is an ALERTDIALOG, not a dialog — the role is the whole point', async () => {
    render(<Harness />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const dialog = await open();
    expect(dialog).toBeInTheDocument();
    // Modal in the way that matters: the page behind is inert, which is what
    // `userEvent` reports as `pointer-events: none` in the outside-click case
    // below.
    expect(document.body).toHaveStyle({ pointerEvents: 'none' });
  });

  it('announces the consequence with the title, via title AND description', async () => {
    render(<Harness />);
    const dialog = await open();

    expect(dialog).toHaveAccessibleName('Delete Acme?');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('lands focus on CANCEL, so a stray Enter cannot delete anything', async () => {
    render(<Harness />);
    await open();

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveFocus();
  });

  it('puts Cancel FIRST in the DOM, which is what makes it the first tab stop', async () => {
    render(<Harness />);
    const dialog = await open();

    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Cancel', 'Delete']);
  });

  it('closes on Escape — a keyboard user needs a way out', async () => {
    render(<Harness />);
    await open();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does NOT close on an outside click — the question has to be answered', async () => {
    render(<Harness />);
    const dialog = await open();

    // `userEvent` refuses to click an inert page, so the dismiss attempt is
    // dispatched directly: Radix's outside-click handler listens for exactly
    // this pair, and an ordinary Dialog would close on it.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('offers no corner dismiss button, unlike Dialog', async () => {
    render(<Harness />);
    const dialog = await open();

    expect(within(dialog).queryByRole('button', { name: /close/i })).toBeNull();
  });

  it('runs the action and closes on confirm', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels without running the action', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
