import { describe, expect, it } from 'vitest';

import {
  AREA_FILL_OPACITY,
  PLANNED_FILL_OPACITY,
  fillOpacityFor,
} from '@/components/reports/chart-theme';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The Theme Studio's Chart-style switch, end to end — as far as it can be
 * asserted without rendering Recharts into a zero-sized jsdom container.
 *
 * The switch has existed since WP4.5 and, until WP5.6, nothing read the token
 * it wrote: `chartStyle` was set, persisted, exported and ignored. A control
 * that describes itself as "Filled areas or plain lines on the reports
 * dashboard" and changes nothing is worse than a missing one — it teaches the
 * reader that the studio's settings are decorative.
 *
 * Two things have to hold, and an inverted implementation would satisfy
 * neither: the token round-trips through the store, and `line` is the value
 * that removes the fill.
 */
describe('fillOpacityFor', () => {
  it('keeps the series fill under the FILLED style', () => {
    expect(fillOpacityFor('filled', AREA_FILL_OPACITY)).toBe(AREA_FILL_OPACITY);
    expect(fillOpacityFor('filled', PLANNED_FILL_OPACITY)).toBe(PLANNED_FILL_OPACITY);
  });

  it('drops the fill to zero under the LINE style, leaving the stroke', () => {
    expect(fillOpacityFor('line', AREA_FILL_OPACITY)).toBe(0);
    expect(fillOpacityFor('line', PLANNED_FILL_OPACITY)).toBe(0);
  });

  it('is the store token that decides, so the studio switch actually reaches it', () => {
    useThemeStore.getState().patchShared({ chartStyle: 'line' });
    expect(fillOpacityFor(useThemeStore.getState().chartStyle(), AREA_FILL_OPACITY)).toBe(0);

    useThemeStore.getState().patchShared({ chartStyle: 'filled' });
    expect(fillOpacityFor(useThemeStore.getState().chartStyle(), AREA_FILL_OPACITY)).toBe(
      AREA_FILL_OPACITY,
    );
  });
});
