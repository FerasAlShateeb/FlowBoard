import { cn } from '@/lib/utils';

/**
 * The FlowBoard mark: three stacked bars of decreasing width — a board column
 * seen edge-on — inside a rounded tile filled with the accent.
 *
 * Drawn as inline SVG with `currentColor` + token fills rather than shipped as
 * an asset, for one reason that matters: it must follow the Theme Studio. A
 * `.svg` file cannot read a CSS custom property that `applyTheme()` rewrote a
 * moment ago; this can.
 *
 * The wordmark is the literal string `FlowBoard` — a BRAND, never translated,
 * in any locale (i18n.md).
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="FlowBoard"
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <g fill="var(--primary-fg)">
        <rect x="8" y="8" width="16" height="4" rx="2" />
        <rect x="8" y="14" width="11" height="4" rx="2" opacity="0.8" />
        <rect x="8" y="20" width="6" height="4" rx="2" opacity="0.6" />
      </g>
    </svg>
  );
}

export default BrandMark;
