import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useShortcuts, type ShortcutDef, type ShortcutGroup } from '@/lib/shortcuts';
import { usePaletteStore } from '@/stores/usePaletteStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { chordKeys, currentPlatformIsApple } from '@/components/palette/chords';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The `?` cheat sheet — TRUTHFUL BY CONSTRUCTION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The global half of this dialog is not a list somebody maintains. It is
 * `useShortcuts()` — the live contents of `lib/shortcuts.ts`'s registry —
 * rendered. A chord that is not registered CANNOT appear here, and one that is
 * appears without anyone editing this file. That matters because the registry
 * is filled by three packages running in parallel (this one, WP4.4's
 * diagnostics drawer, whatever Wave 5 adds), and a hand-written cheat sheet is
 * wrong within one wave of being written.
 *
 * Each row's words come from its own `descriptionKey`, so the OWNER of a chord
 * owns its description, in its own namespace.
 *
 * ═══ THE SECOND HALF, AND WHY IT LOOKS DIFFERENT ═══════════════════════════
 *
 * Plenty of real keys are not global chords: a card only picks up with Space
 * when it has focus, the table grid's arrows only move a cell inside the grid,
 * a Gantt bar's arrows only nudge the bar you are on. They belong to a
 * component, are registered by dnd-kit or by an `onKeyDown` on the element, and
 * putting them in the registry would be a lie in the other direction — the
 * registry means "fires anywhere", and these do not.
 *
 * So they are a SEPARATE, visually distinct section with its own heading, and
 * every row in it was read out of the component that implements it (see
 * `CONTEXTUAL` below for the file each one lives in). It is the one part of
 * this dialog that a future change can make stale, which is exactly why it is
 * fenced off instead of blended in.
 */

/** Group order. `navigation` first: it is what a new user is looking for. */
const GROUP_ORDER: readonly ShortcutGroup[] = ['navigation', 'tasks', 'system'];

const GROUP_TITLE_KEY: Record<ShortcutGroup, string> = {
  navigation: 'palette:shortcuts.groups.navigation',
  tasks: 'palette:shortcuts.groups.tasks',
  system: 'palette:shortcuts.groups.system',
};

/**
 * The contextual keys, as data: literal caps and an i18n key each.
 *
 * The caps are LITERAL strings rather than chords through `chordKeys`, because
 * none of these is a registered chord — inventing `board.pickUp` in the chord
 * grammar just to render it would suggest the registry knows about it.
 */
interface ContextualRow {
  id: string;
  keys: readonly string[];
  descriptionKey: string;
}

interface ContextualSection {
  id: string;
  titleKey: string;
  rows: readonly ContextualRow[];
}

/**
 * Verified against the implementing components, not from memory:
 *   - board:  `components/board/BoardCard.tsx` (Enter → open) + dnd-kit's
 *             `KeyboardSensor` in `BoardDndProvider.tsx` (Space / arrows / Esc).
 *   - table:  `components/datatable/TaskDataTable.tsx`'s `onGridKeyDown`.
 *   - roadmap:`components/gantt/GanttBar.tsx`'s `onKeyDown`.
 *   - anywhere: `components/layout/AppShell.tsx`'s Escape listener.
 */
export const CONTEXTUAL: readonly ContextualSection[] = [
  {
    id: 'board',
    titleKey: 'palette:shortcuts.contextual.board.title',
    rows: [
      { id: 'pick', keys: ['Space'], descriptionKey: 'palette:shortcuts.contextual.board.pickUp' },
      {
        id: 'move',
        keys: ['←', '→', '↑', '↓'],
        descriptionKey: 'palette:shortcuts.contextual.board.move',
      },
      { id: 'drop', keys: ['Space'], descriptionKey: 'palette:shortcuts.contextual.board.drop' },
      { id: 'cancel', keys: ['Esc'], descriptionKey: 'palette:shortcuts.contextual.board.cancel' },
      { id: 'open', keys: ['↵'], descriptionKey: 'palette:shortcuts.contextual.board.open' },
    ],
  },
  {
    id: 'table',
    titleKey: 'palette:shortcuts.contextual.table.title',
    rows: [
      {
        id: 'move',
        keys: ['←', '→', '↑', '↓'],
        descriptionKey: 'palette:shortcuts.contextual.table.move',
      },
      {
        id: 'edit',
        keys: ['↵', 'F2'],
        descriptionKey: 'palette:shortcuts.contextual.table.edit',
      },
      {
        id: 'page',
        keys: ['PgUp', 'PgDn'],
        descriptionKey: 'palette:shortcuts.contextual.table.page',
      },
      {
        id: 'edges',
        keys: ['Home', 'End'],
        descriptionKey: 'palette:shortcuts.contextual.table.edges',
      },
    ],
  },
  {
    id: 'roadmap',
    titleKey: 'palette:shortcuts.contextual.roadmap.title',
    rows: [
      {
        id: 'nudge',
        keys: ['←', '→'],
        descriptionKey: 'palette:shortcuts.contextual.roadmap.nudge',
      },
      {
        id: 'resize',
        keys: ['Shift', '←', '→'],
        descriptionKey: 'palette:shortcuts.contextual.roadmap.resize',
      },
      {
        id: 'open',
        keys: ['↵'],
        descriptionKey: 'palette:shortcuts.contextual.roadmap.open',
      },
    ],
  },
  {
    id: 'anywhere',
    titleKey: 'palette:shortcuts.contextual.anywhere.title',
    rows: [
      {
        id: 'escape',
        keys: ['Esc'],
        descriptionKey: 'palette:shortcuts.contextual.anywhere.escape',
      },
    ],
  },
];

