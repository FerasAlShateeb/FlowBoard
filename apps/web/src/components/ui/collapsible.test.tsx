// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * The disclosure contract: `aria-expanded` on the trigger, `aria-controls`
 * pointing at the panel, and a panel that is genuinely absent while closed.
 */

installJsdomStubs();

afterEach(cleanup);

function Harness({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger>Advanced options</CollapsibleTrigger>
      <CollapsibleContent>
        <p>Panel body</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

describe('Collapsible', () => {
  it('reports its state through aria-expanded, both ways', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Advanced options' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('points aria-controls at the panel it actually opens', async () => {
    render(<Harness defaultOpen />);
    const trigger = screen.getByRole('button', { name: 'Advanced options' });
    const controls = trigger.getAttribute('aria-controls');

    expect(controls).toBeTruthy();
    expect(document.getElementById(controls ?? '')).toContainElement(
      screen.getByText('Panel body'),
    );
  });

  it('removes the panel from the tree while closed, rather than hiding it', async () => {
    render(<Harness />);
    expect(screen.queryByText('Panel body')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
    expect(screen.getByText('Panel body')).toBeInTheDocument();
  });

  it('opens on Enter and on Space, because it is a real button', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Advanced options' });

    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('stamps the data-slot attributes the design system keys off', () => {
    const { container } = render(<Harness defaultOpen />);

    expect(container.querySelector('[data-slot="collapsible"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="collapsible-trigger"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="collapsible-content"]')).toBeInTheDocument();
  });

  it('clips the panel, so a closing transition never paints outside the box', () => {
    const { container } = render(<Harness defaultOpen />);
    expect(container.querySelector('[data-slot="collapsible-content"]')?.className).toContain(
      'overflow-hidden',
    );
  });
});
