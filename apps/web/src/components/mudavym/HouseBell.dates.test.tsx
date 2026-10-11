/**
 * F-1344: a bell line older than a week printed its day in the house locale's
 * month words, "2 Eki" on an English page in a Turkish house. ADR 0207 q7
 * keeps dates in digits, in the house's day and month order, so the words
 * stay English.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setHouseLocale } from '../../lib/houseCurrency';

const bell = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('@/services/api/client', () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: {} }) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('../../lib/mudavym/useBellBook', () => ({
  BELL_PAGE: 25,
  useBellBook: () => ({
    register: { state: 'ready' },
    unread: bell.items.length,
    unreadNote: null,
    foldedCount: 0,
    foldedById: {},
    folds: {},
    items: bell.items,
    hasMore: false,
    actionNote: null,
    markAllRead: () => {},
    refresh: () => {},
  }),
}));

import { HouseBell } from './HouseBell';

afterEach(() => setHouseLocale(null));

describe('the bell writes an old line\'s day in digits (F-1344)', () => {
  it('[REVERT-FAILS] a Turkish house reads "2/10", never "2 Eki"', async () => {
    setHouseLocale('tr-TR');
    // A year back, so it is always past the "Nd ago" week.
    bell.items = [
      {
        id: 'n1',
        userId: 'u',
        restaurantId: 'r',
        type: 'order_delivered',
        title: 'Order delivered',
        message: '',
        status: 'unread',
        priority: 'medium',
        metadata: {},
        timestamp: '2025-10-02T12:00:00.000Z',
        createdAt: '2025-10-02T12:00:00.000Z',
      },
    ];
    render(
      <MemoryRouter>
        <HouseBell />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Notifications \(1 unread\)/ }));
    expect(await screen.findByText('Order delivered')).toBeInTheDocument();
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.queryByText(/Eki/)).toBeNull();
  });
});
