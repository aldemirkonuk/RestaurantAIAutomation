/**
 * Saving "Who you are" (sim F-282, F-283).
 *
 * F-282: the display name on /profile and in the header is the signed-in user
 * from AuthContext, and the save re-read only the account query — so the old
 * name came back next to "Saved.". The save must re-read the signed-in user.
 *
 * F-283: an emptied phone field was sent as `undefined`, which the gateway
 * reads as "leave it", so the number could never be removed.
 *
 * All data is SYNTHETIC; every other read on the page is left to fail.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const updateMe = vi.fn();
const refreshUser = vi.fn();
const getMe = vi.fn();

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'u-syn', name: 'Old Name', role: 'owner' },
    activeRestaurantId: 'r-syn',
    activeRole: 'owner',
    availableRestaurants: [],
    setActiveRestaurantId: vi.fn(),
    refreshBranches: vi.fn(),
    logout: vi.fn(),
    refreshUser: () => refreshUser(),
  }),
}));
vi.mock('../../../services/api/profile', () => ({
  profileApi: {
    getMe: () => getMe(),
    updateMe: (body: unknown) => updateMe(body),
  },
}));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: () => Promise.reject(new Error('not under test')) },
}));
vi.mock('../../../services/api/integrations', () => ({
  integrationsApi: new Proxy({}, { get: () => () => Promise.reject(new Error('not under test')) }),
}));
vi.mock('../../../lib/mudavym/useMudavymDesign', () => ({
  useMudavymDesign: () => ({ enabled: true, loading: false }),
}));

import { useProfileNextData } from './useProfileNextData';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useProfileNextData(), { wrapper });
}

describe('useProfileNextData — saveAccount', () => {
  beforeEach(() => {
    updateMe.mockReset().mockResolvedValue({});
    refreshUser.mockReset().mockResolvedValue(undefined);
    getMe.mockReset().mockResolvedValue({ name: 'Old Name', phone: '+90 555 000 0000' });
  });

  it('re-reads the signed-in user, so the saved name is the one shown (F-282)', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.meState).toBe('ok'));
    await act(() => result.current.saveAccount('New Name', '+90 555 000 0000'));
    expect(updateMe).toHaveBeenCalledWith({ name: 'New Name', phone: '+90 555 000 0000' });
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it('sends an empty phone as "" so the number is removed (F-283)', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.meState).toBe('ok'));
    await act(() => result.current.saveAccount('Old Name', '   '));
    expect(updateMe).toHaveBeenCalledWith({ name: 'Old Name', phone: '' });
  });

  it('leaves the phone out when the record was never read', async () => {
    getMe.mockRejectedValue(new Error('account read down'));
    const { result } = mount();
    await waitFor(() => expect(result.current.meState).not.toBe('loading'));
    await act(() => result.current.saveAccount('Old Name', ''));
    expect(updateMe).toHaveBeenCalledWith({ name: 'Old Name' });
  });

  it('does not call a landed save a failure when the re-read fails', async () => {
    refreshUser.mockRejectedValue(new Error('offline'));
    const { result } = mount();
    await expect(
      act(() => result.current.saveAccount('New Name', 'x')),
    ).resolves.toBeUndefined();
  });
});
