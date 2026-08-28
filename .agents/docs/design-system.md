# Design System

The authoritative token catalogue for FlowBoard's web app: where every colour,
dimension and font lives, how the Theme Studio rewrites them at runtime, and the
short list of files allowed to write a colour value at all. Read it before any
styling work, before touching `apps/web/src/components/ui/`, and before adding a
chart. §7 is the enforcement contract a reviewer checks a diff against.

## 1. The design direction

FlowBoard is **Linear-style minimal, dark-first**. Both palettes are complete,
but dark is the default an unconfigured visitor gets — `loadStoredDark()` returns
`null` (not `false`) when nothing is stored, and `useThemeStore` falls back to
`true` only on that `null`, so an explicit "I want light" survives a reload.

| Principle                   | What it means in code                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Dense                       | `--fs-base: 13.5px`, `--topbar-h: 48px`, `--row-pad: 8px`. Compact density multiplies the spacing by 0.72.               |
| Muted surfaces              | A three-step neutral ramp `--bg` → `--surface` → `--surface-raised`, all carrying hue 275 as a trace.                    |
| Subtle borders              | `--border` sits barely above the surface it separates. Depth comes from the hairline, not a drop shadow.                 |
| Exactly one accent          | `--primary`, a refined indigo/violet. `--accent` is a secondary hue used for washes, never for chrome.                   |
| Keyboard-first              | `:focus-visible` is a designed 2px `--primary` ring at 2px offset in `@layer base`, never a browser default.             |
| Perceptible motion is a bug | One duration, `--speed: 130ms`, for all chrome. The Layout tab's `Instant` option (0ms) is a real accessibility setting. |

**Every page owes the user three states — loading, empty, error.** A view that
renders only the happy path is not done. The shared components are
`apps/web/src/components/common/PageSpinner.tsx` (the branded Suspense fallback
for every lazy route, `role="status"` with a translated name),
`apps/web/src/components/common/EmptyState.tsx` (the one panel every "nothing to
show" renders, so an unfiltered empty board and a search with no matches look
alike), and `apps/web/src/components/common/ErrorState.tsx` — which is built
_on_ `EmptyState`, takes the raw `unknown` error rather than a message, and
localizes it through `useApiErrorMessage()` from `@/i18n/errors`. Where a
skeleton reads better than a spinner, use `apps/web/src/components/ui/skeleton.tsx`
directly; `apps/web/src/components/board/BoardSkeleton.tsx` is the worked example
(others live in `TaskRowList.tsx`, `ReportCard.tsx`, `TaskDataTable.tsx`).

## 2. Token architecture — `apps/web/src/index.css`

### 2.1 Tailwind v4 is CSS-first

**There is no `tailwind.config.js`, and there is no `components.json`.** The
whole configuration surface is `apps/web/src/index.css` plus the
`@tailwindcss/vite` plugin. Two consequences the agent must internalise:

- **Never run the shadcn CLI.** `shadcn add` reads `components.json` and a JS
  config to learn the token names. Neither exists, so it rewrites styles it does
  not understand and reintroduces upstream colour names that no longer resolve.
  Primitives are copied by hand — see §8.
- A token is added in **three** places or nowhere: `theme.schema.ts` (the
  contract), `theme-tokens.ts` (`COLOR_VARS` + the default), and `index.css` (the
  pre-paint default). `theme-presets.test.ts` asserts the groups cover the schema.

### 2.2 Layer order

The file is five blocks and the order is load-bearing:

| #   | Block                                        | Why it is where it is                                                                                                                                                                                                                                 |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `@import 'tailwindcss'` / `'tw-animate-css'` | Tailwind's own layers first.                                                                                                                                                                                                                          |
| 2   | `@custom-variant dark (&:is(.dark *))`       | Dark is a **class**, not `prefers-color-scheme`: the stored preference must beat the OS, and `applyTheme()` needs a synchronous pre-paint switch.                                                                                                     |
| 3   | `:root`                                      | The complete **light** palette plus every shared dimension. This is what the first paint uses before a line of JS runs.                                                                                                                               |
| 4   | `.dark`                                      | The complete **dark** palette. Colour tokens only — dimensions, fonts and `--speed` are mode-independent; `--shadow-1`/`--shadow-2` are the exception and are redeclared.                                                                             |
| 5   | `@theme inline`                              | Republishes tokens as Tailwind utilities. `inline` (not plain `@theme`) is **required**: the values reference custom properties that `applyTheme()` rewrites, and a plain `@theme` would snapshot them at build time and make the Theme Studio inert. |

Then `@layer base` (typography, focus ring, Arabic overrides, scrollbars) and
`@layer components` (`.fb-card`, `.fb-auth-bg`, `.fb-grid-overlay`).

The stylesheet values are the **byte-for-byte twins** of `DEFAULT_THEME` in
`apps/web/src/components/theme/theme-tokens.ts`. Change one without the other and
the pre-paint frame differs from the post-mount one, which a user reads as a flash.

### 2.3 The raw colour tokens (Default preset)

Twenty-two per mode, authored in **OKLCH** — perceptually uniform, so one
lightness step looks like the same step at every hue, which is what keeps the
light and dark ramps of eight presets consistent. This is the whole catalogue:
the `Key` column is the `themeColorTokensSchema` field (§3.2), and `COLOR_VARS`
in `theme-tokens.ts` is the mapping table that joins the two.

