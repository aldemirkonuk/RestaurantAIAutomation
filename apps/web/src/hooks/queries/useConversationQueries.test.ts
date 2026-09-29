/**
 * useConversationQueries — the conversation book's request reaches the route
 * the gateway actually serves.
 *
 * This module builds its own axios instance on the BARE gateway origin
 * (`baseURL: VITE_API_GATEWAY_URL`), unlike `services/api/client.ts`, which
 * appends `/api/v1`. The gateway mounts every controller under the global
 * prefix `api/v1` (`apps/api-gateway/src/main.ts`, `setGlobalPrefix`), so a
 * path on this instance that omits the prefix is a 404 for every house.
 * Sweep defect 21 (WEB-ENDPOINT-SWEEP-2026-09-28): `/communications`' book
 * asked for `/procurement/conversations/history` and always got a 404.
 *
 * The test pins the FULL URL the browser sends — base plus path — not a
 * substring, so a mock that matches on `includes()` cannot hide the missing
 * prefix again.
 */

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = vi.hoisted(() => vi.fn());
const created = vi.hoisted(() => ({ baseURL: undefined as string | undefined }));

vi.mock('axios', () => {
  const instance = {
    get: mockGet,
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  const create = (config: { baseURL?: string }) => {
    created.baseURL = config?.baseURL;
    return instance;
  };
  return { default: { create }, create };
});

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

import { useAuth } from '../../contexts/AuthContext';
import { useProcurementConversationHistory } from './useConversationQueries';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/** What axios sends: the instance's baseURL joined to the request path. */
function fullUrl(path: string): string {
  return `${String(created.baseURL).replace(/\/+$/, '')}${path}`;
}

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({ data: [] });
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { restaurantId: 'rest-A' },
    activeRestaurantId: 'rest-A',
  });
});

describe('useProcurementConversationHistory — sweep defect 21', () => {
  it('asks the gateway for /api/v1/procurement/conversations/history, the route it serves', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProcurementConversationHistory(), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledTimes(1);
    const path = String(mockGet.mock.calls[0][0]);
    // The instance is on the bare origin — the prefix must come from the path.
    expect(created.baseURL).toBeDefined();
    expect(String(created.baseURL)).not.toMatch(/\/api\/v1\/?$/);
    expect(path).toBe('/api/v1/procurement/conversations/history');
    expect(new URL(fullUrl(path)).pathname).toBe('/api/v1/procurement/conversations/history');
  });

  it('a failed read stays a failure, never an empty book', async () => {
    mockGet.mockRejectedValue(new Error('Request failed with status code 404'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useProcurementConversationHistory(), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useConversationQueries — every hand-built path carries the gateway prefix', () => {
  it('no request on this bare-origin instance omits /api/v1', () => {
    const src = readFileSync(resolve(__dirname, 'useConversationQueries.ts'), 'utf8');
    const calls = [...src.matchAll(/\bapi\s*\.(?:get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([`'"])([^`'"]*)\1?/g)];
    expect(calls.length).toBeGreaterThan(0);
    const missing = calls.map((m) => m[2]).filter((p) => !p.startsWith('/api/v1/'));
    expect(missing, `paths missing the /api/v1 prefix: ${missing.join(', ')}`).toEqual([]);
  });
});
