import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore } from '@/stores/useAuthStore';
import { viewChangeBounceTarget } from '@/components/navigation/view-as';

/**
 * "Viewing as member" — the switch, and the way back out of it.
 *
 * See `components/navigation/view-as.ts` for what the feature is and why it is
 * chrome rather than authorization. This file is its two surfaces:
 *
 *   - {@link useViewAsSwitch} — the transition, shared by the profile menu's
 *     toggle and the pill, so "flip the flag, bounce off `/admin/*`, say so"
 *     is written once. Both callers gate on the REAL admin flag: the effective
 *     one is false the moment member view is on, which would take the way back
 *     out with it.
 *   - {@link ViewAsPill} — the standing reminder. An admin can be in member
 *     view for an hour, and the ONLY thing that distinguishes it from "my admin
 *     rights were revoked" is this pill saying so. It is `--warning`-toned for
 *     the same reason: this is a temporary, self-inflicted, reversible state,
 *     which is exactly what an amber affordance means everywhere else in the
 *     product.
 */

export interface ViewAsSwitch {
  /** The server-authoritative flag. False hides both surfaces entirely. */
  realAdmin: boolean;
  viewingAsMember: boolean;
  switchView: (nextViewingAsMember: boolean) => void;
}

export function useViewAsSwitch(): ViewAsSwitch {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation(['common']);

  const realAdmin = useAuthStore((state) => state.isGlobalAdmin());
  const viewingAsMember = useAuthStore((state) => state.viewingAsMember);
  const setViewingAsMember = useAuthStore((state) => state.setViewingAsMember);

  const switchView = useCallback(
    (next: boolean) => {
      setViewingAsMember(next);

      // The BOUNCE lives here, not in the guard — `view-as.ts` explains why a
      // guard that redirected would break a genuine non-admin's bookmarked
      // link. `replace` so the back button does not walk straight back into a
      // console the chrome no longer offers.
      const target = viewChangeBounceTarget(pathname, next);
      if (target !== null) void navigate(target, { replace: true });

      toast(next ? t('common:nav.viewingAsMember') : t('common:nav.backToAdminView'));
    },
    [navigate, pathname, setViewingAsMember, t],
  );

  return { realAdmin, viewingAsMember, switchView };
}

/** The amber "you are pretending" pill. One click returns to admin view. */
export default function ViewAsPill() {
  const { t } = useTranslation(['common']);
  const { realAdmin, viewingAsMember, switchView } = useViewAsSwitch();

  if (!realAdmin || !viewingAsMember) return null;

  return (
    <button
      type="button"
      data-testid="view-as-pill"
      aria-label={t('common:nav.exitMemberView')}
      onClick={() => {
        switchView(false);
      }}
      // `color-mix` against `--warning` rather than a hex literal or a fixed
      // amber utility: the tint has to follow the Theme Studio and the
      // light/dark switch like every other colour in the product
      // (design-system.md — colours live in `index.css` and the presets).
      className="me-1 inline-flex h-7 items-center gap-1.5 rounded-[var(--btn-radius)] border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-2 text-[11px] font-medium text-[var(--warning)] transition-colors duration-[var(--speed)] hover:bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Eye className="size-3.5 shrink-0" aria-hidden />
      {/* The words hide on the narrowest screens; the icon plus the
          `aria-label` still carry the whole meaning. */}
      <span className="hidden sm:inline">{t('common:nav.viewingAsMember')}</span>
    </button>
  );
}