| Key             | CSS var            | Light                      | Dark                     | Controls                                                  |
| --------------- | ------------------ | -------------------------- | ------------------------ | --------------------------------------------------------- |
| `primary`       | `--primary`        | `oklch(0.524 0.187 276.2)` | `oklch(0.662 0.166 278)` | The single accent: buttons, focus ring, links             |
| `primaryFg`     | `--primary-fg`     | `oklch(0.99 0 0)`          | `oklch(0.16 0.028 278)`  | Foreground **on** `--primary` (a pair)                    |
| `secondary`     | `--secondary`      | `oklch(0.958 0.004 275)`   | `oklch(0.248 0.009 275)` | Quiet fill; bridges to shadcn `--muted`                   |
| `accent`        | `--accent`         | `oklch(0.585 0.126 232)`   | `oklch(0.742 0.116 220)` | Secondary hue — the auth-page wash only                   |
| `bg`            | `--bg`             | `oklch(0.985 0.002 275)`   | `oklch(0.163 0.007 275)` | Page ground                                               |
| `surface`       | `--surface`        | `oklch(1 0 0)`             | `oklch(0.193 0.008 275)` | Cards, panels                                             |
| `surfaceRaised` | `--surface-raised` | `oklch(0.972 0.003 275)`   | `oklch(0.229 0.009 275)` | Popovers, dialogs, the drag overlay                       |
| `border`        | `--border`         | `oklch(0.914 0.005 275)`   | `oklch(0.281 0.009 275)` | Every hairline, and the scrollbar thumb                   |
| `text`          | `--text`           | `oklch(0.215 0.014 275)`   | `oklch(0.934 0.004 275)` | Body text                                                 |
| `textMuted`     | `--text-muted`     | `oklch(0.545 0.014 275)`   | `oklch(0.652 0.012 275)` | Secondary text, axis ticks, chart guides                  |
| `success`       | `--success`        | `oklch(0.588 0.136 150)`   | `oklch(0.742 0.152 152)` | Semantic green — same meaning in every preset             |
| `warning`       | `--warning`        | `oklch(0.702 0.152 74)`    | `oklch(0.812 0.146 79)`  | Semantic amber                                            |
| `danger`        | `--danger`         | `oklch(0.577 0.211 26)`    | `oklch(0.681 0.184 24)`  | Semantic red; bridges to `--destructive`                  |
| `info`          | `--info`           | `oklch(0.598 0.132 240)`   | `oklch(0.732 0.121 236)` | Semantic blue                                             |
| `sidebarBg`     | `--sidebar-bg`     | `oklch(0.968 0.003 275)`   | `oklch(0.147 0.007 275)` | Sidebar ground                                            |
| `sidebarActive` | `--sidebar-active` | `oklch(0.928 0.024 276)`   | `oklch(0.264 0.031 278)` | Active nav row — **also** the shadcn hover surface (§2.5) |
| `topbar`        | `--topbar`         | `oklch(1 0 0)`             | `oklch(0.163 0.007 275)` | Topbar ground                                             |
| `chart1`        | `--chart-1`        | `oklch(0.524 0.187 276.2)` | `oklch(0.662 0.166 278)` | Chart role `primary` (§6)                                 |
| `chart2`        | `--chart-2`        | `oklch(0.598 0.132 240)`   | `oklch(0.732 0.121 236)` | Chart role `delivered`                                    |
| `chart3`        | `--chart-3`        | `oklch(0.702 0.152 74)`    | `oklch(0.812 0.146 79)`  | Chart role `warning`                                      |
| `chart4`        | `--chart-4`        | `oklch(0.588 0.136 150)`   | `oklch(0.742 0.152 152)` | Chart role `planned`                                      |
| `chart5`        | `--chart-5`        | `oklch(0.577 0.185 12)`    | `oklch(0.702 0.164 8)`   | Chart role `quiet`                                        |

**The semantic four never change hue across presets.** `theme-presets.ts` keeps
`success`/`warning`/`danger`/`info` green/amber/red/blue in all eight, because
they encode meaning — a "Rose" preset whose success state is pink is a preset
that lies.

### 2.4 The shared (mode-independent) tokens

Twenty-three schema fields (§3.3) plus the two shadow vars, which `applyTheme()`
derives rather than reads. `Key` is the `sharedThemeTokensSchema` field; `Range`
is the zod constraint, and a slider outside it is a rejected import.

| Key           | CSS var          | Default                                                                 | Range       | Controls                                               |
| ------------- | ---------------- | ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------ |
| `fontBody`    | `--font-body`    | `'Inter', 'IBM Plex Sans Arabic', ui-sans-serif, system-ui, sans-serif` | ≤ 200 ch    | `html`/`body` face                                     |
| `fontHead`    | `--font-head`    | same as body                                                            | ≤ 200 ch    | `h1`–`h6`                                              |
| `fontMono`    | `--font-mono`    | `'JetBrains Mono', 'IBM Plex Sans Arabic', ui-monospace, monospace`     | ≤ 200 ch    | `code`, `pre`, `kbd`, `samp`, task keys                |
| `hWeight`     | `--h-weight`     | `600`                                                                   | int 100–900 | Heading weight                                         |
| `fsBase`      | `--fs-base`      | `13.5px`                                                                | 10–20       | `body` font size                                       |
| `lh`          | `--lh`           | `1.5`                                                                   | 1–2.5       | `body` line height                                     |
| `ls`          | `--ls`           | `-0.006em`                                                              | −0.05–0.1   | `body` letter spacing — **em**, so it scales with size |
| `radius`      | `--radius`       | `6px`                                                                   | 0–24        | Generic corner; base for `--radius-sm/md`              |
| `cardRadius`  | `--card-radius`  | `8px`                                                                   | 0–28        | `.fb-card`, `ui/card.tsx`; base for `--radius-lg/xl`   |
| `btnRadius`   | `--btn-radius`   | `6px`                                                                   | 0–24        | Buttons, and the `:focus-visible` outline radius       |
| `inputRadius` | `--input-radius` | `6px`                                                                   | 0–24        | Text controls                                          |
| `sidebarW`    | `--sidebar-w`    | `232px`                                                                 | 160–400     | Expanded sidebar                                       |
| `sidebarWc`   | `--sidebar-wc`   | `56px`                                                                  | 40–120      | Collapsed sidebar                                      |
| `topbarH`     | `--topbar-h`     | `48px`                                                                  | 36–80       | Topbar height                                          |
| `contentMax`  | `--content-max`  | `1600px`                                                                | 800–2400    | Reading-column cap                                     |
| `pagePad`     | `--page-pad`     | `20px`                                                                  | 0–64        | Page gutter — **density-scaled**                       |
| `cardPad`     | `--card-pad`     | `16px`                                                                  | 0–48        | `.fb-card` padding — **density-scaled**                |
| `gap`         | `--gap`          | `12px`                                                                  | 0–48        | Grid/flex gap — **density-scaled**                     |
| `rowPad`      | `--row-pad`      | `8px`                                                                   | 0–32        | List/table row padding — **density-scaled**            |
| `shadowLevel` | _(indexes)_      | `1`                                                                     | int 0–3     | Picks `--shadow-1`/`--shadow-2` from the ramp          |
| `speed`       | `--speed`        | `130ms`                                                                 | int 0–600   | Every chrome transition                                |
| `density`     | _(none)_         | `comfortable`                                                           | enum        | The spacing multiplier (§5) — no DOM attribute         |
| `chartStyle`  | _(none)_         | `filled`                                                                | enum        | Read by `fillOpacityFor` — see §6.4                    |
| —             | `--shadow-1`     | `0 1px 2px 0 oklch(0 0 0 / 0.05)` (light)                               | derived     | Resting elevation; separate dark ramp                  |
| —             | `--shadow-2`     | `0 8px 24px -8px oklch(0 0 0 / 0.14)` (light)                           | derived     | Overlay elevation; separate dark ramp                  |

