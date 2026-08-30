import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArchiveRestore, Ellipsis, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import type { OrgAdminRow } from '@flowboard/shared';

import { ApiError } from '@/lib/api';
import { ORG_SLUG_CONFLICT_CODE, useAdminOrgs, useRestoreOrg } from '@/hooks/useAdminOrgs';
import { useInstanceConfig } from '@/hooks/useInstanceConfig';
import { useGridUrlState, type GridParamDefs } from '@/hooks/useGridUrlState';
import { useApiErrorMessage } from '@/i18n/errors';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import {
  DataTable,
  PAGE_SIZE_OPTIONS,
  col,
  compareValues,
  type DashboardColumnDef,
  type FacetDef,
  type SortState,
} from '@/components/dashboard/DataTable';
import { formatDay } from '@/components/dashboard/format';
import { ArchiveOrgDialog } from '@/components/admin/orgs/ArchiveOrgDialog';
import { OrgFormDialog } from '@/components/admin/orgs/OrgFormDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * `/admin/orgs` — the organizations console: create, rename, archive, restore.
 *
 * ═══ WHY THE GRID PAGES ITSELF ═══════════════════════════════════════════
 *
 * `GET /orgs` answers a plain array with no `meta` block — it is the org
 * switcher's endpoint first, and a switcher does not paginate. Rather than
 * dropping the page out of the URL (and rendering nine hundred rows on the one
 * deployment that has them), this page sorts and slices locally and hands
 * `DataTable` a page-shaped `meta` of its own. The filters that MATTER for cost
 * — `q` and `includeDeleted` — are still server-side, so the client only ever
 * paginates a set the server already narrowed.
 *
 * That also means the grid runs in its SERVER mode (`meta` present ⇒
 * `manualSorting`), so the sort is applied here, once, by {@link SORTERS} —
 * exactly the comparator `DataTable` would have used, imported rather than
 * re-implemented.
 *
 * ═══ ARCHIVED IS A SERVER FLAG, NOT A CLIENT FILTER ══════════════════════
 *
 * `includeDeleted` changes the endpoint's ROW SHAPE, not just its filter (see
 * `useAdminOrgs`), and it is refused for anyone but a global admin. Fetching
 * everything and hiding rows in the browser would make the toggle a lie and
 * would ask the server for rows the operator did not ask to see.
 *
 * ═══ ARCHIVE IS NOT DELETE ═══════════════════════════════════════════════
 *
 * `DELETE /orgs/:orgId` is a soft delete, and `POST /orgs/:orgId/restore` is its
 * undo. The console calls the pair archive/restore throughout, because copy that
 * said "delete" would make the Restore row action read as an undo of something
 * the same screen called permanent. Restore's one interesting failure — the slug
 * was taken while the org was away — gets its own sentence rather than the
 * generic conflict toast.
 */

/* ------------------------------------------------------------------ */
/* URL state                                                           */
/* ------------------------------------------------------------------ */

type ArchivedFilter = 'hidden' | 'shown';

/**
 * A TYPE, not an interface: `useGridUrlState` constrains its state to
 * `Record<string, GridUrlValue>`, and TypeScript only gives object-literal
 * TYPES the implicit index signature that satisfies it.
 */
type OrgGridState = {
  q: string;
  archived: ArchivedFilter;
  page: number;
  pageSize: number;
};

const ORG_GRID_PARAMS: GridParamDefs<OrgGridState> = {
  q: { kind: 'text', maxLength: 120 },
  archived: { kind: 'enum', values: ['hidden', 'shown'], default: 'hidden' },
  page: { kind: 'int', default: 1, min: 1, max: 10_000 },
  pageSize: { kind: 'int', default: 20, values: PAGE_SIZE_OPTIONS },
};

const INITIAL_STATE: OrgGridState = { q: '', archived: 'hidden', page: 1, pageSize: 20 };

/**
 * The comparable value per sortable column.
 *
 * A closed record rather than a `switch`: the grid reports the wire field its
 * header declared, and anything not in this table simply leaves the rows in the
 * server's own name order instead of throwing.
 */
const SORTERS: Record<string, (row: OrgAdminRow) => string | number | null> = {
  name: (row) => row.name,
  memberCount: (row) => row.memberCount,
  projectCount: (row) => row.projectCount,
  createdAt: (row) => row.createdAt,
  deletedAt: (row) => row.deletedAt,
};

