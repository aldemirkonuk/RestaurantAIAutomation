import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockPost = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/client', () => ({ apiClient: { post: mockPost, get: vi.fn() } }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1', user: { restaurantId: 'house-1', role: 'owner' } }),
}));

import { useFileHeldLetter } from './useSendersDeskData';

/**
 * Filing a held letter under its vendor (r35 mail, gap 9): the one route that
 * does it, the id kept to one path segment, and every list that shows the
 * letter read again — "Who is writing" so it leaves the held list, and the
 * house's Mail lists so it appears in the vendor's thread.
 */
describe('useFileHeldLetter', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      data: { filed: true, conversationId: 'c1', threadKey: 't1', providerId: 'v1', providerName: 'Dairy', alreadyStored: false },
    });
  });

  it('posts to file-under-vendor with the id kept to one path segment, and reads the lists again', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useFileHeldLetter(), { wrapper });

    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync('a/b');
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/prospects/a%2Fb/file-under-vendor');
    expect(out).toMatchObject({ filed: true, providerId: 'v1', threadKey: 't1' });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    for (const root of ['comms-strangers', 'mail-people', 'mail-threads', 'mail-thread', 'mail-summary']) {
      expect(keys).toContain(JSON.stringify([root, 'house-1']));
    }
  });

  it('reads the lists again after a refusal too, since the letter may have moved', async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error('409'), { response: { status: 409 } }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useFileHeldLetter(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('p1').catch(() => undefined);
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['comms-strangers', 'house-1']));
  });
});
