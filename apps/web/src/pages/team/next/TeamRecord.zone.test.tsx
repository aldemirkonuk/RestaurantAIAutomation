import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

/**
 * F-852 — the trail's house clock was cached under one key for every house,
 * so after switching houses the record printed times in the PREVIOUS house's
 * zone for five minutes. The answer is now kept per house.
 */

const auth = vi.hoisted(() => ({ rid: 'r1' }));
const zones: Record<string, string> = { r1: 'Europe/Istanbul', r2: 'America/Detroit' };
const get = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: auth.rid,
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: auth.rid, role: 'owner' },
  }),
}));
vi.mock('../../../services/api/client', () => ({ apiClient: { get } }));

import { TrailSheet } from './TeamRecord';

const trail = {
  readable: true,
  reason: null,
  oldestAt: null,
  recordingSince: '2026-09-03',
  entries: [
    {
      id: 'e1',
      action: 'member_role_changed',
      occurredAt: '2026-10-01T12:00:00.000Z',
      actor: { userId: null, name: 'Ada', email: null },
      subject: null,
      fields: {},
    },
  ],
} as any;

describe('TrailSheet — the house clock belongs to the house on screen', () => {
  it('asks again for the new house’s time zone after a switch', async () => {
    get.mockImplementation(() =>
      Promise.resolve({ data: { zone: zones[auth.rid] } }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sheet = () => (
      <QueryClientProvider client={client}>
        <TrailSheet trail={trail} failed={false} members={[]} onClose={() => {}} />
      </QueryClientProvider>
    );
    const { rerender } = render(sheet());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    auth.rid = 'r2';
    rerender(sheet());

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith('/settings/time-zone');
    expect(screen.getByText('Ada', { exact: false })).toBeTruthy();
  });
});
