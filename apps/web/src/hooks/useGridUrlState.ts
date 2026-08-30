import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Grid state ⇄ URL query params, in one hook.
 *
 * ═══ WHY ═════════════════════════════════════════════════════════════════
 *
 * A filtered grid that cannot be linked or reloaded is a grid an admin has to
 * rebuild from memory every time they follow a link out of it. So filters, sort
 * and paging live in the query string — and **column visibility, column order
 * and density deliberately do not**. Those three are a momentary investigative
 * posture, not a query; serializing them would put a table layout in every
 * pasted link and resurrect the persistence story `DataTable` chose not to
 * have.
 *
 * ═══ THE FIVE RULES EVERY GRID SHARES ════════════════════════════════════
 *
 * 1. **A param at its default is omitted.** The bare URL IS the default state,
 *    so `/admin/orgs` and `/admin/orgs?page=1&pageSize=20&sort=createdAt` mean
 *    the same thing, and only the short one is ever produced.
 * 2. **Invalid values are dropped silently, and the URL is rewritten
 *    canonically.** `?pageSize=25` (not in the server's whitelist) or
 *    `?sort=nonsense` hydrates the default rather than 422-ing the page.
 * 3. **A CLEARED enum serializes as PRESENT BUT EMPTY.** A grid whose default
 *    sort is `createdAt` needs a way to say "the user turned the sort off" that
 *    is not the same statement as "no sort param" — that is `?sort=`, which the
 *    request builder then drops so the server falls back to its own ordering.
 * 4. **Typing and paging `replace`; discrete choices `push`.** Debounced text
 *    would otherwise stack one history entry per keystroke, while a facet or a
 *    sort is exactly the step a user expects Back to walk.
 * 5. **Foreign params are preserved.** Only the keys named in `params` are ever
 *    written or removed, so a page's own `?tab=` survives every grid change.
 *
 * Hydration happens ONCE PER URL: on mount, and again whenever the query string
 * changes without this hook having written it (Back/Forward, or an in-app link
 * into a pre-filtered grid). `apply` is expected to set every field and fire a
 * SINGLE request.
 *
 * ═══ THE PURE HALF IS EXPORTED ═══════════════════════════════════════════
 *
 * `encodeGridParams` / `decodeGridParams` / `ownedSearch` / `shouldPush` are
 * the codec, and they are what the unit tests exercise: every bug in this area
 * has been about WHICH VALUES reach the URL, not about the effect wiring. They
 * are also DOM-free, so the suite runs in the default node environment.
 */

/** A value a grid param can carry. Arrays are comma-joined on the wire. */
export type GridUrlValue = string | string[] | number | undefined;

/** The flat record a page serializes to and hydrates from. */
export type GridUrlState = Record<string, GridUrlValue>;

/** One param's codec. See rule 3 for the `enum` + `clearable` combination. */
export type GridParamDef =
  | {
      kind: 'enum';
      values: readonly string[];
      default?: string;
      /** Allow the explicit "unset" state to round-trip as an empty value. */
      clearable?: boolean;
    }
  | { kind: 'int'; default: number; values?: readonly number[]; min?: number; max?: number }
  | { kind: 'text'; default?: string; maxLength?: number }
  | { kind: 'list'; values?: readonly string[] };

export type GridParamDefs<S extends GridUrlState> = { [K in keyof S & string]: GridParamDef };

export interface GridUrlCodec<S extends GridUrlState> {
  /** Param name → codec. The name IS the query key, usually the wire name. */
  params: GridParamDefs<S>;
  /**
   * Read the current grid state.
   *
   * **It must read the STORE (`useXStore.getState()`), not values destructured
   * in the component body.** Hydration below runs inside an effect, i.e. after
   * the render that mounted the hook — a closure over that render's values is
   * one commit stale, and the writer effect would answer a deep link by
   * flushing the pre-hydration state straight back over the URL it just read.
   */
  get: () => S;
  /** Adopt a parsed state — set every field, then fetch ONCE. */
  apply: (values: S) => void;
  /**
   * Params whose change deserves a history entry (facets, sort). Everything
   * else — typing, `page`, `pageSize` — replaces the current entry.
   */
  push?: readonly (keyof S & string)[];
}

/** Text params are capped so a pasted novel cannot become a query string. */
const TEXT_MAX = 200;

function encodeOne(def: GridParamDef, value: GridUrlValue): string | undefined {
  switch (def.kind) {
    case 'enum': {
      if (value === undefined || value === '') return def.clearable ? '' : undefined;
      const text = String(value);
      if (!def.values.includes(text)) return undefined;
      return text === def.default ? undefined : text;
    }
    case 'int': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num) || !Number.isInteger(num)) return undefined;
      if (def.values && !def.values.includes(num)) return undefined;
      if (def.min != null && num < def.min) return undefined;
      if (def.max != null && num > def.max) return undefined;
      return num === def.default ? undefined : String(num);
    }
    case 'text': {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text === '' || text === (def.default ?? '')) return undefined;
      return text.slice(0, def.maxLength ?? TEXT_MAX);
    }
    case 'list': {
      const values = def.values;
      const list = Array.isArray(value) ? value : value == null ? [] : [String(value)];
      const kept = values ? list.filter((entry) => values.includes(entry)) : list;
      return kept.length > 0 ? kept.join(',') : undefined;
    }
  }
}

