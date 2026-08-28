import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import BrandMark from '@/components/common/BrandMark';

/**
 * The Suspense fallback for every lazy route.
 *
 * Branded rather than a bare spinner because this is what a user sees on a cold
 * navigation over a slow link, and an unstyled flash of nothing reads as a
 * broken app. `role="status"` + an accessible name means a screen reader
 * announces the wait instead of going silent.
 *
 * `full` fills the viewport (used outside the app shell, e.g. the login
 * branch); the default fills only the content area, so the sidebar and topbar
 * stay put while a page loads — which is the whole point of a layout route.
 */
export function PageSpinner({ full = false, className }: { full?: boolean; className?: string }) {
  const { t } = useTranslation(['common']);

  return (
    <div
      role="status"
      aria-label={t('common:states.loading')}
      data-testid="page-spinner"
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3',
        full ? 'min-h-dvh bg-background' : 'min-h-[50dvh]',
        className,
      )}
    >
      <BrandMark size={32} className="opacity-90" />
      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}

export default PageSpinner;
