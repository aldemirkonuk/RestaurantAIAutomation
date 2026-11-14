import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import React from 'react';

const api = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn(), get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1', user: { restaurantId: 'house-1', role: 'owner' } }),
}));

import { useNoReplyMark } from './useMailData';

/**
 * r35 mail, M-F1: "No reply needed" answered at once, but the thread was read
 * again a second or two later; in between the button offered the act again
 * over a letter still drawn as waiting. The mark is pending until the thread
 * on screen has been read again.
 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let reads = 0;
  let pending: ReturnType<typeof deferred<string>> | null = null;
  const threadFn = vi.fn(() => {
    reads += 1;
    if (reads === 1) return Promise.resolve('waiting');
    pending = deferred<string>();
    return pending.promise;
  });
  // The people list answers once, then never again.
  let listReads = 0;
  const listFn = vi.fn(() => (++listReads === 1 ? Promise.resolve('people') : new Promise<string>(() => undefined)));
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const hook = renderHook(
    () => ({
      thread: useQuery({ queryKey: ['mail-thread', 'house-1', 'k1'], queryFn: threadFn }),
      people: useQuery({ queryKey: ['mail-people', 'house-1', false, ''], queryFn: listFn }),
      mark: useNoReplyMark(),
    }),
    { wrapper },
  );
  return { hook, threadFn, listFn, release: (v: string) => pending?.resolve(v) };
}

describe('useNoReplyMark', () => {
  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ data: { id: 'l/1', marked: true } });
    api.delete.mockReset().mockResolvedValue({ data: { id: 'l/1', marked: false } });
  });

  it('stays pending after the mark is saved, until the thread has been read again', async () => {
    const { hook, threadFn, release } = setup();
    await waitFor(() => expect(hook.result.current.thread.data).toBe('waiting'));

    act(() => hook.result.current.mark.mutate({ id: 'l/1', marked: true }));
    await waitFor(() => expect(threadFn).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledWith('/mail/letters/l%2F1/no-reply-needed');
    // The server has answered and the thread is being read: still pending.
    expect(hook.result.current.mark.isPending).toBe(true);

    await act(async () => release('marked'));
    await waitFor(() => expect(hook.result.current.mark.isPending).toBe(false));
    expect(hook.result.current.thread.data).toBe('marked');
    expect(hook.result.current.mark.isSuccess).toBe(true);
  });

  it('taking the mark back waits for the thread the same way, and does not wait on the lists', async () => {
    const { hook, threadFn, listFn, release } = setup();
    await waitFor(() => expect(hook.result.current.thread.data).toBe('waiting'));
    await waitFor(() => expect(hook.result.current.people.data).toBe('people'));

    act(() => hook.result.current.mark.mutate({ id: 'l/1', marked: false }));
    await waitFor(() => expect(threadFn).toHaveBeenCalledTimes(2));
    expect(api.delete).toHaveBeenCalledWith('/mail/letters/l%2F1/no-reply-needed');
    expect(hook.result.current.mark.isPending).toBe(true);
    // The people list was asked again too, and never answers; the mark does not wait for it.
    await waitFor(() => expect(listFn.mock.calls.length).toBeGreaterThanOrEqual(2));

    await act(async () => release('waiting again'));
    await waitFor(() => expect(hook.result.current.mark.isPending).toBe(false));
  });

  it('a thread that cannot be read again still lets the mark settle as saved', async () => {
    const { hook, threadFn } = setup();
    await waitFor(() => expect(hook.result.current.thread.data).toBe('waiting'));
    threadFn.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    act(() => hook.result.current.mark.mutate({ id: 'l/1', marked: true }));
    await waitFor(() => expect(hook.result.current.mark.isSuccess).toBe(true));
  });
});
