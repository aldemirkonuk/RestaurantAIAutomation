/**
 * The one unread count every surface prints (F-256).
 *
 * The bell, the /notifications page and the rail each read
 * `GET /notifications/unread/count` on their own clock — the bell every 60 s,
 * the page every 10 s, the rail on a 30 s React Query poll that nothing ever
 * invalidated. After "Rule all off" the bell was empty while the rail still
 * said 99+, and when the rail's read failed it printed nothing at all while the
 * bell printed its hollow "unknown" marker.
 *
 * So the last answer ANY of them got is published here, and every surface
 * draws that one. `count: null` is a read that failed: it is published too, so
 * a failure is never shown as a calm house on one surface and as unknown on
 * another. The entry carries the restaurant it was read for, and a reader asks
 * for its own — a house switch never shows the previous house's number.
 */

import { useSyncExternalStore } from 'react';

export interface SharedUnread {
  restaurantId: string;
  /** The register's unread count; null when the read failed. */
  count: number | null;
  /** Why the count is unknown, in words; null when it is known. */
  note: string | null;
}

let current: SharedUnread | null = null;
const listeners = new Set<() => void>();

export function publishUnreadCount(next: SharedUnread): void {
  if (
    current &&
    current.restaurantId === next.restaurantId &&
    current.count === next.count &&
    current.note === next.note
  ) {
    return;
  }
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The shared count for this restaurant, or null when nobody has read it yet. */
export function useSharedUnreadCount(restaurantId: string | null | undefined): SharedUnread | null {
  const snap = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  return restaurantId && snap?.restaurantId === restaurantId ? snap : null;
}

/** Tests only: forget the last answer. */
export function resetSharedUnreadCount(): void {
  current = null;
  for (const l of listeners) l();
}
