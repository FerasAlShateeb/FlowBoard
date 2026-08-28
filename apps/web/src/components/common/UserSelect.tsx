import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, UserRound, X } from 'lucide-react';
import type { UserSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useOrgUsers } from '@/hooks/useOrgs';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The person picker — a searchable combobox over the org's user directory.
 *
 * Used by every "who" field in the product: project lead, assignee, project
 * member, team roster. One component, so the search behaviour, the avatar
 * treatment and the keyboard model are decided once.
 *
 * WHY THE SEARCH IS CLIENT-SIDE. `GET /orgs/:orgId/users` returns the whole
 * directory and `useOrgUsers` caches it for five minutes, so filtering happens
 * in `ui/command`'s own matcher — no request per keystroke, no debounce, no
 * loading flicker inside an open popover. An org large enough for that to hurt
 * would need a server-side search mode, and the hook already accepts a term for
 * exactly that day.
 *
 * KEYBOARD MODEL comes from `ui/command`: focus stays in the text field,
 * arrows move `aria-activedescendant`, Enter clicks the active option. The
 * trigger is a real `role="combobox"` button so the whole thing is reachable
 * without a pointer.
 */

export interface UserSelectProps {
  orgId: string | null | undefined;
  /** The selected user id, or `null` for none. */
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Offer an explicit "clear" row. Off for fields that require a person. */
  allowClear?: boolean;
  /** Hide these ids — e.g. people already on the team being edited. */
  excludeIds?: readonly string[];
  disabled?: boolean;
  className?: string;
  /** Accessible name, when the field has no visible `<label>`. */
  ariaLabel?: string;
}

export function UserSelect({
  orgId,
  value,
  onChange,
  placeholder,
  allowClear = true,
  excludeIds,
  disabled,
  className,
  ariaLabel,
}: UserSelectProps) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const { data: users } = useOrgUsers(orgId);

  const excluded = new Set(excludeIds ?? []);
  const options = (users ?? []).filter(
    // The CURRENT value is never excluded: hiding it would render the trigger
    // blank for a selection that is genuinely set.
    (entry) => entry.user.id === value || !excluded.has(entry.user.id),
  );
  const selected = options.find((entry) => entry.user.id === value);

  const summary: UserSummary | null = selected?.user ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn('h-8 w-full justify-between gap-2 font-normal', className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {summary ? (
              <UserAvatar user={summary} size="xs" label="" />
            ) : (
              <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
            )}
            {/* `dir="auto"` — THE `…trova` FIX (WP3.8 → WP5.1). This span
                truncates, and under Arabic a Latin name inherited `rtl`, so the
                ellipsis landed at the READING START: "Nina Petrova" clipped to
                "…trova", cutting off the only part that identifies the person.
                `auto` takes the direction from the value's own first strong
                character, so the tail is what disappears in either script — and
                the Arabic placeholder below still reads right-to-left. */}
            <span dir="auto" className={cn('truncate', !summary && 'text-muted-foreground')}>
              {summary?.name ?? placeholder ?? t('common:picker.selectPerson')}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>

      {/* `p-0` because the Command owns its own padding; the width matches the
          trigger via Radix's exposed CSS variable, so the list never spills
          past the field it belongs to. */}
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command label={ariaLabel ?? t('common:picker.selectPerson')}>
          <CommandInput placeholder={t('common:picker.search')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('common:picker.empty')}</CommandEmpty>

            {allowClear ? (
              <CommandItem
                value={t('common:picker.unassigned')}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <UserRound aria-hidden />
                <span className="truncate">{t('common:picker.unassigned')}</span>
                {value === null ? <Check className="ms-auto size-3.5" aria-hidden /> : null}
              </CommandItem>
            ) : null}

            {options.map((entry) => (
              <CommandItem
                key={entry.user.id}
                // The NAME is the match target (it is what people type) and the
                // email is a keyword, so `ada@` finds Ada without the address
                // being the visible label.
                value={entry.user.name}
                keywords={[entry.email]}
                onSelect={() => {
                  onChange(entry.user.id);
                  setOpen(false);
                }}
              >
                <UserAvatar user={entry.user} size="xs" label="" />
                <span className="flex min-w-0 flex-col leading-tight">
                  {/* A name is user content: `dir="auto"` — see `UserChip`. */}
                  <span dir="auto" className="truncate">
                    {entry.user.name}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground" dir="ltr">
                    {entry.email}
                  </span>
                </span>
                {entry.user.id === value ? (
                  <Check className="ms-auto size-3.5" aria-hidden />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The multi-select form — the team roster editor's picker.
 *
 * A separate component rather than a `multiple` flag: the two differ in nearly
 * every behaviour that matters (the popover stays open, the trigger shows a
 * count and a chip row, selection toggles instead of replacing), and folding
 * them together produces a component that is mostly branches.
 */
export function UserMultiSelect({
  orgId,
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  orgId: string | null | undefined;
  value: readonly string[];
  onChange: (userIds: string[]) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const { data: users } = useOrgUsers(orgId);

  const selected = new Set(value);
  const options = users ?? [];

  const toggle = (userId: string) => {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange([...next]);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            className="h-8 w-full justify-between gap-2 font-normal"
          >
            <span className={cn('truncate', selected.size === 0 && 'text-muted-foreground')}>
              {placeholder ?? t('common:picker.selectPerson')}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command label={ariaLabel ?? t('common:picker.selectPerson')}>
            <CommandInput placeholder={t('common:picker.search')} autoFocus />
            <CommandList>
              <CommandEmpty>{t('common:picker.empty')}</CommandEmpty>
              {options.map((entry) => (
                <CommandItem
                  key={entry.user.id}
                  value={entry.user.name}
                  keywords={[entry.email]}
                  // The popover deliberately stays OPEN: picking a roster is a
                  // burst of selections, and closing after each one turns eight
                  // choices into eight round trips through the trigger.
                  onSelect={() => {
                    toggle(entry.user.id);
                  }}
                >
                  <UserAvatar user={entry.user} size="xs" label="" />
                  <span dir="auto" className="truncate">
                    {entry.user.name}
                  </span>
                  {selected.has(entry.user.id) ? (
                    <Check className="ms-auto size-3.5" aria-hidden />
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.size > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {options
            .filter((entry) => selected.has(entry.user.id))
            .map((entry) => (
              <li key={entry.user.id}>
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border bg-surface-raised py-0.5 pe-1 ps-1.5 text-xs">
                  <UserAvatar user={entry.user} size="xs" label="" />
                  <span dir="auto" className="max-w-[10rem] truncate">
                    {entry.user.name}
                  </span>
                  <button
                    type="button"
                    aria-label={t('common:actions.remove')}
                    className="inline-flex size-4 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => {
                      toggle(entry.user.id);
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

export default UserSelect;
