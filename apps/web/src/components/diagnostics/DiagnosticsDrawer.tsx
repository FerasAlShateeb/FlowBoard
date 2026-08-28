import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  ListFilter,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Pause,
  Play,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { isRTL, useLang } from '@/lib/lang-policy';
import { registerShortcut } from '@/lib/shortcuts';
import { registerTopbarSlot } from '@/components/layout/TopbarSlots';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMe } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/useAuthStore';
import { isSideDock, useLayoutStore, type DiagDock } from '@/stores/useLayoutStore';
import { useDiagLogsStore } from '@/stores/useDiagLogsStore';
import {
  copyText,
  DOCK_BORDER_CLASS,
  filterByMinLevel,
  ICON_BTN,
  isDrawerFirst,
  LEVEL_FILTER_CHOICES,
  logsToJsonl,
  type LevelFilter,
} from '@/components/diagnostics/diag-chrome';
import { useEffectiveDiagDock } from '@/components/diagnostics/useDiagDock';
import DrawerResizeHandle from '@/components/diagnostics/DrawerResizeHandle';
import LogList from '@/components/diagnostics/LogList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The diagnostics drawer — a devtools-style live tail of the server log,
 * for global admins only.
 *
 * ── It is a PANEL, not a dialog ─────────────────────────────────────────────
 * Non-modal, no scrim, no focus trap, no scroll lock, and deliberately absent
 * from `closeAllOverlays`. The entire point is watching the log WHILE using the
 * app: click a card, watch the request land. A global Escape that killed a
 * running tail would defeat that, so Escape closes the drawer only when focus
 * is inside it (and `stopPropagation`s, so the shell's own Escape handler does
 * not also fire).
 *
 * ── It PUSHES content ───────────────────────────────────────────────────────
 * The drawer is a real flex child of the shell, sized in px, so the app reflows
 * around it rather than hiding behind it. `AppShell` mounts it ONCE,
 * unconditionally, and it decides its own placement with an `order` class —
 * which is what lets a dock switch reflow WITHOUT remounting, keeping the poll
 * in `LogList` alive across it. (A conditional position in the JSX would
 * remount the subtree and reset the tail on every redock.)
 *
 * ── Admin gating, twice ─────────────────────────────────────────────────────
 * Renders nothing for a non-admin and registers no shortcuts for one, so Ctrl+J
 * keeps its browser meaning for everyone else. That is presentation only: the
 * server enforces `requireGlobalAdmin` on `/api/admin/logs` regardless, which
 * is the boundary that actually matters — log lines carry user emails and ids.
 */

/** The lucide glyph for each dock — the cycle button shows the CURRENT one. */
const DOCK_ICON: Record<DiagDock, typeof PanelBottom> = {
  bottom: PanelBottom,
  left: PanelLeft,
  right: PanelRight,
  top: PanelTop,
};