function decodeOne(def: GridParamDef, raw: string | null): GridUrlValue {
  switch (def.kind) {
    case 'enum': {
      if (raw === null) return def.default;
      if (raw === '') return def.clearable ? undefined : def.default;
      return def.values.includes(raw) ? raw : def.default;
    }
    case 'int': {
      if (raw === null || !/^-?\d+$/.test(raw)) return def.default;
      const num = Number(raw);
      if (def.values && !def.values.includes(num)) return def.default;
      if (def.min != null && num < def.min) return def.default;
      if (def.max != null && num > def.max) return def.default;
      return num;
    }
    case 'text': {
      if (raw === null) return def.default ?? '';
      const text = raw.trim().slice(0, def.maxLength ?? TEXT_MAX);
      return text === '' ? (def.default ?? '') : text;
    }
    case 'list': {
      if (raw === null) return [];
      const values = def.values;
      const list = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
      return values ? list.filter((entry) => values.includes(entry)) : list;
    }
  }
}

/**
 * Serialize a grid state into the params it owns, defaults omitted.
 *
 * Key order follows the codec's DECLARATION ORDER, which is what makes the
 * result comparable to {@link ownedSearch} without sorting either side.
 */
export function encodeGridParams<S extends GridUrlState>(
  defs: GridParamDefs<S>,
  state: S,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of Object.keys(defs) as (keyof S & string)[]) {
    const encoded = encodeOne(defs[key], state[key]);
    if (encoded !== undefined) out.set(key, encoded);
  }
  return out;
}

/** Parse the owned params out of a query string, filling defaults for the rest. */
export function decodeGridParams<S extends GridUrlState>(
  defs: GridParamDefs<S>,
  search: URLSearchParams,
): S {
  const out: GridUrlState = {};
  for (const key of Object.keys(defs) as (keyof S & string)[]) {
    out[key] = decodeOne(defs[key], search.get(key));
  }
  return out as S;
}

/** The owned slice of a query string, in codec order — the comparison key. */
export function ownedSearch<S extends GridUrlState>(
  defs: GridParamDefs<S>,
  search: URLSearchParams,
): string {
  const out = new URLSearchParams();
  for (const key of Object.keys(defs) as (keyof S & string)[]) {
    const raw = search.get(key);
    if (raw !== null) out.set(key, raw);
  }
  return out.toString();
}

/** True when a push-worthy param differs between two serialized states. */
export function shouldPush(previous: string, next: string, pushKeys: readonly string[]): boolean {
  if (pushKeys.length === 0) return false;
  const before = new URLSearchParams(previous);
  const after = new URLSearchParams(next);
  return pushKeys.some((key) => before.get(key) !== after.get(key));
}

