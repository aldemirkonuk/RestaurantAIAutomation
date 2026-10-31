/**
 * The opened row's receipts read (INV-W8). The gateway's ledger query DTO has
 * no number transform, so any `limit` is refused with a 400: the page must not
 * send one, and keeps the newest three itself.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));
vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { get },
}));
vi.mock('../../../services/api/documents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  documentsApi: { forOrder: vi.fn(async () => []) },
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchAuctionLotRecords: vi.fn(async () => []),
}));

import { useRowDetail } from './useInventoryNextData';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRowDetail receipts', () => {
  it('sends no limit and keeps the newest three of what the ledger answers', async () => {
    const tx = (n: number) => ({ id: `t${n}`, transactionDate: `2026-09-0${n}T10:00:00Z`, quantityChange: 6, unitCost: 20, orderId: null });
    get.mockResolvedValueOnce({ data: { transactions: [tx(5), tx(4), tx(3), tx(2), tx(1)], total: 5 } });

    const { result } = renderHook(() => useRowDetail('i1'), { wrapper });
    await waitFor(() => expect(result.current.purchases).not.toBeNull());

    expect(get).toHaveBeenCalledTimes(1);
    const [url, config] = get.mock.calls[0];
    expect(url).toBe('/inventory-ledger/transactions');
    expect(config.params).toEqual({ inventoryId: 'i1', transactionType: 'purchase' });
    expect('limit' in config.params).toBe(false);
    expect(result.current.purchases?.map((l) => l.id)).toEqual(['t5', 't4', 't3']);
    expect(result.current.purchasesTotal).toBe(5);
  });
});
