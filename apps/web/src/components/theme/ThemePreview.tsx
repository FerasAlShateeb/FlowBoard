import { useTranslation } from 'react-i18next';
import { CircleCheck, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The live preview column.
 *
 * IT IS STYLED NORMALLY, AND THAT IS THE DESIGN. Not one inline colour, not one
 * copy of a token — a real board card, the real `ui/button` variants, a real
 * input and five bars on `--chart-1..5`. It therefore updates "for free" the
 * instant `applyTheme()` rewrites a custom property, and it cannot drift from
 * what the rest of the app looks like, because it is built the same way the
 * rest of the app is built.
 *
 * THERE IS NO PREVIEW-ONLY MODE FLIP. A scoped light/dark toggle would need
 * this subtree to paint from the OTHER palette than `<html>`, which means
 * duplicating the token layer at a container — and it would quietly teach the
 * reader that edits are sandboxed. They are not: every edit is already live
 * app-wide. The topbar's global toggle flips both this panel and everything
 * behind it, which is the honest preview.
 */
export function ThemePreview() {
  const { t } = useTranslation(['theme', 'common']);

  return (
    <section aria-label={t('theme:preview.title')} className="grid gap-3">
      <div>
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('theme:preview.title')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('theme:preview.description')}</p>
      </div>

      {/* A board card, exactly as the board renders one. */}
      <article className="fb-card grid gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium text-foreground">
            {t('theme:preview.cardTitle')}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {t('theme:preview.cardKey')}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('theme:preview.cardMeta')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The `soft-*` variants are the semantic tokens at low alpha — the
              fastest way to see whether a preset's success/warning still read. */}
          <Badge variant="soft-success">
            <CircleCheck aria-hidden />
            {t('theme:preview.done')}
          </Badge>
          <Badge variant="soft-warning">
            <TriangleAlert aria-hidden />
            {t('theme:preview.blocked')}
          </Badge>
        </div>
      </article>

      {/* The button set: every variant that carries a token decision. */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm">{t('common:actions.save')}</Button>
        <Button size="sm" variant="secondary">
          {t('common:actions.edit')}
        </Button>
        <Button size="sm" variant="outline">
          {t('common:actions.cancel')}
        </Button>
        <Button size="sm" variant="ghost">
          {t('common:actions.close')}
        </Button>
        <Button size="sm" variant="destructive">
          {t('common:actions.delete')}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="theme-preview-input">{t('theme:preview.inputLabel')}</Label>
        <Input
          id="theme-preview-input"
          readOnly
          placeholder={t('theme:preview.inputPlaceholder')}
        />
      </div>

      {/* The chart ramp. `bg-chart-N` resolves through `--chart-N`, which is
          also what WP3.8's task-type glyphs read — so this row previews the
          icon palette of every view, not just the reports dashboard. */}
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">{t('theme:preview.chart')}</span>
        <div
          aria-hidden
          className="flex h-16 items-end gap-1.5 rounded-[var(--card-radius)] border border-border bg-surface p-2"
        >
          <span className="h-1/2 flex-1 rounded-[var(--radius)] bg-chart-1" />
          <span className="h-3/4 flex-1 rounded-[var(--radius)] bg-chart-2" />
          <span className="h-full flex-1 rounded-[var(--radius)] bg-chart-3" />
          <span className="h-2/5 flex-1 rounded-[var(--radius)] bg-chart-4" />
          <span className="h-3/5 flex-1 rounded-[var(--radius)] bg-chart-5" />
        </div>
      </div>
    </section>
  );
}

export default ThemePreview;
