/**
 * The opened row reads only what a drawn panel shows (inventory r36 audit,
 * gap 7). What is not asked for is never requested and stays null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(), forOrder: vi.fn(), lots: vi.fn() }));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));
vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { get: api.get },
}));
vi.mock('../../../services/api/documents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  documentsApi: { forOrder: api.forOrder },
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchAuctionLotRecords: api.lots,
}));

import { useRowDetail } from './useInventoryNextData';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const LEDGER = {
  data: {
    transactions: [{ id: 't1', transactionDate: '2026-09-01T10:00:00Z', quantityChange: 6, unitCost: 20, orderId: 'o1' }],
    total: 1,
  },
};

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(LEDGER);
  api.forOrder.mockReset().mockResolvedValue([]);
  api.lots.mockReset().mockResolvedValue([]);
});

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('useRowDetail reads only what it is asked for', () => {
  it('asked for nothing, requests nothing and says nothing was read', async () => {
    const { result } = renderHook(() => useRowDetail('i1', { purchases: false, paper: false, lots: false }), { wrapper });
    await settle();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.forOrder).not.toHaveBeenCalled();
    expect(api.lots).not.toHaveBeenCalled();
    expect(result.current.purchases).toBeNull();
    expect(result.current.lots).toBeNull();
  });

  it('the purchases alone read no order paper and no lots', async () => {
    const { result } = renderHook(() => useRowDetail('i1', { purchases: true, paper: false, lots: false }), { wrapper });
    await waitFor(() => expect(result.current.purchases).not.toBeNull());
    await settle();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.forOrder).not.toHaveBeenCalled();
    expect(api.lots).not.toHaveBeenCalled();
    expect(result.current.paper.size).toBe(0);
  });

  it('the lots alone read no ledger', async () => {
    const { result } = renderHook(() => useRowDetail('i1', { purchases: false, paper: false, lots: true }), { wrapper });
    await waitFor(() => expect(result.current.lots).not.toBeNull());
    expect(api.get).not.toHaveBeenCalled();
    expect(api.lots).toHaveBeenCalledTimes(1);
  });

  it('the paperwork reads the purchases and each one’s order paper', async () => {
    const { result } = renderHook(() => useRowDetail('i1', { purchases: true, paper: true, lots: false }), { wrapper });
    await waitFor(() => expect(result.current.paper.get('o1')?.docs).toEqual([]));
    expect(api.forOrder).toHaveBeenCalledWith('o1');
    expect(api.lots).not.toHaveBeenCalled();
  });

  it('with no need given, reads all three as before', async () => {
    const { result } = renderHook(() => useRowDetail('i1'), { wrapper });
    await waitFor(() => expect(result.current.paper.get('o1')?.docs).toEqual([]));
    await waitFor(() => expect(result.current.lots).not.toBeNull());
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
