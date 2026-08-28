import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@flowboard/shared';

import {
  buildPaletteItems,
  buildTaskRows,
  filterPaletteItems,
  fuzzyMatch,
  localizeItems,
  scopeFromPathname,
  type PaletteItem,
  type PaletteLabelKey,
  type PaletteSectionKey,
} from '@/components/palette/palette-items';

/**
 * The palette's lanes, proved without a DOM.
 *
 * The context gates (what exists where, and for whom) are a small matrix and a
 * large source of "why is the board missing from my palette" bugs, so they are
 * asserted exhaustively here rather than sampled through a render.
 */

const ENGLISH: Record<string, string> = {
  'common:nav.board': 'Board',
  'common:nav.backlog': 'Backlog',
  'common:nav.roadmap': 'Roadmap',
  'common:nav.table': 'Table',
  'common:nav.calendar': 'Calendar',
  'common:nav.dashboard': 'Dashboard',
  'common:nav.organization': 'Organization',
  'common:nav.members': 'Members',
  'common:nav.teams': 'Teams',
  'common:nav.orgSettings': 'Organization settings',
  'common:nav.notifications': 'Notifications',
  'common:nav.profile': 'My profile',
  'common:nav.theme': 'Theme',
  'common:nav.adminUsers': 'Users',
  'common:nav.adminTelemetry': 'Telemetry',
  'palette:actions.createTask': 'Create task…',
  'palette:actions.openDiagnostics': 'Open diagnostics',
  'palette:sections.project': 'Project',
  'palette:sections.organization': 'Organization',
  'palette:sections.workspace': 'Workspace',
  'palette:sections.admin': 'Administration',
  'palette:sections.actions': 'Actions',
};

/** A stand-in for i18next's `t`, so the pure functions stay language-agnostic. */
function translator(
  dictionary: Record<string, string>,
): (key: PaletteLabelKey | PaletteSectionKey) => string {
  return (key) => dictionary[key] ?? key;
}

const IN_PROJECT = { orgSlug: 'acme', projectKey: 'FLOW', isGlobalAdmin: false };
const IN_ORG = { orgSlug: 'acme', projectKey: null, isGlobalAdmin: false };
const NOWHERE = { orgSlug: null, projectKey: null, isGlobalAdmin: false };

function ids(items: readonly PaletteItem[]): string[] {
  return items.map((item) => item.id);
}

describe('buildPaletteItems — context gates', () => {
  it('offers the six project views, in sidebar order, only inside a project', () => {
    const inside = ids(buildPaletteItems(IN_PROJECT)).filter((id) => id.startsWith('view-'));
    expect(inside).toEqual([
      'view-board',
      'view-backlog',
      'view-roadmap',
      'view-table',
      'view-calendar',
      'view-dashboard',
    ]);
    expect(ids(buildPaletteItems(IN_ORG)).some((id) => id.startsWith('view-'))).toBe(false);
    expect(ids(buildPaletteItems(NOWHERE)).some((id) => id.startsWith('view-'))).toBe(false);
  });

  it('builds every project path from the org slug and project key in the URL', () => {
    const items = buildPaletteItems(IN_PROJECT);
    const paths = items
      .filter((item) => item.id.startsWith('view-'))
      .map((item) => (item.action.kind === 'navigate' ? item.action.to : null));

    expect(paths).toEqual([
      '/o/acme/p/FLOW/board',
      '/o/acme/p/FLOW/backlog',
      '/o/acme/p/FLOW/roadmap',
      '/o/acme/p/FLOW/table',
      '/o/acme/p/FLOW/calendar',
      '/o/acme/p/FLOW/dashboard',
    ]);
  });

  it('puts the project views FIRST, so Enter on a fresh palette goes to the board', () => {
    expect(buildPaletteItems(IN_PROJECT)[0]?.id).toBe('view-board');
  });

  it('offers the org pages only inside an org', () => {
    const orgIds = ['org-home', 'org-members', 'org-teams', 'org-settings'];
    expect(ids(buildPaletteItems(IN_ORG))).toEqual(expect.arrayContaining(orgIds));
    for (const id of orgIds) expect(ids(buildPaletteItems(NOWHERE))).not.toContain(id);
  });

  it('offers the personal pages everywhere, org or not', () => {
    for (const context of [NOWHERE, IN_ORG, IN_PROJECT]) {
      expect(ids(buildPaletteItems(context))).toEqual(
        expect.arrayContaining(['notifications', 'profile', 'theme']),
      );
    }
  });

  it('hides the admin pages and the diagnostics verb from a non-admin', () => {
    const list = ids(buildPaletteItems(IN_PROJECT));
    expect(list).not.toContain('admin-users');
    expect(list).not.toContain('admin-telemetry');
    expect(list).not.toContain('action-diagnostics');
  });

  it('shows them to a global admin', () => {
    const list = ids(buildPaletteItems({ ...IN_PROJECT, isGlobalAdmin: true }));
    expect(list).toEqual(
      expect.arrayContaining(['admin-users', 'admin-telemetry', 'action-diagnostics']),
    );
  });

  it('always offers "Create task", and disables it outside a project', () => {
    for (const context of [NOWHERE, IN_ORG, IN_PROJECT]) {
      const create = buildPaletteItems(context).find((item) => item.id === 'action-create-task');
      expect(create).toBeDefined();
      expect(create?.disabled).toBe(context.projectKey === null);
    }
  });

  it('gives every row a unique id and an absolute path', () => {
    const items = buildPaletteItems({ ...IN_PROJECT, isGlobalAdmin: true });
    expect(new Set(ids(items)).size).toBe(items.length);
    for (const item of items) {
      if (item.action.kind === 'navigate') expect(item.action.to.startsWith('/')).toBe(true);
    }
  });
});

