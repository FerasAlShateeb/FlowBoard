import * as React from 'react';
import { SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * Command — the filterable list primitive behind the Ctrl+K palette (WP4.6),
 * the assignee/label pickers, and the status switcher.
 *
 * WHY IT IS HAND-BUILT. shadcn's `command` is a skin over the `cmdk` package.
 * `cmdk` is not in FlowBoard's dependency set and the web manifest is frozen
 * after this wave, so this is a from-scratch composition on the same public API
 * (`Command` / `CommandInput` / `CommandList` / `CommandEmpty` / `CommandGroup`
 * / `CommandItem` / `CommandSeparator` / `CommandShortcut` / `CommandDialog`) —
 * a Wave 3/4 agent writing against the shadcn docs finds what it expects.
 *
 * THREE DESIGN DECISIONS WORTH KNOWING:
 *
 * 1. **Non-matching items UNMOUNT** (`CommandItem` returns `null`), rather than
 *    being hidden. That keeps the DOM the single source of truth for "what is
 *    on screen", which is what makes the keyboard navigation below correct with
 *    no parallel bookkeeping to drift.
 *
 * 2. **Navigation reads the DOM, not a registry.** Arrow keys query
 *    `[data-command-item]` inside the list at keypress time and move relative
 *    to the active one. A registry would have to reproduce document order
 *    across groups, async children and conditional rendering; `querySelectorAll`
 *    already answers that exactly.
 *
 * 3. **Emptiness is CSS, not state.** `CommandList` carries
 *    `has-[[data-command-item]]:*:data-[slot=command-empty]:hidden`, so
 *    `CommandEmpty` shows precisely when no item survived the filter — with no
 *    mount/unmount counter to keep in sync. `CommandEmpty` must therefore be a
 *    CHILD of `CommandList`.
 *
 * ACCESSIBILITY. The input is a `combobox` owning the `listbox`, and
 * `aria-activedescendant` points at the active option — the standard
 * "focus stays in the textbox" pattern, so typing is never interrupted.
 */

interface CommandContextValue {
  search: string;
  setSearch: (next: string) => void;
  activeValue: string | null;
  setActiveValue: (next: string | null) => void;
  /** Returns true when an item with `value`/`keywords` survives `search`. */
  matches: (value: string, keywords: readonly string[]) => boolean;
  /** Base id: option element ids and the listbox id are derived from it. */
  baseId: string;
  listRef: React.RefObject<HTMLDivElement | null>;
}

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommand(): CommandContextValue {
  const ctx = React.useContext(CommandContext);
  if (!ctx) throw new Error('Command subcomponents must be used inside <Command>');
  return ctx;
}

/** Deterministic option id, so the input can name the active one without a ref. */
function optionId(baseId: string, value: string): string {
  return `${baseId}-opt-${encodeURIComponent(value)}`;
}

/**
 * Default matcher: case-insensitive substring over the item's value and its
 * extra keywords. Deliberately NOT fuzzy — a project key search (`FB-142`) and
 * a status name are both exact-ish, and fuzzy matching on short strings mostly
 * produces confident nonsense. Pass `filter` to override per palette.
 */
function defaultFilter(value: string, search: string, keywords: readonly string[]): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  if (value.toLowerCase().includes(needle)) return true;
  return keywords.some((keyword) => keyword.toLowerCase().includes(needle));
}

function Command({
  className,
  children,
  filter = defaultFilter,
  label,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  /** Custom match predicate. Must be stable (module scope or `useCallback`). */
  filter?: (value: string, search: string, keywords: readonly string[]) => boolean;
  /** Accessible name for the whole widget (the palette's purpose). */
  label?: string;
}) {
  const baseId = React.useId();
  const [search, setSearch] = React.useState('');
  const [activeValue, setActiveValue] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const matches = React.useCallback(
    (value: string, keywords: readonly string[]) => filter(value, search, keywords),
    [filter, search],
  );

  // Whenever the result set changes, make sure SOMETHING is active and that it
  // still exists. Runs after the children have re-rendered, so the DOM query
  // sees the post-filter list.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll<HTMLElement>('[data-command-item]');
    const first = items.item(0);
    if (!first) {
      setActiveValue(null);
      return;
    }
    const stillPresent =
      activeValue !== null && list.querySelector(`[data-value="${CSS.escape(activeValue)}"]`);
    if (!stillPresent) setActiveValue(first.dataset.value ?? null);
  }, [search, activeValue]);

  const value = React.useMemo<CommandContextValue>(
    () => ({ search, setSearch, activeValue, setActiveValue, matches, baseId, listRef }),
    [search, activeValue, matches, baseId],
  );

  return (
    <CommandContext.Provider value={value}>
      <div
        data-slot="command"
        role="group"
        aria-label={label}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-[var(--card-radius)] bg-popover text-popover-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </CommandContext.Provider>
  );
}

