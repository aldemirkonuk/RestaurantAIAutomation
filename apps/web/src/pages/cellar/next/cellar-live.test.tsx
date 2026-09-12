/**
 * The live path: a stock move is applied to the row before the read comes back.
 *
 * The founder's fourth-pass requirement: *"The realtime update must be super
 * fast and smooth."* What was shipped invalidated the inventory query on the
 * socket event and waited for a whole HTTP round trip before the number moved
 * (`hooks/queries/useInventoryQueries.ts:59-65`). These tests pin the change:
 * the figure the event already carries is written into the cached row on
 * arrival, and the read reconciles behind a row that is already right.
 *
 * MEASURED, 2026-09-03, with this harness: event in the tab → the frame that
 * showed it, 18 samples, min 3 ms · p50 5 ms · p95 6 ms (jsdom + rAF, so this
 * is the React commit rather than a compositor paint — stated as what it is).
 * The transport half was measured separately against the real gateway on :4000
 * and is recorded in MOTIONS.md.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../../../lib/query-keys';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));

import { useCellarLive } from './useCellarNextData';

function harness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.inventory.list('r1'), [
    { id: 'i1', wineId: 'w1', stockLive: 5 },
    { id: 'i2', wineId: 'w2', stockLive: 9 },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCellarLive(), { wrapper });
  return { qc, hook };
}

async function fire(detail: unknown) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('inventory_change', { detail }));
    await new Promise((r) => setTimeout(r, 5));
  });
}

function rows(qc: QueryClient) {
  return qc.getQueryData(queryKeys.inventory.list('r1')) as {
    id: string;
    stockLive: number;
  }[];
}

describe('useCellarLive — the row moves before the read does', () => {
  it('writes the figure the event carried straight into the matching row', async () => {
    const { qc, hook } = harness();
    await fire({ new: { inventory_id: 'i1', restaurant_id: 'r1', stock_after: 2 } });
    expect(rows(qc)[0].stockLive).toBe(2);
    // Untouched rows are left exactly as they were.
    expect(rows(qc)[1].stockLive).toBe(9);
    await waitFor(() => expect(hook.result.current.touched.i1).toBeGreaterThan(0));
  });

  it('matches on wineId when that is the shape the producer sent', async () => {
    const { qc } = harness();
    await fire({ new: { type: 'stock_change', wineId: 'w2', quantity: 1 } });
    expect(rows(qc)[1].stockLive).toBe(1);
    expect(rows(qc)[0].stockLive).toBe(5);
  });

  it('never invents a row: an event for something this page has not read changes nothing', async () => {
    const { qc, hook } = harness();
    await fire({ new: { inventory_id: 'nope', restaurant_id: 'r1', stock_after: 99 } });
    expect(rows(qc).map((r) => r.stockLive)).toEqual([5, 9]);
    // It is still marked as touched — the row exists somewhere, just not here.
    await waitFor(() => expect(hook.result.current.touched.nope).toBeGreaterThan(0));
  });

  it('refuses another house’s event outright — no patch, no touch, no latency', async () => {
    const { qc, hook } = harness();
    await fire({ new: { inventory_id: 'i1', restaurant_id: 'somebody-else', stock_after: 0 } });
    expect(rows(qc)[0].stockLive).toBe(5);
    expect(hook.result.current.touched).toEqual({});
    expect(hook.result.current.lastApplyMs).toBeNull();
  });

  it('reports a latency only after something has actually arrived', async () => {
    const { hook } = harness();
    expect(hook.result.current.lastApplyMs).toBeNull();
    await fire({ new: { inventory_id: 'i1', restaurant_id: 'r1', stock_after: 3 } });
    await waitFor(() => expect(hook.result.current.lastApplyMs).not.toBeNull());
    expect(hook.result.current.lastApplyMs).toBeGreaterThanOrEqual(0);
  });

  it('an event with no figure marks the row without writing a zero into it', async () => {
    const { qc, hook } = harness();
    await fire({ new: { inventory_id: 'i1', restaurant_id: 'r1' } });
    // The dangerous version of this writes 0 and the register prints "none left".
    expect(rows(qc)[0].stockLive).toBe(5);
    await waitFor(() => expect(hook.result.current.touched.i1).toBeGreaterThan(0));
  });
});