The Arabic fallback `'IBM Plex Sans Arabic'` is interposed **after** each Latin
family and before the generic keyword, in every stack, because font matching is
per glyph: Latin keeps resolving from Inter/JetBrains Mono and only the Arabic
characters — which neither covers — fall through. See [i18n.md](./i18n.md).

### 2.5 The shadcn variable bridge

The hand-copied primitives keep their upstream variable names (`bg-background`,
`text-muted-foreground`, `border-input`) but **every one resolves to a FlowBoard
token**. That indirection is exactly what makes a Theme Studio preset restyle the
primitives for free: no primitive ever names a colour of its own.

| shadcn var                     | → FlowBoard token      | Note                                                          |
| ------------------------------ | ---------------------- | ------------------------------------------------------------- |
| `--background`                 | `--bg`                 |                                                               |
| `--foreground`                 | `--text`               |                                                               |
| `--card` / `--card-foreground` | `--surface` / `--text` |                                                               |
| `--popover`                    | `--surface-raised`     | One step above `--card`, on purpose                           |
| `--popover-foreground`         | `--text`               |                                                               |
| `--primary`                    | _(shared name)_        | Same name, same meaning in both systems — not re-aliased      |
| `--primary-foreground`         | `--primary-fg`         |                                                               |
| `--secondary-foreground`       | `--text`               |                                                               |
| `--muted`                      | `--secondary`          | shadcn "muted" is a **background**; FlowBoard's muted is text |
| `--muted-foreground`           | `--text-muted`         |                                                               |
| `--accent-foreground`          | `--text`               |                                                               |
| `--destructive`                | `--danger`             |                                                               |
| `--destructive-foreground`     | `--primary-fg`         |                                                               |
| `--input`                      | `--border`             |                                                               |
| `--ring`                       | `--primary`            |                                                               |
| `--sidebar`                    | `--sidebar-bg`         |                                                               |
| `--sidebar-foreground`         | `--text`               |                                                               |
| `--sidebar-primary`            | `--primary`            |                                                               |
| `--sidebar-primary-foreground` | `--primary-fg`         |                                                               |
| `--sidebar-accent`             | `--sidebar-active`     |                                                               |
| `--sidebar-accent-foreground`  | `--text`               |                                                               |
| `--sidebar-border`             | `--border`             |                                                               |
| `--sidebar-ring`               | `--primary`            |                                                               |

**The one name collision to remember:** shadcn's `accent` means the _hover
surface_, not a hue. `@theme inline` therefore maps `--color-accent` to
`--sidebar-active`, and FlowBoard's own `--accent` hue is published separately as
`--color-brand-accent` (`bg-brand-accent`). Do not "fix" this by pointing
`--color-accent` at `--accent`; every shadcn primitive's hover state would become
a saturated cyan.

### 2.6 What `@theme inline` publishes

- **Radii** → `rounded-sm` (`--radius` − 2px), `rounded-md` (`--radius`),
  `rounded-lg` (`--card-radius`), `rounded-xl` (`--card-radius` + 4px).
- **Fonts** → `font-sans` (`--font-body`), `font-serif` (`--font-head`),
  `font-mono` (`--font-mono`). Note `font-serif` is wired to the _heading_ stack,
  which matters for the `Source Serif 4` preset.
- **Colours** → every bridge var above as `--color-*`, so `bg-background`,
  `text-muted-foreground`, `border-input`, `ring-ring`, `bg-chart-1`…`bg-chart-5`,
  and the full `sidebar-*` family all work.
- **FlowBoard-only semantics** → `--color-surface`, `--color-surface-raised`,
  `--color-success`, `--color-warning`, `--color-danger`, `--color-info`,
  `--color-brand-accent`. These exist so `text-success` / `bg-danger` /
  `bg-surface-raised` work without an arbitrary `[var(--…)]` value.

**Prefer the published utility over `[var(--token)]`.** The arbitrary-value form
is correct only for tokens that are _not_ colours — `rounded-[var(--btn-radius)]`,
`gap-[var(--gap)]`, `duration-[var(--speed)]` — which is the pattern
`ui/badge.tsx` and `common/EmptyState.tsx` use.

### 2.7 The base and component layers

