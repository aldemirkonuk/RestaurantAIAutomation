/**
 * p11-5 — /inventory reads each endpoint once on a cold load.
 *
 * The slot-2 trace of a cold /inventory counted 32-33 API calls, nine of them
 * an endpoint already asked for earlier in the same load. The app's QueryClient
 * (App.tsx) sets `refetchOnMount: 'always'`, which beats every query's own
 * `staleTime`: a second observer of the same key that mounts after the first
 * answer (a row's name hint, the deliveries card) asks the gateway again.
 *
 * This mounts the real route and the real page under that same QueryClient
 * default with the gateway replaced by an axios adapter that records each GET,
 * and holds each endpoint to one request.
 *
 * Not StrictMode on purpose: the slot-2 stack serves the Vite DEV build, where
 * main.tsx's StrictMode runs every mount effect twice, so the effect-driven
 * reads (ContextualInsights' insights and actions, /auth/me, branches) read
 * twice there and once in the built app. This holds the built app's count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

vi.mock('../../../contexts/AuthContext', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { userId: 'u1', restaurantId: 'r1', role: 'owner' },
    availableRestaurants: [],
    loading: false,
    isAuthenticated: true,
  }),
}));
vi.mock('../../../components/scanner/MenuScannerFlow', () => ({ MenuScannerFlow: () => null }));

import { apiClient } from '../../../services/api/client';
import { clearMudavymDesignCache } from '../../../lib/mudavym/useMudavymDesign';
import { InventoryRoute } from './InventoryRoute';

const ITEMS = [1, 2, 3].map((n) => ({
  inventoryId: `i${n}`,
  id: `i${n}`,
  restaurantId: 'r1',
  wineId: `w${n}`,
  wineName: `Wine ${n}`,
  quantity: 6,
  currentStock: 6,
  stockLive: 6,
  unit: 'bottle',
}));

function answer(path: string): unknown {
  if (/\/feature-flags|\/flags?\b/.test(path)) return { active: true, enabled: true };
  if (/\/inventory\/r1$/.test(path)) return ITEMS;
  if (/\/storage-locations\/r1$/.test(path)) return [];
  if (/\/inventory\/research$/.test(path)) return { items: [] };
  if (/\/pricing\/advice$/.test(path)) return { wines: [], target: { set: false }, locks: { readable: true } };
  if (/\/wines$/.test(path)) return ITEMS.map((i) => ({ id: i.wineId, name: i.wineName }));
  if (/\/procurement\/items-to-name$/.test(path)) return { viewer: { mayName: false, mayNameReason: null }, deliveries: [] };
  if (/\/analytics\/insights\//.test(path)) return { insights: [], source: 'stored' };
  if (/\/actions$/.test(path)) return { items: [] };
  return {};
}

describe('/inventory cold load', () => {
  const gets: string[] = [];
  let was: AxiosAdapter | undefined;

  beforeEach(() => {
    gets.length = 0;
    clearMudavymDesignCache();
    window.localStorage.clear();
    window.localStorage.setItem('activeRestaurantId', 'r1');
    window.localStorage.setItem('accessToken', 't');
    was = apiClient.defaults.adapter as AxiosAdapter | undefined;
    apiClient.defaults.adapter = (async (cfg: InternalAxiosRequestConfig) => {
      const path = String(cfg.url ?? '').split('?')[0];
      if ((cfg.method ?? 'get').toLowerCase() === 'get') gets.push(path);
      return { data: answer(path), status: 200, statusText: 'OK', headers: {}, config: cfg };
    }) as AxiosAdapter;
  });
  afterEach(() => {
    apiClient.defaults.adapter = was;
    window.localStorage.clear();
  });

  it('asks the gateway for each endpoint once', async () => {
    // The same defaults App.tsx builds its client with.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: 1 } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/inventory']}>
          <InventoryRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(gets.some((p) => p.endsWith('/inventory/r1'))).toBe(true), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 1500));
    const count = new Map<string, number>();
    for (const p of gets) count.set(p, (count.get(p) ?? 0) + 1);
    // Not vacuous: the reads the trace named were all made, once each.
    for (const p of ['/pricing/advice', '/procurement/items-to-name', '/inventory/research', '/wines', '/analytics/insights/r1', '/analytics/recommendations/r1/actions']) {
      expect(count.get(p), p).toBe(1);
    }
    const repeated = [...count].filter(([, n]) => n > 1);
    expect(repeated).toEqual([]);
    expect(screen.queryByTestId('inventory-route-reading')).toBeNull();
  });
});