function CommandInput({
  className,
  containerClassName,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & { containerClassName?: string }) {
  const { search, setSearch, activeValue, setActiveValue, baseId, listRef } = useCommand();

  /** Move the active option by `delta` places, clamping at both ends. */
  const move = (delta: number) => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-command-item]'));
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.dataset.value === activeValue);
    const nextIndex = Math.min(
      Math.max((current === -1 ? 0 : current) + delta, 0),
      items.length - 1,
    );
    const next = items[nextIndex];
    if (!next) return;
    setActiveValue(next.dataset.value ?? null);
    next.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        move(-Number.MAX_SAFE_INTEGER);
        break;
      case 'End':
        event.preventDefault();
        move(Number.MAX_SAFE_INTEGER);
        break;
      case 'Enter': {
        if (activeValue === null) break;
        const target = listRef.current?.querySelector<HTMLElement>(
          `[data-value="${CSS.escape(activeValue)}"]`,
        );
        if (!target) break;
        event.preventDefault();
        // Click, rather than reaching for a stored callback: it is the one path
        // that also fires whatever a call site attached to the element itself.
        target.click();
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        'flex h-11 shrink-0 items-center gap-2 border-b border-border px-3',
        containerClassName,
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        data-slot="command-input"
        type="text"
        role="combobox"
        aria-expanded
        aria-autocomplete="list"
        aria-controls={`${baseId}-list`}
        aria-activedescendant={activeValue === null ? undefined : optionId(baseId, activeValue)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-full w-full bg-transparent text-sm text-foreground outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<'div'>) {
  const { baseId, listRef } = useCommand();

  return (
    <div
      ref={listRef}
      id={`${baseId}-list`}
      data-slot="command-list"
      role="listbox"
      className={cn(
        'max-h-[min(24rem,60dvh)] scroll-py-1 overflow-x-hidden overflow-y-auto p-1',
        // Emptiness as CSS: as soon as ONE item survives the filter, the
        // CommandEmpty child is hidden. See the header note.
        'has-[[data-command-item]]:*:data-[slot=command-empty]:hidden',
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-empty"
      role="presentation"
      className={cn('py-6 text-center text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/**
 * A titled section. It hides itself when the filter emptied it — `:has()` on
 * the group, so no counting and no coordination with the items.
 */
function CommandGroup({
  className,
  heading,
  children,
  ...props
}: React.ComponentProps<'div'> & { heading?: React.ReactNode }) {
  return (
    <div
      data-slot="command-group"
      role="group"
      className={cn('overflow-hidden py-1 not-has-[[data-command-item]]:hidden', className)}
      {...props}
    >
      {heading === undefined ? null : (
        <div
          data-slot="command-group-heading"
          aria-hidden
          className="px-2 py-1 text-[11px] font-medium text-muted-foreground"
        >
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

function CommandItem({
  className,
  value,
  keywords = [],
  disabled = false,
  onSelect,
  onClick,
  onPointerMove,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  /** Unique within the enclosing Command; also what the default filter matches. */
  value: string;
  /** Extra searchable terms (a task title for a key, an email for a name). */
  keywords?: readonly string[];
  disabled?: boolean;
  onSelect?: (value: string) => void;
}) {
  const { activeValue, setActiveValue, matches, baseId } = useCommand();

  if (!matches(value, keywords)) return null;

  const active = activeValue === value;

  return (
    <div
      id={optionId(baseId, value)}
      data-slot="command-item"
      // The navigation hook. `data-command-item` is what the arrow keys, the
      // empty state and the group visibility all query — a disabled item is
      // deliberately NOT marked, so it is skipped rather than landed on.
      {...(disabled ? {} : { 'data-command-item': '' })}
      data-value={value}
      data-selected={active || undefined}
      data-disabled={disabled || undefined}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (!disabled) setActiveValue(value);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (disabled || event.defaultPrevented) return;
        onSelect?.(value);
      }}
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-sm outline-hidden select-none',
        'data-[selected]:bg-accent data-[selected]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-separator"
      role="separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      // Latin keyboard combos only, never translated prose — see dropdown-menu.
      className={cn(
        'ms-auto font-mono text-[10px] tracking-widest text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The palette shell: a `Command` inside a `Dialog`, positioned near the top of
 * the viewport the way every command palette is.
 *
 * `title`/`description` are required and rendered `sr-only` — a modal dialog
 * without an accessible name is an axe violation, and there is no visible
 * heading to borrow one from.
 */
function CommandDialog({
  title,
  description,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        showCloseButton={false}
        className={cn('top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0', className)}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command label={title} className="bg-transparent">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