`@layer base` carries five things worth knowing: the `border-border` default on
`*`; `scrollbar-gutter: stable` on `html` (a dense board must not shift sideways
when a tall page appears); the `:focus-visible` ring; the `html[lang='ar'] body`
overrides (`letter-spacing: 0` and a `max()` line-height **floor** of 1.7 — see
[i18n.md](./i18n.md)); and thin token-driven scrollbars for both Firefox
(`scrollbar-color`) and Chromium (`::-webkit-scrollbar-*`).

`@layer components` carries exactly three recipes:

| Class              | What it is                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.fb-card`         | The one surface recipe — `--surface` + 1px `--border` + `--card-radius` + `--card-pad` + `--shadow-1`. `ui/card.tsx` renders the identical box, so the two are interchangeable. |
| `.fb-auth-bg`      | The login ground: two very wide, very faint radial `color-mix` washes of `--primary` and `--accent` over `--bg`. Token-driven, so it follows the Studio.                        |
| `.fb-grid-overlay` | A 56px hairline grid at low opacity over `.fb-auth-bg`, masked to a radial falloff — texture without shipping a noise bitmap.                                                   |

## 3. The theme document — `packages/shared/src/theme.schema.ts`

The document is **device-local** (localStorage), not a server resource, but it
still lives in `@flowboard/shared` because it crosses a boundary: the Studio's
import/export JSON. **Every read parses it with zod**, so a hand-edited or
version-skewed payload degrades to the default preset instead of taking the app
down at boot.

Two shapes of token, and the split is deliberate: **colours are strings** (the
palette is OKLCH; a hex-only token would have forced everything into sRGB), and
**dimensions are numbers** (the sliders bind to them, and `applyTheme()`
multiplies the spacing ones by the density factor — the unit is serialized at the
one place that writes the custom property).

### 3.1 `themeColorSchema`

`z.string().min(3).max(64)` plus a regex accepting a hex (`#rgb`, `#rgba`,
`#rrggbb`, `#rrggbbaa`) or a CSS colour function (`oklch`, `oklab`, `lch`, `lab`,
`rgb`, `rgba`, `hsl`, `hsla`, `color`). **The character class is the security
guard, not a niceness check** — these strings go straight into
`element.style.setProperty()`, so `;`, `{` and `}` must never appear or a stored
theme could inject arbitrary declarations.

### 3.2 `themeColorTokensSchema` — the 22 keys

The keys, their CSS vars and their default values are catalogued in §2.3. Light
and dark each supply a **complete** set — there is no inheritance between them,
because a token that falls back to the other mode is exactly how a half-finished
dark theme ships.

The Studio's editor renders them **by role, not alphabetically** (someone editing
a theme thinks "the surfaces are too warm", never "I need the token starting with
S"), via `TOKEN_GROUPS` in `theme-presets.ts`:

| `TokenGroupKey` | Tokens                                                  |
| --------------- | ------------------------------------------------------- |
| `surfaces`      | `bg`, `surface`, `surfaceRaised`, `border`, `secondary` |
| `text`          | `text`, `textMuted`                                     |
| `accent`        | `primary`, `primaryFg`, `accent`                        |
| `semantic`      | `success`, `warning`, `danger`, `info`                  |
| `sidebar`       | `sidebarBg`, `sidebarActive`, `topbar`                  |
| `charts`        | `chart1`–`chart5`                                       |

Every token appears exactly once, and `theme-presets.test.ts` asserts the groups
cover the schema — a token added to the contract and forgotten in `TOKEN_GROUPS`
would silently become uneditable.

### 3.3 `sharedThemeTokensSchema` — 23 mode-independent keys

Catalogued with their defaults, ranges and CSS vars in §2.4. The shape does not
change with light/dark, so it is declared once. Three constraints are worth
restating because they are the ones an editor gets wrong:

- **Dimensions are numbers, not CSS strings** (`radius: 6`, not `'6px'`). The
  Studio's sliders bind to them and `applyTheme()` multiplies the spacing ones by
  the density factor; the unit is serialized at the single site that writes the
  custom property.
- **`ls` is in em, not px** — letter spacing must scale with the font size.
- **Fonts are full CSS stacks**, because the Arabic fallback has to be interposed
  _inside_ each one (§2.4).

### 3.4 Document, presets, mode — and versioning

`themeDocumentSchema` is `{ light, dark, shared, themePreset?, fontPreset? }`.
**There is no `version` field on the document.** Versioning is carried by the
storage key itself (`fb-theme-v1`), and a payload from an older schema simply
fails `safeParse` and falls back to `DEFAULT_THEME` — see
`apps/web/src/components/theme/theme-storage.ts`.

`themePresetSchema` = the eight gallery names plus `'Imported'`.
`fontPresetSchema` = the eight font families plus `'Imported'`. **Both are labels,
never pointers.** Tokens always resolve from the document's own `light`/`dark`/
`shared` blocks; the field only tells the gallery which card to mark active, and
`matchColorPreset()` recomputes that _structurally_ by comparing all 44 colours.
Apply Ocean, hand-edit one token, and the document still says `'Ocean'` while the
gallery correctly highlights nothing.

`themeModeSchema` = `'light' | 'dark'`. **There is deliberately no `system`
member** — FlowBoard is dark-first, so an unconfigured visitor gets dark
regardless of their OS.

## 4. The Theme Studio

Route `/theme`, `apps/web/src/pages/ThemePage.tsx`. Three tabs (`colors`,
`typography`, `layout`) plus a persistent `ThemePreview` column that is styled
with ordinary tokens and therefore cannot drift from the real app.

### 4.1 `applyTheme()`

Lives in `apps/web/src/components/theme/theme-tokens.ts` (it touches the DOM, so
it cannot live in `@flowboard/shared`). It:

1. writes all 22 colours as inline custom properties on `document.documentElement`
   via `COLOR_VARS`;
2. writes the shared tokens, serializing units (`px`, `em`, `ms`) and multiplying
   the four spacing tokens by `DENSITY_SCALE[density]`;
