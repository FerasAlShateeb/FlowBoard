import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, RotateCcw, Save, Upload } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ColorsPanel from '@/components/theme/ColorsPanel';
import TypographyPanel from '@/components/theme/TypographyPanel';
import LayoutPanel from '@/components/theme/LayoutPanel';
import ThemePreview from '@/components/theme/ThemePreview';
import ImportThemeDialog from '@/components/theme/ImportThemeDialog';
import { downloadJson } from '@/components/theme/theme-file';
import { matchColorPreset } from '@/components/theme/theme-presets';
import { trackThemeChanged } from '@/lib/telemetry-client';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * `/theme` — the Theme Studio.
 *
 * A PAGE, NOT A SLIDE-OVER. Choosing a palette is a considered, comparative
 * task: eight preset cards each showing two mock screens, a 22-row token
 * editor and a live preview do not fit in a 380px drawer, and half of the point
 * is watching the app behind the editor change. A route also means a theme can
 * be linked, bookmarked and deep-linked from the command palette.
 *
 * THREE TABS + A PERSISTENT PREVIEW. The tabs split the work by the question
 * being asked (what colour, what typeface, what shape); the preview column
 * stays put across all three, because every one of those questions is answered
 * by looking at the same card, buttons and chart.
 *
 * WHAT IS LIVE AND WHAT IS SAVED. Every edit applies immediately, app-wide —
 * `useThemeStore` funnels each mutation through `applyTheme()`. Only **Save**
 * writes `fb-theme-v1`, so a session of experimenting is discarded by a reload,
 * and the leave guard below exists precisely because that is surprising if
 * nobody says it out loud.
 *
 * TELEMETRY. `theme_changed` is emitted at the two moments that mean something
 * to the question "which themes do people actually use": applying a preset (in
 * `ColorsPanel`) and SAVING (here). Save is the one that separates a browse
 * from a commitment, and it reports the preset the saved document matches —
 * `Custom` when it matches none, which is itself the interesting answer.
 * `lib/telemetry-client` is fire-and-forget and inert under test.
 */

type StudioTab = 'colors' | 'typography' | 'layout';

const TABS: readonly StudioTab[] = ['colors', 'typography', 'layout'];

export default function ThemePage() {
  const { t } = useTranslation(['theme', 'common']);

  const dirty = useThemeStore((state) => state.dirty);
  const save = useThemeStore((state) => state.save);
  const resetToDefault = useThemeStore((state) => state.resetToDefault);
  const exportTheme = useThemeStore((state) => state.exportTheme);

  const [tab, setTab] = useState<StudioTab>('colors');
  const [importOpen, setImportOpen] = useState(false);

  /**
   * THE LEAVE GUARD. `useBlocker` is the data router's own hook (the app runs
   * on `createBrowserRouter`), so this needs no custom history wrapper — it
   * pauses the navigation, we ask, and `proceed()` / `reset()` answers.
   *
   * Gated on a real path CHANGE: the studio's own tabs are component state, but
   * a search-param or hash change elsewhere must not pop a dialog either.
   */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  /**
   * The other half of the same promise: closing the TAB is not a navigation the
   * router can see. The browser shows its own generic wording — `preventDefault`
   * plus a legacy `returnValue` is the whole modern API, and it only fires at
   * all if the page has been interacted with.
   */
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  return (
    <>
      <PageHeader
        title={t('theme:title')}
        description={t('theme:subtitle')}
        actions={dirty ? <Badge variant="soft-warning">{t('theme:unsaved.badge')}</Badge> : null}
      />

      <div className="grid gap-[var(--gap)] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as StudioTab);
          }}
          className="min-w-0 gap-[var(--gap)]"
        >
          <TabsList aria-label={t('theme:title')}>
            {TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {t(`theme:tabs.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="colors">
            <ColorsPanel />
          </TabsContent>
          <TabsContent value="typography">
            <TypographyPanel />
          </TabsContent>
          <TabsContent value="layout">
            <LayoutPanel />
          </TabsContent>
        </Tabs>

        {/* Sticky so the preview stays in view while the token list scrolls
            past it; `h-fit` keeps it from stretching to the tab column. */}
        <aside className="h-fit xl:sticky xl:top-0">
          <ThemePreview />
        </aside>
      </div>

      {/* The action bar. Sticky to the bottom of the scroll container so Save is
          reachable from the middle of a 22-row token list.

          It is a LABELLED GROUP because the preview column deliberately renders
          a button set of its own — including a "Save" — and without a name on
          this container, "the Save button" is ambiguous to a screen reader in
          exactly the way it was ambiguous to the test that first found this. */}
      <div
        role="group"
        aria-label={t('theme:actions.barLabel')}
        data-slot="theme-actions"
        className="sticky bottom-0 z-10 mt-[var(--gap)] -mb-[var(--page-pad)] flex flex-wrap items-center justify-end gap-1.5 border-t border-border bg-surface/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            resetToDefault();
            toast.success(t('theme:toasts.reset'));
          }}
        >
          <RotateCcw aria-hidden />
          {t('theme:actions.reset')}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (downloadJson(exportTheme())) toast.success(t('theme:toasts.exported'));
          }}
        >
          <Download aria-hidden />
          {t('theme:actions.export')}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setImportOpen(true);
          }}
        >
          <Upload aria-hidden />
          {t('theme:actions.import')}
        </Button>

        <Button
          type="button"
          size="sm"
          disabled={!dirty}
          onClick={() => {
            save();
            trackThemeChanged(matchColorPreset(useThemeStore.getState().theme)?.name ?? 'Custom');
            toast.success(t('theme:toasts.saved'));
          }}
        >
          <Save aria-hidden />
          {t('theme:actions.save')}
        </Button>
      </div>

      <ImportThemeDialog open={importOpen} onOpenChange={setImportOpen} />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          // Anything that closes the dialog without choosing "Leave" — Escape,
          // the Cancel button, an outside click — is a decision to stay, and
          // the blocked navigation has to be released either way or the router
          // stays wedged.
          if (!open) blocker.reset?.();
        }}
        title={t('theme:unsaved.title')}
        description={t('theme:unsaved.body')}
        confirmLabel={t('theme:unsaved.leave')}
        variant="default"
        onConfirm={() => {
          blocker.proceed?.();
        }}
      />
    </>
  );
}
