import { useTranslation } from 'react-i18next';

import { LAYOUT_GROUPS } from '@/components/theme/theme-presets';
import SegmentedOptions from '@/components/theme/SegmentedOptions';

/**
 * The Layout tab: corners, density, spacing, sidebar and content widths,
 * elevation, motion and chart style — each a segmented control of WORDS with a
 * one-line description under it.
 *
 * All eight groups patch the SHARED tokens, which are mode-independent, so
 * nothing here needs a light/dark switch: what you set is what both palettes
 * get.
 */
export function LayoutPanel() {
  const { t } = useTranslation(['theme']);

  return (
    <section
      className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={t('theme:tabs.layout')}
    >
      {LAYOUT_GROUPS.map((group) => (
        <SegmentedOptions key={group.key} group={group} />
      ))}
    </section>
  );
}

export default LayoutPanel;
