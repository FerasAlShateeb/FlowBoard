import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RouteScope } from '@/hooks/useRouteScope';
import { useOrgBySlug } from '@/hooks/useOrgs';
import { useOrgSearch } from '@/hooks/useSearch';
import { getLastOrgSlug } from '@/hooks/useLastOrg';
import { useInstanceConfig } from '@/hooks/useInstanceConfig';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { usePaletteStore } from '@/stores/usePaletteStore';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { TaskTypeIcon } from '@/components/common/task-icons';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';
import {
  buildPaletteItems,
  buildTaskRows,
  filterPaletteItems,
  localizeItems,
  type PaletteAction,
  type PaletteLabelKey,
  type PaletteSectionKey,
  type RankedPaletteItem,
} from '@/components/palette/palette-items';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The command palette (Ctrl/⌘+K).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TWO LANES, ONE KEYBOARD LIST. Navigation rows (synchronous, from
 * `palette-items.ts`) sit above task hits (a debounced org-wide search). They
 * are not two widgets: `ui/command`'s arrow keys walk `[data-command-item]`
 * elements in DOM order, so ArrowDown steps off the last verb straight onto the
 * first task with no second focus model and no index bookkeeping to drift.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE UNOBVIOUS THING: `filter={() => true}` PLUS `onInput`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `ui/command` owns its needle: `CommandInput` is uncontrolled by design
 * (`value`/`onChange` are `Omit`ted from its props) and `Command` filters items
 * itself with a case-insensitive substring test.
 *
 * The palette needs both halves of that changed, for reasons the primitive's
 * own header agrees with:
 *
 *   - **The filter.** A palette must reach "Board" from `brd`, and it must rank
 *     — "Board" above "Dashboard" for `board`. The primitive's default filter is
 *     deliberately not fuzzy (right for a status picker, wrong here), so the
 *     palette hands it a filter that passes everything and does its own
 *     matching in `filterPaletteItems`. Only rows that survived are rendered,
 *     so "what is in the DOM" stays the single source of truth the primitive's
 *     keyboard model depends on.
 *
 *   - **The needle.** The TASK lane is not a filter over local rows; it is a
 *     request. Something outside the input has to know what was typed. The
 *     input is spread `{...props}` LAST onto the `<input>`, so an `onInput`
 *     handler reaches it even though `onChange` is closed off — and `input` is
 *     the same native event React's `onChange` is built on, so the two can
 *     never disagree about the value. The store copy is a MIRROR, never an
 *     authority: the visible text is still the primitive's state.
 *
 * A controlled input would have meant either forking a frozen primitive or
 * re-implementing its roving-focus keyboard model. Mirroring one event is the
 * smaller lie.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ROUTING ARRIVES AS A PROP
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `navigate` and `scope` are props, not `useNavigate()`/`useRouteScope()`,
 * because this component is mounted in `AppProviders` — which sits ABOVE
 * `<RouterProvider>` and therefore outside router context entirely. See
 * `PaletteMount.tsx`, which reads both off the router singleton and passes them
 * down. The side benefit is that a test drives the palette with a `vi.fn()`
 * instead of a memory router.
 */

export interface CommandPaletteProps {
  /** Where the user is. Decides which navigation rows exist. */
  scope: RouteScope;
  /** In-app navigation. Supplied by `PaletteMount`; a spy in tests. */
  navigate: (to: string) => void;
}

/** The palette does its own matching — see the header. */
function matchEverything(): boolean {
  return true;
}

/**
 * The label with its matched characters lifted out.
 *
 * Contiguous runs are ONE element rather than one per character: a 40-character
 * label would otherwise be 40 spans on every keystroke, and a screen reader
 * reading a name a letter at a time is worse than no highlight at all.
 */
export function Highlight({ text, indices }: { text: string; indices: readonly number[] }) {
  if (indices.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < indices.length; i += 1) {
    const start = indices[i];
    if (start === undefined || start < cursor || start >= text.length) continue;
    // Swallow the rest of the contiguous run.
    let end = start + 1;
    while (indices[i + 1] === end) {
      end += 1;
      i += 1;
    }
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark key={start} className="bg-transparent font-semibold text-primary">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

/** A `kbd`-ish cap for the footer hints. Latin glyphs, never translated. */
function Cap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground">
      {children}
    </kbd>
  );
}

