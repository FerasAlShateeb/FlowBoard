import { describe, expect, it } from 'vitest';

import {
  BACKLOG_COLLAPSE_KEY,
  isSectionCollapsed,
  readCollapse,
  toggleSection,
  writeCollapse,
} from '@/components/backlog/backlog-collapse';

/**
 * The persisted fold state.
 *
 * The interesting property is the THREE-VALUED read: a section can be folded, be
 * open, or have never been touched — and only the third case is allowed to fall
 * back to the section's own default (completed sprints open folded, everything
 * else open). A set of ids could not express that, which is why the stored shape
 * is a map.
 *
 * `src/test/setup.ts` installs an in-memory `localStorage` and clears it before
 * every test, so these run in the node environment with no DOM.
 */

describe('readCollapse', () => {
  it('is empty when nothing has been saved', () => {
    expect(readCollapse()).toEqual({});
  });

  it('reads back what was written', () => {
    writeCollapse({ 'sp-1': true, backlog: false });
    expect(readCollapse()).toEqual({ 'sp-1': true, backlog: false });
  });

  it('ignores an unparseable value rather than throwing on first render', () => {
    localStorage.setItem(BACKLOG_COLLAPSE_KEY, '{not json');
    expect(readCollapse()).toEqual({});
  });

  it('drops non-boolean entries, so a stray string cannot fold a section', () => {
    localStorage.setItem(BACKLOG_COLLAPSE_KEY, JSON.stringify({ 'sp-1': 'yes', 'sp-2': true }));
    expect(readCollapse()).toEqual({ 'sp-2': true });
  });

  it('ignores a saved array — an older shape, not a map', () => {
    localStorage.setItem(BACKLOG_COLLAPSE_KEY, JSON.stringify(['sp-1']));
    expect(readCollapse()).toEqual({});
  });
});

describe('isSectionCollapsed', () => {
  it('uses the section’s own default for an id nobody has touched', () => {
    expect(isSectionCollapsed({}, 'sp-1')).toBe(false);
    expect(isSectionCollapsed({}, 'sp-old', true)).toBe(true);
  });

  it('lets an explicit `false` beat a collapsed-by-default section', () => {
    expect(isSectionCollapsed({ 'sp-old': false }, 'sp-old', true)).toBe(false);
  });
});

describe('toggleSection', () => {
  it('flips against the default the first time', () => {
    expect(toggleSection({}, 'sp-old', true)).toEqual({ 'sp-old': false });
  });

  it('returns a new object rather than mutating the old one', () => {
    const before = { 'sp-1': true };
    const after = toggleSection(before, 'sp-1');
    expect(after).toEqual({ 'sp-1': false });
    expect(before).toEqual({ 'sp-1': true });
  });
});
