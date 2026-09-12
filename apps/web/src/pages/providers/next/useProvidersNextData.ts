/**
 * ProvidersNext data — live data through the existing hooks only, shaped for
 * the founder's MERGE verdict: a small, closed card per vendor (the virtue of
 * today's page) with the learned detail held back for the sheet (the virtue
 * of the redesign). The card gets at most three facts, all real:
 *
 *   open orders    — counted from the orders book (pending/approved/ordered);
 *   lead time      — the provider's own leadTimeDays, EM when unrecorded;
 *   last contact   — lastContactDate, said plainly when absent.
 *
 * Nothing here invents a "behavioural" figure the backend does not hold —
 * the digital twin lives in the sheet via ProviderIntelligencePanel, which
 * fetches its own evidence.
 */

import { useMemo } from 'react';
import { useProviders } from '../../../hooks/queries/useProviderQueries';
import { useOrders } from '../../../hooks/queries/useOrderQueries';
import { useAuth } from '../../../contexts/AuthContext';
import type { Provider } from '../../../services/api/providers';
import { canonicalStatus } from '../../../lib/mudavym/status';
import { num } from './pv-format';

export interface ProviderCardVM {
  provider: Provider;
  /** null while the orders book is unknown (loading/error) — render EM. */
  openOrders: number | null;
  leadTimeDays: number | null;
  lastContact: string | null;
}

/**
 * "Open" = live business with the vendor: not yet delivered, not closed.
 * Matched on the CANONICAL status (canonicalStatus knows the gateway's
 * SCREAMING_SNAKE variants — PENDING, APPROVAL_NEEDED, CONFIRMED, IN_TRANSIT —
 * that raw lowercasing silently dropped; audit finding, providers-audit.md).
 */
const OPEN_STAGES = new Set([
  'pending',
  'pending_approval',
  'negotiating',
  'approved',
  'ordered',
  'in_transit',
  'partially_received',
]);

export function useProvidersNextData() {
  const { activeRestaurantId } = useAuth();
  const providersQ = useProviders(activeRestaurantId ?? '');
  const ordersQ = useOrders();

  const openByProvider = useMemo(() => {
    if (!ordersQ.data) return null;
    const m = new Map<string, number>();
    for (const o of ordersQ.data) {
      if (!o.providerId || !OPEN_STAGES.has(canonicalStatus(o.status))) continue;
      m.set(o.providerId, (m.get(o.providerId) ?? 0) + 1);
    }
    return m;
  }, [ordersQ.data]);

  const cards: ProviderCardVM[] = useMemo(() => {
    const providers = providersQ.data ?? [];
    return providers
      .map((p) => ({
        provider: p,
        openOrders: openByProvider === null ? null : (openByProvider.get(p.id) ?? 0),
        leadTimeDays: num(p.leadTimeDays),
        lastContact: p.lastContactDate ?? null,
      }))
      .sort((a, b) => {
        // Vendors with open business first, then by name — a scanning order,
        // not a ranking claim.
        const ao = a.openOrders ?? 0;
        const bo = b.openOrders ?? 0;
        if (ao !== bo) return bo - ao;
        return a.provider.name.localeCompare(b.provider.name);
      });
  }, [providersQ.data, openByProvider]);

  return {
    cards,
    hasData: providersQ.data !== undefined,
    isError: providersQ.isError,
    errorMessage:
      providersQ.error instanceof Error ? providersQ.error.message : 'unknown error',
    ordersKnown: openByProvider !== null,
    refetch: () => {
      void providersQ.refetch();
      void ordersQ.refetch();
    },
  };
}
