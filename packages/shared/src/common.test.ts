import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  booleanQuery,
  commaSeparatedList,
  hexColor,
  isoDate,
  isoDateTime,
  jsonValueSchema,
  NONE_SENTINEL,
  paginationQuerySchema,
  slugSchema,
  sortQueryFor,
  sortQuerySchema,
  uuid,
  uuidOrNone,
} from './common';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('identifiers and wire dates', () => {
  it('accepts a uuid and rejects a bare string', () => {
    expect(uuid.parse(UUID_A)).toBe(UUID_A);
    expect(uuid.safeParse('not-a-uuid').success).toBe(false);
  });

  it('accepts both Z and offset instants but not a bare date', () => {
    expect(isoDateTime.safeParse('2026-01-31T09:15:00Z').success).toBe(true);
    expect(isoDateTime.safeParse('2026-01-31T09:15:00+03:00').success).toBe(true);
    expect(isoDateTime.safeParse('2026-01-31').success).toBe(false);
  });

  it('accepts a calendar day but not an instant', () => {
    expect(isoDate.safeParse('2026-01-31').success).toBe(true);
    expect(isoDate.safeParse('2026-01-31T09:15:00Z').success).toBe(false);
  });

  it('accepts both hex color lengths and rejects a named color', () => {
    expect(hexColor.safeParse('#4f46e5').success).toBe(true);
    expect(hexColor.safeParse('#abc').success).toBe(true);
    expect(hexColor.safeParse('rebeccapurple').success).toBe(false);
  });

  it('accepts a dashed slug and rejects uppercase or leading dashes', () => {
    expect(slugSchema.parse('acme-corp')).toBe('acme-corp');
    expect(slugSchema.safeParse('Acme').success).toBe(false);
    expect(slugSchema.safeParse('-acme').success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults to page 1 of 25 when the query is empty', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('coerces the string values a query string actually carries', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('rejects a pageSize above the 100 ceiling and a page below 1', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: '250' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('sort parsing', () => {
  it('splits field and direction', () => {
    expect(sortQuerySchema.parse('dueDate:desc')).toEqual({ field: 'dueDate', direction: 'desc' });
  });

  it('defaults a bare field to ascending', () => {
    expect(sortQuerySchema.parse('dueDate')).toEqual({ field: 'dueDate', direction: 'asc' });
  });

  it('rejects a malformed spec', () => {
    expect(sortQuerySchema.safeParse('dueDate:sideways').success).toBe(false);
    expect(sortQuerySchema.safeParse('due date:asc').success).toBe(false);
  });

  it('restricts the field to the endpoint whitelist', () => {
    const taskSort = sortQueryFor(['createdAt', 'dueDate', 'priority']);

    expect(taskSort.parse('priority:desc')).toEqual({ field: 'priority', direction: 'desc' });
    expect(taskSort.safeParse('passwordHash:asc').success).toBe(false);
  });
});

describe('commaSeparatedList', () => {
  const idList = commaSeparatedList(uuid);

  it('splits, trims and validates every entry', () => {
    expect(idList.parse(`${UUID_A} , ${UUID_B}`)).toEqual([UUID_A, UUID_B]);
  });

  it('accepts an already-split array (a repeated query param)', () => {
    expect(idList.parse([UUID_A, UUID_B])).toEqual([UUID_A, UUID_B]);
  });

  it('drops empty entries from a trailing comma', () => {
    expect(idList.parse(`${UUID_A},`)).toEqual([UUID_A]);
  });

  it('rejects the whole list when one entry is invalid', () => {
    expect(idList.safeParse(`${UUID_A},nope`).success).toBe(false);
  });

  it('works with an enum item schema', () => {
    const types = commaSeparatedList(z.enum(['bug', 'task']));

    expect(types.parse('bug,task')).toEqual(['bug', 'task']);
    expect(types.safeParse('bug,epic').success).toBe(false);
  });

  it('short-circuits when made optional and the param is absent', () => {
    expect(idList.optional().parse(undefined)).toBeUndefined();
  });
});

describe('the none sentinel', () => {
  it('accepts either a uuid or the literal sentinel', () => {
    expect(uuidOrNone.parse(UUID_A)).toBe(UUID_A);
    expect(uuidOrNone.parse(NONE_SENTINEL)).toBe('none');
    expect(uuidOrNone.safeParse('null').success).toBe(false);
  });
});

describe('booleanQuery', () => {
  it('accepts every spelling a URL can carry', () => {
    expect(booleanQuery.parse('true')).toBe(true);
    expect(booleanQuery.parse('1')).toBe(true);
    expect(booleanQuery.parse('false')).toBe(false);
    expect(booleanQuery.parse('0')).toBe(false);
    expect(booleanQuery.parse(true)).toBe(true);
  });

  it('rejects a value that is neither', () => {
    expect(booleanQuery.safeParse('yes').success).toBe(false);
  });
});

describe('jsonValueSchema', () => {
  /**
   * The `activity.old_value` / `new_value` and `notifications.payload` columns.
   *
   * Deliberately NOT `z.unknown()`: an opaque blob still has to SERIALIZE. A
   * function or an `undefined` would survive an `unknown` and then be mangled
   * on the way into Postgres, which turns a diff row into a lie about what
   * changed — and nobody reads an audit row until they are already debugging.
   */
  it('accepts every JSON primitive, including null', () => {
    expect(jsonValueSchema.parse('a')).toBe('a');
    expect(jsonValueSchema.parse(7)).toBe(7);
    expect(jsonValueSchema.parse(false)).toBe(false);
    expect(jsonValueSchema.parse(null)).toBeNull();
  });

  it('recurses through nested arrays and objects', () => {
    const nested = { a: [1, { b: [null, 'c'] }], d: {} };
    expect(jsonValueSchema.parse(nested)).toEqual(nested);
  });

  it('rejects the values `JSON.stringify` would silently drop', () => {
    expect(jsonValueSchema.safeParse(undefined).success).toBe(false);
    expect(jsonValueSchema.safeParse(() => 1).success).toBe(false);
    expect(jsonValueSchema.safeParse({ fn: () => 1 }).success).toBe(false);
    expect(jsonValueSchema.safeParse([undefined]).success).toBe(false);
  });
});
