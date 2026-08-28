/**
 * The Theme Studio's colour maths: OKLCH ⇄ sRGB, in about sixty lines of pure
 * arithmetic and no dependency.
 *
 * WHY THIS FILE EXISTS. FlowBoard's palette is authored in **OKLCH** (see
 * `packages/shared/src/theme.schema.ts`) because it is perceptually uniform —
 * one lightness step looks like the same step at every hue, which is what keeps
 * the light and dark ramps of eight presets consistent. But the browser's
 * `<input type="color">` speaks **only** `#rrggbb`. The studio therefore needs a
 * conversion in both directions, and `culori` is not a dependency of this
 * workspace (adding a package for ~60 lines of matrix multiplication is not a
 * trade this repo makes).
 *
 * CHECKLIST §6 NOTE ("no hex or raw colour literal outside `index.css` and the
 * theme presets"): this module contains no colour LITERALS. The numbers below
 * are the published OKLab ⇄ linear-sRGB transfer matrices (Björn Ottosson) and
 * the sRGB transfer function — they are maths, not palette. The one place a
 * colour value is written by hand is `theme-presets.ts`.
 *
 * Runtime-neutral: no DOM, no `getComputedStyle`. Everything is computed from
 * the theme document, which is what makes it testable and timing-safe.
 */

/** A colour in OKLCH: `l` 0–1, `c` 0–~0.4, `h` degrees 0–360. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** A colour in sRGB, each channel 0–1 (gamma-encoded, i.e. what hex holds). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** sRGB transfer function, linear → gamma-encoded. */
const encodeGamma = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;

/** sRGB transfer function, gamma-encoded → linear. */
const decodeGamma = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);

/**
 * OKLCH → **linear** sRGB. Channels may fall outside 0–1: OKLCH describes more
 * colours than an sRGB monitor can show, and detecting that overflow is exactly
 * how {@link oklchToRgb} knows it has to reduce chroma.
 */
function oklchToLinearRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  // OKLab → LMS' (cube roots of the cone responses), then cubed back to LMS.
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    g: -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    b: -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  };
}

const inGamut = ({ r, g, b }: Rgb, epsilon = 1e-4): boolean =>
  r >= -epsilon &&
  r <= 1 + epsilon &&
  g >= -epsilon &&
  g <= 1 + epsilon &&
  b >= -epsilon &&
  b <= 1 + epsilon;

/**
 * OKLCH → sRGB (gamma-encoded, 0–1 per channel).
 *
 * OUT-OF-GAMUT COLOURS LOSE CHROMA, NOT HUE. A naive per-channel clamp shifts
 * the hue of any saturated colour — a vivid orange clamps to something visibly
 * pinker — which would make the studio's swatch disagree with what the browser
 * paints from the same `oklch()` string. Instead the chroma is bisected down to
 * the gamut boundary at constant lightness and hue (16 iterations ≈ 1e-5
 * precision), which is what CSS Color 4 gamut mapping does in spirit.
 */
export function oklchToRgb(color: Oklch): Rgb {
  const direct = oklchToLinearRgb(color);
  let linear = direct;

  if (!inGamut(direct)) {
    let low = 0;
    let high = color.c;
    for (let i = 0; i < 16; i += 1) {
      const mid = (low + high) / 2;
      const candidate = oklchToLinearRgb({ ...color, c: mid });
      if (inGamut(candidate)) low = mid;
      else high = mid;
    }
    linear = oklchToLinearRgb({ ...color, c: low });
  }

  return {
    r: clamp01(encodeGamma(clamp01(linear.r))),
    g: clamp01(encodeGamma(clamp01(linear.g))),
    b: clamp01(encodeGamma(clamp01(linear.b))),
  };
}

/** sRGB (gamma-encoded, 0–1) → OKLCH. The exact inverse of the above. */
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = decodeGamma(clamp01(r));
  const lg = decodeGamma(clamp01(g));
  const lb = decodeGamma(clamp01(b));

  const lc = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const mc = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const sc = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const l = 0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc;
  const a = 1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc;
  const bb = 0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc;

  const c = Math.sqrt(a * a + bb * bb);
  // A grey has no meaningful hue; reporting 0 keeps round-trips stable instead
  // of returning whatever `atan2(±0, ±0)` happens to produce.
  const h = c < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;

  return { l, c, h };
}

const byteToHex = (channel: number): string =>
  Math.round(clamp01(channel) * 255)
    .toString(16)
    .padStart(2, '0');

/** sRGB (0–1 per channel) → `#rrggbb`, always six digits and lower case. */
export const rgbToHexString = ({ r, g, b }: Rgb): string =>
  `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;

/**
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` → sRGB, or `null` when the string is
 * not a hex colour. Alpha is PARSED AND DROPPED: the token layer is opaque, and
 * silently keeping a half-transparent surface would be worse than losing it.
 */
