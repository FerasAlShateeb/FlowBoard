/**
 * Notification subscribers — domain events → notification rows (+ socket push).
 *
 * OWNED BY WP4.2. `bootstrap.ts` calls this once, from the composition root.
 *
 * ═══ WHY EVERY HANDLER IS `void … .catch(log)` ════════════════════════════
 *
 * The bus invokes handlers synchronously and swallows their rejections already
 * (`utils/domain-events.ts`), so this belt-and-braces shape buys two specific
 * things the bus cannot:
 *
 *   - **A LOG LINE THAT NAMES THE TRIGGER.** The bus logs `Domain event handler
 *     rejected` with the event name; this logs which fan-out failed and for
 *     which task, which is the difference between a diagnosable bug and a
 *     shrug.
 *   - **AN EXPLICIT STATEMENT OF THE CONTRACT.** A notification is a courtesy
 *     attached to a mutation that has ALREADY COMMITTED. There is no state in
 *     which failing to write one should surface to the user who moved the card,
 *     and writing it this way means nobody later "fixes" it by awaiting.
 *
 * SUBSCRIPTIONS ARE NOT REMOVED. The bus's `onDomainEvent` returns an
 * unsubscribe, but this runs once per process at startup and the process exits
 * when it is done; tests use `clearDomainEventHandlers()` instead.
 */
import { onDomainEvent } from '../utils/domain-events';
import { logger } from '../utils/logger';
import {
  handleCommentCreated,
  handleSprintChanged,
  handleTaskCreated,
  handleTaskMoved,
  handleTaskUpdated,
  startDueSoonSweep,
} from './notifications.service';

/** Fire-and-forget with a trigger-specific log line. Never rethrows. */
function dispatch(trigger: string, context: Record<string, unknown>, run: () => Promise<void>) {
  void run().catch((error: unknown) => {
    logger.error({ err: error, trigger, ...context }, 'Notification fan-out failed');
  });
}

/**
 * Subscribe every trigger and start the due-soon sweep.
 *
 * `task.moved` is subscribed alongside `task.updated` on purpose: a Kanban drop
 * is the most common way a status changes in this product, and it publishes
 * `task.moved`, not `task.updated`. See `handleTaskMoved` for how it tells a
 * genuine column change from a re-order.
 */
export function registerNotificationSubscribers(): void {
  onDomainEvent('task.created', (event) => {
    dispatch('task.created', { taskId: event.taskId }, () => handleTaskCreated(event));
  });

  onDomainEvent('task.updated', (event) => {
    dispatch('task.updated', { taskId: event.taskId }, () => handleTaskUpdated(event));
  });

  onDomainEvent('task.moved', (event) => {
    dispatch('task.moved', { taskId: event.taskId }, () => handleTaskMoved(event));
  });

  onDomainEvent('comment.created', (event) => {
    dispatch('comment.created', { commentId: event.commentId }, () => handleCommentCreated(event));
  });

  onDomainEvent('sprint.changed', (event) => {
    dispatch('sprint.changed', { sprintId: event.sprintId }, () => handleSprintChanged(event));
  });

  // The seventh trigger has no domain event behind it — nothing HAPPENS when a
  // due date approaches, so it is swept on a timer. No-op under NODE_ENV=test.
  startDueSoonSweep();
}