3. picks `--shadow-1`/`--shadow-2` from `SHADOWS_LIGHT` or `SHADOWS_DARK` by the
   clamped `shadowLevel`;
4. toggles the `.dark` class the `@custom-variant` keys off;
5. sets `root.style.colorScheme` — which is what makes native form controls, the
   caret and the OS scrollbar chrome match the palette.

It does **not** stamp `data-density`; that step was removed in WP5.6. See §5.

**Inline style beats the stylesheet**, so `applyTheme()` always wins over
`index.css` — the stylesheet is only the pre-JS default. It only ever _sets_
properties, never removes them, so it is safe to call on every keystroke and
there is no intermediate frame with a token missing.

### 4.2 Pre-mount application — no flash

`apps/web/src/stores/useThemeStore.ts` reads localStorage at **module scope** and
calls `applyTheme(initialTheme, initialDark)` at the bottom of the file (guarded
on `typeof document`, so node unit suites can still import it). `main.tsx`
therefore does nothing but a side-effect import:

```ts
import '@/index.css';
import '@/stores/useThemeStore';
```

**That import sits above every component import on purpose — import order is
evaluation order**, and anything imported earlier would render against the
stylesheet defaults. No effect, no first-render flash.

### 4.3 Colour presets

`COLOR_PRESETS` in `apps/web/src/components/theme/theme-presets.ts`, in gallery
order (Default first — it is the way back):

| #   | `name`          | `labelKey`     |
| --- | --------------- | -------------- |
| 1   | `Default`       | `default`      |
| 2   | `Graphite`      | `graphite`     |
| 3   | `Ocean`         | `ocean`        |
| 4   | `Forest`        | `forest`       |
| 5   | `Sunset`        | `sunset`       |
| 6   | `Rose`          | `rose`         |
| 7   | `Amber`         | `amber`        |
| 8   | `High Contrast` | `highContrast` |

