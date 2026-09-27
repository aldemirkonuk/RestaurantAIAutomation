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
 * P3/P4 — a failure is not latency, and every source the page OWNS can say it
 * failed. Since the ADR 0083 amendment of 2026-09-25 the page owns three: the
 * conversation book, the thread index and the drafts. The report schedules
 * (`scheduled_reports` is created by no migration, so the read failed for
 * every house) and the Gmail watch status (deployment plumbing, now read on
 * the admin desk) left the page — and so did their requests: this hook must
 * not ask for either.
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

const LABELS = {
  history: 'the conversation book',
  threads: 'the thread index',
  drafts: 'the drafts awaiting action',
} as const;

/** Route each owned source to its own client so one can fail alone. */
function sources(fail: Partial<Record<keyof typeof LABELS, boolean>>) {
  mockAxiosGet.mockImplementation((url: string) => {
    if (url.includes('/procurement/conversations/history')) {
      return fail.history ? Promise.reject(new Error('history 500')) : Promise.resolve({ data: [] });
    }
    if (url.includes('/conversations/threads')) {
      return fail.threads
        ? Promise.reject(new Error('threads 500'))
        : Promise.resolve({ data: { threads: [], total: 0 } });
    }
    return Promise.resolve({ data: [] });
  });
  mockApiGet.mockImplementation((url: string) => {
    if (url.includes('/procurement/conversations/active')) {
      return fail.drafts ? Promise.reject(new Error('drafts 500')) : Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('useCommsNextData — ADR 0083 amended 2026-09-25: three owned sources', () => {
  it('never asks for the report schedules or the Gmail watch status', async () => {
    auth('active-rest-B');
    sources({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.glance.draftsPending).toBe(0));
    await waitFor(() => expect(result.current.glance.threads).toBe(0));
    await waitFor(() => expect(result.current.hasData).toBe(true));

    expect(mockListSchedules).not.toHaveBeenCalled();
    const urls = [...mockAxiosGet.mock.calls, ...mockApiGet.mock.calls].map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/reports/schedules'))).toBe(false);
    expect(urls.some((u) => u.includes('/webhooks/gmail/status'))).toBe(false);
    expect(keys(qc).some((k) => k.includes('report-schedules') || k.includes('gmail'))).toBe(false);
    // healthy owned sources: nothing for the banner to say
    expect(result.current.failedSources).toEqual([]);
  });

  for (const source of ['history', 'threads', 'drafts'] as const) {
    it(`a real failure of ${LABELS[source]} alone is still named (ADR 0051: never swallowed)`, async () => {
      auth('active-rest-B');
      sources({ [source]: true });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

      await waitFor(() => expect(result.current.failed[source]).toBe(true));
      expect(result.current.failedSources).toEqual([LABELS[source]]);
      // failed is not unanswered: the other two answered and are not named
      for (const other of Object.keys(LABELS) as Array<keyof typeof LABELS>) {
        if (other !== source) expect(result.current.failed[other]).toBe(false);
      }
    });
  }

  it('an owned source that has not answered yet is NOT a failure', async () => {
    auth('active-rest-B');
    mockAxiosGet.mockReturnValue(new Promise(() => {}));
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(keys(qc).length).toBeGreaterThan(0));
    expect(result.current.glance.threads).toBeNull();
    expect(result.current.glance.draftsPending).toBeNull();
    expect(result.current.failedSources).toEqual([]);
  });

  it('exposes a failed state for every one of the three owned queries (P4)', async () => {
    auth('active-rest-B');
    sources({ history: true, threads: true, drafts: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCommsNextData(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.failed.history).toBe(true));
    await waitFor(() => expect(result.current.failed.threads).toBe(true));
    await waitFor(() => expect(result.current.failed.drafts).toBe(true));
    expect(result.current.failedSources).toEqual([
      LABELS.history,
      LABELS.threads,
      LABELS.drafts,
    ]);
    expect(Object.keys(result.current.failed).sort()).toEqual(['drafts', 'history', 'threads']);
  });
});
