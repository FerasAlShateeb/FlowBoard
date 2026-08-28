import { useRef } from 'react';
import { useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react';

import { isStaleChunkError, tryRecoveryReload } from '@/lib/chunk-recovery';
import BrandMark from '@/components/common/BrandMark';
import EmptyState from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';

/**
 * The router's `errorElement` — the last thing between a thrown route error and
 * React Router's built-in "Unexpected Application Error" page (unstyled black
 * text on white, with a stack trace). It is wired onto every top-level route
 * object plus the `AppShell` layout route, so no path can reach that default.
 *
 * It renders OUTSIDE the shell — a shell error is exactly the case where the
 * shell cannot be trusted — so it owns full-page chrome of its own. Tokens
 * still resolve: `applyTheme()` stamped every custom property inline on
 * `<html>` before first paint, independently of React.
 *
 * The dominant real-world cause is a stale lazy chunk after a deploy (see
 * `lib/chunk-recovery`), so that case is handled FIRST and silently: reload
 * once, and show a brief branded "updating" state while the document is
 * replaced. Only when the loop guard REFUSES — meaning we already reloaded
 * moments ago and the chunk is still unreachable — does the user see a card.
 */
/**
 * The five keys this screen may render. Spelled out as a closed union so the
 * fallback helper below stays typed against the catalog — a widened `string`
 * would silently accept a key that does not exist, which on THIS screen means
 * showing a raw `common:appError.tpyo` to a user who is already having a bad
 * time.
 */
type ErrorCopyKey =
  | 'common:appError.title'
  | 'common:appError.description'
  | 'common:appError.updating'
  | 'common:appError.reload'
  | 'common:appError.home';

export default function RouteErrorScreen() {
  const error = useRouteError();
  const { t } = useTranslation(['common']);

  /**
   * Run the recovery decision exactly ONCE per mount. A ref rather than
   * `useState`'s lazy initializer, because StrictMode double-invokes
   * initializers but shares refs across the paired renders — and this decision
   * has a side effect (`location.reload()`) that must fire at most once.
   */
  const decision = useRef<boolean | null>(null);
  if (decision.current === null) {
    decision.current = isStaleChunkError(error) ? tryRecoveryReload() : false;
  }
  const reloading = decision.current;

  /**
   * i18n WITH A HARD-CODED FALLBACK. This IS the error screen, so it must
   * render even when the failure was i18next itself: `useTranslation()` on an
   * uninitialised instance returns the KEY rather than a value, so the key is
   * compared away here instead of trusted.
   */
  const label = (key: ErrorCopyKey, fallback: string): string => {
    const value: string = t(key);
    return !value || value === key ? fallback : value;
  };

  if (reloading) {
    return (
      <div
        data-testid="route-error-screen"
        data-state="updating"
        className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark size={40} />
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground" role="status">
            {label('common:appError.updating', 'Updating to the latest version…')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="route-error-screen"
      data-state="error"
      className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-center">
          <BrandMark size={40} />
        </div>
        <EmptyState
          icon={<TriangleAlert className="size-4" />}
          title={label('common:appError.title', 'Something went wrong')}
          message={label(
            'common:appError.description',
            'This page hit an unexpected error. Reloading usually clears it.',
          )}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                data-testid="route-error-reload"
                size="sm"
                onClick={() => {
                  window.location.reload();
                }}
              >
                <RotateCcw aria-hidden />
                {label('common:appError.reload', 'Reload')}
              </Button>
              {/*
                A PLAIN ANCHOR, not a react-router <Link>. A client-side
                navigation to '/' would try to lazy-load the home chunk —
                possibly the very file that is missing — from the same dead
                document. A real document load refetches index.html and with it
                the current asset manifest, which is what actually recovers.
              */}
              <a
                href="/"
                data-testid="route-error-home"
                className="inline-flex h-7 items-center justify-center rounded-[var(--btn-radius)] border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors duration-[var(--speed)] hover:bg-accent"
              >
                {label('common:appError.home', 'Go home')}
              </a>
            </div>
          }
        />
      </div>
    </div>
  );
}
