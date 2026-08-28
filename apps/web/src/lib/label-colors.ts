/**
 * The label colour PRESETS — the ten swatches a project's label picker offers.
 *
 * WHY HEX LITERALS ARE CORRECT HERE, and only here. Project checklist §B bans
 * hex outside `index.css` and presets, for a good reason: a hardcoded colour in
 * a component cannot follow the Theme Studio. These are neither. A label colour
 * is DATA — it is persisted per label in `labels.color`, validated by
 * `hexColor` in `@flowboard/shared` (which is `#rgb`/`#rrggbb`, not a CSS colour
 * function), and it must mean the same thing in both themes and in a CSV export.
 * This file is the "presets" half of that exemption, and it is the ONLY place
 * in `src/` outside the token layer where a hex appears.
 *
 * The ten are picked for mutual distinguishability at 8px — the size a label
 * dot renders on a board card — rather than for palette harmony. Each sits
 * around the same lightness so no swatch disappears against either surface.
 */

/** One offered swatch: the wire value plus the `settings:colors.*` key. */
export interface LabelColorPreset {
  /** `settings:colors.<nameKey>` — the accessible name of the swatch. */
  nameKey:
    'slate' | 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'indigo' | 'violet' | 'pink';
  /** The `#rrggbb` value stored on the label row. */
  value: string;
}

export const LABEL_COLORS: readonly LabelColorPreset[] = [
  { nameKey: 'slate', value: '#64748b' },
  { nameKey: 'red', value: '#ef4444' },
  { nameKey: 'orange', value: '#f97316' },
  { nameKey: 'amber', value: '#f59e0b' },
  { nameKey: 'green', value: '#22c55e' },
  { nameKey: 'teal', value: '#14b8a6' },
  { nameKey: 'blue', value: '#3b82f6' },
  { nameKey: 'indigo', value: '#6366f1' },
  { nameKey: 'violet', value: '#8b5cf6' },
  { nameKey: 'pink', value: '#ec4899' },
];

/** The default offered to a new label — the most neutral of the ten. */
export const DEFAULT_LABEL_COLOR: string = LABEL_COLORS[0]?.value ?? '#64748b';

/**
 * The same ten, reused as STATUS colours in the workflow editor.
 *
 * Statuses validate with the same `hexColor` schema and render the same kind of
 * swatch, so offering a second palette would be two vocabularies for one
 * decision — and a board whose column colours clash with its label colours.
 */
export const STATUS_COLORS = LABEL_COLORS;

/** The default for a newly added status column. */
export const DEFAULT_STATUS_COLOR: string = LABEL_COLORS[6]?.value ?? '#3b82f6';
