/**
 * Stating the house's money is the house setup's money step. The rail keeps
 * the setup it read until the window is next focused, so it went on saying the
 * money was still to set after the save. A save that was written asks that read
 * again; one the gateway refused does not.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'manager' | 'staff' | null,
  rid: 'rest-house-1' as string | null,
  uid: 'user-1' as string | null,
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.uid ? { userId: auth.uid, role: auth.role } : null,
    activeRestaurantId: auth.rid,
    activeRole: auth.role,
    availableRestaurants: auth.rid
      ? [{ id: auth.rid, name: 'House', role: auth.role }]
      : [],
    refreshBranches: vi.fn(),
  }),
}));

vi.mock('@/services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getCatalog: vi.fn(async () => []),
    getConnections: vi.fn(async () => []),
    disconnect: vi.fn(),
  },
}));
vi.mock('@/services/api/posHub', () => ({
  getPosProviders: vi.fn(async () => ({
    summary: { total: 0, byTier: {}, byStatus: {} },
    providers: [],
  })),
  getPosStatus: vi.fn(async () => null),
}));
vi.mock('@/services/api/notifications', () => ({
  fetchNotificationPreferences: vi.fn(async () => ({
    userId: 'user-1',
    email: true,
    push: true,
    sms: false,
    categories: {},
    updatedAt: null,
  })),
  updateNotificationPreferences: vi.fn(),
}));
vi.mock('@/services/api/restaurants', () => ({
  restaurantsApi: {
    getOperatingHours: vi.fn(async () => ({
      restaurantId: 'rest-house-1',
      timezone: 'UTC',
      operatingHours: null,
      updatedAt: null,
    })),
  },
}));
vi.mock('@/lib/mudavym/useMudavymDesign', () => ({
  useMudavymDesign: () => false,
}));
vi.mock('@/hooks/useCellarRegisters', () => ({
  useCellarRegisters: () => ({
    data: null,
    loading: true,
    error: null,
    save: { mutateAsync: vi.fn(), isPending: false, error: null },
    refetch: vi.fn(),
  }),
}));

import { useSettingsNextData } from './useSettingsNextData';

const WRITTEN = {
  restaurantId: 'rest-house-1',
  code: 'TRY',
  country: null,
  readable: true,
  reason: null,
  statedAt: null,
  statedBy: null,
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['onboarding-progress'], { next_steps: { money_set: false } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useSettingsNextData(), { wrapper });
  const stale = () => client.getQueryState(['onboarding-progress'])?.isInvalidated;
  return { hook, stale };
}

beforeEach(() => {
  auth.role = 'owner';
  auth.rid = 'rest-house-1';
  auth.uid = 'user-1';
  Object.values(api).forEach((f) => f.mockReset());
  api.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { ...WRITTEN, code: null } };
    return { data: null };
  });
});

describe('stating the house money asks the house setup read again', () => {
  it('a written code marks the setup read stale', async () => {
    api.put.mockResolvedValue({ data: WRITTEN });
    const { hook, stale } = mount();
    await waitFor(() => expect(hook.result.current.houseCurrency.status).toBe('ok'));
    expect(stale()).toBe(false);
    await act(async () => {
      await hook.result.current.saveCurrency('TRY');
    });
    expect(api.put).toHaveBeenCalledWith('/settings/currency', { code: 'TRY' });
    expect(stale()).toBe(true);
  });

  it('a refused save leaves the setup read as it was', async () => {
    api.put.mockRejectedValue(new Error('refused'));
    const { hook, stale } = mount();
    await waitFor(() => expect(hook.result.current.houseCurrency.status).toBe('ok'));
    await act(async () => {
      await hook.result.current.saveCurrency('TRY');
    });
    expect(api.put).toHaveBeenCalled();
    expect(stale()).toBe(false);
  });
});
