import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import EmptyState from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';

/**
 * The catch-all route. Rendered INSIDE the app shell, so a mistyped URL keeps
 * the sidebar and the org context — a user who fat-fingered a project key is
 * one click from where they meant to go, rather than dumped on a bare page.
 */
export default function NotFoundPage() {
  const { t } = useTranslation(['common']);

  return (
    <EmptyState
      icon={<Compass className="size-4" />}
      title={t('common:notFound.title')}
      message={t('common:notFound.description')}
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/">{t('common:appError.home')}</Link>
        </Button>
      }
    />
  );
}
