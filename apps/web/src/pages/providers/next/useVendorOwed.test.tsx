/**
 * F-1635 remainder (S230): what is owed to a vendor was on /reports only. The
 * vendor's sheet on /vendors now says it too, owners and managers only, in the
 * reports shelf's words. Every [REVERT-FAILS] case failed on a build without
 * `useVendorOwed`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { setHouseCurrency, setHouseLocale } from '@/lib/houseCurrency';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'h1', user: { role: 'owner' }, activeRole: 'owner' }),
}));

import { useVendorOwed } from './useVendorOwed';

const ROSSI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const row = (over: Record<string, unknown> = {}) => ({
  providerId: ROSSI,
  name: 'Rossi Wines',
  received: [],
  receivedOrders: 0,
  unpricedOrders: 0,
  awaitingOrders: 0,
  awaiting: [],
  invoiced: [],
  invoices: 0,
  credited: [],
  creditNotes: 0,
  paperWithoutTotal: 0,
  unpaid: [],
  unpaidInvoices: 0,
  unpaidWithoutTotal: 0,
  owed: [],
  owedInvoices: 0,
  owedCreditNotes: 0,
  owedWithoutTotal: 0,
  ...over,
});

const answer = (vendors: unknown[], owedSince: string | null) => ({
  data: {
    from: '2026-10-14',
    to: '2026-10-14',
    zone: 'Europe/Istanbul',
    currency: 'EUR',
    vendors,
    totals: { received: [], awaiting: [], invoiced: [], credited: [], unpaid: [], owed: [] },
    owedSince,
    unverifiedPaper: 0,
    duplicatePaper: 0,
    paperWithoutCurrency: 0,
    basis: [],
  },
});

function wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe('useVendorOwed (F-1635)', () => {
  beforeEach(() => {
    api.get.mockReset();
    setHouseCurrency('EUR');
    setHouseLocale('en-GB');
  });

  it('[REVERT-FAILS] says what this vendor is owed, credit notes off, and the older invoices apart', async () => {
    api.get.mockResolvedValue(
      answer(
        [
          row({
            owed: [{ currency: 'EUR', total: 1000 }],
            owedInvoices: 2,
            owedCreditNotes: 1,
            unpaid: [{ currency: 'EUR', total: 9000 }],
            unpaidInvoices: 3,
          }),
        ],
        '2026-10-14',
      ),
    );
    const { result } = renderHook(() => useVendorOwed(ROSSI, true), { wrapper });
    await waitFor(() => expect(result.current[0].value).not.toBe('Reading…'));
    expect(api.get.mock.calls[0][0]).toBe('/reports/vendor-spend');
    expect(result.current[0].label).toBe('Owed');
    expect(result.current[0].value).toMatch(/^€1,000(\.00)? over 2 invoices, less 1 credit note$/);
    expect(result.current[1].label).toBe('Not marked paid');
    expect(result.current[1].value).toMatch(/^€9,000(\.00)? over 3 invoices, dated before 2026-10-14$/);
  });

  it('[REVERT-FAILS] never calls an old unmarked invoice owed when nothing has been marked paid', async () => {
    api.get.mockResolvedValue(
      answer([row({ unpaid: [{ currency: 'EUR', total: 9000 }], unpaidInvoices: 3 })], null),
    );
    const { result } = renderHook(() => useVendorOwed(ROSSI, true), { wrapper });
    await waitFor(() => expect(result.current[0].value).not.toBe('Reading…'));
    expect(result.current[0].value).toBe('Not worked out yet: no invoice has been marked paid here');
    expect(result.current[1].value).toMatch(/^€9,000(\.00)? over 3 invoices$/);
  });

  it('a vendor with nothing on file is owed nothing; staff are not asked for it at all', async () => {
    api.get.mockResolvedValue(answer([], '2026-10-01'));
    const owner = renderHook(() => useVendorOwed(ROSSI, true), { wrapper });
    await waitFor(() => expect(owner.result.current[0].value).toBe('Nothing'));
    api.get.mockReset();
    const staff = renderHook(() => useVendorOwed(ROSSI, false), { wrapper });
    expect(staff.result.current).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });
});
