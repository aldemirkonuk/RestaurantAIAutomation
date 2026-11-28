/**
 * r110 mail-gap g5: a note names its thread by query, never by path segment. A mid: key can hold
 * a "/" (RFC 5322 msg-id atext allows it), and a path segment that a proxy decodes gains a
 * segment: the note could be neither written nor deleted. Same shape as GET /mail/thread.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => h.post(...a), delete: (...a: unknown[]) => h.del(...a) },
}));
vi.mock('../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/AuthContext')>()),
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}));

import { useAddNote, useDeleteNote } from './MailThreadNotes';

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  h.post.mockReset().mockResolvedValue({ data: { id: 'n1' } });
  h.del.mockReset().mockResolvedValue({ data: { id: 'n1', deleted: true } });
});

describe('a note names its thread by query', () => {
  it('writing: POST /mail/thread/notes with the key and the person as params, the key never in the path', async () => {
    const { result } = renderHook(() => useAddNote('mid:a/b@x.example', 'vendor:v1'), { wrapper: wrapper() });
    result.current.mutate({ person: 'vendor:v1', body: 'Called them' });
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith('/mail/thread/notes', { body: 'Called them' }, { params: { key: 'mid:a/b@x.example', with: 'vendor:v1' } });
  });

  it('deleting: DELETE /mail/thread/notes/:id, the key not in the path', async () => {
    const { result } = renderHook(() => useDeleteNote('mid:a/b@x.example'), { wrapper: wrapper() });
    result.current.mutate('n 1');
    await waitFor(() => expect(h.del).toHaveBeenCalled());
    expect(h.del).toHaveBeenCalledWith('/mail/thread/notes/n%201');
  });
});
