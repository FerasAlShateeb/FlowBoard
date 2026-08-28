import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderKanban, Search } from 'lucide-react';

import { projectPath } from '@/hooks/useRouteScope';
import { useOrgBySlug } from '@/hooks/useOrgs';
import { useProjects } from '@/hooks/useProjects';
import CreateProjectDialog from '@/components/org/CreateProjectDialog';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import RoleBadge from '@/components/common/RoleBadge';
import UserAvatar from '@/components/common/UserAvatar';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * `/o/:orgSlug` — the organization home: every project you can open.
 *
 * The card is the whole click target (a stretched-link `::after`), and it goes
 * to the BOARD rather than to a project overview: FlowBoard has no project
 * landing page, and the board is what someone opening a project came for.
 *
 * The filter is client-side and deliberately un-debounced. An org's project
 * list is tens of rows, already in memory, and a request per keystroke to
 * narrow twelve cards would be latency in exchange for nothing.
 */
export default function OrgHomePage() {
  const { t } = useTranslation(['orgs', 'common']);
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  const [filter, setFilter] = useState('');

  const { org } = useOrgBySlug(orgSlug);
  const { data: projects, isPending, error, refetch } = useProjects(org?.id);

  const canCreate = org?.role === 'admin';

  const needle = filter.trim().toLowerCase();
  const visible = (projects ?? []).filter(
    (project) =>
      needle.length === 0 ||
      project.name.toLowerCase().includes(needle) ||
      project.key.toLowerCase().includes(needle),
  );

  return (
    <section>
      <PageHeader
        title={t('orgs:home.title')}
        description={t('orgs:home.subtitle', { org: org?.name ?? orgSlug })}
        actions={
          canCreate && org ? <CreateProjectDialog orgId={org.id} orgSlug={org.slug} /> : undefined
        }
      >
        {(projects?.length ?? 0) > 0 ? (
          <div className="relative max-w-xs">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              // Room for the icon on the reading-START side.
              className="h-7 ps-8 text-xs"
              placeholder={t('orgs:home.searchPlaceholder')}
              aria-label={t('orgs:home.searchPlaceholder')}
            />
          </div>
        ) : null}
      </PageHeader>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isPending ? (
        <ProjectGridSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-4" />}
          title={needle ? t('orgs:home.noMatches') : t('orgs:home.empty')}
          message={
            needle
              ? undefined
              : canCreate
                ? t('orgs:home.emptyBody')
                : t('orgs:home.emptyBodyViewer')
          }
        />
      ) : (
        <ul className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <li key={project.id}>
              <Card className="h-full gap-2 transition-colors duration-[var(--speed)] hover:border-primary/40">
                <Link
                  to={projectPath(orgSlug, project.key, 'board')}
                  className="relative flex items-start gap-3 outline-none after:absolute after:inset-0 after:rounded-[var(--card-radius)] focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {/* The key is a Latin identifier, monospaced so keys line
                          up down the column and readable in either direction. */}
                      <span
                        dir="ltr"
                        className="rounded-[var(--radius)] border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {project.key}
                      </span>
                      <RoleBadge role={project.role} />
                    </span>
                    {/* `dir="auto"` on USER-GENERATED text: a Latin project
                        description inside an RTL card had its full stop pulled
                        to the FRONT of the line (".no transition rules"), and
                        the name clipped from the wrong end. See `UserChip` in
                        `components/common/UserAvatar.tsx`. */}
                    <span
                      dir="auto"
                      className="mt-1.5 block truncate text-sm font-medium text-foreground"
                    >
                      {project.name}
                    </span>
                    {project.description ? (
                      <span
                        dir="auto"
                        className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground"
                      >
                        {project.description}
                      </span>
                    ) : null}
                  </span>
                </Link>

                <div className="flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  {project.lead ? (
                    <>
                      <UserAvatar user={project.lead} size="xs" label="" />
                      <span dir="auto" className="truncate">
                        {project.lead.name}
                      </span>
                    </>
                  ) : (
                    <span>{t('orgs:home.noLead')}</span>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The loading state.
 *
 * Skeleton CARDS rather than a spinner: the grid's shape is known before the
 * data arrives, so showing it means the layout does not jump when the rows
 * land — which is the whole reason to prefer a skeleton over a spinner.
 */
function ProjectGridSkeleton() {
  return (
    <div className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Card key={index} className="gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </Card>
      ))}
    </div>
  );
}
