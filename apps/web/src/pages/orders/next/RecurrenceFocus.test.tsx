/**
 * F-1038: Pause, Resume and End each disappear once the write lands, because
 * the status they offered is gone. Focus must land somewhere a keyboard user
 * can carry on from, and the result must be said aloud, not only shown.
 */

import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/client', () => ({
  apiClient: { post: postMock },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'error',
  getActiveRestaurantId: () => 'rest-1',
}));

import { RecurrenceSheet } from './RecurrenceSheet';
import { readRecurrence } from './recurrence';
import { toRow, type OrderRowVM } from './useOrdersNextData';

const base = toRow(
  {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'inv-1',
    providerId: 'prov-1',
    quantity: 5,
    unitType: 'case',
    bottlesTotal: 60,
    finalPrice: 38.99,
    totalCost: 194.95,
    status: 'APPROVED',
    approvedAt: '2026-09-01T10:00:00Z',
  } as never,
  new Map([['prov-1', 'Anadolu']]),
);

const withStatus = (status: 'active' | 'paused' | 'ended'): OrderRowVM => ({
  ...base,
  recurrence: readRecurrence({
    recurrenceFrequency: 'weekly',
    recurrenceAnchorDay: 1,
    recurrenceNextDueOn: '2026-10-12',
    recurrenceStatus: status,
    recurrenceParentOrderId: null,
    recurrenceOccurrenceOn: null,
  }),
});

/** The page's part: the order comes back from the server in its new state. */
function Harness() {
  const [row, setRow] = useState<OrderRowVM>(withStatus('active'));
  postMock.mockImplementation(async (url?: string) => {
    const path = String(url ?? '');
    if (path.endsWith('/pause')) setRow(withStatus('paused'));
    if (path.endsWith('/resume')) setRow(withStatus('active'));
    if (path.endsWith('/end')) setRow(withStatus('ended'));
    return { data: {} };
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <RecurrenceSheet open onClose={() => {}} row={row} />
    </QueryClientProvider>
  );
}

describe('in-sheet writes keep focus and speak (F-1038)', () => {
  beforeEach(() => postMock.mockReset());

  it('after Pause it, focus is on Resume it and "Saved." is in a status region', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Pause it' }));

    const resume = await screen.findByRole('button', { name: 'Resume it' });
    await waitFor(() => expect(resume).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('after End it, with no button left, focus is on the result line', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'End it' }));

    const done = await screen.findByTestId('recurrence-done');
    await waitFor(() => expect(done).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a refused write is announced as an alert', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    postMock.mockRejectedValueOnce(new Error('The supplier is closed on that day.'));

    await user.click(screen.getByRole('button', { name: 'Pause it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The supplier is closed on that day.');
  });
});
