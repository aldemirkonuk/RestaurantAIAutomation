/**
 * `useDigestSubscription` — the read/write contract against the sender built
 * on `feat/finish-digest`, unmerged as of 2026-09-17. Until that branch
 * merges here, every call 404s; this hook's whole job is telling that story
 * honestly rather than reading it as "your subscription is off" (a distinct,
 * false claim about the account) or hiding the request entirely.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

import { useDigestSubscription } from './useDigestSubscription';

const STATUS = {
  armed: true,
  armedFlag: 'DIGEST_SEND_ENABLED',
  served: true,
  servedReason: null,
  unsubscribeLinkReady: true,
  house: { set: true as const, enabled: true, hour: 7, urgencyFloor: 'this_week' as const },
  timeZone: { zone: 'America/Los_Angeles', isFallback: false },
  isMember: true,
  subscription: null,
  preferences: {
    email: true,
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    usingDefaults: true,
  },
  willReceive: false,
  blockers: ['Not subscribed yet.'],
  nextDueAt: null,
  lastSend: null,
};

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
});

describe('useDigestSubscription', () => {
  it('does nothing while inactive — no request fires before the sheet opens', () => {
    renderHook(() => useDigestSubscription(false));
    expect(api.get).not.toHaveBeenCalled();
  });

  it('reads the status once active and exposes it as ready', async () => {
    api.get.mockResolvedValue({ data: STATUS });
    const { result } = renderHook(() => useDigestSubscription(true));
    expect(result.current.phase).toBe('loading');
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.status).toEqual(STATUS);
    expect(api.get).toHaveBeenCalledWith('/recommendations/digest/subscription');
  });

  it('marks a 404 as looksUnmerged — the likelier reading on this branch — without asserting it as fact', async () => {
    api.get.mockRejectedValue({ response: { status: 404, data: { message: 'not found' } } });
    const { result } = renderHook(() => useDigestSubscription(true));
    await waitFor(() => expect(result.current.phase).toBe('unreachable'));
    expect(result.current.looksUnmerged).toBe(true);
  });

  it('does not read a 500 as looksUnmerged — that distinction is reserved for 404', async () => {
    api.get.mockRejectedValue({ response: { status: 500, data: { message: 'db down' } } });
    const { result } = renderHook(() => useDigestSubscription(true));
    await waitFor(() => expect(result.current.phase).toBe('unreachable'));
    expect(result.current.looksUnmerged).toBe(false);
    expect(result.current.failure?.message).toBe('db down');
  });

  it('subscribes with the chosen cadence and folds the response back in without a second read', async () => {
    api.get.mockResolvedValue({ data: STATUS });
    api.put.mockResolvedValue({ data: { ...STATUS, subscription: { frequency: 'daily', weekday: null, subscribedAt: 'x', updatedAt: 'x', unsubscribedAt: null, unsubscribedVia: null } } });
    const { result } = renderHook(() => useDigestSubscription(true));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    let ok = false;
    await act(async () => {
      ok = await result.current.subscribe('daily', null);
    });
    expect(ok).toBe(true);
    expect(api.put).toHaveBeenCalledWith('/recommendations/digest/subscription', { frequency: 'daily' });
    expect(api.get).toHaveBeenCalledTimes(1); // no re-fetch — the PUT response is authoritative
    expect(result.current.status?.subscription?.frequency).toBe('daily');
  });

  it('sends the weekday only for a weekly cadence', async () => {
    api.get.mockResolvedValue({ data: STATUS });
    api.put.mockResolvedValue({ data: STATUS });
    const { result } = renderHook(() => useDigestSubscription(true));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.subscribe('weekly', 3);
    });
    expect(api.put).toHaveBeenCalledWith('/recommendations/digest/subscription', {
      frequency: 'weekly',
      weekday: 3,
    });
  });

  it('reports a failed subscribe write without silently leaving the old status stale-but-unmarked', async () => {
    api.get.mockResolvedValue({ data: STATUS });
    api.put.mockRejectedValue({ response: { status: 400, data: { message: 'bad weekday' } } });
    const { result } = renderHook(() => useDigestSubscription(true));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    let ok = true;
    await act(async () => {
      ok = await result.current.subscribe('weekly', 9);
    });
    expect(ok).toBe(false);
    expect(result.current.failure?.message).toBe('bad weekday');
  });

  it('unsubscribes and re-reads status rather than assuming the DELETE response shape', async () => {
    api.get.mockResolvedValueOnce({ data: STATUS }).mockResolvedValueOnce({
      data: { ...STATUS, subscription: null },
    });
    api.delete.mockResolvedValue({});
    const { result } = renderHook(() => useDigestSubscription(true));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(api.delete).toHaveBeenCalledWith('/recommendations/digest/subscription');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});
