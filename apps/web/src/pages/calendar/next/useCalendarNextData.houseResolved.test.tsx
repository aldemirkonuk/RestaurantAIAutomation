/**
 * "No restaurant is active" is a conclusion; it may only be drawn once the
 * session's houses have been read. Before that the calendar says nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('../../../contexts/RealtimeContext', () => ({ useCalendarEventsSubscription: () => {} }));
vi.mock('../../../services/api/providers', () => ({ fetchProviders: async () => [] }));
vi.mock('../../../hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({ data: [], isError: false, isLoading: false }),
}));

import { useCalendarNextData } from './useCalendarNextData';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const run = (a: Record<string, unknown>) => {
  auth.value = a;
  return renderHook(() => useCalendarNextData('month', new Date('2026-11-18T12:00:00Z')), { wrapper }).result.current;
};

describe('useCalendarNextData noRestaurant', () => {
  it('is not drawn while the houses are still being read', () => {
    expect(run({ activeRestaurantId: null, houseResolved: false }).noRestaurant).toBe(false);
  });
  it('is drawn once the houses were read and none is active', () => {
    expect(run({ activeRestaurantId: null, houseResolved: true }).noRestaurant).toBe(true);
  });
  it('is false with a house', () => {
    expect(run({ activeRestaurantId: 'r-1', houseResolved: true }).noRestaurant).toBe(false);
  });
});
