import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import EmptyState from '@/components/common/EmptyState';

/**
 * The placeholder every not-yet-built page renders.
 *
 * It exists so the router, the sidebar, the breadcrumb and the RTL pass are all
 * exercisable NOW: navigation demos end to end in Wave 1, and a Wave 3/4 agent
 * replaces one file without touching the route table.
 *
 * `wave` is the work package that will fill it in — shown in a `Planned for …`
 * line so nobody mistakes a stub for a bug. Its value is a package identifier
 * (`WP3.1`), which is deliberately NOT translated: it is a reference to this
 * repo's plan, the same way a git SHA would be.
 */
export function PageStub({
  icon,
  title,
  wave,
}: {
  icon: ReactNode;
  /** Already-translated page title — pages own their own `t()` call. */
  title: string;
  wave?: string;
}) {
  const { t } = useTranslation(['common']);

  return (
    <section aria-labelledby="page-stub-title" data-testid="page-stub">
      <h1 id="page-stub-title" className="sr-only">
        {title}
      </h1>
      <EmptyState
        icon={icon}
        title={title}
        message={t('common:stub.body')}
        action={
          wave ? (
            <span className="rounded-[var(--radius)] border border-border bg-surface-raised px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {t('common:stub.wave', { wave })}
            </span>
          ) : undefined
        }
      />
    </section>
  );
}

export default PageStub;
