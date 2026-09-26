/**
 * Staff must never issue tenant remotes from `/settings`, especially
 * `GET /calendar/ical-token` (JWT-only; can mint the house calendar-feed
 * credential). PR #419 made settings always-on; a post-hook staff gate still
 * fired every tenant fetch. This file fails if that regresses.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('@/services/api/client', () => ({ apiClient: api }));
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
import SettingsNext from './SettingsNext';

function icalGets() {
  return api.get.mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes('/calendar/ical-token'),
  );
}

beforeEach(() => {
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

describe('useSettingsNextData — staff never mints the calendar feed', () => {
  it('issues GET /calendar/ical-token for an owner with a house', async () => {
    auth.role = 'owner';
    renderHook(() => useSettingsNextData());
    await waitFor(() => expect(icalGets().length).toBeGreaterThan(0));
    expect(api.get).toHaveBeenCalledWith('/calendar/ical-token');
  });

  it('does NOT call GET /calendar/ical-token when role is staff (even with a live rid)', async () => {
    auth.role = 'staff';
    renderHook(() => useSettingsNextData());
    // Give any eager remotes a tick to fire if the gate regressed.
    await waitFor(() => {
      // Account-scoped remotes may still resolve; the assertion is the tenant
      // calendar credential must never be requested.
      expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(0);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(icalGets()).toEqual([]);
    expect(api.get).not.toHaveBeenCalledWith('/calendar/ical-token');
  });
});

describe('SettingsNext — staff gate is above the data hook', () => {
  it('renders Ask a manager without ever requesting /calendar/ical-token', async () => {
    auth.role = 'staff';
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsNext />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask a manager');
    await new Promise((r) => setTimeout(r, 50));
    expect(icalGets()).toEqual([]);
    expect(api.get).not.toHaveBeenCalledWith('/calendar/ical-token');
    // Belt: no tenant remotes at all from a staff open of /settings.
    const tenantish = api.get.mock.calls.filter(([url]) => {
      if (typeof url !== 'string') return false;
      return (
        url.includes('/calendar/ical-token') ||
        url === '/settings/feature-flags' ||
        url === '/vendor-terms' ||
        url === '/settings/approval-thresholds' ||
        url === '/settings/currency' ||
        url === '/settings/carrying-cost' ||
        url.startsWith('/settings-audit') ||
        url.includes('/digest')
      );
    });
    expect(tenantish).toEqual([]);
  });
});
