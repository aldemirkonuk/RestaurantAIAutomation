/**
 * ProvidersNext data — live data through the existing hooks only, shaped for
 * the founder's MERGE verdict: a small, closed card per vendor (the virtue of
 * today's page) with the learned detail held back for the sheet (the virtue
 * of the redesign). The card gets at most three facts, all real:
 *
 *   open orders    — counted by the gateway over the whole orders book;
 *   lead time      — the provider's own leadTimeDays, EM when unrecorded;
 *   last contact   — lastContactDate, said plainly when absent.
 *
 * Nothing here invents a "behavioural" figure the backend does not hold —
 * what their mail has told us lives in the sheet via LearnedSection, which
 * fetches its own evidence.
 */

import { useMemo } from 'react';
import { useProviders } from '../../../hooks/queries/useProviderQueries';
import { useOpenOrderCountsByProvider } from '../../../hooks/queries/useOrderQueries';
import { useAuth } from '../../../contexts/AuthContext';
import type { Provider } from '../../../services/api/providers';
import { num } from './pv-format';

export interface ProviderCardVM {
  provider: Provider;
  /** null while the orders book is unknown (loading/error) — render EM. */
  openOrders: number | null;
  leadTimeDays: number | null;
  lastContact: string | null;
}

export function useProvidersNextData() {
  const { activeRestaurantId } = useAuth();
  const providersQ = useProviders(activeRestaurantId ?? '');
  // Counted by the gateway over the whole book (F-905): the open stages are
  // `OPEN_ORDER_STATUSES` in procurement.service.ts. Paging every order into
  // the browser to count them grew with the house's history.
  const ordersQ = useOpenOrderCountsByProvider();

  const openByProvider = useMemo(() => {
    if (!ordersQ.data) return null;
    return new Map(Object.entries(ordersQ.data));
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
