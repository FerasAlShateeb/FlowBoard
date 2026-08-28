import type { UserSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * A person, as a circle — the single avatar used by every assignee chip,
 * comment author, member row and presence stack in the product.
 *
 * TWO THINGS IT ADDS over the raw `ui/avatar` primitive:
 *
 * 1. **Initials that read correctly.** First letter of the first word plus
 *    first letter of the LAST — so "Ada Byron King" is `AK`, not `AB`. Single
 *    words give one letter rather than a doubled one.
 * 2. **A deterministic colour from the chart ramp.** The fallback tint is
 *    derived from the user id, so the same person is the same colour on every
 *    screen and in every session — which is what makes a wall of unnamed
 *    avatars scannable. It reads `--chart-1…5`, so it follows the Theme Studio
 *    and both palettes, and no hex literal appears anywhere (checklist §B).
 */

/**
 * The five ramp slots. Deliberately the CHART ramp rather than a bespoke set:
 * those five are already guaranteed to be distinguishable from each other and
 * legible in both modes, which is exactly the property an identity colour
 * needs.
 */
const RAMP_SIZE = 5;

/**
 * A stable 0–4 bucket for an id.
 *
 * A plain character sum, not a cryptographic hash: the requirement is
 * "same input, same colour, roughly even spread", and a uuid's hex characters
 * already have that spread. `>>> 0` keeps it unsigned so the modulo cannot go
 * negative on a long string.
 */
export function avatarRampIndex(seed: string): number {
  let total = 0;
  for (let index = 0; index < seed.length; index += 1) {
    total = (total * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return (total % RAMP_SIZE) + 1;
}

/** `Ada Lovelace` → `AL`; `Ada` → `A`; empty → `?`. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`;
}

export interface UserAvatarProps {
  /** `null` renders the unassigned placeholder rather than an empty circle. */
  user: UserSummary | null | undefined;
  size?: 'xs' | 'sm' | 'default' | 'lg';
  className?: string;
  /** Accessible name override — pass `''` inside an already-labelled row. */
  label?: string;
}

export function UserAvatar({ user, size = 'sm', className, label }: UserAvatarProps) {
  const name = user?.name ?? '';
  const title = label ?? name;

  return (
    <Avatar
      size={size}
      className={className}
      // A decorative avatar inside a row that already names the person would
      // otherwise be read twice by a screen reader.
      {...(title ? { title, role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
      <AvatarFallback
        style={
          user
            ? {
                // Low-alpha tint + full-strength text: the same treatment the
                // `soft-*` badge variants use, and the reason this stays legible
                // at 20px in both modes.
                backgroundColor: `color-mix(in oklab, var(--chart-${avatarRampIndex(user.id)}) 18%, transparent)`,
                color: `var(--chart-${avatarRampIndex(user.id)})`,
              }
            : undefined
        }
      >
        {user ? initialsOf(name) : '?'}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A person's avatar and name side by side — the row form, used in tables,
 * pickers and member lists.
 */
export function UserChip({
  user,
  size = 'sm',
  className,
  secondary,
}: UserAvatarProps & { secondary?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <UserAvatar user={user} size={size} label="" />
      <span className="flex min-w-0 flex-col leading-tight">
        {/* `dir="auto"` on USER-GENERATED text (WP5.1). A person's name is
            whatever alphabet they wrote it in, and this span truncates. Inside
            an RTL page a Latin name inherits `rtl`, so the ellipsis lands at
            the reading start and "Elena Petrova" clips to "…trova" — the head
            of the name, the only part that identifies it, is what gets cut.
            `auto` gives the span the direction of its own first strong
            character, so the tail is what disappears in either script. */}
        <span dir="auto" className="truncate text-xs font-medium text-foreground">
          {user?.name ?? '—'}
        </span>
        {secondary ? (
          // Email addresses are Latin identifiers even on an Arabic page.
          <span className="truncate text-[11px] text-muted-foreground" dir="ltr">
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export default UserAvatar;
