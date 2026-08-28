// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { Markdown } from '@/components/tasks/Markdown';
import { IDS } from '@/components/tasks/__tests__/test-utils';

/**
 * The markdown renderer.
 *
 * `cleanup` is registered EXPLICITLY: `vitest.config.ts` does not enable
 * `globals`, so Testing Library never sees a global `afterEach` to auto-register
 * with, and without this every previous test's tree is still in the document
 * when the next one queries it.
 */
afterEach(cleanup);

describe('Markdown', () => {
  it('renders block markdown through the token-styled overrides', () => {
    render(<Markdown source={'# Heading\n\n- alpha\n- beta'} />);

    // `h1` is downgraded to an `h3`: the sheet's own title is the page heading,
    // and a user-authored `#` must not outrank it in the outline.
    expect(screen.getByRole('heading', { name: 'Heading', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a mention as an accent chip carrying the user id', () => {
    const { container } = render(
      <Markdown source={`ping @[Ada Lovelace](${IDS.ada}) about ranks`} />,
    );

    const chip = container.querySelector('[data-slot="mention"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent('@Ada Lovelace');
    // The id survives the markdown round trip — this is the assertion that
    // catches react-markdown's URL sanitiser eating the private scheme.
    expect(chip?.getAttribute('data-user-id')).toBe(IDS.ada);
    // And it is NOT a link: a mention must not navigate anywhere.
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders a real link as an external anchor', () => {
    render(<Markdown source="see [the docs](https://example.com/x)" />);

    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    // A task description is user-authored: `noopener` is what stops it reaching
    // back through `window.opener`.
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('neutralises a javascript: URL', () => {
    const { container } = render(<Markdown source="[click](javascript:alert(1))" />);

    // The custom `urlTransform` passes everything that is not a mention to
    // react-markdown's own sanitiser, which EMPTIES a dangerous protocol.
    // Queried by element rather than by role: an anchor whose href the
    // sanitiser blanked is no longer exposed as a `link` to the a11y tree,
    // which is itself the right outcome.
    const link = container.querySelector('a');
    expect(link).toHaveTextContent('click');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
  });

  it('renders GFM tables, strikethrough and task lists', () => {
    render(
      <Markdown
        source={['| a | b |', '| - | - |', '| 1 | 2 |', '', '~~gone~~', '', '- [x] shipped'].join(
          '\n',
        )}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('gone')).toBeInTheDocument();
    // A checkbox inside a description is markdown, not state — so it renders
    // checked and disabled rather than promising a persistence that does not
    // exist.
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
  });

  it('renders raw HTML as text rather than executing it', () => {
    // `rehype-raw` is deliberately not installed; a comment containing markup
    // must never become markup.
    const { container } = render(<Markdown source={'<img src=x onerror="boom()">'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('leaves the encoding alone inside a fenced code block', () => {
    const { container } = render(
      <Markdown source={['```', `@[Ada Lovelace](${IDS.ada})`, '```'].join('\n')} />,
    );

    expect(container.querySelector('[data-slot="mention"]')).toBeNull();
    expect(container.querySelector('pre')).toHaveTextContent(`@[Ada Lovelace](${IDS.ada})`);
  });
});
