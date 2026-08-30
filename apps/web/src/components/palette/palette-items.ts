import { Palette, Plus, Terminal, type LucideIcon } from 'lucide-react';
import { matchPath } from 'react-router-dom';
import type { SearchResult } from '@flowboard/shared';

import { projectPath, type RouteScope } from '@/hooks/useRouteScope';
import {
  buildSections,
  flattenNav,
  type NavLabelKey,
  type NavSection,
} from '@/components/navigation/nav.config';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The palette's NAVIGATION lane, as data.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything in this file is PURE. `buildPaletteItems` takes the three facts
 * that decide what a user may reach (where they are, and whether they are a
 * global admin) and returns rows; `filterPaletteItems` takes rows and a needle
 * and returns the subset, ranked. No hooks, no i18next, no router — which is
 * what makes the two rules that actually matter provable in a node test:
 *
 *   - **Context gates.** The project views exist only inside a project, the org
 *     pages only inside an org, the admin pages only for a global admin. A DOM
 *     test can assert one arrangement; a table-driven unit test asserts all of
 *     them.
 *   - **Matching is over the LOCALIZED label.** An Arabic session types Arabic
 *     and must match Arabic. So the builder emits an i18n KEY, the component
 *     resolves it (`localizeItems`), and the filter runs on the resolved text —
 *     never on the key, which is English forever.
 *
 * ═══ WHY THE LABELS ARE `common:nav.*` ═════════════════════════════════════
 *
 * The sidebar already names these fourteen destinations, and a palette that
 * called the board something else would be a second vocabulary for one product
 * (the exact failure WP3.8 spent a wave undoing for the task types). Only the
 * SECTION HEADINGS and the two verbs are new, and those live in `palette:`
 * because nothing else has them.
 */

// ───────────────────────────────────────────────────────────────────────────
// Where am I?
// ───────────────────────────────────────────────────────────────────────────

/**
 * `useRouteScope()`, as a pure function of the path.
 *
 * The hook cannot be used here: the palette is mounted above `RouterProvider`
 * (see `app-router.ts`), so there is no router context to read a match from.
 * `matchPath` is the same pattern matcher `useMatch` wraps, minus the context —
 * so this answers the identical question against the identical patterns, and a
 * test can ask it about a URL that was never navigated to.
 */
