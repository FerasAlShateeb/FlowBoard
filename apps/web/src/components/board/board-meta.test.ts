import { describe, expect, it } from 'vitest';

import { formatDueDate } from '@/components/board/board-meta';

/**
 * What is LEFT in the board's own meta module after WP3.8.
 *
 * `formatPoints`, `isOverdue` and `todayIso` moved to `lib/format.ts` and their
 * cases moved with them to `lib/format.test.ts`; the icon tables moved to
 * `components/common/task-icons.tsx` and their totality is asserted in
 * `task-icons.test.ts`. A duplicate suite here would pass forever without
 * exercising the code the board actually imports.
 */

describe('formatDueDate', () => {
  it('drops the year for a date in the current one', () => {
    const formatted = formatDueDate('2026-03-12', 'en-US', new Date(2026, 0, 1));
    expect(formatted).toContain('12');
    expect(formatted).not.toContain('2026');
  });

  it('keeps the year once the inference stops being safe', () => {
    expect(formatDueDate('2027-03-12', 'en-US', new Date(2026, 0, 1))).toContain('2027');
  });

  it('reads the ISO day as LOCAL midnight, never UTC', () => {
    // `new Date('2026-03-12')` is UTC midnight and renders as the 11th west of
    // Greenwich — the exact bug the explicit `T00:00:00` prevents.
    expect(formatDueDate('2026-03-12', 'en-US', new Date(2026, 0, 1))).toMatch(/12/);
  });

  it('returns the raw value rather than "Invalid Date" for junk', () => {
    expect(formatDueDate('not-a-date', 'en-US')).toBe('not-a-date');
  });
});
