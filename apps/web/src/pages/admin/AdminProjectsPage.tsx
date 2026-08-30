import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ellipsis, ExternalLink, LayoutGrid } from 'lucide-react';
import type { AdminProjectRow } from '@flowboard/shared';

import {
  adminProjectSortParam,
  isAdminProjectSortField,
  useAdminProjects,
} from '@/hooks/useAdminProjects';
import { useAdminOrgs } from '@/hooks/useAdminOrgs';
import { useGridUrlState, type GridParamDefs } from '@/hooks/useGridUrlState';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import {
  DataTable,
  PAGE_SIZE_OPTIONS,
  col,
  type DashboardColumnDef,
  type FacetDef,
  type SortState,
} from '@/components/dashboard/DataTable';
import { formatAgo, formatCount } from '@/components/dashboard/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * `/admin/projects` — every project in the deployment, whoever owns it.
 *
 * ═══ READ-ONLY, ON PURPOSE ═══════════════════════════════════════════════
 *
 * The only row action is "open the board". A project's settings, workflow and
 * membership belong to the project's own pages, which already enforce the
 * guards; re-implementing them here would mean a second copy of the same
 * permission logic, reachable from outside the organization it protects. The
 * console's job is to FIND a project across organizations, and then get out of
 * the way.
 *
 * ═══ THE SORT IS THE SERVER'S ════════════════════════════════════════════
 *
 * Unlike the organizations console (whose endpoint is unpaginated), this one
 * paginates and sorts server-side over a whitelisted field list. So the grid
 * runs in server mode with real `meta`, the header buttons report a
 * `{sort, order}` pair, and the request rebuilds `?sort=field:dir` from it —
 * dropping any field the shared contract does not know, rather than 422-ing the
 * page for a hand-edited URL.
 *
 * ═══ TWO NUMBERS IN ONE COLUMN ═══════════════════════════════════════════
 *
 * `open / total` rather than two columns: the pair is one fact — how much of the
 * backlog is still live — and splitting it makes a reader do the division
 * themselves across eight pixels of table gutter. It sorts by `taskCount`,
 * which is the denominator and the only half the API orders by.
 */

/* ------------------------------------------------------------------ */
/* URL state                                                           */
/* ------------------------------------------------------------------ */

type ArchivedFilter = 'hidden' | 'shown';

/** A TYPE, not an interface — see the note in `AdminOrgsPage`. */
type ProjectGridState = {
  q: string;
  orgId: string;
  archived: ArchivedFilter;
  sort: string | undefined;
  order: string;
  page: number;
  pageSize: number;
};

/**
 * `sort` is an enum with NO default and no `clearable`, which is exactly the
 * combination that round-trips "unsorted" as an ABSENT param: an unknown value
 * decodes to `undefined`, and `undefined` encodes to nothing. `clearable` — the
 * `?sort=` form — is for a grid whose default sort is a real field and which
 * therefore needs to say "the user turned it off"; this grid's default is the
 * server's own ordering, which is what no param already means.
 */
const PROJECT_GRID_PARAMS: GridParamDefs<ProjectGridState> = {
  q: { kind: 'text', maxLength: 120 },
  orgId: { kind: 'text', maxLength: 36 },
  archived: { kind: 'enum', values: ['hidden', 'shown'], default: 'hidden' },
  sort: { kind: 'enum', values: ['name', 'org', 'taskCount', 'lastActivityAt'] },
  order: { kind: 'enum', values: ['asc', 'desc'], default: 'asc' },
  page: { kind: 'int', default: 1, min: 1, max: 10_000 },
  pageSize: { kind: 'int', default: 20, values: PAGE_SIZE_OPTIONS },
};

const INITIAL_STATE: ProjectGridState = {
  q: '',
  orgId: '',
  archived: 'hidden',
  sort: undefined,
  order: 'asc',
  page: 1,
  pageSize: 20,
};