export function scopeFromPathname(pathname: string): RouteScope {
  const org = matchPath('/o/:orgSlug/*', pathname);
  const project = matchPath('/o/:orgSlug/p/:projectKey/*', pathname);

  return {
    orgSlug: org?.params.orgSlug ?? null,
    projectKey: project?.params.projectKey ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

/** What selecting a row does. */
export type PaletteAction =
  /** Absolute in-app path. */
  | { kind: 'navigate'; to: string }
  /** Open WP3.2's `TaskCreateDialog` for the project in scope. */
  | { kind: 'create-task' }
  /** Flip `useLayoutStore.diagOpen` — WP4.4's drawer. */
  | { kind: 'diagnostics' }
  /** Flip `useLayoutStore.themeStudioOpen` — W2.3's Theme Studio drawer. */
  | { kind: 'theme-studio' };

/**
 * Every label key the navigation lane can emit. Checked against the catalog.
 *
 * The navigation half is exactly `NavLabelKey` — the palette does not get to
 * name a destination the sidebar has not heard of. Only the two VERBS are the
 * palette's own, and they are the only rows here that are not a route.
 */
export type PaletteLabelKey =
  | NavLabelKey
  | 'palette:actions.createTask'
  | 'palette:actions.openThemeStudio'
  | 'palette:actions.openDiagnostics';

export type PaletteSectionKey =
  | 'palette:sections.project'
  | 'palette:sections.organization'
  | 'palette:sections.workspace'
  | 'palette:sections.admin'
  | 'palette:sections.actions';

/** A navigation-lane row before its strings exist. */
export interface PaletteItem {
  /** Unique within the palette; also the `CommandItem` value. */
  id: string;
  labelKey: PaletteLabelKey;
  sectionKey: PaletteSectionKey;
  icon: LucideIcon;
  action: PaletteAction;
  /**
   * Extra needles that are NOT the label — the URL segment, mostly. Latin and
   * un-translated on purpose: someone who types `backlog` in an Arabic session
   * is typing the thing they saw in the address bar.
   */
  keywords: readonly string[];
  /**
   * Rendered greyed and unreachable by the arrow keys rather than hidden. Used
   * for "Create task…" outside a project: an action that vanishes reads as a
   * missing feature, one that is visible and disabled reads as a precondition.
   */
  disabled?: boolean;
}

/** A row with its strings resolved for the current language. */
export interface LocalizedPaletteItem extends PaletteItem {
  label: string;
  section: string;
}

/** A row that survived the needle, with the label positions that matched. */
export interface RankedPaletteItem extends LocalizedPaletteItem {
  score: number;
  /** Indices INTO `label` to highlight. Empty for an unfiltered list. */
  matched: readonly number[];
}

/**
 * Everything the builder needs to decide what exists.
 *
 * `effectiveAdmin`, not `isGlobalAdmin`: an admin previewing the product as a
 * member must not find the admin console through Ctrl+K either.
 *
 * The two FALLBACK slugs are the palette's half of the admin-trap fix. The org
 * rows used to be gated on `orgSlug` alone, so hitting Ctrl+K on `/admin/users`
 * — a route with no org in it — offered no way into any organization at all.
 * They now resolve through the same ladder the sidebar uses; both default to
 * null so a caller that has neither still type-checks and simply gets the old
 * behaviour.
 */
export interface PaletteContext {
  /** From `/o/:orgSlug/…`, or null outside any org. */
  orgSlug: string | null;
  /** From `/o/:orgSlug/p/:projectKey/…`, or null outside a project. */
  projectKey: string | null;
  effectiveAdmin: boolean;
  /** `fb-last-org-v1` — the org this device was last inside. */
  lastOrgSlug?: string | null;
  /** `instance_settings.defaultOrgSlug` — the single-org install's org. */
  defaultOrgSlug?: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// The builder
// ───────────────────────────────────────────────────────────────────────────

/**
 * Which palette heading a nav row lands under.
 *
 * The nav model groups by SIDEBAR shape — one "Workspace" section holding Home,
 * the org pages and the personal pages, because that is one scannable column.
 * The palette groups by KIND, because its rows are re-sorted by a fuzzy match
 * and a heading is the only thing left saying what a row is. A rule rather than
 * a per-id table, so a nav row added next wave lands somewhere sensible without
 * this file being edited.
 */
function paletteSectionFor(sectionId: string, itemId: string): PaletteSectionKey {
  if (sectionId === 'project') return 'palette:sections.project';
  if (sectionId === 'admin' || sectionId === 'analytics') return 'palette:sections.admin';
  return itemId.startsWith('org-') ? 'palette:sections.organization' : 'palette:sections.workspace';
}

/**
 * Every row the navigation lane offers, in the order they appear.
 *
 * ═══ THE ROWS ARE THE SIDEBAR'S ROWS ═══════════════════════════════════════
 *
 * Round 2 stopped this function from maintaining its own list of destinations
 * and had it read `navigation/nav.config.ts` instead. The two lists had already
 * drifted — the palette knew nothing about `/admin/overview`, `/admin/orgs` or
 * any analytics page, and gated its org rows on the URL exactly the way the
 * broken sidebar did, so Ctrl+K on `/admin/users` offered no route into an
 * organization either. One model means a destination that exists is reachable
 * from every surface, or from none.
 *
 * ORDER IS THE KEYBOARD CONTRACT. `buildSections` puts the project views first,
 * which is what someone hitting Ctrl+K inside a project almost always wants,
 * and index 0 is what Enter takes on a palette nobody has typed into yet. The
 * two verbs are appended last because they are not places.
 */
export function buildPaletteItems(context: PaletteContext): PaletteItem[] {
  const { orgSlug, projectKey, effectiveAdmin } = context;

  const sections: NavSection[] = buildSections({
    orgSlug,
    projectKey,
    effectiveAdmin,
    defaultOrgSlug: context.defaultOrgSlug ?? null,
    lastOrgSlug: context.lastOrgSlug ?? null,
  });

  const items: PaletteItem[] = flattenNav(sections)
    .filter((item) => item.inPalette !== false)
    .map((item) => ({
      id: item.id,
      labelKey: item.labelKey,
      sectionKey: paletteSectionFor(sectionIdOf(sections, item.id), item.id),
      icon: item.icon,
      action: { kind: 'navigate', to: item.path },
      keywords: item.keywords ?? [],
    }));

  // ── Verbs ────────────────────────────────────────────────────────────────
  items.push({
    id: 'action-create-task',
    labelKey: 'palette:actions.createTask',
    sectionKey: 'palette:sections.actions',
    icon: Plus,
    action: { kind: 'create-task' },
    keywords: ['new', 'task', 'issue', 'create'],
    // Always present, unreachable without somewhere to put the task. A project
    // view can be reached from a remembered org; a task cannot be CREATED in
    // one, because "create it where?" has no remembered answer.
    disabled: projectKey === null,
  });

  // The Theme Studio drawer. Never gated: appearance is every user's setting,
  // and this is the third door onto the same drawer (the topbar's palette icon
  // and `mod+shift+t` are the other two) precisely because the drawer has no
  // route of its own to reach through the navigation lane.
  items.push({
    id: 'action-theme-studio',
    labelKey: 'palette:actions.openThemeStudio',
    sectionKey: 'palette:sections.actions',
    icon: Palette,
    action: { kind: 'theme-studio' },
    keywords: ['theme', 'appearance', 'colors', 'colours', 'dark', 'studio'],
  });

  if (effectiveAdmin) {
    items.push({
      id: 'action-diagnostics',
      labelKey: 'palette:actions.openDiagnostics',
      sectionKey: 'palette:sections.actions',
      icon: Terminal,
      action: { kind: 'diagnostics' },
      keywords: ['diagnostics', 'logs', 'devtools'],
    });
  }

  return items;
}

/** The id of the section a nav item came from. */
function sectionIdOf(sections: readonly NavSection[], itemId: string): string {
  return sections.find((section) => section.items.some((item) => item.id === itemId))?.id ?? '';
}

/** Resolves each row's two strings. Kept separate so the builder stays pure. */
export function localizeItems(
  items: readonly PaletteItem[],
  translate: (key: PaletteLabelKey | PaletteSectionKey) => string,
): LocalizedPaletteItem[] {
  return items.map((item) => ({
    ...item,
    label: translate(item.labelKey),
    section: translate(item.sectionKey),
  }));
}

// ───────────────────────────────────────────────────────────────────────────
// Matching
// ───────────────────────────────────────────────────────────────────────────

/** Characters after which a match is at the start of a word. */
const WORD_BREAK = /[\s\-_/:.]/u;

export interface FuzzyMatch {
  score: number;
  /** Indices into the ORIGINAL text, ascending. */
  indices: readonly number[];
}

/**
 * Subsequence match with a taste for the obvious answer.
 *
 * WHY FUZZY HERE WHEN `ui/command`'s DEFAULT FILTER IS NOT. The primitive's
 * comment is right about its own call sites: a status picker and a `FB-142`
 * lookup are exact-ish, and fuzz on short strings invents confident nonsense.
 * A command palette is the opposite case — its whole promise is that `bo`,
 * `brd` and `kanban board` all reach the board — so the palette overrides the
 * filter (`filter={() => true}`) and ranks here instead.
 *
 * The scoring, in order of weight:
 *   - a contiguous run continues (+8 per character): `boar` beats `b-o-a-r`;
 *   - the character starts a word (+6): `ts` finds "Telemetry Settings";
 *   - characters skipped before a match cost (−1 each, capped): an early match
 *     outranks a late one;
 *   - the whole needle is a prefix of the text (+25): typing `board` puts
 *     "Board" above "Dashboard", which contains the same letters later.
 *
 * Returns null when the needle is not a subsequence at all. An EMPTY needle
 * matches everything with score 0 — "no filter" and "match all" are the same
 * answer, and making the caller special-case it is how one of them drifts.
 */
export function fuzzyMatch(text: string, needle: string): FuzzyMatch | null {
  const trimmed = needle.trim();
  if (trimmed === '') return { score: 0, indices: [] };

  const haystack = text.toLowerCase();
  const wanted = trimmed.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  let previous = -2;

  for (const character of wanted) {
    // Whitespace in the needle is a separator the user typed, not a character
    // to find — "kanban board" should still reach "Board".
    if (WORD_BREAK.test(character)) continue;

    const at = haystack.indexOf(character, cursor);
    if (at === -1) return null;

    if (at === previous + 1) score += 8;
    const before = at === 0 ? undefined : haystack[at - 1];
    if (before === undefined || WORD_BREAK.test(before)) score += 6;
    score -= Math.min(at - cursor, 4);

    indices.push(at);
    previous = at;
    cursor = at + 1;
  }

  if (haystack.startsWith(wanted)) score += 25;

  return { score, indices };
}

/**
 * The navigation lane for a needle: matched rows, best first.
 *
 * A row matches on its LABEL or on any keyword; the label wins ties because
 * the highlight can only be drawn on text that is on screen. Keyword hits are
 * scored a notch lower for the same reason — a row that matched something
 * invisible should not outrank one whose name the user can see matching.
 *
 * Equal scores keep the builder's order, which is what makes the first row
 * predictable: `Array.prototype.sort` is stable in every engine this ships to.
 */
export function filterPaletteItems(
  items: readonly LocalizedPaletteItem[],
  query: string,
): RankedPaletteItem[] {
  const needle = query.trim();

  if (needle === '') {
    return items.map((item) => ({ ...item, score: 0, matched: [] }));
  }

  const ranked: RankedPaletteItem[] = [];

  for (const item of items) {
    const onLabel = fuzzyMatch(item.label, needle);
    if (onLabel) {
      ranked.push({ ...item, score: onLabel.score, matched: onLabel.indices });
      continue;
    }

    let best: number | null = null;
    for (const keyword of item.keywords) {
      const hit = fuzzyMatch(keyword, needle);
      if (hit && (best === null || hit.score > best)) best = hit.score;
    }
    if (best !== null) ranked.push({ ...item, score: best - 10, matched: [] });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

// ───────────────────────────────────────────────────────────────────────────
// The tasks lane
// ───────────────────────────────────────────────────────────────────────────

/** A search hit, addressed. */
export interface PaletteTaskRow {
  /** `CommandItem` value — the task key is unique across the org. */
  id: string;
  key: string;
  title: string;
  type: SearchResult['type'];
  projectKey: string;
  projectName: string;
  /** Deep link: the task's project BOARD with the sheet open over it. */
  to: string;
}

/**
 * Search hits as rows.
 *
 * EVERY HIT LANDS ON THE BOARD, whatever view the user was looking at. The
 * sheet is a child route of all six views (`routes/index.tsx`), so `…/table/t/
 * FB-1` is equally valid — but a cross-project hit is by definition somewhere
 * the user is not, and the board is that project's front door. Sending them to
 * the table of a project they have never opened would be an arbitrary choice
 * made on their behalf.
 *
 * Returns an empty list without an org slug rather than minting `/o/null/…`.
 */
export function buildTaskRows(
  results: readonly SearchResult[],
  orgSlug: string | null,
): PaletteTaskRow[] {
  if (orgSlug === null) return [];

  return results.map((result) => ({
    id: `task:${result.taskId}`,
    key: result.key,
    title: result.title,
    type: result.type,
    projectKey: result.projectKey,
    projectName: result.projectName,
    to: `${projectPath(orgSlug, result.projectKey, 'board')}/t/${result.key}`,
  }));
}
