import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TableChromeCopy } from '@/components/dashboard/chrome-copy';
import { useDebounced } from '@/components/dashboard/use-debounced';

/**
 * The facet row's two shapes, behind one trigger and one testid contract.
 *
 * ═══ A FACET IS CALLER-OWNED ═════════════════════════════════════════════
 *
 * The table never mutates a facet: it renders the current `value` and reports
 * the next one, exactly like row selection. A server grid wires a facet
 * straight to its store filters (and through `useGridUrlState` to the URL); a
 * client grid keeps the state in `useState`. Neither needs this component to
 * know which it is.
 *
 * ═══ WHY A TEXT VARIANT EXISTS AT ALL ════════════════════════════════════
 *
 * Not every server filter is enumerable. `path` on a request-log feed is a
 * substring match over every route the API has ever served, so a checkbox list
 * has nothing to offer it. Splitting such a filter out into a bare input beside
 * the facet row was the alternative, and it read as two rows of controls that
 * do the same job — so it lives behind the same trigger, with a debounce.
 *
 * ═══ THE TRIGGER HAS NO `aria-label` ═════════════════════════════════════
 *
 * Its visible text IS the facet's name, so an `aria-label` could only replace a
 * correct accessible name with a different one — and the e2e specs address
 * these by name and by `data-testid`. The active selection rides along as a
 * tinted count pill inside the button, so it is part of that name: "Status, 2"
 * rather than a button that looks filtered and announces as if it were not.
 */

export interface FacetOption {
  value: string;
  label: string;
  /** Optional match count, rendered as a tinted pill. */
  count?: number;
}

/** Fields every facet shares, whatever it filters by. */
interface FacetBase {
  id: string;
  /** Already-translated facet name — the trigger's visible text. */
  label: string;
  /** The active selection. A text facet carries 0 or 1 entry. */
  value: string[];
  onChange: (next: string[]) => void;
}

/** The checkbox-list facet: a closed set of options the caller enumerates. */
export interface OptionsFacetDef extends FacetBase {
  kind?: 'options';
  options: FacetOption[];
  /**
   * `false` makes the facet single-select — `value` is then a 0-or-1 entry
   * array, which is what a single-valued `status=` / `role=` query param wants.
   */
  multi?: boolean;
}

/** The free-text facet: a debounced input inside the same popover. */
export interface TextFacetDef extends FacetBase {
  kind: 'text';
  /** Input placeholder. Defaults to the shared search verb. */
  placeholder?: string;
  /** Debounce before `onChange` fires, in ms. */
  delay?: number;
}

export type FacetDef = OptionsFacetDef | TextFacetDef;

/**
 * The 12% oklab tint (design-system §6) — one recipe for every count pill, and
 * the same one `StatDelta` and the label chips use. `color-mix` toward
 * `transparent` rather than toward a page colour keeps it correct on every
 * surface and lets it follow the Theme Studio with no second definition.
 */
const PILL_STYLE = {
  background: 'color-mix(in oklab, var(--primary) 12%, transparent)',
  color: 'var(--primary)',
} as const;

/** The trigger button, shared by both variants: name, count pill, testid. */
function FacetTrigger({
  id,
  label,
  summary,
  active,
}: {
  id: string;
  label: string;
  summary?: string;
  active: boolean;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`table-facet-${id}`}
        className={cn(active && 'border-primary text-primary')}
      >
        <Filter className="size-3.5" aria-hidden />
        {label}
        {summary === undefined ? null : (
          <span
            className="ms-1 max-w-32 truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
            style={PILL_STYLE}
          >
            {summary}
          </span>
        )}
      </Button>
    </PopoverTrigger>
  );
}

/** The Clear row, shared by both variants. */
function FacetClear({
  id,
  label,
  disabled,
  onClear,
  copy,
}: {
  id: string;
  label: string;
  disabled: boolean;
  onClear: () => void;
  copy: TableChromeCopy;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-1 w-full"
      disabled={disabled}
      onClick={onClear}
      aria-label={copy.facet.clearAria(label)}
      data-testid={`table-facet-${id}-clear`}
    >
      {copy.facet.clear}
    </Button>
  );
}

function TextFacet({ facet, copy }: { facet: TextFacetDef; copy: TableChromeCopy }) {
  const { id, label, value, onChange, placeholder, delay } = facet;
  const current = value[0] ?? '';
  const [draft, setDraft] = useState(current);

  // The caller's value is the source of truth: a Back/Forward step or a cleared
  // facet must show up in the box. Typing settles to the same string, so this
  // can never fight the debounce below.
  useEffect(() => {
    setDraft(current);
  }, [current]);

  useDebounced(
    draft,
    (next) => {
      const trimmed = next.trim();
      onChange(trimmed === '' ? [] : [trimmed]);
    },
    delay,
  );

  return (
    <Popover>
      <FacetTrigger id={id} label={label} summary={current || undefined} active={current !== ''} />
      <PopoverContent align="start" className="w-56 p-2">
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder={placeholder ?? copy.facet.searchPlaceholder}
          aria-label={label}
          data-testid={`table-facet-${id}-input`}
          className="h-8 text-sm"
        />
        <FacetClear
          id={id}
          label={label}
          copy={copy}
          disabled={draft === '' && current === ''}
          onClear={() => {
            setDraft('');
            onChange([]);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function OptionsFacet({ facet, copy }: { facet: OptionsFacetDef; copy: TableChromeCopy }) {
  const { id, label, options, value, onChange, multi = true } = facet;
  const selected = new Set(value);

  const toggle = (option: string, checked: boolean) => {
    if (!multi) {
      onChange(checked ? [option] : []);
      return;
    }
    const rest = value.filter((entry) => entry !== option);
    onChange(checked ? [...rest, option] : rest);
  };

  const chosen = options.filter((option) => selected.has(option.value));
  // One selection reads better as its own name than as "1"; more than one has
  // no name, so the count is the only honest summary.
  const summary =
    chosen.length === 0
      ? undefined
      : chosen.length === 1
        ? chosen[0]?.label
        : String(chosen.length);

  return (
    <Popover>
      <FacetTrigger id={id} label={label} summary={summary} active={selected.size > 0} />
      <PopoverContent align="start" className="w-56 p-2">
        <div className="flex flex-col gap-0.5" role="group" aria-label={label}>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-default items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-sm transition-colors duration-[var(--speed)] hover:bg-accent"
            >
              <Checkbox
                checked={selected.has(option.value)}
                onCheckedChange={(next) => {
                  toggle(option.value, next === true);
                }}
                // Radix renders a `<button role="checkbox">` with no text of
                // its own, and a wrapping `<label>` does not name a button the
                // way it names a native input. So this `aria-label` SUPPLIES
                // the accessible name rather than replacing one — and it is the
                // same words the sighted user reads beside it.
                aria-label={option.label}
                data-testid={`table-facet-${id}-${option.value || 'any'}`}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.count === undefined ? null : (
                <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={PILL_STYLE}>
                  {option.count}
                </span>
              )}
            </label>
          ))}
        </div>
        <FacetClear
          id={id}
          label={label}
          copy={copy}
          disabled={selected.size === 0}
          onClear={() => {
            onChange([]);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function FacetFilter({ facet, copy }: { facet: FacetDef; copy: TableChromeCopy }) {
  return facet.kind === 'text' ? (
    <TextFacet facet={facet} copy={copy} />
  ) : (
    <OptionsFacet facet={facet} copy={copy} />
  );
}