/** A uuid, loosely — enough to stop a hand-typed `?orgId=nope` reaching a 422. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminProjectsPage() {
  const { t } = useTranslation(['admin', 'common']);

  /* -------- grid state, mirrored in a ref for the URL codec -------- */
  const [state, setState] = useState<ProjectGridState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const commit = (next: ProjectGridState) => {
    stateRef.current = next;
    setState(next);
  };
  const patch = (next: Partial<ProjectGridState>) => {
    commit({ ...stateRef.current, page: 1, ...next });
  };

  useGridUrlState<ProjectGridState>({
    params: PROJECT_GRID_PARAMS,
    get: () => stateRef.current,
    apply: commit,
    push: ['orgId', 'archived', 'sort', 'order'],
  });

  /* -------- data -------- */
  const orgId = UUID_SHAPE.test(state.orgId) ? state.orgId : '';
  const sortField =
    state.sort !== undefined && isAdminProjectSortField(state.sort) ? state.sort : undefined;
  const order = state.order === 'desc' ? 'desc' : 'asc';

  const query = useAdminProjects(
    { q: state.q, orgId, includeArchived: state.archived === 'shown' },
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: adminProjectSortParam(sortField, order),
    },
  );

  // The organization facet's options. The LIVE list: filtering the cross-org
  // table by an archived organization is what `includeArchived` is for, and an
  // options list of archived orgs would offer a filter that returns nothing
  // unless the other toggle happens to be on too.
  const orgsQuery = useAdminOrgs({});

  const rows = query.data?.rows ?? [];
  const sort: SortState = { sort: sortField, order };

  /* -------- columns -------- */
  const columns = useMemo<DashboardColumnDef<AdminProjectRow>[]>(
    () => [
      col<AdminProjectRow>({
        id: 'key',
        header: t('admin:projects.column.key'),
        enableHiding: false,
        cell: (row) => (
          // A project key is machine text (`FLOW-142`'s prefix): LTR always.
          <Badge variant="outline" dir="ltr" className="font-mono text-[11px]">
            {row.key}
          </Badge>
        ),
      }),
      col<AdminProjectRow>({
        id: 'name',
        header: t('admin:projects.column.name'),
        sortField: 'name',
        enableHiding: false,
        cell: (row) => (
          <Link
            to={`/o/${row.orgSlug}/p/${row.key}/board`}
            className="truncate font-medium text-foreground underline-offset-2 hover:underline"
          >
            {row.name}
          </Link>
        ),
      }),
      col<AdminProjectRow>({
        id: 'org',
        header: t('admin:projects.column.org'),
        sortField: 'org',
        cell: (row) => (
          <Link
            to={`/o/${row.orgSlug}`}
            className="truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {row.orgName}
          </Link>
        ),
      }),
      col<AdminProjectRow>({
        id: 'lead',
        header: t('admin:projects.column.lead'),
        cell: (row) =>
          row.leadName ?? (
            <span className="text-xs text-muted-foreground">
              {t('admin:projects.value.noLead')}
            </span>
          ),
      }),
      col<AdminProjectRow>({
        id: 'members',
        header: t('admin:projects.column.members'),
        align: 'end',
        cell: (row) => formatCount(row.memberCount),
      }),
      col<AdminProjectRow>({
        id: 'tasks',
        header: t('admin:projects.column.tasks'),
        align: 'end',
        sortField: 'taskCount',
        cell: (row) =>
          t('admin:projects.value.tasks', {
            open: formatCount(row.openTaskCount),
            total: formatCount(row.taskCount),
          }),
      }),
      col<AdminProjectRow>({
        id: 'lastActivityAt',
        header: t('admin:projects.column.activity'),
        sortField: 'lastActivityAt',
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.lastActivityAt === null
              ? t('admin:projects.value.neverActive')
              : formatAgo(row.lastActivityAt)}
          </span>
        ),
      }),
      /*
        BOTH STATES ARE EXPLICIT — the `/admin/orgs` convention (R2 W3.5).

        This cell used to render `null` for a live row, so a column headed
        "Status" was blank on most of the table. A blank cell under a header
        that promises a value reads as missing DATA, not as an answer, and the
        sibling console page one click away already badged both states. Two
        conventions for the same column across two tables in the same console is
        the drift worth spending eight lines to close.

        `accessor` comes with it: with only one of the two states rendered there
        was nothing to sort by, and sorting a Status column is exactly how an
        admin gathers the archived rows together.
      */
      col<AdminProjectRow>({
        id: 'status',
        header: t('admin:projects.column.status'),
        accessor: (row) => row.deletedAt,
        cell: (row) =>
          row.deletedAt === null ? (
            <Badge variant="soft-success">{t('admin:projects.badge.live')}</Badge>
          ) : (
            <Badge
              variant="soft-danger"
              title={t('admin:projects.badge.archivedOn', {
                date: formatAgo(row.deletedAt),
              })}
            >
              {t('admin:projects.badge.archived')}
            </Badge>
          ),
      }),
    ],
    [t],
  );

  /* -------- facets -------- */
  const facets = useMemo<FacetDef[]>(
    () => [
      {
        id: 'q',
        kind: 'text',
        label: t('admin:projects.facet.q'),
        placeholder: t('admin:projects.facet.qPlaceholder'),
        value: state.q === '' ? [] : [state.q],
        onChange: (next) => {
          patch({ q: next[0] ?? '' });
        },
      },
      {
        id: 'org',
        label: t('admin:projects.facet.org'),
        // SINGLE-select: the wire parameter is one `orgId`, so a multi-select
        // would offer a selection the request cannot express.
        multi: false,
        options: (orgsQuery.data ?? []).map((org) => ({ value: org.id, label: org.name })),
        value: orgId === '' ? [] : [orgId],
        onChange: (next) => {
          patch({ orgId: next[0] ?? '' });
        },
      },
      {
        id: 'archived',
        label: t('admin:projects.facet.archived'),
        multi: false,
        options: [{ value: 'shown', label: t('admin:projects.facet.archivedInclude') }],
        value: state.archived === 'shown' ? ['shown'] : [],
        onChange: (next) => {
          patch({ archived: next[0] === 'shown' ? 'shown' : 'hidden' });
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, state.q, state.archived, orgId, orgsQuery.data],
  );

  const filtered = state.q !== '' || orgId !== '' || state.archived === 'shown';

  return (
    <section className="flex flex-col gap-[var(--gap)]">
      <SectionHeader title={t('admin:projects.title')} subtitle={t('admin:projects.description')} />

      <DataTable<AdminProjectRow>
        aria-label={t('admin:projects.tableLabel')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.projectId}
        rowTestId={(row) => `admin-project-${row.key}`}
        rowClassName={(row) => (row.deletedAt === null ? undefined : 'opacity-60')}
        loading={query.isPending}
        meta={query.data?.meta ?? null}
        onPageChange={(next) => {
          commit({ ...stateRef.current, page: next });
        }}
        onPageSizeChange={(next) => {
          patch({ pageSize: next });
        }}
        sort={sort}
        onSortChange={(next) => {
          patch({ sort: next.sort, order: next.order ?? 'asc' });
        }}
        facets={facets}
        emptyMessage={
          filtered
            ? t('admin:projects.noResults')
            : `${t('admin:projects.empty')} — ${t('admin:projects.emptyBody')}`
        }
        actions={(row) => <ProjectRowActions project={row} />}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Row actions                                                         */
/* ------------------------------------------------------------------ */

function ProjectRowActions({ project }: { project: AdminProjectRow }) {
  const { t } = useTranslation(['admin']);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('admin:projects.rowMenu', { name: project.name })}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to={`/o/${project.orgSlug}/p/${project.key}/board`}>
            <LayoutGrid aria-hidden />
            {t('admin:projects.actions.openBoard')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/o/${project.orgSlug}`}>
            <ExternalLink aria-hidden />
            {t('admin:projects.actions.openOrg')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
