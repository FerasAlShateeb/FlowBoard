import { useTranslation } from 'react-i18next';
import { RotateCcw, TriangleAlert } from 'lucide-react';

import { useApiErrorMessage } from '@/i18n/errors';
import EmptyState from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';

/**
 * The third of the three states every page owes the user (checklist §B):
 * loading, empty, ERROR.
 *
 * It takes the raw error rather than a message, and localizes it here through
 * the same `ApiError.code` → catalog ladder every toast uses. That is the whole
 * point: a page renders `<ErrorState error={query.error} onRetry={query.refetch} />`
 * and gets a sentence in the user's language, with the server's own English as
 * the last resort — without every page repeating the mapping.
 *
 * Built on `EmptyState` so a failed load and an empty result look like members
 * of the same family rather than two different apps.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  /** Usually a query's `refetch`. Omitted, the retry button is not rendered. */
  onRetry?: () => void;
  /** Overrides the generic heading when the page has a better one. */
  title?: string;
  className?: string;
}) {
  const { t } = useTranslation(['common']);
  const describe = useApiErrorMessage();

  return (
    <EmptyState
      className={className}
      icon={<TriangleAlert className="size-4" />}
      title={title ?? t('common:errorState.title')}
      message={describe(error)}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden />
            {t('common:errorState.retry')}
          </Button>
        ) : undefined
      }
    />
  );
}

export default ErrorState;
