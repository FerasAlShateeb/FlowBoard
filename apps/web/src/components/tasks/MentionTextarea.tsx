import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgUser } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useOrgUsers } from '@/hooks/useOrgs';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Textarea } from '@/components/ui/textarea';
import { findMentionQuery, insertMention } from '@/components/tasks/mentions';

/**
 * The markdown editor with @mention autocomplete — the description editor and
 * the comment composer are both this component.
 *
 * ── The autocomplete is a plain positioned listbox, not a Radix popover ─────
 *
 * Every popover primitive in the app is a FOCUS-MOVING widget: it opens, takes
 * focus, and returns it on close. That is exactly wrong here — the user is in
 * the middle of a sentence, and an autocomplete that steals the caret to show
 * suggestions interrupts the typing it exists to help. The ARIA pattern for
 * this case is `combobox` + `aria-activedescendant`: focus never leaves the
 * textarea, the arrow keys move a virtual highlight, and the list is an
 * absolutely positioned `listbox` anchored under the field. So that is what
 * this is, and it is why it does not compose `ui/popover`.
 *
 * ── The encoding never reaches the eye ──────────────────────────────────────
 *
 * What is INSERTED is the wire form, `@[Ada Lovelace](uuid)` — the server parses
 * the stored body to decide who gets notified (`extractMentionUserIds`), so the
 * id has to be in the text. What is DISPLAYED after saving is a chip, rendered
 * by `Markdown`. The raw encoding is visible only while editing, which is the
 * same trade every markdown editor makes with its link syntax.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────
 *
 *   with the list open : ↑/↓ move · Enter or Tab accept · Escape closes the LIST
 *   with the list shut : Ctrl/⌘+Enter submits · Escape cancels the editor
 *
 * Escape is layered on purpose: the first press dismisses the suggestions, the
 * second abandons the edit. A single Escape that threw away a half-written
 * comment because a suggestion list happened to be open would be a bad trade.
 */

export interface MentionTextareaProps {
  /** The org whose directory the autocomplete searches. */
  orgId: string | null | undefined;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/⌘+Enter. Omitted, the shortcut does nothing. */
  onSubmit?: () => void;
  /** Escape with the suggestion list closed. */
  onCancel?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Accessible name, when there is no visible `<label>`. */
  ariaLabel?: string;
  className?: string;
}

/** How many suggestions the list shows before it stops being scannable. */
const MAX_SUGGESTIONS = 6;

/** Case-insensitive match on the display name, then the email. */
function matchesQuery(entry: OrgUser, query: string): boolean {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return (
    entry.user.name.toLowerCase().includes(needle) || entry.email.toLowerCase().includes(needle)
  );
}

export function MentionTextarea({
  orgId,
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  rows = 4,
  autoFocus = false,
  disabled = false,
  ariaLabel,
  className,
}: MentionTextareaProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** The caret, mirrored into state so the `@…` token can be recomputed. */
  const [caret, setCaret] = useState(0);
  /** Set by Escape: suppresses the list until the token changes again. */
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  /** Where to put the caret after an insertion rewrites the value. */
  const pendingCaret = useRef<number | null>(null);

  const token = disabled ? null : findMentionQuery(value, caret);
  const query = token?.query ?? '';

  // The hook is given the QUERY, so a large directory is narrowed server-side
  // (`GET /orgs/:id/users?q=`) rather than shipped whole. Its own five-minute
  // staleTime means a repeated prefix is answered from cache.
  const { data: directory } = useOrgUsers(orgId, query);

  const suggestions = (directory ?? [])
    .filter((entry) => matchesQuery(entry, query))
    .slice(0, MAX_SUGGESTIONS);

  const open = token !== null && !dismissed && suggestions.length > 0;

  // A new token means a new result set; the highlight must not point past it.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Restore the caret AFTER the controlled value has been committed to the DOM —
  // React resets a textarea's selection to the end when its value changes, so
  // setting it inside the change handler would be overwritten a frame later.
  useEffect(() => {
    const position = pendingCaret.current;
    if (position === null) return;
    pendingCaret.current = null;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(position, position);
    setCaret(position);
  }, [value]);

  const syncCaret = () => {
    const element = textareaRef.current;
    if (element) setCaret(element.selectionStart);
  };

  const accept = (entry: OrgUser) => {
    const next = insertMention(value, caret, entry.user);
    pendingCaret.current = next.caret;
    setDismissed(false);
    onChange(next.text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % suggestions.length);
          return;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
          return;
        case 'Enter':
        case 'Tab': {
          const entry = suggestions[activeIndex];
          if (!entry) return;
          event.preventDefault();
          accept(entry);
          return;
        }
        case 'Escape':
          // Stop here: the outer editor must NOT also treat this as a cancel.
          event.preventDefault();
          event.stopPropagation();
          setDismissed(true);
          return;
        default:
          break;
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
      return;
    }

    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className={cn('relative flex flex-col gap-1', className)}>
      <Textarea
        ref={textareaRef}
        value={value}
        rows={rows}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        // The combobox contract: the textarea OWNS the listbox and names the
        // active option, so a screen reader announces suggestions without the
        // focus ever moving off the field.
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${String(activeIndex)}` : undefined}
        className="min-h-20 resize-y font-mono text-xs leading-relaxed"
        onChange={(event) => {
          // Typing past a dismissed token re-arms the list; that is the only
          // way back after Escape without leaving and re-entering the field.
          setDismissed(false);
          setCaret(event.target.selectionStart);
          onChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('tasks:mention.label')}
          className="absolute inset-x-0 top-full z-[110] mt-1 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-border bg-popover p-1 shadow-[var(--shadow-2)]"
        >
          {suggestions.map((entry, index) => (
            <li
              key={entry.user.id}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex || undefined}
              className="flex cursor-default items-center gap-2 rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-sm data-[active]:bg-accent data-[active]:text-accent-foreground"
              // `onMouseDown` + preventDefault, not `onClick`: a click would
              // blur the textarea first, which closes the list and loses the
              // caret the insertion is computed from.
              onMouseDown={(event) => {
                event.preventDefault();
                accept(entry);
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
            >
              <UserAvatar user={entry.user} size="xs" label="" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span dir="auto" className="truncate">
                  {entry.user.name}
                </span>
                <span className="truncate text-[11px] text-muted-foreground" dir="ltr">
                  {entry.email}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[11px] text-muted-foreground">{t('tasks:description.submitHint')}</p>
    </div>
  );
}

export default MentionTextarea;
