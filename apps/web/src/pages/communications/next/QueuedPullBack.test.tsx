/**
 * COMMS-W23 — a queued house letter can be pulled back from the conversation
 * book after the composer is closed. No house can queue a letter until it has
 * a mailbox, so this file is the proof: the clock is the server's, the cancel
 * is the composer's route, and a refusal never reads as a pull-back.
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
}));
vi.mock('../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/AuthContext')>()),
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}));

import { QueuedPullBack } from './QueuedPullBack';

function mount(id = 'c1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QueuedPullBack id={id} />
    </QueryClientProvider>,
  );
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const queued = (dispatchAt: string | null) => ({
  data: { queued: [{ id: 'c1', providerId: 'p1', subject: 'Allocation', to: 'v@x.test', dispatchAt }] },
});

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('QueuedPullBack (COMMS-W23)', () => {
  it('offers the pull-back with the server clock and says it is the author’s alone', async () => {
    api.get.mockResolvedValue(queued(inSeconds(90)));
    mount();
    const button = await screen.findByTestId('book-pull-back');
    expect(api.get).toHaveBeenCalledWith('/communications/letters/queued');
    expect(button.textContent).toMatch(/^Pull it back \((89|90)s\)$/);
    expect(screen.getByText('Only the person who wrote it can pull it back.')).toBeInTheDocument();
  });

  it('pulls it back through the composer’s cancel route and says the server’s words', async () => {
    api.get.mockResolvedValue(queued(inSeconds(90)));
    api.post.mockResolvedValue({ data: { says: 'Pulled back. It was never sent.' } });
    mount();
    fireEvent.click(await screen.findByTestId('book-pull-back'));
    expect(await screen.findByText('Pulled back. It was never sent.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/communications/letters/c1/cancel');
    expect(screen.queryByTestId('book-pull-back')).toBeNull();
  });

  it('a refused cancel is said as NOT pulled back, never as a pull-back', async () => {
    api.get.mockResolvedValue(queued(inSeconds(90)));
    api.post.mockRejectedValue({
      response: { data: { message: 'Only the person who wrote this letter can pull it back.' } },
    });
    mount();
    fireEvent.click(await screen.findByTestId('book-pull-back'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'It was NOT pulled back — Only the person who wrote this letter can pull it back.',
    );
    expect(screen.queryByText(/^Pulled back/)).toBeNull();
  });

  it('a closed window offers nothing to press', async () => {
    api.get.mockResolvedValue(queued(inSeconds(-5)));
    mount();
    expect(await screen.findByText('The window has closed. The book will say whether it left.')).toBeInTheDocument();
    expect(screen.queryByTestId('book-pull-back')).toBeNull();
  });

  it('an unreadable queue says the letter may still leave', async () => {
    api.get.mockRejectedValue(new Error('Network Error'));
    mount();
    expect(
      await screen.findByText('Whether it can still be pulled back could not be read, so it may still leave.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('book-pull-back')).toBeNull();
  });

  it('a letter the queued read does not hold is not offered', async () => {
    api.get.mockResolvedValue(queued(inSeconds(90)));
    mount('other');
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(
      await screen.findByText('It can no longer be pulled back from here. The book will say whether it left.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('book-pull-back')).toBeNull();
  });
});
