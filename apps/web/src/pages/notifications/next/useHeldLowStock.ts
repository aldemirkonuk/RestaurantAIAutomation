/**
 * useHeldLowStock — the held low-stock queue, read for the day-book.
 *
 * Founder, 2026-09-26, round 8 (ADR 0149): the three legacy-only features are
 * built into the new pages before the cutover, and this is one of them. The
 * legacy `/notifications` read `GET /notifications/low-stock/held/:rid` at
 * `pages/Notifications.tsx:221-223`; nothing on the Mudavym page did, so
 * deleting legacy would have deleted the only screen that says "these wines
 * are below par and nobody has been told yet".
 *
 * WHAT "HELD" MEANS, end to end (`low-stock-alerts.service.ts`): a wine
 * crossed below par, the alert ledger recorded the crossing, and the house
 * deliberately did not tell anyone — either another instant alert went out in
 * the last 15 minutes (`instant_cooldown`), or the house's own preferences
 * save non-critical crossings for the daily digest (`prefs`). The hold ends
 * when an instant alert or the digest writes an inbox row, or when the wine
 * comes back above par.
 *
 * Three states, never two (ADR 0067): an empty held queue is good news and has
 * to be MEASURED — a failed read is `unreadable`, and says whether it was a
 * refusal (retrying changes nothing) or a breakage.
 *
 * The path carries the house id because the endpoint was built that way; the
 * gateway refuses any id that is not the token's house
 * (`notifications.controller.ts`, `scopeOwnRestaurant`) and reads with the
 * token's id, so this can only ever read the caller's own house.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchHeldLowStock, type HeldLowStockResponse } from '@/services/api/notifications';
import { failureOf, type FailureVM } from './useNotificationsNextData';

export type HeldVM =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: FailureVM }
  | { state: 'ready'; view: HeldLowStockResponse };

/** The legacy page kept this for a minute; the queue moves on the 2-minute sweep. */
export const HELD_POLL_MS = 60_000;

export function useHeldLowStock(): HeldVM & { refresh: () => void } {
  const { activeRestaurantId } = useAuth();
  const [vm, setVm] = useState<HeldVM>({ state: 'loading' });
  const tenant = useRef<string | null>(activeRestaurantId);

  // A house switch must never leave the previous house's wines on screen.
  useEffect(() => {
    tenant.current = activeRestaurantId;
    setVm({ state: 'loading' });
  }, [activeRestaurantId]);

  const read = useCallback(async () => {
    // Identity still resolving: stay loading rather than fail once and stick
    // (the legacy page's measured bug — an ungated first read reported
    // "could not be read" over a queue that reads fine).
    if (!activeRestaurantId) return;
    const forTenant = activeRestaurantId;
    try {
      const view = await fetchHeldLowStock(forTenant);
      if (tenant.current !== forTenant) return;
      const held = Array.isArray(view?.held) ? view.held : [];
      setVm({
        state: 'ready',
        view: {
          restaurant_id: view?.restaurant_id ?? forTenant,
          held,
          // Counted from the rows drawn, so the headline can never disagree
          // with the list under it.
          summary: {
            count: held.length,
            critical: held.filter((h) => h.level === 'critical').length,
            oldest_held_at: view?.summary?.oldest_held_at ?? null,
          },
          // `undefined` (an older gateway) and `null` (unreadable prefs) both
          // mean "not known" to the page.
          digest: view?.digest ?? null,
        },
      });
    } catch (err) {
      if (tenant.current !== forTenant) return;
      setVm({ state: 'unreadable', failure: failureOf(err) });
    }
  }, [activeRestaurantId]);

  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), HELD_POLL_MS);
    return () => clearInterval(id);
  }, [read]);

  return { ...vm, refresh: () => void read() };
}
