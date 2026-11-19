/**
 * What the house says about tax in its list prices, read from
 * `GET /settings/tax-basis` (the answer a person gives in Settings). While it
 * is asked, or when the read fails, the sheet says so (`unread`): a failed read
 * is never shown as "nothing stated". No tax rate is recorded for a house yet,
 * so a tax-inclusive house reads as "no rate recorded" until one is.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { apiClient } from '../../../../services/api/client';
import type { ListTax } from './listTax';

interface TaxBasisReadout {
  basis: string;
  readable: boolean;
}

export function listTaxFromReadout(r: TaxBasisReadout | undefined, failed: boolean): ListTax {
  if (!r) return { basis: 'unread', failed };
  if (!r.readable) return { basis: 'unread', failed: true };
  if (r.basis === 'prices_include_tax') return { basis: 'prices_include_tax', ratePct: null };
  if (r.basis === 'prices_exclude_tax' || r.basis === 'not_vat_charging') return { basis: r.basis };
  return { basis: 'unset' };
}

export function useListTax(): ListTax {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['settings', 'tax-basis', activeRestaurantId ?? null],
    enabled: Boolean(activeRestaurantId),
    queryFn: async () => (await apiClient.get<TaxBasisReadout>('/settings/tax-basis')).data,
    staleTime: 5 * 60_000,
  });
  return listTaxFromReadout(q.data, q.isError);
}
