import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryEventInsert } from '../types/persistence';
import { hasTelemetrySink, record, setTelemetrySink } from './telemetry.service';

describe('telemetry.service', () => {
  afterEach(() => {
    setTelemetrySink(null);
  });

  it('is a no-op with no sink configured', () => {
    expect(hasTelemetrySink()).toBe(false);
    expect(() => {
      record('task_created');
    }).not.toThrow();
  });

  it('forwards a fully-populated row to the sink', async () => {
    const rows: TelemetryEventInsert[] = [];
    setTelemetrySink(async (event) => {
      rows.push(event);
      await Promise.resolve();
    });

    record(
      'task_created',
      // The task id rides in the payload — `telemetry_events` has no task
      // column, by design (see `TelemetryContext`).
      { taskId: 'task-1', type: 'bug' },
      { userId: 'user-1', orgId: 'org-1', projectId: 'project-1' },
    );

    await Promise.resolve();
    expect(rows).toEqual([
      {
        type: 'task_created',
        userId: 'user-1',
        orgId: 'org-1',
        projectId: 'project-1',
        payload: { taskId: 'task-1', type: 'bug' },
      },
    ]);
  });

  it('nulls every id and the payload when no context is given', async () => {
    const sink = vi.fn(async () => {
      await Promise.resolve();
    });
    setTelemetrySink(sink);

    record('page_view');

    await Promise.resolve();
    expect(sink).toHaveBeenCalledExactlyOnceWith({
      type: 'page_view',
      userId: null,
      orgId: null,
      projectId: null,
      payload: null,
    });
  });

  it('returns synchronously — it never awaits the sink', () => {
    let settled = false;
    setTelemetrySink(async () => {
      await Promise.resolve();
      settled = true;
    });

    record('task_created');

    expect(settled).toBe(false);
  });

  it('swallows a rejected sink', async () => {
    setTelemetrySink(() => Promise.reject(new Error('db down')));

    expect(() => {
      record('task_created');
    }).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    // Reaching here without an unhandled rejection IS the assertion.
    expect(hasTelemetrySink()).toBe(true);
  });

  it('swallows a sink that throws synchronously (a mis-wired injection)', () => {
    setTelemetrySink(() => {
      throw new Error('bad wiring');
    });

    expect(() => {
      record('task_created');
    }).not.toThrow();
  });

  it('can be detached', () => {
    setTelemetrySink(async () => {
      await Promise.resolve();
    });
    expect(hasTelemetrySink()).toBe(true);

    setTelemetrySink(null);
    expect(hasTelemetrySink()).toBe(false);
  });
});
