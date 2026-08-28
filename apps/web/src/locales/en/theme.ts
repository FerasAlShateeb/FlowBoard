/**
 * `theme` — the Theme Studio (`/theme`): the preset gallery, the token editor,
 * the font cards, the layout controls, and the JSON import/export flow.
 *
 * THE KEY NAMES ARE THE DATA'S KEYS. `components/theme/theme-presets.ts` is a
 * framework-free data module: it carries `labelKey: 'ocean'`, never the English
 * word "Ocean". The studio composes `theme:presets.ocean` at render, which is
 * what lets one preset table serve both languages — and why every `labelKey`
 * union in that file has an entry here, checked at compile time.
 *
 * Preset and font NAMES are display text and translate; the identities they
 * describe (`'Ocean'`, `'Inter'`) stay English inside the document.
 */
export default {
  title: 'Theme Studio',
  subtitle: 'Colours, type and layout. Every change applies live — Save keeps it.',

  tabs: {
    colors: 'Colours',
    typography: 'Typography',
    layout: 'Layout',
  },

  /** The Light/Dark switch above the token editor — which palette you are editing. */
  mode: {
    label: 'Editing palette',
    light: 'Light',
    dark: 'Dark',
    /** Shown when you are editing the palette you are not currently looking at. */
    hint: 'You are viewing the {{viewing}} palette. Switch the topbar toggle to see these edits.',
  },

  gallery: {
    title: 'Presets',
    description: 'A complete light and dark palette each. Applying one replaces both.',
    /** No preset matches the current palette — an edited or imported theme. */
    custom: 'Custom',
    customHint: 'These colours match no preset. Export them to keep a copy.',
    active: 'Active',
    preview: 'Preview of the {{name}} preset',
  },

  presets: {
    default: 'Default',
    graphite: 'Graphite',
    ocean: 'Ocean',
    forest: 'Forest',
    sunset: 'Sunset',
    rose: 'Rose',
    amber: 'Amber',
    highContrast: 'High contrast',
  },

  presetHints: {
    default: 'The FlowBoard indigo. Cool neutrals, one strong accent.',
    graphite: 'Monochrome. The chart ramp is lightness, not hue.',
    ocean: 'Deep marine blue with a teal accent.',
    forest: 'Pine green on green-tinted neutrals.',
    sunset: 'Burnt orange against a magenta dusk.',
    rose: 'Crimson rose with a fuchsia accent.',
    amber: 'Honey on sand. Dark labels on the primary.',
    highContrast: 'Maximum legibility: real borders, ~20:1 body text.',
  },

  editor: {
    title: 'Tokens',
    description: 'Every colour in the {{mode}} palette. Edits apply as you make them.',
    /** Accessible name of the `<input type="color">` on a token row. */
    pick: 'Pick {{token}}',
    /** Accessible name of the raw-value text field on a token row. */
    value: '{{token}} value',
    invalid: 'Not a colour. Try a hex (#4f46e5) or oklch(0.52 0.19 276).',
    hint: 'The picker writes OKLCH; the field accepts hex or any CSS colour function.',
  },

  tokenGroups: {
    surfaces: 'Surfaces',
    text: 'Text',
    accent: 'Accent',
    semantic: 'Semantic',
    sidebar: 'Navigation',
    charts: 'Charts',
  },

  tokens: {
    primary: 'Primary',
    primaryFg: 'On primary',
    secondary: 'Secondary',
    accent: 'Accent',
    bg: 'Background',
    surface: 'Surface',
    surfaceRaised: 'Raised surface',
    border: 'Border',
    text: 'Text',
    textMuted: 'Muted text',
    success: 'Success',
    warning: 'Warning',
    danger: 'Danger',
    info: 'Info',
    sidebarBg: 'Sidebar',
    sidebarActive: 'Sidebar active',
    topbar: 'Topbar',
    chart1: 'Chart 1',
    chart2: 'Chart 2',
    chart3: 'Chart 3',
    chart4: 'Chart 4',
    chart5: 'Chart 5',
  },

  typography: {
    title: 'Typeface',
    description: 'Arabic always falls through to IBM Plex Sans Arabic, whatever you pick.',
    /** The font card's specimen — Latin and Arabic side by side. */
    specimen: 'Ag أب',
    notLoaded: 'Uses your installed copy',
    notLoadedHint:
      'FlowBoard ships Inter, JetBrains Mono and IBM Plex Sans Arabic. Other families render if your device has them, and fall back to the next in the stack if not.',
    scale: 'Scale',
  },

  fonts: {
    inter: 'The FlowBoard default. Neutral, dense, built for interfaces.',
    ibmPlexSans: 'The Latin sibling of the Arabic fallback — one superfamily, both scripts.',
    manrope: 'Geometric and open, with a heavier heading weight.',
    dmSans: 'Low-contrast geometric sans. Friendly at small sizes.',
    spaceGrotesk: 'Technical, slightly quirky. Distinct headings.',
    sourceSerif: 'Editorial serif for reading-heavy work.',
    jetBrainsMono: 'The whole interface in the code face.',
    ibmPlexMono: 'A softer monospace, warmer than JetBrains.',
  },

  groups: {
    radius: 'Corners',
    density: 'Density',
    spacing: 'Spacing',
    sidebar: 'Sidebar width',
    content: 'Content width',
    shadow: 'Elevation',
    speed: 'Motion',
    chartStyle: 'Chart style',
    fontSize: 'Text size',
    leading: 'Line height',
    tracking: 'Letter spacing',
  },

  hints: {
    radius: 'Cards, buttons and inputs round together.',
    density: 'Compact tightens every padding and row height by about a quarter.',
    spacing: 'How much air sits between the page, the cards and their contents.',
    sidebar: 'Applies to both the expanded and the collapsed rail.',
    content: 'Where a wide screen stops stretching the reading column.',
    shadow: 'Depth in FlowBoard comes from the border first, the shadow second.',
    speed: 'Instant removes chrome transitions entirely.',
    chartStyle: 'Filled areas or plain lines on the reports dashboard.',
    fontSize: 'The base size everything else scales from.',
    leading: 'Arabic keeps a floor of 1.7 whatever you choose here.',
    tracking: 'Ignored for Arabic — tracking breaks the cursive joins.',
  },

  options: {
    square: 'Square',
    subtle: 'Subtle',
    rounded: 'Rounded',
    pill: 'Pill',
    comfortable: 'Comfortable',
    compact: 'Compact',
    cozy: 'Cozy',
    spacious: 'Spacious',
    narrow: 'Narrow',
    default: 'Default',
    wide: 'Wide',
    boxed: 'Boxed',
    fluid: 'Fluid',
    none: 'None',
    soft: 'Soft',
    medium: 'Medium',
    bold: 'Bold',
    instant: 'Instant',
    fast: 'Fast',
    normal: 'Normal',
    calm: 'Calm',
    filled: 'Filled',
    line: 'Line',
    tight: 'Tight',
    relaxed: 'Relaxed',
    airy: 'Airy',
  },

  preview: {
    title: 'Live preview',
    description: 'Real components on the current tokens — the rest of the app looks like this too.',
    cardTitle: 'Ship the theme editor',
    cardKey: 'FB-142',
    cardMeta: 'In progress · 3 points',
    inputLabel: 'Task title',
    inputPlaceholder: 'Something to do',
    chart: 'Throughput',
    done: 'Done',
    blocked: 'Blocked',
  },

  actions: {
    /** Names the sticky action bar — the preview column has a Save of its own. */
    barLabel: 'Theme actions',
    save: 'Save',
    reset: 'Reset',
    export: 'Export',
    import: 'Import',
    apply: 'Apply {{name}}',
  },

  import: {
    title: 'Import a theme',
    description: 'Choose an exported .json file, or paste one below.',
    chooseFile: 'Choose file…',
    fileInput: 'Theme JSON file',
    pasteLabel: 'Theme JSON',
    pastePlaceholder: '{ "light": { … }, "dark": { … }, "shared": { … } }',
    submit: 'Import',
    errors: {
      json: 'That is not valid JSON.',
      schema: 'That JSON is not a theme document — a token is missing or out of range.',
      file: 'That file could not be read.',
    },
  },

  toasts: {
    saved: 'Theme saved to this device.',
    reset: 'Back to the default theme. Save to keep it.',
    imported: 'Theme imported. Save to keep it.',
    exported: 'Theme exported.',
    presetApplied: '{{name}} applied. Save to keep it.',
  },

  unsaved: {
    badge: 'Unsaved changes',
    title: 'Leave without saving?',
    body: 'Your theme edits are live but not saved to this device. Leaving reverts them on the next reload.',
    // The "stay" side is `common:actions.cancel`: the guard is built on the
    // shared `ConfirmDialog`, which owns its own cancel label.
    leave: 'Leave',
  },
} as const;
