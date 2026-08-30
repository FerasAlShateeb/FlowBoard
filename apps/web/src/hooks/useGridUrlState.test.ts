import { describe, expect, it } from 'vitest';

import {
  decodeGridParams,
  encodeGridParams,
  ownedSearch,
  shouldPush,
  type GridParamDefs,
} from '@/hooks/useGridUrlState';

/**
 * The grid ⇄ URL codec.
 *
 * This suite runs in the DEFAULT node environment: the hook's two effects need
 * a router and a live `window.location`, and they are covered end to end by the
 * e2e grid specs. What can be pinned down here — and what every bug in this
 * area has actually been — is the codec: which values reach the URL, which are
 * dropped, and what a param round-trips to.
 *
 * The fixture below is deliberately shaped like a real admin grid: a
 * single-select facet with an empty default, a free-text search, a multi-select
 * list, a CLEARABLE sort pair, and the two paging params.
 */

type State = {
  status: string;
  q: string;
  roles: string[];
  sort: string | undefined;
  order: string | undefined;
  page: number;
  pageSize: number;
};

const DEFS: GridParamDefs<State> = {
  status: { kind: 'enum', values: ['active', 'archived'], default: '' },
  q: { kind: 'text' },
  roles: { kind: 'list', values: ['admin', 'member'] },
  sort: { kind: 'enum', values: ['createdAt', 'name'], default: 'createdAt', clearable: true },
  order: { kind: 'enum', values: ['asc', 'desc'], default: 'desc', clearable: true },
  page: { kind: 'int', default: 1, min: 1 },
  pageSize: { kind: 'int', default: 20, values: [20, 50, 100] },
};

const DEFAULTS: State = {
  status: '',
  q: '',
  roles: [],
  sort: 'createdAt',
  order: 'desc',
  page: 1,
  pageSize: 20,
};

const encode = (state: Partial<State>) =>
  encodeGridParams(DEFS, { ...DEFAULTS, ...state }).toString();

const decode = (search: string) => decodeGridParams(DEFS, new URLSearchParams(search));

describe('encodeGridParams()', () => {
  it('omits every param sitting at its default — the bare URL IS the default state', () => {
    expect(encode({})).toBe('');
  });

  it('writes only what differs, in codec declaration order', () => {
    expect(encode({ status: 'active', page: 3, pageSize: 50 })).toBe(
      'status=active&page=3&pageSize=50',
    );
  });

  it('serializes a CLEARED sort as a present-but-empty value', () => {
    // `?sort=` is not the same statement as no `sort` at all: one says "the
    // admin turned the sort off", the other says "whatever the default is".
    expect(encode({ sort: undefined, order: undefined })).toBe('sort=&order=');
  });

  it('drops values the codec does not recognise instead of putting junk in the URL', () => {
    expect(encode({ status: 'not-a-value' })).toBe('');
    expect(encode({ pageSize: 25 })).toBe(''); // not in the server whitelist
    expect(encode({ page: 0 })).toBe(''); // below `min`
    expect(encode({ page: 1.5 })).toBe(''); // not an integer
    expect(encode({ page: Number.NaN })).toBe('');
    expect(encode({ roles: ['admin', 'ghost'] })).toBe('roles=admin');
  });

  it('trims text, caps it, and drops it when it says nothing', () => {
    expect(encode({ q: '  ada  ' })).toBe('q=ada');
    expect(encode({ q: '   ' })).toBe('');
    expect(decode(encode({ q: 'x'.repeat(500) })).q).toHaveLength(200);
  });

  it('joins a multi-select on commas and drops it when nothing is selected', () => {
    expect(encode({ roles: ['admin', 'member'] })).toBe('roles=admin%2Cmember');
    expect(encode({ roles: [] })).toBe('');
  });

  it('never serializes column layout — there is no key for it to land in', () => {
    expect(Object.keys(DEFS)).not.toContain('columns');
    expect(Object.keys(DEFS)).not.toContain('density');
    expect(encode({ status: 'active' })).not.toContain('density');
  });
});

describe('decodeGridParams()', () => {
  it('fills every key, using defaults for the params the URL never mentions', () => {
    expect(decode('')).toEqual(DEFAULTS);
  });

  it('round-trips everything encode() produced', () => {
    const state: State = {
      status: 'archived',
      q: 'ada',
      roles: ['admin', 'member'],
      sort: 'name',
      order: 'asc',
      page: 4,
      pageSize: 100,
    };
    expect(decode(encode(state))).toEqual(state);
  });

  it('round-trips a cleared sort back to undefined, not to the default', () => {
    expect(decode('sort=&order=')).toMatchObject({ sort: undefined, order: undefined });
  });

  it('sends an empty NON-clearable enum back to its default, not to undefined', () => {
    // `status` has `default: ''` and no `clearable`, so `?status=` is not a
    // statement the codec recognises — it hydrates the default.
    expect(decode('status=')).toMatchObject({ status: '' });
  });

  it('falls back silently on anything invalid', () => {
    expect(decode('status=nope')).toMatchObject({ status: '' });
    expect(decode('pageSize=25')).toMatchObject({ pageSize: 20 });
    expect(decode('page=abc')).toMatchObject({ page: 1 });
    expect(decode('page=-3')).toMatchObject({ page: 1 });
    expect(decode('page=1.5')).toMatchObject({ page: 1 });
    expect(decode('sort=whatever')).toMatchObject({ sort: 'createdAt' });
    expect(decode('roles=admin,ghost')).toMatchObject({ roles: ['admin'] });
    expect(decode('roles=,,')).toMatchObject({ roles: [] });
  });

  it('ignores params it does not own', () => {
    expect(decode('tab=events&userId=abc')).toEqual(DEFAULTS);
  });
});

describe('ownedSearch()', () => {
  it('keeps only the owned keys, in codec order, so it can be compared to encode()', () => {
    const search = new URLSearchParams('tab=events&page=3&status=active');
    expect(ownedSearch(DEFS, search)).toBe('status=active&page=3');
  });

  it('matches the encoder for a canonical URL — there is nothing to rewrite', () => {
    const canonical = encode({ status: 'active', page: 2 });
    expect(ownedSearch(DEFS, new URLSearchParams(`${canonical}&tab=events`))).toBe(canonical);
  });

  it('differs from the encoder for a NON-canonical URL, which is what triggers the rewrite', () => {
    const search = new URLSearchParams('pageSize=25&page=1');
    expect(ownedSearch(DEFS, search)).not.toBe(
      encodeGridParams(DEFS, decode(search.toString())).toString(),
    );
  });
});

describe('shouldPush()', () => {
  const PUSH_KEYS = ['status', 'roles', 'sort', 'order'];

  it('pushes on a discrete choice', () => {
    expect(shouldPush('', 'status=active', PUSH_KEYS)).toBe(true);
    expect(shouldPush('sort=name', 'sort=', PUSH_KEYS)).toBe(true);
    expect(shouldPush('', 'roles=admin', PUSH_KEYS)).toBe(true);
  });

  it('replaces on typing or paging', () => {
    expect(shouldPush('status=active', 'status=active&page=2', PUSH_KEYS)).toBe(false);
    expect(shouldPush('status=active', 'status=active&q=ada', PUSH_KEYS)).toBe(false);
    expect(shouldPush('pageSize=20', 'pageSize=50', PUSH_KEYS)).toBe(false);
  });

  it('never pushes when no param is push-worthy', () => {
    expect(shouldPush('page=1', 'page=2', [])).toBe(false);
    expect(shouldPush('', 'status=active', [])).toBe(false);
  });
});
