import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDomainEventHandlers,
  domainEventHandlerCount,
  onDomainEvent,
  publishDomainEvent,
  type DomainEventMap,
} from './domain-events';
import { logger } from './logger';

const moved: DomainEventMap['task.moved'] = {
  projectId: 'project-1',
  actorId: 'user-1',
  originSocketId: 'socket-1',
  taskId: 'task-1',
  statusId: 'status-1',
  boardRank: 'a0',
  rebalanced: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('domain-events', () => {
  afterEach(() => {
    clearDomainEventHandlers();
    vi.restoreAllMocks();
  });

  it('delivers a payload to a subscriber', () => {
    const handler = vi.fn();
    onDomainEvent('task.moved', handler);

    publishDomainEvent('task.moved', moved);

    expect(handler).toHaveBeenCalledExactlyOnceWith(moved);
  });

  it('delivers to every subscriber, in registration order', () => {
    const calls: string[] = [];
    onDomainEvent('task.moved', () => {
      calls.push('first');
    });
    onDomainEvent('task.moved', () => {
      calls.push('second');
    });

    publishDomainEvent('task.moved', moved);

    expect(calls).toEqual(['first', 'second']);
  });

  it('does not deliver across event names', () => {
    const handler = vi.fn();
    onDomainEvent('task.created', handler);

    publishDomainEvent('task.moved', moved);

    expect(handler).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is subscribed', () => {
    expect(() => {
      publishDomainEvent('workflow.changed', {
        projectId: 'p',
        actorId: 'u',
        originSocketId: null,
        change: 'statuses',
      });
    }).not.toThrow();
  });

  it('unsubscribes', () => {
    const handler = vi.fn();
    const off = onDomainEvent('task.moved', handler);
    expect(domainEventHandlerCount('task.moved')).toBe(1);

    off();
    expect(domainEventHandlerCount('task.moved')).toBe(0);

    publishDomainEvent('task.moved', moved);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is safe for a handler to unsubscribe itself mid-publish', () => {
    const second = vi.fn();
    const off = onDomainEvent('task.moved', () => {
      off();
    });
    onDomainEvent('task.moved', second);

    expect(() => {
      publishDomainEvent('task.moved', moved);
    }).not.toThrow();
    // The snapshot taken at publish time still reaches the later subscriber.
    expect(second).toHaveBeenCalledOnce();
    expect(domainEventHandlerCount('task.moved')).toBe(1);
  });

  describe('handler failures never reach the publisher', () => {
    it('swallows and logs a synchronous throw', () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const later = vi.fn();
      onDomainEvent('task.moved', () => {
        throw new Error('subscriber exploded');
      });
      onDomainEvent('task.moved', later);

      expect(() => {
        publishDomainEvent('task.moved', moved);
      }).not.toThrow();
      // A broken subscriber must not starve the ones behind it.
      expect(later).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledOnce();
    });

    it('swallows and logs a rejected promise', async () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      onDomainEvent('task.moved', () => Promise.reject(new Error('async boom')));

      expect(() => {
        publishDomainEvent('task.moved', moved);
      }).not.toThrow();

      // Let the rejection settle.
      await Promise.resolve();
      await Promise.resolve();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  it('does not await async handlers (publish stays synchronous)', () => {
    let resolved = false;
    onDomainEvent('task.moved', async () => {
      await Promise.resolve();
      resolved = true;
    });

    publishDomainEvent('task.moved', moved);

    expect(resolved).toBe(false);
  });
});
