/**
 * "Last day of the month" is a choice on the sheet (F-307).
 *
 * Before this, a monthly anchor stopped at 28 — the database CHECK said so —
 * and the only way to the month end was to leave the anchor empty and start on
 * the 31st. Migration 20261231200000_an_order_can_repeat_on_the_last_day widens
 * the CHECK to 1..31, and 31 means "the last day" on the gateway. These cases
 * pin the sheet's half: the named choice, what it says, and what it sends.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const postMock = vi.hoisted(() => vi.fn(async () => ({ data: {} })));

vi.mock('@/services/api/client', () => ({
  apiClient: { post: postMock },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'error',
  getActiveRestaurantId: () => 'rest-1',
}));

import { RecurrenceSheet, monthAnchorSentence, projectOccurrences } from './RecurrenceSheet';
import { readRecurrence, recurrenceLabel } from './recurrence';
import { toRow } from './useOrdersNextData';

const row = toRow(
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

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecurrenceSheet open onClose={() => {}} row={row} />
    </QueryClientProvider>,
  );
}

describe('the last day of the month, on the sheet (F-307)', () => {
  beforeEach(() => postMock.mockClear());

  it('offers "Last day of the month" for a monthly rule, and sends it as 31', async () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('recurrence-frequency-monthly'));
    const lastDay = screen.getByTestId('recurrence-lastday');
    expect(lastDay.textContent).toBe('Last day of the month');
    expect(lastDay.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(lastDay);
    expect(lastDay.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('recurrence-monthday') as HTMLInputElement).max).toBe('31');
    expect(screen.getByTestId('recurrence-projection').textContent).toContain(
      'On the last day of every month.',
    );

    fireEvent.click(screen.getByTestId('recurrence-save'));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(
      '/procurement/orders/o-1/recurrence',
      expect.objectContaining({ frequency: 'monthly', anchorDay: 31 }),
    );
  });

  it('a second press takes the choice back off', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('recurrence-frequency-quarterly'));
    const lastDay = screen.getByTestId('recurrence-lastday');
    fireEvent.click(lastDay);
    fireEvent.click(lastDay);
    expect(lastDay.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByTestId('recurrence-monthday') as HTMLInputElement).value).toBe('');
  });

  it('is not offered for a weekly rule', () => {
    renderSheet();
    fireEvent.click(screen.getByTestId('recurrence-frequency-weekly'));
    expect(screen.queryByTestId('recurrence-lastday')).toBeNull();
  });

  it('projects the last day of every month, back to the 31st after February', () => {
    expect(projectOccurrences('2026-02-10', 'monthly', 31, 4)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('says what an anchor of 29 to 31 does in a short month', () => {
    expect(monthAnchorSentence(31)).toBe('On the last day of every month.');
    expect(monthAnchorSentence(30)).toBe('On the 30th, or the last day of a shorter month.');
    expect(monthAnchorSentence(12)).toBe('On the 12th of the month.');
  });

  it('names the rule "the last day" on the ledger row, never "the 31st"', () => {
    const r = readRecurrence({
      recurrenceFrequency: 'monthly',
      recurrenceAnchorDay: 31,
      recurrenceNextDueOn: null,
      recurrenceStatus: 'paused',
    });
    expect(recurrenceLabel(r, 'en-GB')).toBe('recurs monthly on the last day — paused');
  });
});
