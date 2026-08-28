import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  ChartGantt,
  CircleUser,
  LayoutDashboard,
  ListOrdered,
  Palette,
  Plus,
  Settings,
  ShieldCheck,
  SquareKanban,
  Table2,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { matchPath } from 'react-router-dom';
import type { SearchResult } from '@flowboard/shared';

import { orgPath, projectPath, type RouteScope } from '@/hooks/useRouteScope';

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
  | { kind: 'diagnostics' };

/** Every label key the navigation lane can emit. Checked against the catalog. */
export type PaletteLabelKey =
  | 'common:nav.board'
  | 'common:nav.backlog'
  | 'common:nav.roadmap'
  | 'common:nav.table'
  | 'common:nav.calendar'
  | 'common:nav.dashboard'
  | 'common:nav.organization'
  | 'common:nav.members'
  | 'common:nav.teams'
  | 'common:nav.orgSettings'
  | 'common:nav.notifications'
  | 'common:nav.profile'
  | 'common:nav.theme'
  | 'common:nav.adminUsers'
  | 'common:nav.adminTelemetry'
  | 'palette:actions.createTask'
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

/** Everything the builder needs to decide what exists. */
export interface PaletteContext {
  /** From `/o/:orgSlug/…`, or null outside any org. */
  orgSlug: string | null;
  /** From `/o/:orgSlug/p/:projectKey/…`, or null outside a project. */
  projectKey: string | null;
  isGlobalAdmin: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// The builder
// ───────────────────────────────────────────────────────────────────────────

/** The six project views, in sidebar order — one source for both surfaces. */
const PROJECT_VIEWS: readonly {
  id: string;
  view: string;
  labelKey: PaletteLabelKey;
  icon: LucideIcon;
}[] = [
  { id: 'view-board', view: 'board', labelKey: 'common:nav.board', icon: SquareKanban },
  { id: 'view-backlog', view: 'backlog', labelKey: 'common:nav.backlog', icon: ListOrdered },
  { id: 'view-roadmap', view: 'roadmap', labelKey: 'common:nav.roadmap', icon: ChartGantt },
  { id: 'view-table', view: 'table', labelKey: 'common:nav.table', icon: Table2 },
  { id: 'view-calendar', view: 'calendar', labelKey: 'common:nav.calendar', icon: CalendarDays },
  {
    id: 'view-dashboard',
    view: 'dashboard',
    labelKey: 'common:nav.dashboard',
    icon: LayoutDashboard,
  },
];

/**
 * Every row the navigation lane offers, in the order they appear.
 *
 * ORDER IS THE KEYBOARD CONTRACT. The project views come first because inside a
 * project they are what someone hitting Ctrl+K almost always wants, and index 0
 * is what Enter takes on a palette nobody has typed into yet.
 */
export function buildPaletteItems(context: PaletteContext): PaletteItem[] {
  const { orgSlug, projectKey, isGlobalAdmin } = context;
  const items: PaletteItem[] = [];

  // ── Project views — only inside a project ────────────────────────────────
  if (orgSlug !== null && projectKey !== null) {
    for (const view of PROJECT_VIEWS) {
      items.push({
        id: view.id,
        labelKey: view.labelKey,
        sectionKey: 'palette:sections.project',
        icon: view.icon,
        action: { kind: 'navigate', to: projectPath(orgSlug, projectKey, view.view) },
        keywords: [view.view, projectKey],
      });
    }
  }

  // ── Org pages — only inside an org ───────────────────────────────────────
  if (orgSlug !== null) {
    items.push(
      {
        id: 'org-home',
        labelKey: 'common:nav.organization',
        sectionKey: 'palette:sections.organization',
        icon: Building2,
        action: { kind: 'navigate', to: orgPath(orgSlug) },
        keywords: ['projects', orgSlug],
      },
      {
        id: 'org-members',
        labelKey: 'common:nav.members',
        sectionKey: 'palette:sections.organization',
        icon: Users,
        action: { kind: 'navigate', to: orgPath(orgSlug, 'members') },
        keywords: ['members', 'people'],
      },
      {
        id: 'org-teams',
        labelKey: 'common:nav.teams',
        sectionKey: 'palette:sections.organization',
        icon: Users,
        action: { kind: 'navigate', to: orgPath(orgSlug, 'teams') },
        keywords: ['teams'],
      },
      {
        id: 'org-settings',
        labelKey: 'common:nav.orgSettings',
        sectionKey: 'palette:sections.organization',
        icon: Settings,
        action: { kind: 'navigate', to: orgPath(orgSlug, 'settings') },
        keywords: ['settings'],
      },
    );
  }

  // ── Personal pages — everywhere ──────────────────────────────────────────
  items.push(
    {
      id: 'notifications',
      labelKey: 'common:nav.notifications',
      sectionKey: 'palette:sections.workspace',
      icon: Bell,
      action: { kind: 'navigate', to: '/notifications' },
      keywords: ['notifications', 'inbox'],
    },
    {
      id: 'profile',
      labelKey: 'common:nav.profile',
      sectionKey: 'palette:sections.workspace',
      icon: CircleUser,
      action: { kind: 'navigate', to: '/me' },
      keywords: ['profile', 'account', 'me'],
    },
    {
      id: 'theme',
      labelKey: 'common:nav.theme',
      sectionKey: 'palette:sections.workspace',
      icon: Palette,
      action: { kind: 'navigate', to: '/theme' },
      keywords: ['theme', 'appearance'],
    },
  );

  // ── Administration — chrome only; the API re-checks every one of these ───
  if (isGlobalAdmin) {
    items.push(
      {
        id: 'admin-users',
        labelKey: 'common:nav.adminUsers',
        sectionKey: 'palette:sections.admin',
        icon: ShieldCheck,
        action: { kind: 'navigate', to: '/admin/users' },
        keywords: ['admin', 'users'],
      },
      {
        id: 'admin-telemetry',
        labelKey: 'common:nav.adminTelemetry',
        sectionKey: 'palette:sections.admin',
        icon: Activity,
        action: { kind: 'navigate', to: '/admin/telemetry' },
        keywords: ['admin', 'telemetry', 'analytics'],
      },
    );
  }

  // ── Verbs ────────────────────────────────────────────────────────────────
  items.push({
    id: 'action-create-task',
    labelKey: 'palette:actions.createTask',
    sectionKey: 'palette:sections.actions',
    icon: Plus,
    action: { kind: 'create-task' },
    keywords: ['new', 'task', 'issue', 'create'],
    // Always present, unreachable without somewhere to put the task.
    disabled: projectKey === null,
  });

  if (isGlobalAdmin) {
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