Each is a **complete 22-token light _and_ dark set** built from one recipe: a
neutral ramp at fixed lightness steps carrying a trace of the preset hue; `text`/
`textMuted` at fixed lightness (which is why the contrast floors hold at every
hue — a hue rotation in OKLCH does not move lightness, and that is the whole
reason the palette is not authored in HSL); `primaryFg` picked as whichever end
of the ramp clears 4.5:1 on `primary` (Amber's is near-black, not white); and
`chart1`–`chart5` as five _distinguishable_ hues, not five shades of the primary.
Names are **stable English IDs**; display text comes from `theme:presets.<key>`.

`applyPreset(name)` swaps both palettes and records the name. **Shared tokens are
untouched** — changing palette must not reset someone's radius or density choice.

### 4.4 Font presets

`FONT_PRESETS`, eight entries, each patching only
`FontPatch = { fontBody, fontHead, fontMono, hWeight }` — deliberately _not_
`fsBase`/`lh`/`ls`, which are the Typography tab's own controls.

| `name`           | Shape | `hWeight` | `bundled` |
| ---------------- | ----- | --------- | --------- |
| `Inter`          | sans  | 600       | `true`    |
| `IBM Plex Sans`  | sans  | 600       | `true`    |
| `Manrope`        | sans  | 700       | `true`    |
| `DM Sans`        | sans  | 600       | `true`    |
| `Space Grotesk`  | sans  | 600       | `true`    |
| `Source Serif 4` | serif | 600       | `true`    |
| `JetBrains Mono` | mono  | 600       | `true`    |
| `IBM Plex Mono`  | mono  | 600       | `true`    |

Every stack is built by the `sans` / `serif` / `mono` helpers, which interpose
the `AR` constant (`'IBM Plex Sans Arabic'`) immediately after the Latin family
and before the generic keyword. Non-mono presets share `MONO_STACK` for code.

**`bundled` is a contract with `apps/web/index.html`, not decoration.** It claims
the family is named in that file's single Google Fonts `css2` request. All eight
are `true` today; five were `false` when WP4.5 shipped — declared but never
fetched, so the card did nothing on a machine without the family installed.
`TypographyPanel` renders a warning off the flag. **Adding a ninth preset means
editing `index.html` first**, and it starts `false` until you do.

### 4.5 The OKLCH utility — `apps/web/src/components/theme/color.ts`

About sixty lines of pure arithmetic, no dependency (`culori` is not in this
workspace). It exists because the document is OKLCH but `<input type="color">`
speaks **only** `#rrggbb`, so `TokenEditor.tsx` needs both directions.

| Export                                  | Purpose                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `oklchToRgb(Oklch)` / `rgbToOklch(Rgb)` | The Ottosson OKLab ⇄ linear-sRGB matrices + transfer function                                       |
| `parseOklch` / `parseHex`               | String → struct; accepts `%`, `none`, and drops any `/ alpha`                                       |
| `colorToRgb` / `colorToHex`             | Any _understood_ token → sRGB / `#rrggbb`, else `null`                                              |
| `formatOklch` / `hexToOklchString`      | Struct/hex → the canonical `oklch(l c h)` the document stores                                       |
| `relativeLuminance` / `contrastRatio`   | WCAG 2.1, used by `theme-presets.test.ts` to hold every preset to an AA-ish floor in **both** modes |

Two behaviours worth knowing. **Out-of-gamut colours lose chroma, not hue**: the
chroma is bisected to the gamut boundary at constant lightness and hue (16
iterations), because a naive per-channel clamp shifts hue and would make the
Studio's swatch disagree with what the browser paints from the same string.
And `colorToHex` returns `null` for the forms the schema allows but the Studio
never writes (`rgb()`, `hsl()`, `lab()`, `color()`) — a hand-imported theme may
carry one, and the caller's job is to keep showing the raw text, not to guess.

**`color.ts` contains no colour literals.** The numbers in it are published
transfer matrices — maths, not palette.

### 4.6 Import / export

- **Export** — `exportTheme()` returns `JSON.stringify(theme, null, 2)` (two
  spaces, because a theme file is something people read and hand-edit).
  `downloadJson()` in `theme-file.ts` hands it over as a **blob URL**, not a
  `data:` href (`data:` is size-capped and blocked as a top-level navigation in
  some browsers), revoked immediately after the click. Filename is dated:
  `flowboard-theme-YYYY-MM-DD.json`.
- **Import** — `importTheme(json)` **never throws**. It returns
  `{ ok: false, error: 'json' }` for unparseable text and `'schema'` for anything
  that parses but is not a theme document, as a **code rather than a message**:
  the store is not the place that knows which language the reader speaks. A
  successful import is stamped `themePreset: 'Imported'` and applied live.

Persistence is **explicit**: `save()` is the only thing that writes localStorage,
because colour pickers fire continuously while dragging. Every other mutation
applies live app-wide, which is why the page carries `dirty`, an unsaved badge, a
`useBlocker` leave guard and a `beforeunload` handler rather than a Cancel button
— what you are looking at _is_ the change.

### 4.7 The live favicon

`apps/web/src/components/theme/favicon-updater.ts`. `index.html` ships no icon,
and a static one could not tell the truth: eight presets × two modes is sixteen
`--primary` values, and the tab is often the only part of FlowBoard visible.

`buildFaviconSvg()` draws a 64×64 rounded tile in `primary` with an `F` in
`primaryFg` — the geometric twin of `common/BrandMark.tsx`. The letter is three
rounded `<rect>`s, **not `<text>`**: an SVG favicon is rasterised without the
page's font stack. Colours are converted to hex via `colorToHex` because
`oklch()` inside an SVG data-URI is much newer than SVG favicons themselves.
`buildFaviconDataUri()` uses `encodeURIComponent`, **not base64** — an unencoded
`#` inside a data URI starts a fragment and truncates the SVG at the first fill.

`initFaviconUpdater()` is called from `main.tsx` _after_ the store's side-effect
import, never at module scope: importing a module must not mutate `<head>`. It is
idempotent (a module-level `initialized` guard, for StrictMode and HMR) and
subscribes to the store for the life of the tab.

### 4.8 Storage keys

| Key           | Constant            | Holds                                                 |
| ------------- | ------------------- | ----------------------------------------------------- |
| `fb-theme-v1` | `THEME_STORAGE_KEY` | The whole theme document, zod-validated on every read |
| `fb-dark-v1`  | `DARK_STORAGE_KEY`  | `'1'` / `'0'` — which palette is active               |

They are **separate on purpose**: a document holds both palettes, so the active
mode is a property of the viewer, not of the theme, and switching preset must not
reset the mode. Every access in `theme-storage.ts` is wrapped in `try/catch`,
because this module runs at boot before React exists — an exception here is a
blank page, not a caught render error.

## 5. Density and dimensions

`DENSITY_SCALE` in `theme-tokens.ts` is `{ comfortable: 1, compact: 0.72 }`, and
it is applied to **the four spacing tokens only** — `--page-pad`, `--card-pad`,
`--gap`, `--row-pad`.

**Font size, radii and the sidebar width are deliberately untouched by density.**
Shrinking type hurts legibility and shrinking radii changes the visual language;
shrinking padding and gaps is exactly what "fit more rows on screen" means.

**There is no `data-density` attribute.** `applyTheme()` used to stamp one on
`<html>` and nothing ever read it: the density effect travels entirely through
the multiplied spacing tokens, so the attribute was a second, mute representation
of a fact the tokens already carried — the kind of hook that gets styled against
years later and then silently disagrees with the real mechanism. WP5.6 removed
it. If a rule genuinely needs to branch on density, add the attribute back
deliberately and document what reads it; do not assume it is there.

The Layout tab (`LAYOUT_GROUPS`) exposes dimensions as **word-labelled segmented
options, never raw px**, and one option may patch several tokens because "corners"
is one decision to a reader and four radii to the token layer:

| Group        | Options                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `radius`     | `square` (0/0/0/0) · `subtle` (6/8/6/6) · `rounded` (10/14/10/10) · `pill` (14/20/24/14) |
| `density`    | `comfortable` · `compact`                                                                |
| `spacing`    | `cozy` (14/12/8/6) · `comfortable` (20/16/12/8) · `spacious` (28/22/18/11)               |
| `sidebar`    | `narrow` (208/52) · `default` (232/56) · `wide` (272/64)                                 |
| `content`    | `boxed` (1200) · `wide` (1600) · `fluid` (2400 — the schema cap, not infinity)           |
| `shadow`     | `none` (0) · `soft` (1) · `medium` (2) · `bold` (3)                                      |
| `speed`      | `instant` (0ms) · `fast` (90) · `normal` (130) · `calm` (240)                            |
| `chartStyle` | `filled` · `line`                                                                        |

`TYPOGRAPHY_GROUPS` adds `fontSize` (12.5 / 13.5 / 15), `leading`
(1.35 / 1.5 / 1.65 / 1.8) and `tracking` (−0.014 / −0.006 / 0 / 0.012 em).
`isOptionActive()` lights an option only when **every** token it patches already
holds that value, which is why a hand-imported theme sitting between two presets
correctly shows nothing selected.

## 6. Charts

### 6.1 The five roles

`apps/web/src/components/reports/chart-theme.ts` names the slots **by role, not by
number**, so the six charts read as one system:

| Role        | Token       | Used for                                                                   |
| ----------- | ----------- | -------------------------------------------------------------------------- |
| `primary`   | `--chart-1` | Burndown remaining, CFD in-progress, cycle-time dots, workload open points |
| `delivered` | `--chart-2` | Burnup completed, CFD done, velocity completed — always "the fact"         |
| `warning`   | `--chart-3` | Reserved warning slot                                                      |
| `planned`   | `--chart-4` | Burnup scope, velocity committed — always "the plan", at low alpha         |
| `quiet`     | `--chart-5` | CFD to-do, the calm base of the stack                                      |

The pairing is the point: **"committed / scope" is always `--chart-4` and
"completed / done" is always `--chart-2`** on every chart that shows both, so a
reader learns the code once.

`CHART_CHROME` covers the furniture — `grid` and `axis` on `var(--border)`,
`text` and `guide` on `var(--text-muted)` (the dashed ideal line is furniture, not
data). Alongside them: `TICK_FONT_SIZE` (11), `AXIS_TICK`, `PLOT_MARGIN`
(`right: 28` sized for the longest **Arabic** date label, not English — see the
file's own note), `STROKE` (`data: 2`, `guide: 1.5`), `DASH`,
`PLANNED_FILL_OPACITY` (0.32) and `AREA_FILL_OPACITY` (0.55).

### 6.2 The rule

**Charts read `--chart-*` and the chrome tokens only — never a literal, and never
`getComputedStyle`.** Every value in `chart-theme.ts` is a `var(--…)` _string_
handed straight to an SVG attribute, which works because SVG presentation
attributes resolve custom properties exactly like CSS declarations. That is what
makes `stroke="var(--chart-1)"` follow the Theme Studio, both palettes and a live
preset swap **without the chart re-rendering**. Resolving the colours to hex with
`getComputedStyle` would break all three.

Consumers: `BurndownChart`, `BurnupChart`, `CumulativeFlowChart`,
`CycleTimeScatter`, `VelocityChart`, `WorkloadBars`, `ChartTooltip` in
`components/reports/`, plus `LatencyChart` and `RequestsChart` in
`components/admin/`.

Every plot is wrapped in `components/reports/ChartFrame.tsx`, which is an isolated
`dir="ltr"` island with `role="img"` and a summary sentence as its accessible
name. Recharts does not mirror; see §9 and [i18n.md](./i18n.md).

### 6.3 Task icons ride the same ramp — confirmed

`apps/web/src/components/common/task-icons.tsx` is the single definition of the
task-type and priority glyphs (it replaced six divergent copies). `TASK_TYPE_TONE`
maps the five types onto the chart ramp **as Tailwind tone classes**, not inline
`var()` strings:

| Type      | Glyph         | Tone class     | Priority  | Tone class              |
| --------- | ------------- | -------------- | --------- | ----------------------- |
| `epic`    | `Zap`         | `text-chart-1` | `highest` | `text-danger`           |
| `story`   | `Bookmark`    | `text-chart-4` | `high`    | `text-warning`          |
| `task`    | `SquareCheck` | `text-chart-2` | `medium`  | `text-muted-foreground` |
| `bug`     | `Bug`         | `text-chart-5` | `low`     | `text-info`             |
| `subtask` | `GitBranch`   | `text-chart-3` | `lowest`  | `text-muted-foreground` |

Those utilities exist because `@theme inline` publishes `--color-chart-1`…`-5`
(§2.6). **The coupling is real and intentional:** a preset's chart ramp restyles
every board card, backlog row, calendar chip and table cell in the app, not just
the reports dashboard — which is exactly why `theme-presets.ts` builds the ramp
as five _distinguishable_ hues rather than five shades of the primary. Changing a
`--chart-*` value is never a "reports-only" change.

Priorities take the semantic tokens instead, because they are a severity scale,
not a categorical one.

### 6.4 `chartStyle` — how a chart honours it

`shared.chartStyle` (`filled` | `line`) is in the schema, offered by the Layout
tab's `chartStyle` group, and exposed through `useThemeStore`'s `chartStyle()`
getter. Until WP5.6 **nothing read it** — the Theme Studio's Chart-style switch
was a control that wrote a token, persisted it, exported it in a theme file, and
changed nothing on screen.

It is now consumed by `fillOpacityFor(chartStyle, opacity)` in
`apps/web/src/components/reports/chart-theme.ts`, which
`CumulativeFlowChart.tsx` applies to its area fills — the dashboard's only
filled chart. `line` zeroes the FILL and leaves the stroke, turning a stacked
band into a cumulative line.

**Expressing it as an opacity, rather than swapping in a different chart
component, is the load-bearing decision.** The axes, the stack order, the
tooltip and the legend are all unchanged, so flipping the switch cannot move the
data — a theme setting must never be able to change what a report says. Any new
filled chart should read the token the same way.

## 7. The hex-literal exemption list

**Never write a hex literal, an `oklch()` literal, or any raw colour in a
component** — it cannot follow the Theme Studio or the light/dark switch. The
following is the complete set of files under `apps/web/src` (excluding tests) that
legitimately contain a `#rrggbb`-shaped string, and why each is exempt. Anything
outside this table is a review failure.

| File                                            | Hits | Why it is exempt                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/index.css`                        | 1    | The token layer itself. The single match is prose in a comment (`pure #fff/#000`) — the actual palette is OKLCH.                                                                                                                                                                                                                               |
| `apps/web/src/lib/label-colors.ts`              | 12   | **Data, not palette.** The ten `LABEL_COLORS` swatches (reused as `STATUS_COLORS`) plus `DEFAULT_LABEL_COLOR` / `DEFAULT_STATUS_COLOR`. A label colour is persisted in `labels.color`, validated by `hexColor` in `@flowboard/shared` (`#rgb`/`#rrggbb`, not a CSS function), and must mean the same thing in both themes and in a CSV export. |
| `apps/web/src/components/theme/TokenEditor.tsx` | 2    | One is a comment (`"#4f4"`); one is `value={hex ?? '#000000'}` — `<input type="color">` requires _some_ value, and a colour the picker cannot represent (an imported `lab()`) still has to render. The adjacent swatch shows the truth.                                                                                                        |
| `apps/web/src/locales/en/theme.ts`              | 1    | `#4f46e5` as the worked example inside the "not a colour" validation message.                                                                                                                                                                                                                                                                  |
| `apps/web/src/locales/ar/theme.ts`              | 1    | The Arabic twin of the same message.                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/locales/en/validation.ts`         | 1    | `#4f46e5` as the example in `hexColorInvalid`.                                                                                                                                                                                                                                                                                                 |
| `apps/web/src/locales/ar/validation.ts`         | 1    | The Arabic twin.                                                                                                                                                                                                                                                                                                                               |
| `*.test.ts` / `*.test.tsx` / `__tests__/*`      | —    | Fixtures and assertions. 18 files, led by `components/theme/color.test.ts` (which asserts the hex ⇄ OKLCH round trip). Tests are not shipped styling.                                                                                                                                                                                          |

Outside `apps/web/src`, `packages/shared/src/common.ts` defines the `hexColor`
schema and `packages/shared/src/theme.schema.ts` carries `#4f46e5` in the
`themeColorSchema` error message. Both are contract text, not palette.

**Two corrections to the record.** The checklist's exemption is usually quoted as
"`index.css` and the theme presets", and both `theme-presets.ts` and `color.ts`
carry comments claiming it. In shipped code **neither file contains a single hex
literal**: all eight presets are authored in `oklch()`, and `color.ts` holds
transfer matrices. `theme-presets.ts` is still the only place a _colour value_ is
hand-written, so the spirit of the exemption stands — but a reviewer grepping for
`#` will not find it there.

Two related patterns are **not** violations, and both say so in their own headers:

- `common/LabelDot.tsx` and `common/ColorSwatchPicker.tsx` set
  `style={{ backgroundColor: … }}` from a value the _user_ picked. It is data,
  unknowable at build time, and can only arrive as an inline style. `LabelChip`
  tints with `color-mix(in oklab, …)` rather than an alpha hex, so the tint stays
  in the palette's colour space.
- `common/BrandMark.tsx` is inline SVG filled with `var(--primary)` /
  `var(--primary-fg)` rather than a shipped `.svg`, precisely so it _can_ follow
  a token `applyTheme()` rewrote a moment ago.

## 8. shadcn primitives — `apps/web/src/components/ui/`

### 8.1 Inventory (26 files)

`avatar` · `badge` · `button` · `calendar` · `card` · `checkbox` · `command` ·
`dialog` · `drawer` · `dropdown-menu` · `form` · `input` · `label` · `popover` ·
`radio-group` · `scroll-area` · `select` · `separator` · `sheet` · `skeleton` ·
`sonner` · `switch` · `table` · `tabs` · `textarea` · `tooltip`

### 8.2 The rules

**Every Radix import comes from the unified `radix-ui` package** — one dependency
(`radix-ui@^1.6.7`), never `@radix-ui/react-*`. The house import style is a
namespace alias:

```ts
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Select as SelectPrimitive } from 'radix-ui';
import { Slot } from 'radix-ui';
```

Four primitives are not Radix-backed and that is deliberate: `command` is
hand-built because `cmdk` is not in the dependency set; `drawer` is built on the
same Radix **Dialog** rather than `vaul`, so Escape, scrim click, focus trapping
and `aria-modal` come free; `calendar` wraps `react-day-picker` (with `arSA` from
`date-fns/locale`); `sonner` wraps the `sonner` toaster.

**The folder is frozen.** Only integration agents modify it. A parallel view agent
that "improves" `Button` breaks six other views that were written against the old
one — which is the exact failure the freeze exists to prevent. If a view needs a
variant that does not exist, raise it; do not edit the primitive.

**No primitive names a colour of its own.** They use the bridged shadcn utilities
(`bg-background`, `text-muted-foreground`, `border-input`, `ring-ring`) and
arbitrary values only for non-colour tokens (`rounded-[var(--radius)]`,
`duration-[var(--speed)]`). `ui/badge.tsx` is the reference for a FlowBoard
addition done correctly: five `soft-*` variants that tint the background at low
alpha (`bg-success/12`) and keep the hue at full strength for the text — the
Linear treatment for status chips, since a solid fill at badge size is too loud on
a dense board.

### 8.3 The copy-by-hand recipe

1. Read the upstream primitive from the shadcn docs. **Do not run the CLI.**
2. Create `apps/web/src/components/ui/<name>.tsx` with LF endings.
3. Rewrite imports: `@radix-ui/react-<x>` → `import { X as XPrimitive } from 'radix-ui'`;
   `@/lib/utils` stays.
4. Delete every colour that is not a bridged utility. Replace hard-coded radii and
   durations with `rounded-[var(--radius)]` / `duration-[var(--speed)]`.
5. Keep `data-slot="<name>"` on the root — tests and `@layer components` select on it.
6. Route any user-facing string (a close button's label, a `sr-only` heading)
   through `useTranslation`, as `ui/dialog.tsx` does.
7. Replace physical spacing utilities with logical ones (§9).
8. Verify in **both** modes and in Arabic before you call it done.

## 9. RTL

One rule, and [i18n.md](./i18n.md) has the full treatment — do not duplicate it
here.

**Use logical Tailwind utilities only: `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`.
Never `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`.** A physical utility is a layout
that can never mirror, and FlowBoard ships Arabic with full RTL.

Radix primitives sit under a `Direction.Provider` in
`apps/web/src/AppProviders.tsx` (`dir={lang === 'ar' ? 'rtl' : 'ltr'}`), taken
from the same unified `radix-ui` package. It is **not** redundant with
`<html dir>`: Radix reads direction from its own context for keyboard navigation
and side-aware positioning.

The sanctioned exception is the **LTR island** — Recharts plots
(`components/reports/ChartFrame.tsx`) and the Gantt time axis, which compute pixel
positions from a left origin and cannot mirror. Everything _around_ the plot flips
normally; only the coordinate space stays LTR.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
