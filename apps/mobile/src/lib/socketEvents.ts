/**
 * The live-event contract, kept separate from the socket so it can be tested
 * without a server.
 *
 * These names are not a guess. They are every event the gateway actually
 * emits — `apps/api-gateway/src/websocket/websocket.gateway.ts` lines 366-519,
 * each one through `emitToRoom(room, event, payload)`. The previous mobile
 * client listened for `order:updated` and `order_change`, neither of which the
 * gateway has ever emitted, so two of its three subscriptions were dead on
 * arrival even before the namespace bug below.
 */

/** Query-key prefixes the app invalidates. Mirrors `src/api/queries.ts`. */
export type QueryPrefix =
  | "mobile-feed"
  | "mobile-pulse"
  | "inventory"
  | "orders"
  | "calendar"
  | "notifications"
  | "analytics";

/** Prefix name → the actual react-query key prefix array. */
export const PREFIX_KEY: Record<QueryPrefix, readonly unknown[]> = {
  "mobile-feed": ["mobile", "feed"],
  "mobile-pulse": ["mobile", "pulse"],
  inventory: ["inventory"],
  orders: ["orders"],
  calendar: ["calendar"],
  notifications: ["notifications"],
  analytics: ["analytics"],
};

/**
 * Server event → the caches it invalidates.
 *
 * The feed is the decision surface, so anything that can add or retire a
 * decision refreshes it: an approval handled on web disappears from the phone
 * within a beat instead of within the 60s poll.
 */
export const EVENT_INVALIDATIONS: Record<string, readonly QueryPrefix[]> = {
  "stock:updated": ["inventory", "mobile-feed", "mobile-pulse"],
  "stock:low": ["inventory", "mobile-feed", "notifications"],
  "order:created": ["orders", "mobile-feed"],
  "order:status_changed": ["orders", "mobile-feed", "mobile-pulse"],
  "notification:new": ["notifications", "mobile-feed"],
  "report:ready": ["analytics"],
  "calendar:event_created": ["calendar"],
  "calendar:event_updated": ["calendar"],
  "conversation:updated": ["orders"],
  "conversation:summary_updated": ["orders"],
};

/** Every event name the client subscribes to. */
export const LIVE_EVENTS: readonly string[] = Object.keys(EVENT_INVALIDATIONS);

/**
 * Resolve an event name to the query keys to invalidate.
 * Unknown events resolve to `[]` — a server that grows a new event must not
 * make the phone throw.
 */
export function invalidationsFor(event: string): readonly unknown[][] {
  const prefixes = EVENT_INVALIDATIONS[event];
  if (!prefixes) return [];
  return prefixes.map((p) => [...PREFIX_KEY[p]]);
}

/**
 * The gateway declares `namespace: "/ws"` (websocket.gateway.ts:161), so the
 * namespace is part of the connect URL — exactly as the web client does it at
 * `apps/web/src/lib/websocket.tsx:394`. Connecting to the bare origin lands on
 * the default `/` namespace, where nothing is ever emitted.
 */
export function socketUrl(base: string): string {
  return `${base.replace(/\/$/, "")}/ws`;
}
