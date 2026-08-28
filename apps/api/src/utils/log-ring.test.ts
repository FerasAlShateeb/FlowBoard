import { beforeEach, describe, expect, it } from 'vitest';
import { RING_CAPACITY, clearRing, push, ringStream, snapshot } from './log-ring';

/** Build a raw pino-shaped record. */
function line(level: number, msg: string, extra: Record<string, unknown> = {}): unknown {
  return { level, time: 1_700_000_000_000, msg, pid: 123, hostname: 'test-host', ...extra };
}

describe('log-ring', () => {
  beforeEach(() => {
    clearRing();
  });

  it('starts empty with lastId 0', () => {
    expect(snapshot()).toEqual({ records: [], lastId: 0 });
  });

  it('stamps strictly monotonic ids starting at 1', () => {
    push(line(30, 'a'));
    push(line(30, 'b'));
    push(line(30, 'c'));

    const { records, lastId } = snapshot();
    expect(records.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(lastId).toBe(3);
  });

  it('strips pino reserved keys into the record and keeps the rest as context', () => {
    push(line(40, 'boom', { requestId: 'req-1', nested: { a: 1 } }));

    const [record] = snapshot().records;
    expect(record).toBeDefined();
    expect(record?.level).toBe('warn');
    expect(record?.msg).toBe('boom');
    expect(record?.time).toBe(1_700_000_000_000);
    expect(record?.context).toEqual({ requestId: 'req-1', nested: { a: 1 } });
    // level/time/msg/pid/hostname must NOT leak into context.
    expect(record?.context).not.toHaveProperty('pid');
    expect(record?.context).not.toHaveProperty('hostname');
    expect(record?.context).not.toHaveProperty('level');
  });

  it('defaults a missing/odd level to info and a missing msg to an empty string', () => {
    push({ time: 1, foo: 'bar' });
    const [record] = snapshot().records;
    expect(record?.level).toBe('info');
    expect(record?.msg).toBe('');
    expect(record?.context).toEqual({ foo: 'bar' });
  });

  it('maps an unknown numeric level to info', () => {
    push(line(35, 'odd'));
    expect(snapshot().records[0]?.level).toBe('info');
  });

  it('ignores non-object payloads', () => {
    push('not an object');
    push(null);
    push(42);
    expect(snapshot().records).toHaveLength(0);
  });

  describe('eviction', () => {
    it('never holds more than RING_CAPACITY records', () => {
      for (let i = 0; i < RING_CAPACITY + 50; i += 1) push(line(30, `msg-${String(i)}`));

      const { records, lastId } = snapshot();
      expect(records).toHaveLength(RING_CAPACITY);
      expect(lastId).toBe(RING_CAPACITY + 50);
    });

    it('drops the OLDEST records and never reuses their ids', () => {
      for (let i = 0; i < RING_CAPACITY + 10; i += 1) push(line(30, `msg-${String(i)}`));

      const { records } = snapshot();
      // ids 1..10 were evicted; the window is 11..510.
      expect(records[0]?.id).toBe(11);
      expect(records.at(-1)?.id).toBe(RING_CAPACITY + 10);
      expect(records[0]?.msg).toBe('msg-10');
    });

    it('keeps a cursor valid across eviction (nothing is served twice)', () => {
      for (let i = 0; i < 10; i += 1) push(line(30, `first-${String(i)}`));
      const cursor = snapshot().lastId;

      // Overflow the ring completely.
      for (let i = 0; i < RING_CAPACITY + 5; i += 1) push(line(30, `second-${String(i)}`));

      const after = snapshot({ sinceId: cursor });
      expect(after.records.every((r) => r.id > cursor)).toBe(true);
      expect(after.records).toHaveLength(RING_CAPACITY);
      expect(after.lastId).toBe(RING_CAPACITY + 15);
    });
  });

  describe('sinceId', () => {
    it('returns only records strictly greater than the cursor', () => {
      push(line(30, 'a'));
      push(line(30, 'b'));
      push(line(30, 'c'));

      const { records } = snapshot({ sinceId: 1 });
      expect(records.map((r) => r.msg)).toEqual(['b', 'c']);
    });

    it('returns nothing when the cursor is already at the head', () => {
      push(line(30, 'a'));
      const { records, lastId } = snapshot({ sinceId: 1 });
      expect(records).toHaveLength(0);
      expect(lastId).toBe(1);
    });

    it('treats sinceId 0 as "everything"', () => {
      push(line(30, 'a'));
      expect(snapshot({ sinceId: 0 }).records).toHaveLength(1);
    });
  });

  describe('level filter', () => {
    beforeEach(() => {
      push(line(10, 'trace'));
      push(line(20, 'debug'));
      push(line(30, 'info'));
      push(line(40, 'warn'));
      push(line(50, 'error'));
      push(line(60, 'fatal'));
    });

    it('includes the requested level and everything above it', () => {
      const { records } = snapshot({ level: 'warn' });
      expect(records.map((r) => r.level)).toEqual(['warn', 'error', 'fatal']);
    });

    it('includes everything at trace', () => {
      expect(snapshot({ level: 'trace' }).records).toHaveLength(6);
    });

    it('reports lastId as the ring head regardless of the filter', () => {
      const filtered = snapshot({ level: 'fatal' });
      expect(filtered.records).toHaveLength(1);
      // 6 lines pushed → head is 6, NOT the id of the single matching record.
      expect(filtered.lastId).toBe(6);
    });
  });

  describe('limit', () => {
    beforeEach(() => {
      for (let i = 1; i <= 20; i += 1) push(line(30, `msg-${String(i)}`));
    });

    it('tail-slices (newest wins) rather than head-slices', () => {
      const { records } = snapshot({ limit: 3 });
      expect(records.map((r) => r.msg)).toEqual(['msg-18', 'msg-19', 'msg-20']);
    });

    it('caps at RING_CAPACITY even when asked for more', () => {
      clearRing();
      for (let i = 0; i < RING_CAPACITY + 100; i += 1) push(line(30, 'x'));
      expect(snapshot({ limit: 100_000 }).records).toHaveLength(RING_CAPACITY);
    });

    it('combines with sinceId and level', () => {
      push(line(50, 'e1'));
      push(line(50, 'e2'));
      const { records } = snapshot({ sinceId: 5, level: 'error', limit: 1 });
      expect(records.map((r) => r.msg)).toEqual(['e2']);
    });
  });

  describe('restart semantics', () => {
    it('rewinds ids after a process restart, which the client detects via lastId', () => {
      for (let i = 0; i < 30; i += 1) push(line(30, 'before'));
      const cursorFromPreviousProcess = snapshot().lastId;
      expect(cursorFromPreviousProcess).toBe(30);

      // A restart is exactly this: a fresh ring and a counter back at 1.
      clearRing();
      push(line(30, 'after'));

      const fresh = snapshot({ sinceId: cursorFromPreviousProcess });
      // The stale cursor is "in the future" — nothing matches …
      expect(fresh.records).toHaveLength(0);
      // … and lastId < sinceId is the signal the drawer rewinds on.
      expect(fresh.lastId).toBeLessThan(cursorFromPreviousProcess);
    });
  });

  describe('ringStream', () => {
    it('parses and pushes a JSON line', () => {
      ringStream.write(JSON.stringify(line(50, 'from stream', { scope: 'io' })));

      const [record] = snapshot().records;
      expect(record?.level).toBe('error');
      expect(record?.msg).toBe('from stream');
      expect(record?.context).toEqual({ scope: 'io' });
    });

    it('swallows malformed lines instead of throwing into the logger', () => {
      expect(() => {
        ringStream.write('{not json');
      }).not.toThrow();
      expect(snapshot().records).toHaveLength(0);
    });
  });
});
