import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, FolderKanban, Plus, Users } from 'lucide-react';

import { useOrgs } from '@/hooks/useOrgs';
import { getLastOrgSlug, resolveHomeTarget, setLastOrgSlug } from '@/hooks/useLastOrg';
import { useInstanceConfig } from '@/hooks/useInstanceConfig';
import { useAuthStore } from '@/stores/useAuthStore';
import PageHeader from '@/components/common/PageHeader';
import PageSpinner from '@/components/common/PageSpinner';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import RoleBadge from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * `/` — the signed-in landing page, which is usually not a page at all.
 *
 * THE OUTCOMES, decided by `resolveHomeTarget` (pure, unit-tested):
 *   0. **single-org mode** → straight to the instance's one organization,
 *      without waiting on `GET /orgs` (the config already answered);
 *   1. the org you were last in, if you are still a member → redirect;
 *   2. your only org → redirect (a picker with one card teaches nothing);
 *   3. otherwise → the picker below.
 *
 * The redirect is `replace`, so the back button from a board does not bounce
 * through `/` and straight forward again — which is what a push would do, and
 * it makes "back" appear broken.
 *
 * ═══ THE PICKER IS AN ESCAPE ROUTE, NOT ONLY A CHOICE ══════════════════════
 *
 * `/` is what the brand mark, the Home row and the switcher's "All
 * organizations" all point at, so it is where an admin who got lost in the
 * console lands. For an EFFECTIVE global admin it therefore also carries the
 * way FORWARD: a create-organization CTA into `/admin/orgs`. Without it, an
 * instance with no organizations yet — a fresh install, and the one state where
 * being stuck is most likely — is a dead end with an apology on it.
 */
export default function HomePage() {
  const { t } = useTranslation(['orgs', 'common']);
  const { data: orgs, isPending, error, refetch } = useOrgs();
  const { orgMode, defaultOrgSlug } = useInstanceConfig();
  const effectiveAdmin = useAuthStore((state) => state.isEffectiveGlobalAdmin());

  const target = resolveHomeTarget(orgs, getLastOrgSlug(), defaultOrgSlug, orgMode);

  const createOrgCta = effectiveAdmin ? (
    <Button asChild size="sm">
      <Link to="/admin/orgs">
        <Plus aria-hidden />
        {t('common:nav.createOrganization')}
      </Link>
    </Button>
  ) : undefined;

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  if (isPending || target === null) return <PageSpinner />;

  if (target.kind === 'org') return <Navigate to={`/o/${target.slug}`} replace />;

  return (
    <section>
      <PageHeader
        title={t('orgs:picker.title')}
        description={t('orgs:picker.subtitle')}
        actions={createOrgCta}
      />

      {orgs && orgs.length > 0 ? (
        <ul className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => (
            <li key={org.id}>
              {/* `Card` already carries `--card-pad` on its root (see
                  `ui/card`), so no inner padding is added here. */}
              <Card className="h-full transition-colors duration-[var(--speed)] hover:border-primary/40">
                <div>
                  {/*
                    The WHOLE card is the target, via a stretched link: a card
                    with a small "open" link inside it is a 40px hit area
                    pretending to be a 200px one. `after:absolute after:inset-0`
                    grows the anchor to the card without nesting interactive
                    elements.
                  */}
                  <Link
                    to={`/o/${org.slug}`}
                    onClick={() => {
                      setLastOrgSlug(org.slug);
                    }}
                    className="relative flex items-start gap-3 outline-none after:absolute after:inset-0 after:rounded-[var(--card-radius)] focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-surface-raised text-muted-foreground">
                      <Building2 className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {org.name}
                        </span>
                        <RoleBadge role={org.role} />
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" aria-hidden />
                          {t('orgs:picker.members', { count: org.memberCount })}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <FolderKanban className="size-3" aria-hidden />
                          {t('orgs:picker.projects', { count: org.projectCount })}
                        </span>
                      </span>
                    </span>
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Building2 className="size-4" />}
          title={t('orgs:picker.empty')}
          message={t('orgs:picker.emptyBody')}
          action={createOrgCta}
        />
      )}
    </section>
  );
}
