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

  it('an owner or a manager declines with a reason the person who asked reads, and nothing is sent', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-manager', mayDecline: true } } });
    api.post.mockResolvedValue({ data: { says: 'Declined. The person who asked was told why, and nothing was sent.' } });
    draw(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(screen.queryByRole('button', { name: 'Withdraw my request' })).toBeNull();
    // No reason, no decline.
    fireEvent.click(screen.getByRole('button', { name: 'Decline it' }));
    expect(await screen.findByTestId('letter-requests-problem')).toHaveTextContent(/Say why/);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Why\? Ayşe reads this/), { target: { value: ' We ordered this week. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline it' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/communications/letters/requests/req-1/decline', { reason: 'We ordered this week.' }),
    );
    expect(await screen.findByTestId('letter-requests-says')).toHaveTextContent(/Declined/);
  });

  it('the person who asked may withdraw their own, and is offered no decline', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-staff', mayDecline: false } } });
    api.post.mockResolvedValue({ data: { says: 'Withdrawn. It no longer waits for a manager, and nothing was sent.' } });
    draw(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw my request' }));
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/communications/letters/requests/req-1/withdraw', {}));
    expect(await screen.findByTestId('letter-requests-says')).toHaveTextContent(/Withdrawn/);
  });

  it('nobody else is offered a withdraw', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-other', mayDecline: false } } });
    draw(false);
    await screen.findByTestId('letter-requests');
    expect(screen.queryByRole('button', { name: 'Withdraw my request' })).toBeNull();
  });

  it('a letter pulled back inside its undo window says it is waiting again', async () => {
    api.get.mockResolvedValue({ data: { requests: [{ ...REQ, undoneCount: 1 }], viewer: { userId: 'u-manager', mayDecline: true } } });
    draw(true);
    expect(await screen.findByTestId('letter-request-undone')).toHaveTextContent(/pulled back before it left, so it is waiting again/);
  });

  it('a released letter can be pulled back from here inside its window, and a failed pull-back never reads as done', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ], viewer: { userId: 'u-manager', mayDecline: true } } });
    const dispatchAt = new Date(Date.now() + 120_000).toISOString();
    let cancelFails = true;
    api.post.mockImplementation(async (path: string) => {
      if (path.endsWith('seal-challenge')) return { data: { challenge: 'seal-1' } };
      if (path.endsWith('/cancel')) {
        if (cancelFails) throw new Error('That letter left the queue a moment ago');
        return { data: { says: 'Pulled back. The staff request it released is waiting for an owner or a manager again.' } };
      }
      return { data: { id: 'letter-9', says: 'Queued to leave.', dispatchAt, undoMs: 120_000 } };
    });
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    const pull = await screen.findByRole('button', { name: 'Pull it back' });
    fireEvent.click(pull);
    await waitFor(() => expect(screen.getByTestId('letter-requests-problem')).toHaveTextContent(/NOT pulled back: That letter left the queue/));
    expect(api.post).toHaveBeenCalledWith('/communications/letters/letter-9/cancel');
    cancelFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Pull it back' }));
    await waitFor(() => expect(screen.getByTestId('letter-requests-says')).toHaveTextContent(/waiting for an owner or a manager again/));
    expect(screen.queryByRole('button', { name: 'Pull it back' })).toBeNull();
  });

  it('a release whose letter has no undo window offers no pull-back', async () => {
    api.get.mockResolvedValue({ data: { requests: [REQ] } });
    api.post.mockImplementation(async (path: string) =>
      path.endsWith('seal-challenge') ? { data: { challenge: 'seal-1' } } : { data: { id: 'letter-9', says: 'Queued to leave.', dispatchAt: new Date(Date.now() + 120_000).toISOString(), undoMs: null } },
    );
    draw(true);
    const die = await screen.findByRole('button', { name: /Hold to send it as written/ });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('letter-requests-says')).toHaveTextContent(/Queued to leave/));
    expect(screen.queryByRole('button', { name: 'Pull it back' })).toBeNull();
  });

  it('a failed read is a failed read, not an empty list', async () => {
    api.get.mockRejectedValue(new Error('permission denied'));
    draw(true);
    await waitFor(() => expect(screen.getByTestId('letter-requests-unread')).toHaveTextContent(/could not be read/));
  });
});

// Founder, 2026-09-22, verbatim pick: "Back to waiting (Recommended)".
describe('a released letter that could not be sent', () => {
  it('comes back waiting, with who released it and why it was not sent, for the manager and the person who asked', async () => {
    const failed: LetterRequest = {
      ...REQ,
      lastSendFailure: {
        reason: "the house's mailbox holds no grant to send with.",
        at: '2026-09-22T09:05:00.000Z',
        releasedBy: { userId: 'u-manager', name: 'Mert' },
        count: 1,
      },
    };
    api.get.mockResolvedValue({ data: { requests: [failed] } });
    draw(true);
    expect(await screen.findByTestId('letter-request-send-failed')).toHaveTextContent(
      "Mert released it, but it could not be sent: the house's mailbox holds no grant to send with. It is waiting again. Nothing was sent.",
    );
  });

  it('says nothing about a failure that did not happen', async () => {
    api.get.mockResolvedValue({ data: { requests: [{ ...REQ, lastSendFailure: null }] } });
    draw(false);
    await screen.findByTestId('letter-requests');
    expect(screen.queryByTestId('letter-request-send-failed')).toBeNull();
  });
});
