/**
 * useCommsNextData contract — the two things a reader of this page must be able
 * to trust about its cache and its failures.
 *
 * P2 — EVERY query bucket names the tenant. The gateway NEVER reads the
 * `X-Restaurant-Id` header for these endpoints (a repo-wide grep finds it only
 * in test fixtures); `procurement.controller.ts:737` scopes the history from
 * `user.restaurantId` on the JWT. So the only thing separating one restaurant's
 * conversations from another's in this cache is the key literal. An unkeyed key
 * plus a failed re-mint (AuthContext.tsx catches it and proceeds) renders the
 * PREVIOUS tenant's book with no banner.
 *
 * P3 — a permanent failure is not latency. `scheduled_reports` is created by no
 * migration in `supabase/migrations/` — it is named in
 * `20260826170000_integration_oauth_tables.sql:26` as one of five tables
 * production never saw — so `GET /reports/schedules` fails every time. A hook
 * that only exposes `data !== undefined` reports that permanent failure as
 * "hasn't answered yet", forever.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockApiGet = vi.hoisted(() => vi.fn());
const mockListSchedules = vi.hoisted(() => vi.fn());

vi.mock('axios', () => {
  const instance = {
    get: mockAxiosGet,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { create: () => instance }, create: () => instance };
});

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: mockApiGet },
}));

vi.mock('../../../services/api/reports', () => ({
  listReportSchedules: mockListSchedules,
}));

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

import { useAuth } from '../../../contexts/AuthContext';
import { useCommsNextData } from './useCommsNextData';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function auth(activeRestaurantId: string | null, jwtRestaurantId = 'jwt-rest-A') {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { restaurantId: jwtRestaurantId, userId: 'u1', email: 'a@b.com', name: 'A', role: 'owner' },
    activeRestaurantId,
    isAuthenticated: true,
  });
}

function keys(qc: QueryClient): string[] {
  return qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAxiosGet.mockResolvedValue({ data: [] });
  mockApiGet.mockResolvedValue({ data: { configured: false } });
  mockListSchedules.mockResolvedValue([]);
});

describe('useCommsNextData — every cache bucket names the tenant (P2)', () => {
  it('keys the conversation history by the ACTIVE restaurant, not by a constant', async () => {
    auth('active-rest-B');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(keys(qc).length).toBeGreaterThan(0));

    const history = keys(qc).filter((k) => k.includes('procurement') && k.includes('history'));
    expect(history.length).toBeGreaterThan(0);
    for (const k of history) {
      expect(k, `history key ${k} must name the active restaurant`).toContain('active-rest-B');
    }
    // The constant key is the defect: two tenants share one bucket.
    expect(history).not.toContain(JSON.stringify(['procurement', 'history']));
  });

  it('keys the report schedules by the ACTIVE restaurant', async () => {
    auth('active-rest-B');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(keys(qc).length).toBeGreaterThan(0));

    const sched = keys(qc).filter((k) => k.includes('report-schedules'));
    expect(sched.length).toBeGreaterThan(0);
    for (const k of sched) {
      expect(k, `schedules key ${k} must name the active restaurant`).toContain('active-rest-B');
    }
    expect(sched).not.toContain(JSON.stringify(['report-schedules']));
  });

  it('two restaurants never share a cache bucket', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    auth('rest-one');
    const first = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(keys(qc).length).toBeGreaterThan(0));
    const before = keys(qc);
    first.unmount();

    auth('rest-two');
    renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(keys(qc).length).toBeGreaterThan(before.length));

    const after = keys(qc);
    const oneKeys = after.filter((k) => k.includes('rest-one'));
    const twoKeys = after.filter((k) => k.includes('rest-two'));
    expect(oneKeys.length).toBeGreaterThan(0);
    expect(twoKeys.length).toBeGreaterThan(0);
    // No bucket may be shared: every key that exists must name exactly one tenant.
    for (const k of after) {
      expect(
        k.includes('rest-one') || k.includes('rest-two'),
        `key ${k} names no tenant, so both restaurants read and write it`,
      ).toBe(true);
    }
  });
});

describe('useCommsNextData — a permanent failure is not latency (P3)', () => {
  it('reports a failed schedules fetch as a failure, distinct from unanswered', async () => {
    auth('active-rest-B');
    mockListSchedules.mockRejectedValue(new Error('Request failed with status code 500'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.schedulesError).not.toBeNull());

    expect(result.current.schedulesError).toContain('500');
    // Unanswered and failed must not be the same state.
    expect(result.current.schedulesKnown).toBe(false);
    expect(result.current.glance.schedules).toBeNull();
  });

  it('a schedules fetch that has not answered yet is NOT a failure', async () => {
    auth('active-rest-B');
    mockListSchedules.mockReturnValue(new Promise(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.gmailWatchConfigured).not.toBeUndefined());
    expect(result.current.schedulesError).toBeNull();
    expect(result.current.schedulesKnown).toBe(false);
  });

  it('exposes a failed state for every one of the five queries (P4)', async () => {
    auth('active-rest-B');
    mockAxiosGet.mockRejectedValue(new Error('gateway down'));
    mockApiGet.mockRejectedValue(new Error('gateway down'));
    mockListSchedules.mockRejectedValue(new Error('gateway down'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.failed.history).toBe(true));
    await waitFor(() => expect(result.current.failed.threads).toBe(true));
    await waitFor(() => expect(result.current.failed.drafts).toBe(true));
    await waitFor(() => expect(result.current.failed.schedules).toBe(true));
    await waitFor(() => expect(result.current.failed.gmail).toBe(true));
    expect(result.current.failedSources.length).toBe(5);
  });
});