describe('fuzzyMatch', () => {
  it('treats an empty needle as "match everything", with nothing highlighted', () => {
    expect(fuzzyMatch('Board', '')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('Board', '   ')).toEqual({ score: 0, indices: [] });
  });

  it('returns null when the needle is not a subsequence', () => {
    expect(fuzzyMatch('Board', 'bz')).toBeNull();
    expect(fuzzyMatch('Board', 'draob')).toBeNull();
  });

  it('is case-insensitive and reports the matched positions', () => {
    expect(fuzzyMatch('Backlog', 'BL')?.indices).toEqual([0, 4]);
  });

  it('matches a gapped subsequence — `brd` finds the board', () => {
    expect(fuzzyMatch('Board', 'brd')).not.toBeNull();
  });

  it('ranks a prefix above the same letters buried later', () => {
    const board = fuzzyMatch('Board', 'board');
    const dashboard = fuzzyMatch('Dashboard', 'board');
    expect(board).not.toBeNull();
    expect(dashboard).not.toBeNull();
    expect(board?.score).toBeGreaterThan(dashboard?.score ?? 0);
  });

  it('treats a space in the needle as a separator, not a character to find', () => {
    expect(fuzzyMatch('Organization settings', 'org set')?.indices).toEqual([0, 1, 2, 13, 14, 15]);
  });

  it('works on Arabic, where there is no case to fold', () => {
    expect(fuzzyMatch('لوحة المهام', 'لوحة')).not.toBeNull();
    expect(fuzzyMatch('لوحة المهام', 'زز')).toBeNull();
  });
});

describe('filterPaletteItems', () => {
  const localized = localizeItems(
    buildPaletteItems({ ...IN_PROJECT, isGlobalAdmin: true }),
    translator(ENGLISH),
  );

  it('returns every row, in builder order, for an empty needle', () => {
    const all = filterPaletteItems(localized, '');
    expect(all.map((item) => item.id)).toEqual(localized.map((item) => item.id));
    expect(all.every((item) => item.matched.length === 0)).toBe(true);
  });

  it('filters to the rows whose LOCALIZED label matches', () => {
    const hits = filterPaletteItems(localized, 'board').map((item) => item.id);
    expect(hits).toContain('view-board');
    expect(hits).toContain('view-dashboard');
    expect(hits).not.toContain('view-calendar');
  });

  it('ranks the better match first', () => {
    expect(filterPaletteItems(localized, 'board')[0]?.id).toBe('view-board');
  });

  it('matches keywords too, but ranks them below a visible label match', () => {
    // "issue" appears only in the create verb's keywords.
    const hits = filterPaletteItems(localized, 'issue');
    expect(hits.map((item) => item.id)).toContain('action-create-task');
    expect(hits.find((item) => item.id === 'action-create-task')?.matched).toEqual([]);
  });

  it('matches the language the user is actually reading', () => {
    const arabic = localizeItems(
      buildPaletteItems(IN_PROJECT),
      translator({
        ...ENGLISH,
        'common:nav.board': 'لوحة المهام',
        'common:nav.profile': 'ملفي',
      }),
    );

    // Arabic text reaches the Arabic label, and the highlight lands on it.
    const board = filterPaletteItems(arabic, 'لوحة').find((item) => item.id === 'view-board');
    expect(board?.matched.length).toBeGreaterThan(0);

    // English words that lived only in the (now Arabic) label stop matching —
    // the English KEY is never what is searched.
    expect(filterPaletteItems(arabic, 'my pro').map((item) => item.id)).not.toContain('profile');

    // …while the Latin URL keywords still work, deliberately, and unhighlighted.
    const viaKeyword = filterPaletteItems(arabic, 'board').find((item) => item.id === 'view-board');
    expect(viaKeyword?.matched).toEqual([]);
  });

  it('keeps the highlight positions for the row it matched', () => {
    const backlog = filterPaletteItems(localized, 'back').find(
      (item) => item.id === 'view-backlog',
    );
    expect(backlog?.matched).toEqual([0, 1, 2, 3]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterPaletteItems(localized, 'zzzz')).toEqual([]);
  });
});

describe('scopeFromPathname', () => {
  it.each([
    ['/', null, null],
    ['/notifications', null, null],
    ['/o/acme', 'acme', null],
    ['/o/acme/members', 'acme', null],
    ['/o/acme/p/FLOW/board', 'acme', 'FLOW'],
    ['/o/acme/p/FLOW/board/t/FLOW-142', 'acme', 'FLOW'],
    ['/o/acme/p/FLOW/settings/labels', 'acme', 'FLOW'],
  ])('reads %s as org=%s project=%s', (pathname, orgSlug, projectKey) => {
    expect(scopeFromPathname(pathname)).toEqual({ orgSlug, projectKey });
  });
});

describe('buildTaskRows', () => {
  const hit: SearchResult = {
    taskId: '33333333-3333-4333-8333-333333333333',
    key: 'FLOW-142',
    title: 'Refresh token rotation',
    type: 'bug',
    statusId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: '22222222-2222-4222-8222-222222222222',
    projectKey: 'FLOW',
    projectName: 'FlowBoard',
  };

  it('deep-links every hit to its own project board with the sheet open', () => {
    expect(buildTaskRows([hit], 'acme')[0]).toMatchObject({
      id: `task:${hit.taskId}`,
      key: 'FLOW-142',
      to: '/o/acme/p/FLOW/board/t/FLOW-142',
    });
  });

  it('refuses to mint a link without an org slug', () => {
    expect(buildTaskRows([hit], null)).toEqual([]);
  });
});