export default function CommandPalette({ scope, navigate }: CommandPaletteProps) {
  const { t } = useTranslation(['palette']);
  const open = usePaletteStore((state) => state.open);
  const closePalette = usePaletteStore((state) => state.closePalette);

  /**
   * A FRESH `Command` PER OPEN — the `key` below, and why it is not decoration.
   *
   * The visible needle is `ui/command`'s own state, not the store's:
   * `CommandInput` is uncontrolled by design and `usePaletteStore.query` is a
   * mirror (see the header). `openPalette`/`closePalette` therefore reset the
   * MIRROR and cannot reach the primitive's copy.
   *
   * That is invisible as long as closing unmounts the subtree — but Radix keeps
   * `DialogContent` mounted for the length of its exit ANIMATION, and reopening
   * inside that window cancels the exit and restores the very same React
   * subtree, needle and highlighted row intact. Ctrl+K → Enter → Ctrl+K is a
   * completely ordinary rhythm on a keyboard-first tool, and it produced a
   * palette pre-filled with the previous search: stale rows until the debounce
   * caught up, and the next keystroke appending to text the user never typed —
   * precisely the failure `usePaletteStore`'s own comment says must not happen.
   *
   * Bumping a session counter on each OPEN forces a remount, so the primitive
   * starts clean every time. It is incremented on open rather than on close so
   * the exit animation still plays over the palette the user was looking at,
   * instead of blanking mid-flight.
   */
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (open) setSession((current) => current + 1);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closePalette();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Top-aligned, not centred: a palette that grows downward keeps its
        // input under the cursor's memory of where it typed, while a centred
        // box slides its own input away as results arrive.
        className="top-[12%] max-w-[calc(100vw-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[640px]"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">{t('palette:title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('palette:description')}</DialogDescription>
        <Command
          key={session}
          filter={matchEverything}
          label={t('palette:title')}
          className="bg-transparent"
        >
          <PaletteBody scope={scope} navigate={navigate} />
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The palette's contents.
 *
 * SPLIT OUT so its hooks mount with the dialog rather than with the app: Radix
 * does not render `DialogContent`'s children while it is closed, so `GET /orgs`
 * and the search query below cost nothing until the user actually opens the
 * palette. Exported for the render tests, which can then skip the portal.
 */
export function PaletteBody({ scope, navigate }: CommandPaletteProps) {
  const { t } = useTranslation(['palette', 'common']);
  const vocabulary = useTaskVocabulary();

  const query = usePaletteStore((state) => state.query);
  const setQuery = usePaletteStore((state) => state.setQuery);
  const closePalette = usePaletteStore((state) => state.closePalette);
  const setCreateTaskOpen = usePaletteStore((state) => state.setCreateTaskOpen);

  // Chrome only — every one of these destinations is re-checked by the API.
  // EFFECTIVE, not real: an admin previewing the product as a member must not
  // find the admin console through Ctrl+K either.
  const effectiveAdmin = useAuthStore((state) => state.isEffectiveGlobalAdmin());
  const { defaultOrgSlug } = useInstanceConfig();
  const { org } = useOrgBySlug(scope.orgSlug);
  const search = useOrgSearch(org?.id, query);

  const items = useMemo(
    () =>
      buildPaletteItems({
        orgSlug: scope.orgSlug,
        projectKey: scope.projectKey,
        effectiveAdmin,
        // The same fallback ladder the sidebar uses, so Ctrl+K on `/admin/*`
        // still offers a route into an organization. Read at render: it is a
        // string in `localStorage` that changes on navigation, and the palette
        // re-renders on every one of those anyway.
        lastOrgSlug: getLastOrgSlug(),
        defaultOrgSlug,
      }),
    [scope.orgSlug, scope.projectKey, effectiveAdmin, defaultOrgSlug],
  );

  // `t` changes identity on a language switch — which is exactly when every
  // label has to be re-resolved AND the needle re-matched against the new text.
  const localized = useMemo(
    () => localizeItems(items, (key: PaletteLabelKey | PaletteSectionKey) => t(key)),
    [items, t],
  );
  const ranked = useMemo(() => filterPaletteItems(localized, query), [localized, query]);
  const taskRows = useMemo(
    () => buildTaskRows(search.results, scope.orgSlug),
    [search.results, scope.orgSlug],
  );

  const run = useCallback(
    (action: PaletteAction) => {
      // Close FIRST in every branch: the palette is a modal, and navigating or
      // opening a second dialog underneath a live one traps focus in the box
      // that is on its way out.
      closePalette();
      switch (action.kind) {
        case 'navigate':
          navigate(action.to);
          return;
        case 'create-task':
          setCreateTaskOpen(true);
          return;
        case 'diagnostics':
          useLayoutStore.getState().setDiagOpen(true);
          return;
        case 'theme-studio':
          useLayoutStore.getState().setThemeStudioOpen(true);
          return;
      }
    },
    [closePalette, navigate, setCreateTaskOpen],
  );

  return (
    <>
      <CommandInput
        placeholder={t('palette:placeholder')}
        aria-label={t('palette:inputLabel')}
        // The needle mirror. See the file header for why this is `onInput`.
        onInput={(event) => {
          setQuery(event.currentTarget.value);
        }}
        autoFocus
      />

      <CommandList>
        <CommandEmpty>{t('palette:empty', { query: query.trim() })}</CommandEmpty>

        <CommandGroup heading={t('palette:lanes.navigation')}>
          {ranked.map((item) => (
            <NavigationRow
              key={item.id}
              item={item}
              onSelect={() => {
                run(item.action);
              }}
            />
          ))}
        </CommandGroup>

        {/*
          The tasks lane is a plain container, NOT a `CommandGroup`: a group
          hides itself when it holds no `[data-command-item]`
          (`not-has-[…]:hidden`), which would take the "searching…" row and the
          "no matches" row down with it — the two states this lane most needs
          to show.
        */}
        {search.isActive ? (
          <div role="presentation" data-testid="palette-tasks-lane" className="py-1">
            <div aria-hidden className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t('palette:lanes.tasks')}
            </div>

            {search.isSearching && taskRows.length === 0 ? (
              <div
                role="presentation"
                data-testid="palette-tasks-loading"
                className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t('palette:tasks.searching')}
              </div>
            ) : null}

            {search.isError ? (
              <div role="presentation" className="px-2 py-2 text-xs text-danger">
                {t('palette:tasks.error')}
              </div>
            ) : null}

            {!search.isSearching && !search.isError && taskRows.length === 0 ? (
              <div role="presentation" className="px-2 py-2 text-xs text-muted-foreground">
                {t('palette:tasks.none', { query: query.trim() })}
              </div>
            ) : null}

            {taskRows.map((row) => (
              <CommandItem
                key={row.id}
                value={row.id}
                onSelect={() => {
                  run({ kind: 'navigate', to: row.to });
                }}
              >
                <span className="shrink-0 rounded-[calc(var(--radius)-4px)] bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {row.key}
                </span>
                <TaskTypeIcon type={row.type} label={vocabulary.typeAria(row.type)} />
                <span className="truncate">{row.title}</span>
                <span className="ms-auto shrink-0 truncate ps-2 text-xs text-muted-foreground">
                  {row.projectName}
                </span>
              </CommandItem>
            ))}
          </div>
        ) : null}
      </CommandList>

      {/* Footer hints. The caps are Latin glyphs on purpose; only the verbs
          beside them are translated. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Cap>↑</Cap>
          <Cap>↓</Cap>
          {t('palette:footer.navigate')}
        </span>
        <span className="flex items-center gap-1">
          <Cap>
            <CornerDownLeft className="size-2.5" aria-hidden />
          </Cap>
          {t('palette:footer.open')}
        </span>
        <span className="flex items-center gap-1">
          <Cap>Esc</Cap>
          {t('palette:footer.close')}
        </span>
      </div>
    </>
  );
}

/** One navigation row: glyph, highlighted name, and which section it lives in. */
function NavigationRow({ item, onSelect }: { item: RankedPaletteItem; onSelect: () => void }) {
  const Icon = item.icon;

  return (
    <CommandItem
      value={item.id}
      keywords={item.keywords}
      disabled={item.disabled}
      onSelect={onSelect}
    >
      <Icon aria-hidden />
      <span className={cn('truncate', item.disabled && 'opacity-70')}>
        <Highlight text={item.label} indices={item.matched} />
      </span>
      <span className="ms-auto shrink-0 ps-2 text-xs text-muted-foreground">{item.section}</span>
    </CommandItem>
  );
}
