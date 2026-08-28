import * as React from 'react';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { arSA } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import {
  DayPicker,
  getDefaultClassNames,
  type ClassNames,
  type CustomComponents,
  type DayButton,
  type DropdownProps,
  type Formatters,
  type Labels,
} from 'react-day-picker';

import { useLang } from '@/lib/lang-policy';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * shadcn `Calendar` on react-day-picker v9, FlowBoard tokens.
 *
 * LOCALIZATION. The app language drives DayPicker's `locale` (date-fns `arSA`
 * for Arabic) and `dir`, so month names, weekday headers and the grid order all
 * follow the UI language.
 *
 * DIGITS STAY WESTERN everywhere (i18n.md): `arSA` formats years with latin
 * digits and DayPicker's `numerals` defaults to `latn`, so day numbers do too.
 * The one trap is the month dropdown — `date.toLocaleString('ar-SA')` renders
 * Arabic-Indic numerals, so {@link CALENDAR_FORMATTERS_AR} uses the plain `'ar'`
 * locale instead.
 *
 * ARIA LABELS DO NOT FOLLOW `locale`. DayPicker's `labels.*` are hard-coded
 * English strings that ignore the locale entirely, so the four that name a real
 * control are overridden from `common:ui.calendar.*`. English there is
 * byte-for-byte the upstream default, so a screen-reader user's muscle memory
 * does not shift.
 *
 * PROP IDENTITIES ARE LOAD-BEARING — see {@link CALENDAR_COMPONENTS}.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  formatters,
  components,
  labels,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
}) {
  const lang = useLang();
  const isArabic = lang === 'ar';
  const { t } = useTranslation(['common']);
  const showWeekNumber = props.showWeekNumber;

  // `t` is stable per (i18n instance, namespace, language), so this rebuilds
  // only on a real language switch — exactly when the ARIA copy must change.
  const mergedLabels = React.useMemo<Partial<Labels>>(
    () => ({
      labelPrevious: () => t('common:ui.calendar.previousMonth'),
      labelNext: () => t('common:ui.calendar.nextMonth'),
      labelMonthDropdown: () => t('common:ui.calendar.chooseMonth'),
      labelYearDropdown: () => t('common:ui.calendar.chooseYear'),
      ...labels,
    }),
    [t, labels],
  );

  const mergedFormatters = React.useMemo<Partial<Formatters>>(() => {
    const base = isArabic ? CALENDAR_FORMATTERS_AR : CALENDAR_FORMATTERS_EN;
    return formatters ? { ...base, ...formatters } : base;
  }, [isArabic, formatters]);

  const mergedComponents = React.useMemo<Partial<CustomComponents>>(
    () => (components ? { ...CALENDAR_COMPONENTS, ...components } : CALENDAR_COMPONENTS),
    [components],
  );

  const mergedClassNames = React.useMemo<Partial<ClassNames>>(() => {
    const defaults = getDefaultClassNames();

    return {
      root: cn('w-fit', defaults.root),
      months: cn('relative flex flex-col gap-4 md:flex-row', defaults.months),
      month: cn('flex w-full flex-col gap-3', defaults.month),
      // pointer-events-none: this bar is absolutely positioned across the FULL
      // caption strip, so without it the <nav> swallows every click meant for
      // the month/year dropdowns underneath. Its two buttons re-enable hits.
      nav: cn(
        'pointer-events-none absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
        defaults.nav,
      ),
      button_previous: cn(
        buttonVariants({ variant: buttonVariant }),
        'pointer-events-auto size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
        defaults.button_previous,
      ),
      button_next: cn(
        buttonVariants({ variant: buttonVariant }),
        'pointer-events-auto size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
        defaults.button_next,
      ),
      month_caption: cn(
        'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
        defaults.month_caption,
      ),
      dropdowns: cn(
        'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium',
        defaults.dropdowns,
      ),
      dropdown_root: cn(
        'relative rounded-[var(--input-radius)] border border-input shadow-[var(--shadow-1)] has-focus:border-ring has-focus:ring-2 has-focus:ring-ring/25',
        defaults.dropdown_root,
      ),
      dropdown: cn('absolute inset-0 bg-popover opacity-0', defaults.dropdown),
      caption_label: cn(
        'font-medium select-none',
        captionLayout === 'label'
          ? 'text-sm'
          : 'flex h-7 items-center gap-1 rounded-[var(--radius)] pe-1 ps-2 text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
        defaults.caption_label,
      ),
      month_grid: cn('w-full border-collapse', defaults.month_grid),
      weekdays: cn('flex', defaults.weekdays),
      weekday: cn(
        'flex-1 rounded-[var(--radius)] text-[0.75rem] font-normal text-muted-foreground select-none',
        defaults.weekday,
      ),
      week: cn('mt-1.5 flex w-full', defaults.week),
      week_number_header: cn('w-(--cell-size) select-none', defaults.week_number_header),
      week_number: cn('text-[0.75rem] text-muted-foreground select-none', defaults.week_number),
      // Range caps are LOGICAL (`rounded-s`/`rounded-e`), not physical.
      // DayPicker under `dir="rtl"` lays the week out right-to-left, so the
      // row's `:first-child` and the range's earliest day are both on the
      // reading-START side — which is what `rounded-s-*` caps in either
      // direction. Physical `rounded-l-*` would cap the wrong end of an RTL
      // range: an open notch at the start and a stray round at the end.
      day: cn(
        'group/day relative aspect-square h-full w-full p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-e-[var(--radius)]',
        showWeekNumber
          ? '[&:nth-child(2)[data-selected=true]_button]:rounded-s-[var(--radius)]'
          : '[&:first-child[data-selected=true]_button]:rounded-s-[var(--radius)]',
        defaults.day,
      ),
      range_start: cn('rounded-s-[var(--radius)] bg-accent', defaults.range_start),
      range_middle: cn('rounded-none', defaults.range_middle),
      range_end: cn('rounded-e-[var(--radius)] bg-accent', defaults.range_end),
      today: cn(
        'rounded-[var(--radius)] bg-accent text-accent-foreground data-[selected=true]:rounded-none',
        defaults.today,
      ),
      outside: cn('text-muted-foreground aria-selected:text-muted-foreground', defaults.outside),
      disabled: cn('text-muted-foreground opacity-50', defaults.disabled),
      hidden: cn('invisible', defaults.hidden),
      ...classNames,
    };
  }, [buttonVariant, captionLayout, showWeekNumber, classNames]);

  return (
    <DayPicker
      locale={isArabic ? arSA : undefined}
      dir={isArabic ? 'rtl' : undefined}
      showOutsideDays={showOutsideDays}
      labels={mergedLabels}
      className={cn(
        'group/calendar bg-transparent p-2 [--cell-size:--spacing(8)]',
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      formatters={mergedFormatters}
      classNames={mergedClassNames}
      components={mergedComponents}
      {...props}
    />
  );
}

/** Root element of the calendar — carries the `data-slot` the CSS keys off. */
const CalendarRoot: CustomComponents['Root'] = ({ className, rootRef, ...props }) => (
  <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />
);

/** Nav-button and dropdown chevrons, swapped for the lucide set. */
const CalendarChevron: CustomComponents['Chevron'] = ({ className, orientation, ...props }) => {
  if (orientation === 'left')
    return <ChevronLeftIcon className={cn('size-4', className)} {...props} />;
  if (orientation === 'right')
    return <ChevronRightIcon className={cn('size-4', className)} {...props} />;
  return <ChevronDownIcon className={cn('size-4', className)} {...props} />;
};

const CalendarMonthsDropdown: CustomComponents['MonthsDropdown'] = (props) => (
  <CalendarDropdown {...props} testId="calendar-month-select" />
);

const CalendarYearsDropdown: CustomComponents['YearsDropdown'] = (props) => (
  <CalendarDropdown {...props} testId="calendar-year-select" />
);

/** Week-number cell (only reachable with `showWeekNumber`). */
const CalendarWeekNumber: CustomComponents['WeekNumber'] = ({ children, ...props }) => (
  <td {...props}>
    <div className="flex size-(--cell-size) items-center justify-center text-center">
      {children}
    </div>
  </td>
);

/**
 * DayPicker's component overrides — **deliberately a module-scope constant.**
 *
 * react-day-picker resolves `components` / `formatters` / `labels` /
 * `classNames` inside ONE `useMemo` whose dependency array lists all four BY
 * IDENTITY. A fresh object literal in any of them therefore rebuilds the
 * component map on every render, handing React brand-new element *types* —
 * which unmounts and remounts the entire calendar subtree. With
 * `captionLayout="dropdown*"` that subtree contains an OPEN Radix `Select`
 * portal, so the option list is torn out from under the pointer mid-click.
 *
 * So: everything that closes over nothing lives here, and the two maps that do
 * read something (`labels` needs `t`; `classNames` needs `buttonVariant` /
 * `captionLayout` / `showWeekNumber`) are `useMemo`'d on their real inputs
 * inside {@link Calendar}. Inlining any of them back is a functional
 * regression, not a style choice.
 */
const CALENDAR_COMPONENTS: Partial<CustomComponents> = {
  Root: CalendarRoot,
  Chevron: CalendarChevron,
  DayButton: CalendarDayButton,
  MonthsDropdown: CalendarMonthsDropdown,
  YearsDropdown: CalendarYearsDropdown,
  WeekNumber: CalendarWeekNumber,
};

/**
 * Caption-dropdown month names, one frozen map per language — same identity
 * doctrine as {@link CALENDAR_COMPONENTS}. The Arabic entry must use the `'ar'`
 * Intl locale rather than `'ar-SA'`, which renders Arabic-Indic numerals.
 */
const CALENDAR_FORMATTERS_EN: Partial<Formatters> = {
  formatMonthDropdown: (date) => date.toLocaleString('en-US', { month: 'short' }),
};

const CALENDAR_FORMATTERS_AR: Partial<Formatters> = {
  formatMonthDropdown: (date) => date.toLocaleString('ar', { month: 'short' }),
};

/**
 * The slice of react-day-picker's `DropdownProps` this bridge reads. Declaring
 * the subset (rather than the whole `SelectHTMLAttributes` bag) keeps native
 * `<select>`-only props from leaking onto a Radix trigger; `DropdownProps` is
 * still assignable to it, so the override stays type-compatible.
 */
type CalendarDropdownProps = Pick<
  DropdownProps,
  'options' | 'value' | 'onChange' | 'disabled' | 'className' | 'aria-label'
> & {
  /** `data-testid` for the trigger — month vs. year, set by the call site. */
  testId: string;
};

/**
 * A month/year caption dropdown rendered with the shadcn `Select` primitives
 * instead of the native `<select>` upstream hides behind an opacity-0 overlay.
 *
 * DayPicker hands this component a native-select contract — a numeric `value`
 * plus an `onChange` whose body only reads `event.target.value` — so the whole
 * bridge is stringifying on the way in and handing back a minimal synthetic
 * change event on the way out.
 */
function CalendarDropdown({
  options,
  value,
  onChange,
  disabled,
  className,
  testId,
  'aria-label': ariaLabel,
}: CalendarDropdownProps) {
  const current = value == null ? undefined : String(value);
  const selected = options?.find((option) => String(option.value) === current);

  return (
    <Select
      value={current}
      disabled={disabled}
      onValueChange={(next) => {
        onChange?.({
          target: { value: next },
        } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn('h-(--cell-size) gap-1 px-2 font-medium', className)}
      >
        {/* Radix resolves the trigger text from the OPEN content, which never
            renders on the server — passing the label explicitly keeps the
            caption readable in static renders too. */}
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options?.map((option) => (
          <SelectItem key={option.value} value={String(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaults = getDefaultClassNames();
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal',
        'group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-2 group-data-[focused=true]/day:ring-ring/40',
        'data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground',
        'data-[range-start=true]:rounded-s-[var(--radius)] data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground',
        'data-[range-end=true]:rounded-e-[var(--radius)] data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground',
        'data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground',
        '[&>span]:text-xs [&>span]:opacity-70',
        defaults.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
