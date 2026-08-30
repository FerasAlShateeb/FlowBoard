import type { ThemeColorTokens } from '@flowboard/shared';

import type { ColorPreset } from '@/components/theme/theme-presets';

/**
 * The 64px FlowBoard mock the Theme Studio DRAWER paints each preset with.
 *
 * WHY A SECOND MOCK AT ALL, next to `PresetCard`'s. They answer the same
 * question at two very different sizes. `/theme` has a three-column grid and
 * shows BOTH palettes per card (light beside dark, 80px each) because the page
 * is where a palette is chosen deliberately. The drawer has 380px total and a
 * two-column grid, so a card gets ~160px: two mocks there would each be 76px
 * wide, at which point the sidebar rail is two pixels and the chart ramp is
 * noise. One mock, painted in the mode you are actually looking at, is the
 * honest thing to show in that space — and switching Light/Dark in the drawer
 * repaints every card, which is what tells the reader the other half exists.
 *
 * INLINE STYLES ARE THE POINT, and are the same documented exemption
 * `PresetCard` and `common/LabelDot` carry (design-system.md §colour literals):
 * every other surface reads `var(--surface)` and therefore shows the ACTIVE
 * theme, which is exactly what a gallery of eight alternatives must not do. The
 * values are DATA read from `theme-presets.ts`, never literals authored here.
 *
 * `aria-hidden` + `pointer-events-none`: it is decoration inside a button that
 * already carries the preset's name as its accessible label. A screen reader
 * hearing "Apply Ocean" needs nothing from a picture of Ocean.
 */
function Mock({ colors }: { colors: ThemeColorTokens }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none h-16 w-full overflow-hidden rounded-[var(--radius)] border"
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
    >
      <div className="flex h-full">
        {/* The sidebar rail: brand mark, the ACTIVE row in `primary`, two idle
            rows. The active bar is the preset's loudest statement at this size. */}
        <div
          className="flex w-5 shrink-0 flex-col gap-1 border-e p-1"
          style={{ backgroundColor: colors.sidebarBg, borderColor: colors.border }}
        >
          <div className="h-1.5 rounded-[1px]" style={{ backgroundColor: colors.primary }} />
          <div className="h-1 rounded-[1px]" style={{ backgroundColor: colors.sidebarActive }} />
          <div
            className="h-1 rounded-[1px] opacity-60"
            style={{ backgroundColor: colors.border }}
          />
          <div
            className="h-1 rounded-[1px] opacity-60"
            style={{ backgroundColor: colors.border }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* The topbar, with the accent and primary chips pinned to the END —
              `justify-end` is logical, so the chips sit where the real topbar's
              controls sit in either direction. */}
          <div
            className="flex h-3 shrink-0 items-center justify-end gap-0.5 border-b px-1"
            style={{ backgroundColor: colors.topbar, borderColor: colors.border }}
          >
            <span className="size-1 rounded-full" style={{ backgroundColor: colors.accent }} />
            <span className="size-1 rounded-full" style={{ backgroundColor: colors.primary }} />
          </div>

          {/* Two board cards, each with a muted title line and one chart bar —
              the smallest drawing that still shows a surface, a text colour and
              the chart ramp's first two hues. */}
          <div className="grid flex-1 grid-cols-2 gap-1 p-1">
            {[colors.chart1, colors.chart2].map((chart, index) => (
              <div
                key={index}
                className="rounded-[2px] border p-0.5"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <div
                  className="mb-0.5 h-0.5 w-2/3 rounded-[1px]"
                  style={{ backgroundColor: colors.textMuted }}
                />
                <div
                  className="h-1.5 rounded-[1px]"
                  style={{ backgroundColor: chart, opacity: 0.85 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Paints `preset` in the mode currently on screen. */
export function PresetPreviewMini({ preset, dark }: { preset: ColorPreset; dark: boolean }) {
  return <Mock colors={dark ? preset.dark : preset.light} />;
}

export default PresetPreviewMini;