export default function DiagnosticsDrawer() {
  const { t } = useTranslation(['diagnostics']);

  // Same ladder as `routes/guards.tsx`: the session response when it has
  // arrived, the persisted flag while it is in flight — so the drawer does not
  // blink out of existence on every reload for the admin who lives in it.
  const me = useMe().data;
  const storedFlag = useAuthStore((state) => state.isGlobalAdmin());
  const isGlobalAdmin = me ? me.isGlobalAdmin : storedFlag;

  const diagOpen = useLayoutStore((state) => state.diagOpen);
  const diagHeight = useLayoutStore((state) => state.diagHeight);
  const diagWidth = useLayoutStore((state) => state.diagWidth);
  const setDiagOpen = useLayoutStore((state) => state.setDiagOpen);
  const cycleDiagDock = useLayoutStore((state) => state.cycleDiagDock);

  const paused = useDiagLogsStore((state) => state.paused);
  const minLevel = useDiagLogsStore((state) => state.minLevel);

  const dock = useEffectiveDiagDock();
  // Subscribes the drawer to the LANGUAGE so a live switch re-runs the RTL
  // order math below; the value itself is read through `isRTL()`.
  useLang();

  /**
   * The topbar trigger — the discoverable half of Ctrl+J.
   *
   * A keyboard-only entry point is invisible: nothing on screen says the log
   * drawer exists, and the cheat sheet only helps someone who already suspects
   * it does. Registered through `TopbarSlots` rather than by editing
   * `Topbar.tsx`, which belongs to WP1.4 and is closed — order 30 is the slot
   * the registry's own docs reserve for diagnostics (10 palette, 15 presence,
   * 20 bell, 30 diagnostics).
   *
   * Admin-gated the same way the chords are, and for the same reason: it is
   * registered from inside the effect's guard, so a non-admin's topbar has no
   * button rather than a button that refuses.
   */
  useEffect(() => {
    if (!isGlobalAdmin) return;
    return registerTopbarSlot({
      id: 'diagnostics',
      zone: 'end',
      order: 30,
      render: () => <DiagnosticsTrigger />,
    });
  }, [isGlobalAdmin]);

  /**
   * The two chords, registered in the central registry rather than as loose
   * listeners — so the shortcut cheat sheet can list them truthfully and a
   * collision with another wave's chord is loud rather than silent.
   *
   * Gated on the admin flag: a non-admin never registers them, so Ctrl+J stays
   * the browser's downloads shortcut for everyone the drawer would refuse to
   * open for anyway.
   *
   * ORDER IS NOT LOAD-BEARING, and used to be. `matchChord` once treated a
   * chord whose key equalled the pressed character as shift-agnostic, so
   * `mod+shift+j` also matched a bare Ctrl+J and the toggle had to be
   * registered first to win the "first match wins" dispatch. WP4.7 fixed the
   * matcher: Shift is now enforced in both directions for an alphanumeric key,
   * so the two chords are genuinely distinct. The order is kept because the
   * cheat sheet lists chords in registration order and reads better this way.
   */
  useEffect(() => {
    if (!isGlobalAdmin) return;

    const unregisterToggle = registerShortcut({
      id: 'diagnostics.toggle',
      chord: 'mod+j',
      descriptionKey: 'diagnostics:shortcuts.toggle',
      group: 'system',
      // A devtools toggle that stops working because the cursor is in a search
      // box is a devtools toggle you stop trusting.
      allowInInputs: true,
      handler: () => {
        useLayoutStore.getState().toggleDiag();
      },
    });

    const unregisterCycle = registerShortcut({
      id: 'diagnostics.cycleDock',
      chord: 'mod+shift+j',
      descriptionKey: 'diagnostics:shortcuts.cycleDock',
      group: 'system',
      allowInInputs: true,
      handler: () => {
        const layout = useLayoutStore.getState();
        layout.cycleDiagDock();
        // Cycling a closed drawer would otherwise be an invisible no-op.
        if (!layout.diagOpen) layout.setDiagOpen(true);
      },
    });

    return () => {
      unregisterToggle();
      unregisterCycle();
    };
  }, [isGlobalAdmin]);

  if (!isGlobalAdmin || !diagOpen) return null;

  const side = isSideDock(dock);
  const drawerFirst = isDrawerFirst(dock, isRTL());
  const DockIcon = DOCK_ICON[dock];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setDiagOpen(false);
  };

  const onCopy = (): void => {
    // Read through `getState()` rather than the subscribed `records`: the copy
    // must be of what is on screen at the CLICK, and this component does not
    // subscribe to the record list (only the list does).
    const { records, minLevel: min } = useDiagLogsStore.getState();
    copyText(logsToJsonl(filterByMinLevel(records, min)));
  };

  return (
    <section
      role="region"
      aria-label={t('diagnostics:title')}
      data-testid="fb-diag-drawer"
      data-dock={dock}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={side ? { width: diagWidth } : { height: diagHeight }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-2)] outline-none',
        // PHYSICAL border + PHYSICAL order — the deliberate deviation from the
        // app's logical-properties rule. See `isDrawerFirst`.
        DOCK_BORDER_CLASS[dock],
        drawerFirst ? 'order-first' : 'order-last',
      )}
    >
      <DrawerResizeHandle dock={dock} />

      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <h2 className="text-xs font-semibold tracking-wide text-[var(--text)]">
          {t('diagnostics:title')}
        </h2>
        {paused ? (
          <span
            className="rounded px-1 text-[10px] font-semibold uppercase text-[var(--warning)]"
            style={{ background: 'color-mix(in oklab, var(--warning) 14%, transparent)' }}
            data-testid="fb-diag-paused"
          >
            {t('diagnostics:logs.paused')}
          </span>
        ) : null}

        <div className="ms-auto flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={ICON_BTN}
                aria-label={t('diagnostics:logs.filter')}
                title={t('diagnostics:logs.filter')}
                data-testid="fb-diag-level"
                data-min-level={minLevel}
              >
                <ListFilter className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel>{t('diagnostics:logs.minLevel')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={minLevel}
                onValueChange={(value) => {
                  useDiagLogsStore.getState().setMinLevel(value as LevelFilter);
                }}
              >
                {LEVEL_FILTER_CHOICES.map((choice) => (
                  <DropdownMenuRadioItem
                    key={choice}
                    value={choice}
                    data-testid={`fb-diag-level-${choice}`}
                  >
                    {t(`diagnostics:logs.levels.${choice}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            className={ICON_BTN}
            aria-label={paused ? t('diagnostics:logs.resume') : t('diagnostics:logs.pause')}
            title={paused ? t('diagnostics:logs.resume') : t('diagnostics:logs.pause')}
            aria-pressed={paused}
            data-testid="fb-diag-pause"
            onClick={() => {
              useDiagLogsStore.getState().togglePaused();
            }}
          >
            {paused ? (
              <Play className="size-4" aria-hidden />
            ) : (
              <Pause className="size-4" aria-hidden />
            )}
          </button>

          <button
            type="button"
            className={ICON_BTN}
            aria-label={t('diagnostics:logs.clear')}
            title={t('diagnostics:logs.clear')}
            data-testid="fb-diag-clear"
            onClick={() => {
              useDiagLogsStore.getState().clear();
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>

          <button
            type="button"
            className={ICON_BTN}
            aria-label={t('diagnostics:logs.copy')}
            title={t('diagnostics:logs.copy')}
            data-testid="fb-diag-copy"
            onClick={onCopy}
          >
            <Copy className="size-4" aria-hidden />
          </button>

          <button
            type="button"
            className={ICON_BTN}
            aria-label={t('diagnostics:dock.cycle')}
            title={t(`diagnostics:dock.${dock}`)}
            data-testid="fb-diag-dock-cycle"
            onClick={cycleDiagDock}
          >
            <DockIcon className="size-4" aria-hidden />
          </button>

          <button
            type="button"
            className={ICON_BTN}
            aria-label={t('diagnostics:close')}
            title={t('diagnostics:close')}
            data-testid="fb-diag-close"
            onClick={() => {
              setDiagOpen(false);
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      <LogList />
    </section>
  );
}

/**
 * The topbar icon button, rendered into `TopbarSlots` by the drawer's effect.
 *
 * A COMPONENT rather than inline JSX inside the `render` callback, because
 * `render` is invoked during the TOPBAR's render and must stay a pure
 * node-returning function — the `useTranslation` and `useLayoutStore` calls
 * below are hooks, and they belong to a component with its own identity in the
 * tree. (The registry's own docs make this rule explicit.)
 *
 * It reflects state rather than only sending it: `aria-pressed` tells a screen
 * reader whether the panel is currently open, which for a toggle is the whole
 * difference between a button and a mystery.
 */
function DiagnosticsTrigger() {
  const { t } = useTranslation(['diagnostics']);
  const diagOpen = useLayoutStore((state) => state.diagOpen);
  const toggleDiag = useLayoutStore((state) => state.toggleDiag);

  const label = diagOpen ? t('diagnostics:close') : t('diagnostics:open');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={ICON_BTN}
          data-testid="fb-diag-trigger"
          aria-label={label}
          aria-pressed={diagOpen}
          onClick={toggleDiag}
        >
          <ScrollText className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
