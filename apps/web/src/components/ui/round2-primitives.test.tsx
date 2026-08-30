// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router-dom';

import '@/i18n';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * The remaining Round 2 primitives: the roles they claim, the names they carry,
 * and — for `Progress` — the arithmetic that keeps a bad ratio off the screen.
 */

installJsdomStubs();

afterEach(cleanup);

/* ------------------------------------------------------------------ */
/* Breadcrumb                                                          */
/* ------------------------------------------------------------------ */

describe('Breadcrumb', () => {
  const renderTrail = () =>
    render(
      <MemoryRouter>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis label="More pages" />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Acme</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </MemoryRouter>,
    );

  it('names its navigation landmark from the catalog', () => {
    renderTrail();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('lets a caller override that name', () => {
    render(
      <MemoryRouter>
        <Breadcrumb aria-label="Where you are">
          <BreadcrumbList />
        </Breadcrumb>
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Where you are' })).toBeInTheDocument();
  });

  it('renders the trail as an ordered list of CRUMBS only', () => {
    renderTrail();
    expect(screen.getByRole('list').tagName).toBe('OL');
    // Three crumbs. The two separators are `role="presentation"`, so they are
    // not list items and "2 of 3" counts what a reader actually navigates.
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('routes through the router rather than reloading the app', () => {
    renderTrail();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('marks the last crumb as the current page and keeps it out of the tab order', () => {
    renderTrail();
    const current = screen.getByText('Acme');

    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('aria-disabled', 'true');
    expect(current.tagName).toBe('SPAN');
  });

  it('hides the separators — an ordered list already conveys the sequence', () => {
    const { container } = renderTrail();
    const separators = container.querySelectorAll('[data-slot="breadcrumb-separator"]');

    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('mirrors the chevron under RTL, because it points at the NEXT crumb', () => {
    const { container } = renderTrail();
    const icon = container.querySelector('[data-slot="breadcrumb-separator"] svg');
    expect(icon?.getAttribute('class')).toContain('rtl:rotate-180');
  });

  it('names the ellipsis, because "…" is not a word in any language', () => {
    renderTrail();
    expect(screen.getByText('More pages')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

describe('Progress', () => {
  const indicator = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-slot="progress-indicator"]');

  it('is a progressbar carrying the caller-supplied name', () => {
    render(<Progress value={40} aria-label="Sprint completion" />);
    expect(screen.getByRole('progressbar', { name: 'Sprint completion' })).toBeInTheDocument();
  });

  it('reports the value to assistive tech and to the bar width', () => {
    const { container } = render(<Progress value={40} aria-label="x" />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(indicator(container)?.style.inlineSize).toBe('40%');
  });

  it('sizes the bar on the INLINE axis, so it fills from the reading start', () => {
    const { container } = render(<Progress value={40} aria-label="x" />);

    // Not a transform: `translateX` is not mirrored by `direction` and would
    // empty an Arabic bar from the wrong end.
    expect(indicator(container)?.style.transform).toBe('');
    expect(indicator(container)?.style.inlineSize).toBe('40%');
  });

  it('clamps a ratio that overshoots or undershoots', () => {
    const { container, rerender } = render(<Progress value={140} aria-label="x" />);
    expect(indicator(container)?.style.inlineSize).toBe('100%');

    rerender(<Progress value={-20} aria-label="x" />);
    expect(indicator(container)?.style.inlineSize).toBe('0%');
  });

  it('treats a NaN (the `done / 0` case) as indeterminate, not as a bar of NaN%', () => {
    const { container } = render(<Progress value={Number.NaN} aria-label="x" />);

    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(indicator(container)?.style.inlineSize).toBe('0%');
  });

  it('passes an explicit null through as indeterminate', () => {
    render(<Progress value={null} aria-label="x" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
});

/* ------------------------------------------------------------------ */
/* Alert                                                               */
/* ------------------------------------------------------------------ */

describe('Alert', () => {
  it('is a static NOTE by default — a banner must not interrupt a screen reader', () => {
    render(
      <Alert>
        <AlertTitle>Single-organization mode</AlertTitle>
        <AlertDescription>Only the default organization is shown.</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole('note');
    expect(within(alert).getByText('Single-organization mode')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('becomes a live region only when the caller asks for one', () => {
    render(
      <Alert role="alert" variant="destructive">
        <AlertTitle>Could not save</AlertTitle>
      </Alert>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('tints from a TOKEN through the house color-mix recipe, never a literal', () => {
    render(
      <Alert variant="warning">
        <AlertTitle>Careful</AlertTitle>
      </Alert>,
    );

    const className = screen.getByRole('note').className;
    expect(className).toContain('color-mix(in_oklab,var(--warning)_12%,transparent)');
    expect(className).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('stamps the variant, so a test or a print sheet can key off it', () => {
    render(<Alert variant="success">ok</Alert>);
    expect(screen.getByRole('note')).toHaveAttribute('data-variant', 'success');
  });
});

/* ------------------------------------------------------------------ */
/* ToggleGroup                                                         */
/* ------------------------------------------------------------------ */

describe('ToggleGroup', () => {
  function SingleHarness() {
    const [value, setValue] = useState('day');
    return (
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={(next) => {
          if (next) setValue(next);
        }}
        aria-label="Granularity"
      >
        <ToggleGroupItem value="hour">Hourly</ToggleGroupItem>
        <ToggleGroupItem value="day">Daily</ToggleGroupItem>
      </ToggleGroup>
    );
  }

  it('names the group, or the whole strip is an anonymous pile of buttons', () => {
    render(<SingleHarness />);
    // Radix maps `type="single"` to radiogroup semantics; the `aria-label` is
    // what turns it from an unnamed one into a named control either way.
    expect(screen.getByRole('radiogroup', { name: 'Granularity' })).toBeInTheDocument();
  });

  it('is a named toolbar of toggle buttons in multi-select mode', () => {
    // Radix's two modes claim two different roles — `radiogroup` for the
    // exclusive one, `toolbar` for the multi-select one — and the label is what
    // names the control in both.
    render(
      <ToggleGroup type="multiple" aria-label="Columns">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole('toolbar', { name: 'Columns' })).toBeInTheDocument();
  });

  it('reports the pressed item and moves the state on click', async () => {
    render(<SingleHarness />);

    expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Hourly' }));
    expect(screen.getByRole('radio', { name: 'Hourly' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Daily' })).not.toBeChecked();
  });

  it('hands size and variant down by CONTEXT, so a call site cannot get one item wrong', () => {
    render(<SingleHarness />);

    for (const item of screen.getAllByRole('radio')) {
      expect(item).toHaveAttribute('data-size', 'sm');
      expect(item).toHaveAttribute('data-variant', 'outline');
    }
  });

  it('lets one item override the group', () => {
    render(
      <ToggleGroup type="single" size="sm" aria-label="Granularity">
        <ToggleGroupItem value="hour" size="lg">
          Hourly
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole('radio', { name: 'Hourly' })).toHaveAttribute('data-size', 'lg');
  });

  it('rounds the strip with LOGICAL corners, so it mirrors under RTL', () => {
    render(<SingleHarness />);
    const first = screen.getAllByRole('radio')[0];

    expect(first?.className).toContain('first:rounded-s-');
    expect(first?.className).not.toMatch(/rounded-l-/);
  });

  it('supports a multi-select group with aria-pressed semantics', async () => {
    render(
      <ToggleGroup type="multiple" aria-label="Columns">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );

    const a = screen.getByRole('button', { name: 'A' });
    expect(a).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'true');
  });
});
