/**
 * r109 review of #2397: /house says "Your opening hours from Google were not
 * saved" from a sessionStorage note. Nothing removed that note, so after the
 * owner saved the hours in Settings, /house still said it for the rest of the
 * tab session. A successful save of real hours takes the note away; a failed
 * one, and an explicit "we do not know these hours", leave it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'manager' | 'staff' | null,
  rid: 'rest-house-1' as string | null,
  uid: 'user-1' as string | null,
}));

const h = vi.hoisted(() => ({ putHours: vi.fn() }));

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

vi.mock('@/services/api/client', () => ({ apiClient: api, getErrorMessage: (e: unknown) => String((e as Error)?.message ?? e) }));
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
    putOperatingHours: h.putHours,
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
import { readHoursUnsaved, writeHoursUnsaved } from '@/lib/houseHoursNote';

beforeEach(() => {
  h.putHours.mockReset();
  sessionStorage.clear();
  auth.role = 'owner';
  auth.rid = 'rest-house-1';
  auth.uid = 'user-1';
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/calendar/ical-token') return { data: { token: 'secret-feed' } };
    if (url === '/settings/feature-flags') return { data: {} };
    if (url.startsWith('/restaurants/') && url.endsWith('/templates')) return { data: [] };
    if (url === '/organizations/chains') return { data: [] };
    if (url.startsWith('/users/') && url.endsWith('/preferences')) {
      return { data: { preferences: {}, updatedAt: null } };
    }
    if (url === '/vendor-terms') {
      return { data: { restaurantId: 'rest-house-1', providers: [], readable: true, reason: null } };
    }
    if (url === '/settings/approval-thresholds') {
      return { data: { restaurantId: 'rest-house-1', thresholds: [], policyEmpty: true, readable: true, reason: null } };
    }
    if (url === '/settings/currency') {
      return {
        data: {
          restaurantId: 'rest-house-1',
          code: null,
          country: null,
          readable: true,
          reason: null,
          statedAt: null,
          statedBy: null,
        },
      };
    }
    if (url === '/settings/carrying-cost') {
      return {
        data: {
          restaurantId: 'rest-house-1',
          percentPerMonth: null,
          basis: null,
          readable: true,
          reason: null,
          statedAt: null,
          statedBy: null,
        },
      };
    }
    if (url.startsWith('/settings-audit')) return { data: { entries: [], readable: true, reason: null } };
    if (url.includes('/digest')) {
      return {
        data: {
          stated: false,
          digestEnabled: false,
          digestHour: 7,
          digestMinUrgency: 'this_week',
          recipientEmail: null,
          lastSentAt: null,
        },
      };
    }
    if (url.includes('/members') || url.includes('/invites')) {
      return { data: [] };
    }
    return { data: null };
  });
});

const WEEK = { mon: [{ open: '09:00', close: '17:00' }] } as never;

describe('useSettingsNextData — saving the hours takes the /house note away', () => {
  it('clears the "hours were not saved" note once the hours are saved', async () => {
    writeHoursUnsaved('rest-house-1');
    h.putHours.mockResolvedValue({ restaurantId: 'rest-house-1', timezone: 'UTC', operatingHours: WEEK, updatedAt: null });
    const { result } = renderHook(() => useSettingsNextData());
    await waitFor(() => expect(result.current).toBeTruthy());
    let ok = false;
    await act(async () => {
      ok = await result.current.saveHours(WEEK);
    });
    expect(ok).toBe(true);
    expect(readHoursUnsaved('rest-house-1')).toBe(false);
  });

  it('keeps the note when the save fails', async () => {
    writeHoursUnsaved('rest-house-1');
    h.putHours.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSettingsNextData());
    await waitFor(() => expect(result.current).toBeTruthy());
    await act(async () => {
      await result.current.saveHours(WEEK);
    });
    expect(readHoursUnsaved('rest-house-1')).toBe(true);
  });

  it('keeps the note when the owner states they do not know the hours (nothing was saved)', async () => {
    writeHoursUnsaved('rest-house-1');
    h.putHours.mockResolvedValue({ restaurantId: 'rest-house-1', timezone: 'UTC', operatingHours: null, updatedAt: null });
    const { result } = renderHook(() => useSettingsNextData());
    await waitFor(() => expect(result.current).toBeTruthy());
    await act(async () => {
      await result.current.saveHours(null);
    });
    expect(readHoursUnsaved('rest-house-1')).toBe(true);
  });
});
