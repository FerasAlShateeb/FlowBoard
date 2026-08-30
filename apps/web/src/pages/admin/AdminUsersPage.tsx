import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Building2,
  Download,
  Ellipsis,
  KeyRound,
  LogOut,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  provisionUserInputSchema,
  type AdminUpdateUserInput,
  type AdminUserRow,
  type ProvisionMembership,
} from '@flowboard/shared';
import type { z } from 'zod';

import { getIntlLocale } from '@/lib/lang-policy';
import { csvFilename, toCsv, type CsvRow } from '@/lib/csv';
import {
  generateTempPassword,
  useAdminUsers,
  useProvisionUser,
  useResetUserPassword,
  useUpdateAdminUser,
  type AdminUserFilters,
} from '@/hooks/useAdminUsers';
import { useGridUrlState, type GridParamDefs } from '@/hooks/useGridUrlState';
import { useAuthStore } from '@/stores/useAuthStore';
import { downloadCsvBlob } from '@/components/dashboard/save-blob';
import { DeleteUserDialog } from '@/components/admin/users/DeleteUserDialog';
import { MembershipsDialog } from '@/components/admin/users/MembershipsDialog';
import { OrgMembershipPicker } from '@/components/admin/users/OrgMembershipPicker';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import FormDialog from '@/components/common/FormDialog';
import CopyButton from '@/components/common/CopyButton';
import { UserChip } from '@/components/common/UserAvatar';
import TablePagination, { PAGE_SIZES, type PageSize } from '@/components/datatable/TablePagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * `/admin/users` — the global-admin user directory.
 *
 * ═══ WHY EVERY ACTION IS A CONFIRM ════════════════════════════════════════
 *
 * All four row actions have consequences that reach past this table: three of
 * them revoke sessions, and two change what a person can see across every
 * organization in the deployment. None is undoable by pressing the same button
 * again — reactivating a user does not restore the sessions deactivating them
 * killed. A dropdown item that fires straight through is right for a role
 * change inside one project; it is wrong here.
 *
 * Each confirm SAYS what else happens. "Deactivate" that does not mention
 * revoked sessions is a dialog that taught the reader nothing they did not
 * already know from the menu item.
 *
 * ═══ THE TEMPORARY PASSWORD IS A ONE-WAY VALUE ════════════════════════════
 *
 * The API has no "generate one for me" mode: `POST /admin/users` and the reset
 * route both take a password the caller chose, and neither echoes it back. So
 * the browser generates it (`crypto.getRandomValues`, see the hook), holds it
 * in component state, and shows it exactly once. That is why the dialog is
 * modal, says so up front, and offers a copy button rather than expecting
 * anybody to transcribe sixteen characters.
 *
 * ═══ THE SELF-GUARDS ══════════════════════════════════════════════════════
 *
 * The signed-in admin cannot deactivate themselves or drop their own global
 * flag — the server 400s both, because an admin who locks themselves out of the
 * only surface that could let them back in has a very expensive problem. The
 * menu simply does not offer them, which is chrome; the server is the guard.
 *
 * ═══ MEMBERSHIPS (ROUND 2) ════════════════════════════════════════════════
 *
 * This page used to say, right here, that memberships could not be shown
 * because `userSchema` did not carry them and `orgMemberships` was write-only.
 * Both halves of that are now false: the list endpoint returns
 * `adminUserRowSchema` — the account PLUS every organization it belongs to,
 * joined once rather than N+1 — and the memberships dialog reads them back
 * through the org's own membership endpoints. The column renders chips with an
 * overflow count; the dialog is where they are edited.
 *
 * ═══ THE FILTERS LIVE IN THE URL ══════════════════════════════════════════
 *
 * A filtered directory that cannot be linked or reloaded is one an admin has to
 * rebuild from memory every time they follow a link out of it. `q`, `status`,
 * `page` and `pageSize` round-trip through `useGridUrlState`; nothing else does
 * (see that module's header on why a table LAYOUT does not belong in a URL).
 *
 * ═══ WHAT IS STILL NOT HERE, AND WHY ══════════════════════════════════════
 *
 * **Sortable columns.** `adminUserListQuerySchema` is `paginationQuerySchema`
 * plus `q`/`isActive` — there is no `?sort` on this endpoint, so sortable
 * headers would either lie (sorting one page of twenty-five out of nine hundred
 * rows) or need a server change this package does not own. The list is
 * newest-first, which is what an admin directory is usually read as.
 *
 * **A whole-result CSV.** The export writes the rows currently on screen. There
 * is no unpaginated read, and a client that pages through forty requests to
 * build a file is a denial-of-service against its own API. The filename carries
 * the date; the filters are the admin's own.
 */

/** Rows per page. Matches the API's own default. */
const DEFAULT_PAGE_SIZE: PageSize = 25;

type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * The URL-synced grid state.
 *
 * A TYPE, not an interface: `useGridUrlState` constrains its state to
 * `Record<string, GridUrlValue>`, and TypeScript only grants object-literal
 * TYPES the implicit index signature that satisfies it.
 */
type UserGridState = {
  q: string;
  status: StatusFilter;
  page: number;
  pageSize: number;
};

const USER_GRID_PARAMS: GridParamDefs<UserGridState> = {
  q: { kind: 'text', maxLength: 120 },
  status: { kind: 'enum', values: ['all', 'active', 'inactive'], default: 'all' },
  page: { kind: 'int', default: 1, min: 1, max: 10_000 },
  pageSize: { kind: 'int', default: DEFAULT_PAGE_SIZE, values: PAGE_SIZES },
};

const INITIAL_GRID_STATE: UserGridState = {
  q: '',
  status: 'all',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

/** How many org chips a row shows before it collapses the rest into `+n`. */
const MEMBERSHIP_CHIP_LIMIT = 2;

/**
 * The provision form's schema — the wire schema MINUS the two fields the form
 * does not collect.
 *
 * `password` is generated at submit time and `orgMemberships` is not offered
 * here at all (see {@link ProvisionDialog}), so validating against the full
 * `provisionUserInputSchema` would block every submit on a required password
 * the user was never asked for. Deriving it with `.omit()` rather than
 * hand-writing a second schema keeps the two fields that ARE collected bound to
 * the same rules — and the same shared validation messages — the server applies.
 */
const provisionFormSchema = provisionUserInputSchema.omit({
  password: true,
  orgMemberships: true,
});

/** The form's INPUT type — the schema's `.default()`s are not applied yet. */
type ProvisionValues = z.input<typeof provisionFormSchema>;

export default function AdminUsersPage() {
  const { t } = useTranslation(['admin', 'common']);

  /* -------- grid state, mirrored in a ref for the URL codec -------- */
  const [grid, setGrid] = useState<UserGridState>(INITIAL_GRID_STATE);
  // `useGridUrlState.get()` runs inside an EFFECT, one commit after the render
  // that built the codec — so it must read a value hydration can update
  // SYNCHRONOUSLY. A closure over `grid` is one commit stale, and the writer
  // effect would flush the pre-hydration state back over the URL it just read.
  const gridRef = useRef(grid);
  const apply = (next: UserGridState) => {
    gridRef.current = next;
    setGrid(next);
  };

  /**
   * Any filter change resets to page 1.
   *
   * Not cosmetic: narrowing a search while on page 4 of the unfiltered set
   * requests page 4 of a result that may have one page, and the server answers
   * with an empty array — a table that looks broken because the user typed.
   */
  const commit = (next: Partial<UserGridState>) => {
    apply({ ...gridRef.current, page: 1, ...next });
  };

  useGridUrlState<UserGridState>({
    params: USER_GRID_PARAMS,
    get: () => gridRef.current,
    apply,
    // A discrete choice is the step Back should walk; typing and paging are not.
    push: ['status'],
  });

  const { q: search, status, page, pageSize } = grid;

  const filters = useMemo<AdminUserFilters>(
    () => ({
      q: search,
      isActive: status === 'all' ? undefined : status === 'active',
    }),
    [search, status],
  );

  const query = useAdminUsers(filters, { page, pageSize });
  const updateUser = useUpdateAdminUser();

  const meId = useAuthStore((state) => state.user?.id);

  // ── The confirmable row actions ───────────────────────────────────────────
  // One piece of state for all five: only one confirm can be open at a time,
  // and modelling that as five booleans invites the state where two are true.
  // Typed to `PatchAction`, so the lookup tables below are exhaustive by
  // construction and `resetPassword` — which is a different request entirely —
  // cannot reach them.
  const [pending, setPending] = useState<{ user: AdminUserRow; action: PatchAction } | null>(null);

  const runPendingAction = () => {
    if (!pending) return;
    const { user, action } = pending;

    updateUser.mutate(
      { userId: user.id, input: PATCH_FOR[action](user) },
      {
        onSuccess: () => {
          toast.success(t(TOAST_FOR[action], { name: user.name }));
          setPending(null);
        },
      },
    );
  };

  // ── Provisioning, and the password it hands back ──────────────────────────
  const [provisionOpen, setProvisionOpen] = useState(false);
  /** The one-shot credential dialog: `null` when nothing is being revealed. */
  const [revealed, setRevealed] = useState<{ name: string; password: string } | null>(null);
  const [resetting, setResetting] = useState<AdminUserRow | null>(null);

  // ── The two Round 2 dialogs ───────────────────────────────────────────────
  const [managing, setManaging] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);

  const rows = query.data?.rows ?? [];

  /**
   * The rows currently on screen, as a CSV.
   *
   * Built from the same `AdminUserRow`s the table renders, with LOCALIZED
   * headers and machine values — `lib/csv` stringifies numbers with `String()`
   * so a consumer that parses the file back is not handed `Intl` output. The
   * memberships column is flattened to `name (role)` pairs, which is the only
   * shape that survives a single cell.
   */
  const exportCsv = () => {
    const headers = [
      { key: 'name', label: t('admin:users.csv.name') },
      { key: 'email', label: t('admin:users.csv.email') },
      { key: 'access', label: t('admin:users.csv.access') },
      { key: 'status', label: t('admin:users.csv.status') },
      { key: 'organizations', label: t('admin:users.csv.organizations') },
      { key: 'created', label: t('admin:users.csv.created') },
    ] as const;

    const csvRows: CsvRow[] = rows.map((user) => ({
      name: user.name,
      email: user.email,
      access: user.isGlobalAdmin
        ? t('admin:users.badge.globalAdmin')
        : t('admin:users.badge.member'),
      status: user.isActive ? t('admin:users.badge.active') : t('admin:users.badge.inactive'),
      organizations: user.memberships
        .map((entry) => `${entry.orgName} (${t(`admin:users.orgRole.${entry.role}`)})`)
        .join('; '),
      created: user.createdAt,
    }));

    downloadCsvBlob(toCsv(csvRows, headers), csvFilename(t('admin:users.exportName')));
  };

  return (
    <section className="flex flex-col gap-[var(--gap)]">
      <PageHeader
        title={t('admin:users.title')}
        description={t('admin:users.description')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0}
              onClick={exportCsv}
              data-testid="export-users-csv"
            >
              <Download aria-hidden />
              {t('admin:users.exportCsv')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setProvisionOpen(true);
              }}
            >
              <UserPlus aria-hidden />
              {t('admin:users.actions.provision')}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => {
                commit({ q: event.target.value });
              }}
              className="h-7 ps-8 text-xs"
              placeholder={t('admin:users.searchPlaceholder')}
              aria-label={t('admin:users.searchLabel')}
            />
          </div>

          <Select
            value={status}
            onValueChange={(value) => {
              commit({ status: value as StatusFilter });
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label={t('admin:users.filter.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin:users.filter.all')}</SelectItem>
              <SelectItem value="active">{t('admin:users.filter.active')}</SelectItem>
              <SelectItem value="inactive">{t('admin:users.filter.inactive')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      {query.error ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : query.isPending ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-4" />}
          title={
            search === '' && status === 'all'
              ? t('admin:users.empty')
              : t('common:states.noResults')
          }
          message={search === '' && status === 'all' ? t('admin:users.emptyBody') : undefined}
        />
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin:users.column.user')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('admin:users.column.role')}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t('admin:users.column.memberships')}
                </TableHead>
                <TableHead className="w-28">{t('admin:users.column.status')}</TableHead>
                <TableHead className="hidden w-32 lg:table-cell">
                  {t('admin:users.column.created')}
                </TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t('admin:users.column.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={user.id === meId}
                  onAction={(action) => {
                    if (action === 'resetPassword') setResetting(user);
                    else if (action === 'memberships') setManaging(user);
                    else if (action === 'delete') setDeleting(user);
                    else setPending({ user, action });
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <TablePagination
        meta={query.data?.meta}
        page={page}
        pageSize={pageSize as PageSize}
        onPageChange={(next) => {
          apply({ ...gridRef.current, page: next });
        }}
        onPageSizeChange={(next) => {
          commit({ pageSize: next });
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        // `pending` is null only while the dialog is closed, so the fallbacks
        // are never rendered — they exist so the labels need no assertion.
        title={pending ? t(CONFIRM_TITLE[pending.action], { name: pending.user.name }) : ''}
        description={pending ? t(CONFIRM_BODY[pending.action]) : undefined}
        confirmLabel={pending ? t(ACTION_LABEL[pending.action]) : undefined}
        variant={pending !== null && DESTRUCTIVE.has(pending.action) ? 'destructive' : 'default'}
        isPending={updateUser.isPending}
        onConfirm={runPendingAction}
      />

      <ProvisionDialog
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        onProvisioned={(name, password) => {
          setProvisionOpen(false);
          setRevealed({ name, password });
        }}
      />

      <ResetPasswordDialog
        user={resetting}
        onOpenChange={(next) => {
          if (!next) setResetting(null);
        }}
        onReset={(name, password) => {
          setResetting(null);
          setRevealed({ name, password });
        }}
      />

      <RevealPasswordDialog
        reveal={revealed}
        onClose={() => {
          setRevealed(null);
        }}
      />

      {/*
        The FRESH row, re-derived from the list every render. `managing` is a
        snapshot taken when the menu item was clicked; every membership write
        invalidates the directory, and a dialog rendering its own stale snapshot
        would show the change only after being closed and reopened.
      */}
      <MembershipsDialog
        user={managing === null ? null : (rows.find((row) => row.id === managing.id) ?? managing)}
        onOpenChange={(next) => {
          if (!next) setManaging(null);
        }}
      />

      <DeleteUserDialog
        user={deleting}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      />
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Row actions, as data
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four confirmable actions, each mapped to its PATCH body and its copy.
 *
 * As lookup tables rather than a switch in four places: the alternative is the
 * same four-way branch repeated in the menu, the dialog title, the dialog body
 * and the mutation, and the failure mode of that shape is a dialog that says
 * one thing while the request does another.
 */
type RowAction =
  | 'activate'
  | 'deactivate'
  | 'promote'
  | 'demote'
  | 'forceLogout'
  | 'resetPassword'
  | 'memberships'
  | 'delete';

/**
 * The subset that goes through the shared PATCH.
 *
 * `resetPassword` is a different route; `memberships` opens a dialog that talks
 * to the ORG endpoints; `delete` is its own DELETE. Excluding all three by type
 * is what keeps the four lookup tables below exhaustive by construction — a new
 * action that is not a PATCH cannot silently acquire an empty body.
 */
type PatchAction = Exclude<RowAction, 'resetPassword' | 'memberships' | 'delete'>;

const PATCH_FOR: Record<PatchAction, (user: AdminUserRow) => AdminUpdateUserInput> = {
  // Deactivating already bumps `token_version` server-side, so it does not also
  // need `forceLogout` — the server collapses both into one bump anyway.
  activate: () => ({ isActive: true }),
  deactivate: () => ({ isActive: false }),
  promote: () => ({ isGlobalAdmin: true }),
  demote: () => ({ isGlobalAdmin: false }),
  forceLogout: () => ({ forceLogout: true }),
};

const DESTRUCTIVE = new Set<RowAction>(['deactivate', 'demote', 'forceLogout']);

/**
 * `as const satisfies` on each table below, not `: Record<PatchAction, string>`.
 *
 * The annotation would widen every value to `string`, and `t()` in this app
 * takes a UNION of the catalog's real keys — so a widened table stops
 * type-checking at the call site AND stops catching a typo'd key here. `as
 * const` keeps the literals; `satisfies` keeps the exhaustiveness. Both halves
 * are load-bearing.
 */
const ACTION_LABEL = {
  activate: 'admin:users.actions.activate',
  deactivate: 'admin:users.actions.deactivate',
  promote: 'admin:users.actions.promote',
  demote: 'admin:users.actions.demote',
  forceLogout: 'admin:users.actions.forceLogout',
} as const satisfies Record<PatchAction, string>;

const CONFIRM_TITLE = {
  activate: 'admin:users.confirm.activateTitle',
  deactivate: 'admin:users.confirm.deactivateTitle',
  promote: 'admin:users.confirm.promoteTitle',
  demote: 'admin:users.confirm.demoteTitle',
  forceLogout: 'admin:users.confirm.forceLogoutTitle',
} as const satisfies Record<PatchAction, string>;

const CONFIRM_BODY = {
  activate: 'admin:users.confirm.activateBody',
  deactivate: 'admin:users.confirm.deactivateBody',
  promote: 'admin:users.confirm.promoteBody',
  demote: 'admin:users.confirm.demoteBody',
  forceLogout: 'admin:users.confirm.forceLogoutBody',
} as const satisfies Record<PatchAction, string>;

const TOAST_FOR = {
  activate: 'admin:users.toast.activated',
  deactivate: 'admin:users.toast.deactivated',
  promote: 'admin:users.toast.promoted',
  demote: 'admin:users.toast.demoted',
  forceLogout: 'admin:users.toast.loggedOut',
} as const satisfies Record<PatchAction, string>;

// ───────────────────────────────────────────────────────────────────────────
// The row
// ───────────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  isSelf,
  onAction,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onAction: (action: RowAction) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <TableRow data-testid={`admin-user-${user.email}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <UserChip
            user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
            secondary={user.email}
          />
          {isSelf ? <Badge variant="outline">{t('admin:users.badge.you')}</Badge> : null}
        </div>
      </TableCell>

      <TableCell className="hidden md:table-cell">
        {user.isGlobalAdmin ? (
          <Badge variant="soft-primary">
            <ShieldCheck aria-hidden />
            {t('admin:users.badge.globalAdmin')}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{t('admin:users.badge.member')}</span>
        )}
      </TableCell>

      {/*
        MEMBERSHIPS. Two chips and a `+n`, not a wrapped list: this column sits
        between two narrow ones and a row that grows to five lines makes the
        whole table unscannable. "None" is a real answer — a freshly provisioned
        global admin belongs to no organization — so it is written out rather
        than left blank, which would read as data that failed to load.
      */}
      <TableCell className="hidden lg:table-cell">
        {user.memberships.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t('admin:users.memberships.none')}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1" data-testid="user-memberships">
            {user.memberships.slice(0, MEMBERSHIP_CHIP_LIMIT).map((entry) => (
              <Badge
                key={entry.orgId}
                variant={entry.role === 'admin' ? 'soft-primary' : 'outline'}
                title={t(`admin:users.orgRole.${entry.role}`)}
              >
                <Building2 aria-hidden />
                {entry.orgName}
              </Badge>
            ))}
            {user.memberships.length > MEMBERSHIP_CHIP_LIMIT ? (
              <Badge
                variant="outline"
                // The names the chips could not fit, so the count is inspectable
                // without opening the dialog.
                title={user.memberships
                  .slice(MEMBERSHIP_CHIP_LIMIT)
                  .map((entry) => entry.orgName)
                  .join(', ')}
              >
                {t('admin:users.memberships.overflow', {
                  overflow: String(user.memberships.length - MEMBERSHIP_CHIP_LIMIT),
                })}
              </Badge>
            ) : null}
          </div>
        )}
      </TableCell>

      <TableCell>
        <Badge variant={user.isActive ? 'soft-success' : 'soft-danger'}>
          {user.isActive ? t('admin:users.badge.active') : t('admin:users.badge.inactive')}
        </Badge>
      </TableCell>

      {/* NO `dir="ltr"` here (WP5.1). `Intl` emits an Arabic medium date with
          RIGHT-TO-LEFT MARKS between its parts (`28‏/08‏/2026`); forcing
          the cell LTR made those marks reorder the fields into `282026/08/`.
          The digits are already Western by policy (`getIntlLocale`), so the cell
          simply reads in the page's own direction, like every other date in the
          product. */}
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
        {new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(
          new Date(user.createdAt),
        )}
      </TableCell>

      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('admin:users.rowMenu', { name: user.name })}
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onSelect={() => {
                onAction('resetPassword');
              }}
            >
              <KeyRound aria-hidden />
              {t('admin:users.actions.resetPassword')}
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={() => {
                onAction('forceLogout');
              }}
            >
              <LogOut aria-hidden />
              {t('admin:users.actions.forceLogout')}
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={() => {
                onAction('memberships');
              }}
            >
              <Building2 aria-hidden />
              {t('admin:users.actions.memberships')}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/*
              THE SELF-GUARDS. Both of these are 400s server-side for your own
              account, so the menu does not offer them rather than offering an
              action that is going to be refused.
            */}
            {isSelf ? null : (
              <DropdownMenuItem
                onSelect={() => {
                  onAction(user.isGlobalAdmin ? 'demote' : 'promote');
                }}
              >
                {user.isGlobalAdmin ? <ShieldOff aria-hidden /> : <ShieldCheck aria-hidden />}
                {user.isGlobalAdmin
                  ? t('admin:users.actions.demote')
                  : t('admin:users.actions.promote')}
              </DropdownMenuItem>
            )}

            {isSelf ? null : (
              <DropdownMenuItem
                variant={user.isActive ? 'destructive' : 'default'}
                onSelect={() => {
                  onAction(user.isActive ? 'deactivate' : 'activate');
                }}
              >
                {user.isActive
                  ? t('admin:users.actions.deactivate')
                  : t('admin:users.actions.activate')}
              </DropdownMenuItem>
            )}

            {/*
              DELETION. Anonymize-and-deactivate, and the only row action with
              no undo of any kind — which is why it sits below the separator,
              wears the destructive variant, and is never offered for your own
              account (an admin who anonymizes themselves has revoked their own
              sessions and cannot sign back in to fix it).
            */}
            {isSelf ? null : (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  onAction('delete');
                }}
              >
                <Trash2 aria-hidden />
                {t('admin:users.actions.delete')}
              </DropdownMenuItem>
            )}

            {isSelf ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {t('admin:users.selfGuard')}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Dialogs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Provision an account.
 *
 * The password is NOT a field. An admin typing one invents a weak one and then
 * has to transmit it anyway; generating it removes the decision and guarantees
 * the policy is met. It is minted at submit time rather than at open time so a
 * dialog left open does not sit on a credential.
 *
 * `orgMemberships` IS offered here (Round 2). The old note said it should not
 * be, because the field was write-only and a picker would set something the
 * product could never show back. That is no longer true: the directory renders
 * a memberships column and the manage-memberships dialog edits it, so the
 * grants made here are visible one row away — and the API applies them in the
 * SAME TRANSACTION as the account, which is the only path that cannot leave a
 * new user belonging nowhere.
 */
function ProvisionDialog({
  open,
  onOpenChange,
  onProvisioned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned: (name: string, password: string) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const provision = useProvisionUser();

  // NOT an RHF field. `orgMemberships` is an array of objects edited by a
  // bespoke control with no single input to register, and registering it as a
  // field array would buy validation the shared schema already applies at the
  // boundary. It resets alongside the form on success.
  const [memberships, setMemberships] = useState<ProvisionMembership[]>([]);

  const form = useForm<ProvisionValues>({
    resolver: zodResolver(provisionFormSchema),
    defaultValues: {
      name: '',
      email: '',
      isGlobalAdmin: false,
      locale: 'en',
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = (values: ProvisionValues) => {
    const password = generateTempPassword();

    provision.mutate(
      {
        email: values.email,
        name: values.name,
        password,
        isGlobalAdmin: values.isGlobalAdmin ?? false,
        locale: values.locale ?? 'en',
        orgMemberships: memberships,
      },
      {
        onSuccess: (user) => {
          toast.success(t('admin:users.provision.created', { name: user.name }));
          form.reset();
          setMemberships([]);
          onProvisioned(user.name, password);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin:users.provision.title')}
      description={t('admin:users.provision.description')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={t('admin:users.provision.submit')}
      isPending={provision.isPending}
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('admin:users.provision.name')}</FormLabel>
            <FormControl>
              <Input {...field} autoComplete="off" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('admin:users.provision.email')}</FormLabel>
            <FormControl>
              {/* An address is machine text; it stays LTR on an RTL page. */}
              <Input {...field} type="email" dir="ltr" autoComplete="off" />
            </FormControl>
            <FormDescription>{t('admin:users.provision.emailHint')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="isGlobalAdmin"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <FormLabel>{t('admin:users.provision.globalAdmin')}</FormLabel>
              <FormDescription>{t('admin:users.provision.globalAdminHint')}</FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{t('admin:users.provision.orgs')}</span>
        <OrgMembershipPicker
          value={memberships}
          onChange={setMemberships}
          disabled={provision.isPending}
        />
        <p className="text-xs text-muted-foreground">{t('admin:users.provision.orgsHint')}</p>
      </div>
    </FormDialog>
  );
}

/**
 * Reset a password.
 *
 * A confirm rather than a form, for the same reason provisioning has no
 * password field: there is nothing for the admin to decide. What they need to
 * understand is the side effect — every session goes — which is what the body
 * says.
 */
function ResetPasswordDialog({
  user,
  onOpenChange,
  onReset,
}: {
  user: AdminUserRow | null;
  onOpenChange: (open: boolean) => void;
  onReset: (name: string, password: string) => void;
}) {
  const { t } = useTranslation(['admin']);
  const reset = useResetUserPassword();

  return (
    <ConfirmDialog
      open={user !== null}
      onOpenChange={onOpenChange}
      title={user ? t('admin:users.password.resetTitle', { name: user.name }) : ''}
      description={t('admin:users.password.resetDescription')}
      confirmLabel={t('admin:users.password.resetSubmit')}
      isPending={reset.isPending}
      onConfirm={() => {
        if (!user) return;
        const password = generateTempPassword();

        reset.mutate(
          { userId: user.id, password },
          {
            onSuccess: () => {
              toast.success(t('admin:users.password.resetDone', { name: user.name }));
              onReset(user.name, password);
            },
          },
        );
      }}
    />
  );
}

/**
 * The one-shot credential reveal.
 *
 * NOT dismissible by clicking away or by Escape into nothing — it is, but the
 * copy is explicit that closing it is the last look, because the value genuinely
 * cannot be recovered: the server stored a hash and nothing else. The password
 * is rendered in the mono face, `dir="ltr"`, and selectable, so the copy button
 * is a convenience rather than the only route.
 */
function RevealPasswordDialog({
  reveal,
  onClose,
}: {
  reveal: { name: string; password: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <ConfirmDialog
      open={reveal !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('admin:users.password.title')}
      description={t('admin:users.password.description')}
      confirmLabel={t('admin:users.password.done')}
      variant="default"
      // An ACKNOWLEDGEMENT, not a confirmation: the account exists and the
      // password is generated by the time this renders, so a "Cancel" beside
      // "I have copied it" would suggest an undo that does not exist.
      showCancel={false}
      onConfirm={onClose}
    >
      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-muted/40 p-2">
        <code
          dir="ltr"
          data-testid="temp-password"
          className="flex-1 select-all font-mono text-sm tracking-wider"
          aria-label={t('admin:users.password.label')}
        >
          {reveal?.password ?? ''}
        </code>
        <CopyButton value={reveal?.password ?? ''} label={t('common:actions.copy')} />
      </div>
    </ConfirmDialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────

/** Four grey rows: the table's shape, held while the first page resolves. */
function TableSkeleton() {
  return (
    <Card className="gap-2" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="ms-auto h-6 w-24" />
        </div>
      ))}
    </Card>
  );
}