export function parseHex(value: string): Rgb | null {
  const raw = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;

  const expand = (digits: string): number => parseInt(digits.repeat(2 / digits.length), 16) / 255;

  if (raw.length === 3 || raw.length === 4) {
    const [r, g, b] = [raw[0], raw[1], raw[2]];
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r: expand(r), g: expand(g), b: expand(b) };
  }
  if (raw.length === 6 || raw.length === 8) {
    return {
      r: parseInt(raw.slice(0, 2), 16) / 255,
      g: parseInt(raw.slice(2, 4), 16) / 255,
      b: parseInt(raw.slice(4, 6), 16) / 255,
    };
  }
  return null;
}

/**
 * One component of an `oklch()` function. Accepts a number, a percentage
 * (resolved against `full`, per CSS Color 4 — `50%` lightness is `0.5`, `50%`
 * chroma is `0.2`), and the `none` keyword, which CSS defines as the missing
 * component and resolves to zero in a plain conversion.
 */
function parseComponent(token: string, full: number): number | null {
  if (token === 'none') return 0;
  if (token.endsWith('%')) {
    const percent = Number.parseFloat(token.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * full : null;
  }
  const value = Number.parseFloat(token);
  return Number.isFinite(value) ? value : null;
}

/**
 * `oklch(0.52 0.187 276.2)` → {@link Oklch}, `null` for anything else. The
 * optional `/ alpha` tail is accepted and dropped, as in {@link parseHex}.
 */
export function parseOklch(value: string): Oklch | null {
  const match = /^oklch\(([^)]*)\)$/i.exec(value.trim());
  if (!match?.[1]) return null;

  const [coords] = match[1].split('/');
  const parts = (coords ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;

  const l = parseComponent(parts[0] ?? '', 1);
  const c = parseComponent(parts[1] ?? '', 0.4);
  const h = parts[2] === 'none' ? 0 : Number.parseFloat((parts[2] ?? '').replace(/deg$/i, ''));
  if (l === null || c === null || !Number.isFinite(h)) return null;

  return { l, c, h: ((h % 360) + 360) % 360 };
}

/**
 * Any token this module understands → sRGB. `null` for the colour forms the
 * SCHEMA allows but the studio never writes (`rgb()`, `hsl()`, `lab()`,
 * `color()`): a hand-imported theme may legitimately carry one, and the caller's
 * job is to keep showing the raw text rather than to guess a swatch.
 */
export function colorToRgb(value: string): Rgb | null {
  const oklch = parseOklch(value);
  if (oklch) return oklchToRgb(oklch);
  return parseHex(value);
}

/** Any understood colour token → `#rrggbb`, or `null`. For `<input type=color>`. */
export function colorToHex(value: string): string | null {
  const rgb = colorToRgb(value);
  return rgb ? rgbToHexString(rgb) : null;
}

/** Round to `places` decimals without the floating-point tail (`0.1+0.2` noise). */
const round = (n: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
};

/**
 * {@link Oklch} → the canonical `oklch(l c h)` string this codebase stores.
 *
 * Three, four and one decimals: enough precision that a hex → OKLCH → hex round
 * trip is byte-identical, short enough that an exported theme stays readable.
 */
export const formatOklch = ({ l, c, h }: Oklch): string =>
  `oklch(${round(clamp01(l), 4)} ${round(Math.max(0, c), 4)} ${round(h, 2)})`;

/**
 * `#rrggbb` → the `oklch()` string to store in the document.
 *
 * The studio's colour inputs are hex (the browser gives nothing else), but the
 * DOCUMENT stays in OKLCH so an edited token is still in the same space as the
 * preset it came from — which is what keeps "nudge the primary" from silently
 * converting the whole palette to sRGB.
 */
export function hexToOklchString(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? formatOklch(rgbToOklch(rgb)) : null;
}

/** WCAG relative luminance of a colour token (0 = black, 1 = white). */
export function relativeLuminance(value: string): number | null {
  const rgb = colorToRgb(value);
  if (!rgb) return null;
  return 0.2126 * decodeGamma(rgb.r) + 0.7152 * decodeGamma(rgb.g) + 0.0722 * decodeGamma(rgb.b);
}

/**
 * WCAG 2.1 contrast ratio between two colour tokens, 1–21. `null` when either
 * side is a colour form this module cannot resolve.
 *
 * Used by `theme-presets.test.ts` to hold every preset to an AA-ish floor in
 * BOTH modes — a preset gallery whose fifth card is unreadable in light mode is
 * the exact failure this guards.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
