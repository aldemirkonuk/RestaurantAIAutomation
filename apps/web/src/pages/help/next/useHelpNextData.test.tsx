/**
 * A read that did not answer is "not known", never "none". `/help` used to turn
 * a pending-order answer with no count into 0 and a list read that answered
 * something other than a list into [], so "Waiting on the house" said nothing
 * was waiting when nothing had been read.
 */
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), answers: {} as Record<string, unknown> }));
vi.mock('../../../services/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRole: 'owner',
    activeRestaurantId: 'house-1',
    availableRestaurants: [{ id: 'house-1', name: 'The House' }],
  }),
}));
vi.mock('../../../services/api/posHub', () => ({ getPosStatus: vi.fn(async () => ({})) }));
vi.mock('../../../services/api/askAi', () => ({ listOpenProposals: vi.fn(async () => []) }));

import { listOrUnread, pendingCountOrUnread, useHelpNextData } from './useHelpNextData';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.answers = {
    '/mcp-connections': [],
    '/integrations/oauth/house-grants': { success: true, grants: [] },
    '/one-tap-actions/pending': [],
    '/procurement/orders/pending/count': { count: 2 },
  };
  mocks.get.mockReset().mockImplementation(async (path: string) => ({
    data: path in mocks.answers ? mocks.answers[path] : {},
    status: 200,
  }));
});

describe('listOrUnread / pendingCountOrUnread', () => {
  it('passes a list and a count through', () => {
    expect(listOrUnread([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(listOrUnread([])).toEqual([]);
    expect(pendingCountOrUnread({ count: 0 })).toEqual({ count: 0 });
    expect(pendingCountOrUnread({ count: 3 })).toEqual({ count: 3 });
  });
  it('refuses anything that is not a list or a count', () => {
    for (const bad of [undefined, null, {}, 'ok', { items: [] }]) {
      expect(() => listOrUnread(bad)).toThrow('the answer held no list');
    }
    for (const bad of [undefined, null, {}, { count: '2' }, { count: -1 }, { count: 1.5 }, { count: NaN }]) {
      expect(() => pendingCountOrUnread(bad)).toThrow('the answer held no count');
    }
  });
});

describe('useHelpNextData — an unanswered read is an error, not an empty register', () => {
  it('reads the count and lists when they come back', async () => {
    const { result } = renderHook(() => useHelpNextData(), { wrapper });
    await waitFor(() => expect(result.current.ordersPending.status).toBe('ok'));
    expect(result.current.ordersPending).toEqual({ status: 'ok', data: { count: 2 } });
    await waitFor(() => expect(result.current.oneTap.status).toBe('ok'));
    await waitFor(() => expect(result.current.mcp.status).toBe('ok'));
    await waitFor(() => expect(result.current.oauth.status).toBe('ok'));
  });

  it('a pending-order answer with no count is an error, never 0', async () => {
    mocks.answers['/procurement/orders/pending/count'] = {};
    const { result } = renderHook(() => useHelpNextData(), { wrapper });
    await waitFor(() => expect(result.current.ordersPending.status).toBe('error'));
    expect(result.current.ordersPending).toEqual({ status: 'error', message: 'the answer held no count' });
  });

  it('one-tap, MCP and grant answers that are not lists are errors, never empty', async () => {
    mocks.answers['/one-tap-actions/pending'] = { actions: [] };
    mocks.answers['/mcp-connections'] = null;
    mocks.answers['/integrations/oauth/house-grants'] = { success: true };
    const { result } = renderHook(() => useHelpNextData(), { wrapper });
    await waitFor(() => expect(result.current.oneTap.status).toBe('error'));
    await waitFor(() => expect(result.current.mcp.status).toBe('error'));
    await waitFor(() => expect(result.current.oauth.status).toBe('error'));
    expect(result.current.oneTap).toEqual({ status: 'error', message: 'the answer held no list' });
  });
});
