import { useMemo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';
import {
  MENTION_HREF_PREFIX,
  mentionUserIdFromHref,
  mentionsToMarkdownLinks,
} from '@/components/tasks/mentions';

/**
 * The markdown renderer behind task descriptions and comment bodies.
 *
 * ── Why the prose styles are hand-written ───────────────────────────────────
 *
 * `@tailwindcss/typography` is deliberately NOT a dependency: its `prose`
 * classes carry their own colour ramp, their own spacing scale and their own
 * font sizes, none of which are FlowBoard's tokens — so a themed app would have
 * one island rendering in someone else's design system, and the Theme Studio
 * would not reach it. Every element below is therefore styled explicitly from
 * the token layer, with LOGICAL properties (`ps-*`, `border-s`, `text-start`)
 * so the whole block mirrors under RTL rather than needing an `ltr:`/`rtl:` pair
 * per rule.
 *
 * ── Mentions ────────────────────────────────────────────────────────────────
 *
 * `@[Ada](uuid)` is rewritten to `[@Ada](fb-mention:uuid)` BEFORE parsing (see
 * `mentions.ts` for why that beats inspecting the AST afterwards), and the `a`
 * override below turns any link carrying that scheme into an accent chip.
 *
 * That rewrite is also why `urlTransform` is overridden. react-markdown's
 * default sanitiser allows only `http`, `https`, `mailto`, `tel` and relative
 * URLs — everything else becomes an empty href, which would strip the mention's
 * user id before the renderer ever saw it. The override passes exactly the
 * private scheme through and hands everything else to the ORIGINAL sanitiser,
 * so `javascript:` in a user-authored comment stays neutralised.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *
 * Raw HTML is not enabled (`rehype-raw` is not installed and must not be), so a
 * comment containing `<script>` renders as text. Real links open in a new tab
 * with `rel="noreferrer noopener"`: a task description is user-authored content
 * and must not be able to reach back through `window.opener`.
 */

/** Keeps the mention scheme; defers to react-markdown's sanitiser otherwise. */
function urlTransform(url: string): string {
  return url.startsWith(MENTION_HREF_PREFIX) ? url : defaultUrlTransform(url);
}

/**
 * The component overrides, at MODULE SCOPE.
 *
 * react-markdown re-creates its processor when `components` changes identity,
 * and this object closes over nothing — rebuilding it per render would throw
 * away the parsed tree of every comment in a thread on each keystroke of the
 * composer above it.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,

  a: ({ href, children }) => {
    const mentionId = mentionUserIdFromHref(href);
    if (mentionId !== null) {
      return (
        <span
          data-slot="mention"
          data-user-id={mentionId}
          className="mx-px inline-flex items-baseline rounded-[var(--radius)] bg-primary/12 px-1 py-px text-[0.95em] font-medium text-primary"
        >
          {children}
        </span>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      >
        {children}
      </a>
    );
  },

  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

  h1: ({ children }) => (
    <h3 className="mt-4 mb-2 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="mt-4 mb-2 text-sm font-semibold text-foreground first:mt-0">{children}</h4>
  ),
  h3: ({ children }) => (
    <h5 className="mt-3 mb-1.5 text-xs font-semibold text-foreground first:mt-0">{children}</h5>
  ),
  h4: ({ children }) => (
    <h6 className="mt-3 mb-1.5 text-xs font-semibold text-muted-foreground first:mt-0">
      {children}
    </h6>
  ),

  // `ps-5` + `list-outside`: the marker hangs in the start margin and mirrors
  // under RTL, which `pl-5` would not.
  ul: ({ children }) => (
    <ul className="my-2 list-outside list-disc space-y-1 ps-5 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-outside list-decimal space-y-1 ps-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  blockquote: ({ children }) => (
    <blockquote className="my-2 border-s-2 border-border ps-3 text-muted-foreground italic">
      {children}
    </blockquote>
  ),

  /**
   * GFM turns `- [ ]` into a disabled checkbox. It stays disabled — a task list
   * inside a description is markdown, not state, and letting it look clickable
   * would promise a persistence that does not exist.
   */
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={checked ?? false}
        readOnly
        disabled
        className="me-1.5 size-3 translate-y-px accent-primary"
      />
    ) : null,

  /**
   * ONE component for both inline spans and fenced blocks. react-markdown v10
   * no longer passes an `inline` flag, so the two are told apart by the
   * `language-*` class the fence adds — an inline span never has one.
   */
  code: ({ className, children }) => {
    const isBlock = typeof className === 'string' && className.includes('language-');
    if (!isBlock) {
      return (
        <code className="rounded-[calc(var(--radius)-3px)] bg-surface-raised px-1 py-px font-mono text-[0.9em] text-foreground">
          {children}
        </code>
      );
    }
    return <code className="font-mono text-xs leading-relaxed">{children}</code>;
  },

  // Code, like every wide block below, scrolls INSIDE its own box: the sheet is
  // a fixed-width panel and a long line must never widen the page.
  pre: ({ children }) => (
    <pre
      dir="ltr"
      className="my-2 overflow-x-auto rounded-[var(--radius)] border border-border bg-surface-raised p-2.5 text-start"
    >
      {children}
    </pre>
  ),

  hr: () => <hr className="my-3 border-border" />,

  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-raised">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-start font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 text-start">{children}</td>,

  img: ({ src, alt }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      loading="lazy"
      className="my-2 max-w-full rounded-[var(--radius)] border border-border"
    />
  ),
};

const PLUGINS = [remarkGfm];

/**
 * Renders a markdown body with FlowBoard's mention encoding.
 *
 * @param source the raw body as stored — mentions still in `@[Name](id)` form.
 */
export function Markdown({ source, className }: { source: string; className?: string }): ReactNode {
  // One string pass per body, memoized: a comment thread re-renders whenever the
  // composer above it changes, and every body would otherwise be rewritten.
  const prepared = useMemo(() => mentionsToMarkdownLinks(source), [source]);

  return (
    // `dir="auto"` (WP5.1): a description or comment is USER PROSE, written in
    // whatever language its author chose. Inheriting the page's `rtl` for an
    // English body dragged every trailing full stop to the front of its line
    // (".Markdown is supported"). The block-level `dir` also settles list
    // markers, blockquote rules and table columns for the body it wraps — and an
    // Arabic body still reads right-to-left inside an English page.
    <div
      data-slot="markdown"
      dir="auto"
      className={cn('text-sm break-words text-foreground', className)}
    >
      <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={urlTransform} components={COMPONENTS}>
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