/**
 * The AUTHORITATIVE query string — the browser's, not React's.
 *
 * React Router runs navigations inside `startTransition`: `setSearchParams`
 * writes `window.location` synchronously, while the render carrying the
 * matching `useSearchParams()` value stays deferred and interruptible. So the
 * rendered params are a value that is usually current and occasionally one
 * navigation behind, which is precisely the wrong thing to diff a URL against.
 *
 * Falls back to the rendered params where there is no document, so the codec's
 * unit tests import this module cleanly in the node environment.
 */
function liveSearch(rendered: URLSearchParams): URLSearchParams {
  if (typeof window === 'undefined') return rendered;
  return new URLSearchParams(window.location.search);
}

/** Keeps one grid's state in the URL. Renders nothing; drives the caller. */
export function useGridUrlState<S extends GridUrlState>(codec: GridUrlCodec<S>): void {
  // Read for the SUBSCRIPTION as much as for the value: this is what re-renders
  // the page on every navigation, which is what gets the effects below to run.
  const [searchParams, setSearchParams] = useSearchParams();

  // The codec closes over page-local values (translators, store actions), so it
  // is rebuilt every render — held in a ref, never in a dependency array.
  const codecRef = useRef(codec);
  codecRef.current = codec;
  const searchRef = useRef(searchParams);
  searchRef.current = searchParams;
  const setSearchRef = useRef(setSearchParams);
  setSearchRef.current = setSearchParams;

  /** The last owned query string this hook itself produced or consumed. */
  const selfRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  const stateOwned = encodeGridParams(codec.params, codec.get()).toString();

  // URL → state. Mount, Back/Forward, or an in-app link into a filtered grid.
  //
  // Deliberately WITHOUT a dependency array, and deliberately reading the LIVE
  // URL. `selfRef` — the last owned query string this hook produced or consumed
  // — is the only correct gate, and both halves of the transition race defeat
  // any weaker one:
  //
  //  - Back over a discrete choice. The URL travels `?a` → `?a&b` → `?a`, but
  //    the middle step's render is discarded by the `history.back()` that
  //    interrupts it, so the RENDERED params read `?a` on both commits React
  //    actually made. A dependency on them never fires, while `selfRef` still
  //    holds `?a&b` from the writer below — the grid keeps a filter the URL no
  //    longer carries, and no effect is left to notice.
  //  - The mirror image: a commit that lands while a push is still deferred
  //    sees rendered params one navigation STALE. Hydrating from those would
  //    answer the user's brand-new facet by resetting the grid to the previous
  //    URL.
  //
  // Reading `window.location` settles both — it is never stale — and `selfRef`
  // tells our own writes apart from someone else's. Running every commit costs
  // one string compare and is idempotent: hydration records the URL it adopted,
  // so the next pass returns at the guard.
  useEffect(() => {
    const owned = ownedSearch(codecRef.current.params, liveSearch(searchRef.current));
    if (hydratedRef.current && owned === selfRef.current) return;
    hydratedRef.current = true;
    selfRef.current = owned;
    codecRef.current.apply(decodeGridParams(codecRef.current.params, new URLSearchParams(owned)));
  });

  // State → URL. Re-reads the state at EFFECT time rather than trusting the
  // render-time snapshot: hydration above runs first and updates the store
  // synchronously, and the stale snapshot would otherwise write the
  // pre-hydration state straight back over the URL it just read.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const next = encodeGridParams(codecRef.current.params, codecRef.current.get()).toString();
    if (next === selfRef.current) return;
    const previous = selfRef.current ?? '';
    selfRef.current = next;

    // Foreign params come off the LIVE URL for the same reason the read above
    // does: merging them from a deferred render would resurrect a `?tab=` the
    // user has already navigated away from.
    const merged = new URLSearchParams(liveSearch(searchRef.current));
    for (const key of Object.keys(codecRef.current.params)) merged.delete(key);
    for (const [key, value] of new URLSearchParams(next)) merged.append(key, value);

    setSearchRef.current(merged, {
      replace: !shouldPush(previous, next, codecRef.current.push ?? []),
    });
    // `stateOwned` is the change detector; the write above uses a fresh read.
  }, [stateOwned]);
}
