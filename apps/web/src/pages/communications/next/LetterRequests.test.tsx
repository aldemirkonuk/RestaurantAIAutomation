/**
 * Letters a staff member asked a manager to send (founder answer 3,
 * 2026-09-21). The gateway's rules are proved in
 * communications/letters/house-letters-sealed.spec.ts; what is proved here is
 * that a manager releases the exact letter with ONE hold that mints the seal
 * over it and names the request, that staff are offered nothing to release,
 * and that a failed read is never "nothing waiting".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => api.get(...a),
    post: (...a: unknown[]) => api.post(...a),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { LetterRequestsPanel, releaseBody, type LetterRequest } from './LetterRequestsPanel';

const REQ: LetterRequest = {
  id: 'req-1',
  kind: 'house_letter',
  providerId: 'prov-1',
  requestedBy: { userId: 'u-staff', name: 'Ayşe' },
  requestedAt: '2026-09-21T09:00:00.000Z',
  payload: { providerId: 'prov-1', to: 'fikri@fikritarim.com', subject: 'Standing order', body: 'Merhaba', orderId: null },
  state: 'waiting',
};

function draw(canRelease: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LetterRequestsPanel restaurantId="r1" canRelease={canRelease} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('letters waiting for a manager', () => {
  it('a manager releases the exact letter with one hold that mints the seal over it and names the request', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ] } });
    api.post.mockImplementation(async (path: string) =>
      path.endsWith('seal-challenge') ? { data: { challenge: 'seal-1' } } : { data: { says: 'Queued to leave.' } },
    );
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    expect(screen.getByTestId('letter-requests')).toHaveTextContent('Ayşe asked for this letter to fikri@fikritarim.com to be sent');
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    const body = releaseBody(REQ);
    expect(body).toEqual({ providerId: 'prov-1', to: 'fikri@fikritarim.com', subject: 'Standing order', body: 'Merhaba', requestId: 'req-1' });
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/communications/letters', body, { headers: { 'X-Seal-Challenge': 'seal-1' } }));
    expect(api.post).toHaveBeenCalledWith('/communications/letters/seal-challenge', body);
    await waitFor(() => expect(screen.getByTestId('letter-requests-says')).toHaveTextContent(/Queued to leave/));
  });

  it('a staff member sees their own waiting letter and nothing to release', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ] } });
    draw(false);
    await waitFor(() => expect(screen.getByTestId('letter-requests')).toHaveTextContent(/Waiting for an owner or a manager/));
    expect(screen.queryByRole('button', { name: /Hold to send/ })).toBeNull();
  });

  it('a failed read is a failed read, not an empty list', async () => {
    api.get.mockRejectedValue(new Error('permission denied'));
    draw(true);
    await waitFor(() => expect(screen.getByTestId('letter-requests-unread')).toHaveTextContent(/could not be read/));
  });
});
