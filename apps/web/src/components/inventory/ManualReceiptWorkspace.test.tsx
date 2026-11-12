/**
 * A delivery without an order (ported to /inventory 2026-10-31): a save whose
 * outcome is unknown (5xx, or no answer) must not invite a blind retry, since
 * a receipt that did land would count the bottles twice. A refused save (4xx)
 * keeps the plain retry text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const persist = vi.hoisted(() => vi.fn());
vi.mock('../../lib/menuScannerPersistence', () => ({ persistBatchToInventory: persist }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
}));
vi.mock('../../hooks/queries', () => ({ useWines: () => ({ data: [], isFetching: false }) }));
vi.mock('../../hooks/queries/useProviderQueries', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }));

import { ManualReceiptWorkspace } from './ManualReceiptWorkspace';

function axiosLike(over: Record<string, unknown>) {
  return Object.assign(new Error('Request failed'), { isAxiosError: true, ...over });
}

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <ManualReceiptWorkspace isOpen onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Wine not in the library' }));
  fireEvent.change(screen.getByPlaceholderText('Wine name *'), { target: { value: 'Barolo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
  return { invalidate, save: () => screen.getByRole('button', { name: /^Record 1 bottle$/ }) as HTMLButtonElement };
}

beforeEach(() => {
  persist.mockReset();
});

describe('ManualReceiptWorkspace save failures', () => {
  for (const [label, err] of [
    ['a 5xx', axiosLike({ response: { status: 502, data: { message: 'Bad gateway' } } })],
    ['no answer', axiosLike({ request: {} })],
  ] as const) {
    it(`after ${label} says the outcome is unknown, re-reads the book, and will not save again`, async () => {
      persist.mockRejectedValue(err);
      const { invalidate, save } = draw();
      await act(async () => {
        fireEvent.click(save());
      });
      expect(screen.getByText(/couldn't tell whether this receipt was recorded\. Look at the book before saving again/)).toBeTruthy();
      expect(screen.queryByText(/try again/i)).toBeNull();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
      expect(save().disabled).toBe(true);
      await act(async () => {
        fireEvent.click(save());
      });
      expect(persist).toHaveBeenCalledTimes(1);
    });
  }

  it('after a refusal (4xx) keeps the plain text and lets the person fix it and save again', async () => {
    persist.mockRejectedValueOnce(axiosLike({ response: { status: 422, data: { message: 'Quantity is required.' } } }));
    const { invalidate, save } = draw();
    await act(async () => {
      fireEvent.click(save());
    });
    expect(screen.getByText('Quantity is required.')).toBeTruthy();
    expect(screen.queryByText(/couldn't tell whether/)).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
  });
});