/** Registered chords, bucketed by group, in `GROUP_ORDER`. Pure — testable. */
export function groupShortcuts(
  shortcuts: readonly ShortcutDef[],
): { group: ShortcutGroup; defs: ShortcutDef[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    defs: shortcuts.filter((def) => def.group === group),
  })).filter((bucket) => bucket.defs.length > 0);
}

/** One key cap. Latin glyphs — this is what is printed on the hardware. */
function Cap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

/**
 * A row: caps on the start edge, what they do on the end edge.
 *
 * The caps run in LOGICAL order in an ordinary flex row, so an Arabic session
 * reads Ctrl → K right-to-left along with everything else on the page. No
 * `ltr:` variant, and deliberately no `flex-row-reverse`.
 */
function Row({ keys, children }: { keys: readonly string[]; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="flex shrink-0 flex-wrap items-center gap-1">
        {keys.map((key, index) => (
          <Fragment key={`${key}-${String(index)}`}>
            {index > 0 ? <span className="text-[10px] text-muted-foreground">+</span> : null}
            <Cap>{key}</Cap>
          </Fragment>
        ))}
      </span>
      <span className="min-w-0 text-end text-xs text-muted-foreground">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground uppercase">{title}</h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/**
 * The dialog's BODY, exported on its own.
 *
 * The dialog around it is Radix-portalled and therefore awkward to reach in a
 * static render; the body is the seam the tests drive. It is also what makes
 * "the sheet lists exactly what is registered" assertable by registering a
 * fixture and rendering this.
 */
export function ShortcutsList({ apple = currentPlatformIsApple() }: { apple?: boolean }) {
  const { t } = useTranslation(['palette']);
  const shortcuts = useShortcuts();
  const groups = useMemo(() => groupShortcuts(shortcuts), [shortcuts]);

  // `descriptionKey` and the section keys are plain strings on purpose: the
  // registry is filled by packages that own their OWN namespaces, so this file
  // cannot know the union of keys at compile time. The cast is to a narrow
  // function type — never to `any`.
  const translate = t as unknown as (key: string) => string;

  return (
    <div data-testid="shortcuts-list" className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {groups.map(({ group, defs }) => (
        <Section key={group} title={translate(GROUP_TITLE_KEY[group])}>
          {defs.map((def) => (
            <Row key={def.id} keys={chordKeys(def.chord, apple)}>
              {translate(def.descriptionKey)}
            </Row>
          ))}
        </Section>
      ))}

      {/* The fence between "fires anywhere" and "fires where you are". */}
      <div className="sm:col-span-2">
        <div className="mb-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
          {t('palette:shortcuts.contextualNote')}
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {CONTEXTUAL.map((section) => (
            <Section key={section.id} title={translate(section.titleKey)}>
              {section.rows.map((row) => (
                <Row key={row.id} keys={row.keys}>
                  {translate(row.descriptionKey)}
                </Row>
              ))}
            </Section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The cheat sheet itself, opened by `?` (and closed by Escape, via Radix). */
export default function ShortcutsCheatSheet() {
  const { t } = useTranslation(['palette']);
  const open = usePaletteStore((state) => state.cheatSheetOpen);
  const setOpen = usePaletteStore((state) => state.setCheatSheetOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto" data-testid="cheat-sheet">
        <DialogHeader>
          <DialogTitle>{t('palette:shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('palette:shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <ShortcutsList />
      </DialogContent>
    </Dialog>
  );
}