export default function AdminOrgsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const describeError = useApiErrorMessage();
  const instance = useInstanceConfig();

  /* -------- grid state, mirrored in a ref for the URL codec -------- */
  const [state, setState] = useState<OrgGridState>(INITIAL_STATE);
  // `useGridUrlState.get()` runs inside an EFFECT, one commit after the render
  // that built the codec — so it must read a value hydration can update
  // SYNCHRONOUSLY. A closure over `state` is one commit stale, and the writer
  // effect would flush the pre-hydration state back over the URL it just read.
  const stateRef = useRef(state);
  const commit = (next: OrgGridState) => {
    stateRef.current = next;
    setState(next);
  };
  /** Any filter change resets to page 1 — page 4 of a narrower result is empty. */
  const patch = (next: Partial<OrgGridState>) => {
    commit({ ...stateRef.current, page: 1, ...next });
  };

  const [sort, setSort] = useState<SortState>({});

  useGridUrlState<OrgGridState>({
    params: ORG_GRID_PARAMS,
    get: () => stateRef.current,
    apply: commit,
    // A facet is the step Back should walk; typing and paging are not.
    push: ['archived'],
  });

  /* -------- data -------- */
  const showArchived = state.archived === 'shown';
  const query = useAdminOrgs({ q: state.q, includeDeleted: showArchived });
  const restore = useRestoreOrg();

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const sorter = sort.sort === undefined ? undefined : SORTERS[sort.sort];
    if (!sorter) return all;
    const ordered = [...all].sort((a, b) => compareValues(sorter(a), sorter(b)));
    return sort.order === 'desc' ? ordered.reverse() : ordered;
  }, [query.data, sort.sort, sort.order]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  // A filter that shrinks the result under the current page must not leave the
  // grid on an empty one; clamping here beats a second effect that re-navigates.
  const page = Math.min(state.page, totalPages);
  const pageRows = rows.slice((page - 1) * state.pageSize, page * state.pageSize);

  const meta = { page, pageSize: state.pageSize, total, totalPages };

  /* -------- dialogs -------- */
  const [formOrg, setFormOrg] = useState<OrgAdminRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiving, setArchiving] = useState<OrgAdminRow | null>(null);

  const openCreate = () => {
    setFormOrg(null);
    setFormOpen(true);
  };
  const openRename = (org: OrgAdminRow) => {
    setFormOrg(org);
    setFormOpen(true);
  };

  const runRestore = (org: OrgAdminRow) => {
    restore.mutate(org.id, {
      onSuccess: () => {
        toast.success(t('admin:orgs.restore.restored', { name: org.name }));
      },
      onError: (error: unknown) => {
        // The one failure an operator can act on: another organization took the
        // slug while this one was archived. The remedy is not something a
        // generic conflict toast can say.
        if (error instanceof ApiError && error.code === ORG_SLUG_CONFLICT_CODE) {
          toast.error(t('admin:orgs.restore.conflict', { slug: org.slug }));
          return;
        }
        toast.error(describeError(error));
      },
    });
  };

  /* -------- columns -------- */
  const columns = useMemo<DashboardColumnDef<OrgAdminRow>[]>(
    () => [
      col<OrgAdminRow>({
        id: 'name',
        header: t('admin:orgs.column.name'),
        accessor: (row) => row.name,
        enableHiding: false,
        cell: (row) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground">{row.name}</span>
            {/* A slug is machine text and part of a URL: LTR in every language. */}
            <span dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
              /o/{row.slug}
            </span>
          </div>
        ),
      }),
      col<OrgAdminRow>({
        id: 'memberCount',
        header: t('admin:orgs.column.members'),
        align: 'end',
        accessor: (row) => row.memberCount,
        cell: (row) => row.memberCount,
      }),
      col<OrgAdminRow>({
        id: 'projectCount',
        header: t('admin:orgs.column.projects'),
        align: 'end',
        accessor: (row) => row.projectCount,
        cell: (row) => row.projectCount,
      }),
      col<OrgAdminRow>({
        id: 'createdAt',
        header: t('admin:orgs.column.created'),
        accessor: (row) => row.createdAt,
        cell: (row) => (
          <span className="text-xs text-muted-foreground">{formatDay(row.createdAt)}</span>
        ),
      }),
      col<OrgAdminRow>({
        id: 'deletedAt',
        header: t('admin:orgs.column.status'),
        accessor: (row) => row.deletedAt,
        cell: (row) =>
          row.deletedAt === null ? (
            <Badge variant="soft-success">{t('admin:orgs.badge.live')}</Badge>
          ) : (
            <Badge
              variant="soft-danger"
              title={t('admin:orgs.badge.archivedOn', {
                date: formatDay(row.deletedAt),
              })}
            >
              {t('admin:orgs.badge.archived')}
            </Badge>
          ),
      }),
    ],
    [t],
  );

  const facets = useMemo<FacetDef[]>(
    () => [
      {
        id: 'q',
        kind: 'text',
        label: t('admin:orgs.facet.q'),
        placeholder: t('admin:orgs.facet.qPlaceholder'),
        value: state.q === '' ? [] : [state.q],
        onChange: (next) => {
          patch({ q: next[0] ?? '' });
        },
      },
    ],
    // `patch` closes over a ref, not over `state`, so it is stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, state.q],
  );

  const filtered = state.q !== '' || showArchived;

  return (
    <section className="flex flex-col gap-[var(--gap)]">
      <SectionHeader
        title={t('admin:orgs.title')}
        subtitle={t('admin:orgs.description')}
        actions={
          <Button size="sm" onClick={openCreate} data-testid="create-org">
            <Plus aria-hidden />
            {t('admin:orgs.actions.create')}
          </Button>
        }
      />

      {/*
        SINGLE-ORGANIZATION MODE. A banner rather than a disabled page: creating
        an organization stays available to an admin (it is how you prepare a
        switch back), but somebody looking at a two-row table in single mode
        needs to be told why only one of them is reachable.
      */}
      {instance.orgMode === 'single' ? (
        <Alert variant="info" data-testid="single-org-banner">
          <AlertTitle>{t('admin:orgs.singleMode.title')}</AlertTitle>
          <AlertDescription>
            {instance.defaultOrgSlug === null
              ? t('admin:orgs.singleMode.bodyNoDefault')
              : t('admin:orgs.singleMode.body', {
                  name:
                    query.data?.find((org) => org.slug === instance.defaultOrgSlug)?.name ??
                    instance.defaultOrgSlug,
                })}{' '}
            <Link
              to="/admin/settings"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('admin:orgs.singleMode.link')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <DataTable<OrgAdminRow>
        aria-label={t('admin:orgs.tableLabel')}
        columns={columns}
        rows={pageRows}
        rowKey={(row) => row.id}
        rowTestId={(row) => `admin-org-${row.slug}`}
        rowClassName={(row) => (row.deletedAt === null ? undefined : 'opacity-60')}
        loading={query.isPending}
        meta={meta}
        onPageChange={(next) => {
          commit({ ...stateRef.current, page: next });
        }}
        onPageSizeChange={(next) => {
          patch({ pageSize: next });
        }}
        sort={sort}
        onSortChange={setSort}
        facets={facets}
        emptyMessage={
          filtered
            ? t('admin:orgs.noResults')
            : `${t('admin:orgs.empty')} — ${t('admin:orgs.emptyBody')}`
        }
        toolbar={
          <div className="flex items-center gap-2">
            <Switch
              id="admin-orgs-archived"
              checked={showArchived}
              onCheckedChange={(checked) => {
                patch({ archived: checked ? 'shown' : 'hidden' });
              }}
              aria-label={t('admin:orgs.showArchived')}
              data-testid="orgs-show-archived"
            />
            <Label htmlFor="admin-orgs-archived" className="text-xs text-muted-foreground">
              {t('admin:orgs.showArchived')}
            </Label>
          </div>
        }
        actions={(row) => (
          <OrgRowActions
            org={row}
            onOpenOrg={undefined}
            onRename={() => {
              openRename(row);
            }}
            onArchive={() => {
              setArchiving(row);
            }}
            onRestore={() => {
              runRestore(row);
            }}
            restoring={restore.isPending}
          />
        )}
      />

      <OrgFormDialog open={formOpen} onOpenChange={setFormOpen} org={formOrg} />
      <ArchiveOrgDialog
        org={archiving}
        onOpenChange={(next) => {
          if (!next) setArchiving(null);
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Row actions                                                         */
/* ------------------------------------------------------------------ */

/**
 * The row menu. An ARCHIVED row offers Restore and nothing else: opening it
 * would 404 (every org read filters `deleted_at IS NULL`) and renaming one is a
 * change nobody can see until it is back.
 */
function OrgRowActions({
  org,
  onRename,
  onArchive,
  onRestore,
  restoring,
}: {
  org: OrgAdminRow;
  /** Reserved for a future in-place drawer; the Open row is a `<Link>`. */
  onOpenOrg?: undefined;
  onRename: () => void;
  onArchive: () => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  const { t } = useTranslation(['admin']);
  const archived = org.deletedAt !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('admin:orgs.rowMenu', { name: org.name })}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {archived ? (
          <DropdownMenuItem
            disabled={restoring}
            onSelect={() => {
              onRestore();
            }}
          >
            <ArchiveRestore aria-hidden />
            {t('admin:orgs.actions.restore')}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem asChild>
              <Link to={`/o/${org.slug}`}>
                <ExternalLink aria-hidden />
                {t('admin:orgs.actions.open')}
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={() => {
                onRename();
              }}
            >
              <Pencil aria-hidden />
              {t('admin:orgs.actions.rename')}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onArchive();
              }}
            >
              <Trash2 aria-hidden />
              {t('admin:orgs.actions.archive')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
