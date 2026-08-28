import type { CSSProperties } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

import { useLang } from '@/lib/lang-policy';

/**
 * The app's single toast host — sonner, skinned entirely through design tokens.
 *
 * Mount ONCE, in `AppProviders`. Everything else calls sonner's `toast()`
 * directly; there is no store wrapper, because sonner already owns the queue.
 *
 * Every mutation failure in FlowBoard raises a toast (project checklist §B), so
 * this is load-bearing chrome, not decoration.
 */

/** Auto-dismiss window. Generous because sonner pauses on hover and on focus. */
export const TOAST_DURATION_MS = 4000;

/**
 * Token skin, applied as inline custom properties on sonner's `<ol>`.
 *
 * Inline styles beat sonner's own `[data-sonner-toaster][data-theme=…]` rules,
 * which is exactly what we want: the FlowBoard tokens already carry the
 * light/dark palette (and `applyTheme()` rewrites them live), so there is
 * nothing for sonner's own theme switch to do — dark mode follows for free and
 * no `.dark` rule is written anywhere.
 *
 * `zIndex: 70` pins the host to the toast tier of the z-scale documented in
 * `ui/dialog.tsx`, overriding sonner's stylesheet default of 999999999 which
 * would otherwise paint above modal dialogs (100) and popovers (110).
 */
const TOASTER_STYLE = {
  zIndex: 70,
  fontFamily: 'var(--font-body)',
  '--normal-bg': 'var(--surface-raised)',
  '--normal-border': 'var(--border)',
  '--normal-text': 'var(--text)',
  '--border-radius': 'var(--radius)',
} as CSSProperties;

export function Toaster() {
  // `useLang()` (not `i18n.language`) is the source: the language policy is the
  // one synchronous, subscribable answer, and it is what stamped `<html dir>`.
  const lang = useLang();

  return (
    // A STABLE live region that exists before the first toast does, so an e2e
    // MutationObserver has something to attach to — sonner's own live region is
    // an inner <section> whose toast <li>s are created and destroyed. Nested
    // live regions resolve to the innermost one containing the change, so this
    // wrapper never double-announces.
    <div role="status" aria-live="polite" data-testid="toast-host">
      <SonnerToaster
        // sonner's `position` is PHYSICAL (there is no `bottom-end`), so a
        // corner would sit on the wrong side of an Arabic page. Bottom-CENTER
        // is direction-neutral and needs no `rtl:` compensation.
        position="bottom-center"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        duration={TOAST_DURATION_MS}
        visibleToasts={4}
        gap={8}
        style={TOASTER_STYLE}
        toastOptions={{
          classNames: {
            toast: 'text-sm text-foreground shadow-[var(--shadow-2)]',
            title: 'font-medium',
            description: 'text-xs text-muted-foreground',
            actionButton: 'rounded-[var(--btn-radius)] bg-primary text-primary-foreground',
            cancelButton:
              'rounded-[var(--btn-radius)] border border-border bg-surface text-muted-foreground',
            closeButton: 'border-border bg-surface text-muted-foreground hover:text-foreground',
            error: 'text-danger',
            success: 'text-success',
            warning: 'text-warning',
            info: 'text-info',
          },
        }}
      />
    </div>
  );
}

export default Toaster;
