import { describe, expect, it } from 'vitest';

import {
  colorToHex,
  contrastRatio,
  formatOklch,
  hexToOklchString,
  oklchToRgb,
  parseHex,
  parseOklch,
  relativeLuminance,
  rgbToHexString,
  rgbToOklch,
} from '@/components/theme/color';

/**
 * The colour maths, checked against PUBLISHED values rather than against
 * itself.
 *
 * This module is the studio's load-bearing arithmetic: it decides what the
 * `<input type="color">` shows for every token, what an edit writes back into
 * the document, and (via `contrastRatio`) whether a preset is legible. A
 * transposed matrix coefficient would still round-trip perfectly while being
 * silently wrong about every colour, so the primaries below are asserted
 * against the CSS Color 4 reference conversions, not against a fixture this
 * file produced.
 */

/** The sRGB corners, with their OKLCH coordinates from the CSS Color 4 spec. */
const PRIMARIES: ReadonlyArray<readonly [string, number, number, number]> = [
  ['#ff0000', 0.628, 0.2577, 29.23],
  ['#00ff00', 0.8664, 0.2948, 142.5],
  ['#0000ff', 0.452, 0.3132, 264.05],
];

describe('OKLCH ⇄ sRGB', () => {
  it('maps white to L=1 with no chroma', () => {
    const white = rgbToOklch({ r: 1, g: 1, b: 1 });
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.c).toBeCloseTo(0, 4);
    expect(rgbToHexString(oklchToRgb(white))).toBe('#ffffff');
  });

  it('maps black to L=0 with no chroma', () => {
    const black = rgbToOklch({ r: 0, g: 0, b: 0 });
    expect(black.l).toBeCloseTo(0, 4);
    expect(black.c).toBeCloseTo(0, 4);
    expect(rgbToHexString(oklchToRgb(black))).toBe('#000000');
  });

  it('reports a neutral grey as achromatic (hue 0, not NaN)', () => {
    const grey = rgbToOklch({ r: 0.5, g: 0.5, b: 0.5 });
    expect(grey.c).toBeCloseTo(0, 4);
    expect(grey.h).toBe(0);
  });

  it.each(PRIMARIES)('converts %s to its reference OKLCH', (hex, l, c, h) => {
    const rgb = parseHex(hex);
    expect(rgb).not.toBeNull();
    const oklch = rgbToOklch(rgb ?? { r: 0, g: 0, b: 0 });
    expect(oklch.l).toBeCloseTo(l, 3);
    expect(oklch.c).toBeCloseTo(c, 3);
    expect(oklch.h).toBeCloseTo(h, 1);
  });

  it.each(['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#4f46e5', '#808080', '#0f172a'])(
    'round-trips %s through OKLCH byte-for-byte',
    (hex) => {
      const stored = hexToOklchString(hex);
      expect(stored).not.toBeNull();
      expect(colorToHex(stored ?? '')).toBe(hex);
    },
  );

  it('reduces chroma instead of shifting hue for an out-of-gamut colour', () => {
    // C=0.4 at L=0.7 is far outside sRGB. A per-channel clamp would drag the
    // hue; gamut mapping must keep it.
    const mapped = rgbToOklch(oklchToRgb({ l: 0.7, c: 0.4, h: 30 }));
    expect(mapped.h).toBeCloseTo(30, 0);
    expect(mapped.l).toBeCloseTo(0.7, 2);
    expect(mapped.c).toBeLessThan(0.4);
  });
});

describe('parsing', () => {
  it('expands a three-digit hex', () => {
    expect(colorToHex('#abc')).toBe('#aabbcc');
  });

  it('accepts an eight-digit hex and drops the alpha', () => {
    expect(colorToHex('#4f46e580')).toBe('#4f46e5');
  });

  it('parses an oklch() with a percentage lightness', () => {
    expect(colorToHex('oklch(52.4% 0.187 276.2)')).toBe(colorToHex('oklch(0.524 0.187 276.2)'));
  });

  it('parses an oklch() with an alpha tail and ignores it', () => {
    expect(colorToHex('oklch(0.524 0.187 276.2 / 0.5)')).toBe('#5257d3');
  });

  it('normalises an out-of-range hue', () => {
    expect(parseOklch('oklch(0.5 0.1 400)')?.h).toBeCloseTo(40, 6);
  });

  it('returns null for colour functions it does not implement', () => {
    // Legal per the shared schema, so the studio must degrade — not throw.
    expect(colorToHex('rgb(255 0 0)')).toBeNull();
    expect(colorToHex('lab(50% 40 59.5)')).toBeNull();
  });

  it('returns null for nonsense', () => {
    expect(parseHex('#gg0000')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseOklch('oklch(0.5 0.1)')).toBeNull();
    expect(colorToHex('')).toBeNull();
  });

  it('formats to the canonical three-part string', () => {
    expect(formatOklch({ l: 0.5241234, c: 0.1871234, h: 276.2345 })).toBe(
      'oklch(0.5241 0.1871 276.23)',
    );
  });
});

describe('contrast', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const forward = contrastRatio('#ffffff', '#4f46e5');
    const backward = contrastRatio('#4f46e5', '#ffffff');
    expect(forward).toBeCloseTo(backward ?? 0, 10);
  });

  it('computes luminance at the WCAG anchors', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
  });

  it('is null when a side cannot be resolved', () => {
    expect(contrastRatio('#ffffff', 'hsl(200 50% 50%)')).toBeNull();
  });
});
