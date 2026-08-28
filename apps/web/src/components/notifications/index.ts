/**
 * The notification feature's public surface.
 *
 * The INTEGRATOR needs exactly one of these: `<NotificationsBridge />`, mounted
 * anywhere inside the authed tree. It registers the bell into the topbar and
 * keeps the badge fresh across tab focus; everything else here is internal to
 * the feature and exported for tests and for the notification centre page.
 */
export { default as NotificationsBridge } from './NotificationsBridge';
export { default as NotificationBell } from './NotificationBell';
export { default as NotificationRow } from './NotificationRow';
export {
  dayHeading,
  groupByDay,
  notificationDay,
  notificationDetail,
  notificationSentence,
  sentenceValues,
  SENTENCE_KEYS,
  type NotificationGroup,
  type Translate,
} from './notification-sentence';
