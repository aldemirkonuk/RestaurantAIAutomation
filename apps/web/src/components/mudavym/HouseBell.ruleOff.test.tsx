/**
 * F-1659: the bell's "Rule all off" sent `PATCH /notifications/read/all` for
 * the house: every unread row, lines past the bell's page and lines put to
 * sleep among them, and the order lines waiting for a seal, with nothing on
 * screen saying so. It now rules off only the unread lines shown, and never
 * an approval line.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const bell = vi.hoisted(() => ({ items: [] as unknown[], ruleOffShown: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: {} }) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('../../lib/mudavym/useBellBook', () => ({
  BELL_PAGE: 25,
  useBellBook: () => ({
    register: { state: 'ready' },
    unread: 65,
    asleep: 2,
    unreadNote: null,
    foldedCount: 0,
    foldedById: {},
    folds: {},
    items: bell.items,
    hasMore: true,
    actionNote: null,
    markRead: () => {},
    ruleOffShown: bell.ruleOffShown,
    refresh: () => {},
  }),
}));

import { HouseBell } from './HouseBell';

const line = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: 'u',
  restaurantId: 'r',
  type: 'order_delivered',
  title: `Line ${id}`,
  message: '',
  status: 'unread',
  priority: 'medium',
  metadata: {},
  timestamp: '2026-10-13T12:00:00.000Z',
  createdAt: '2026-10-13T12:00:00.000Z',
  ...over,
});

describe('the bell rules off only the lines it shows (F-1659)', () => {
  it('[PRE-FIX-FAILS] names how many it rules off and keeps the seal line out', () => {
    bell.items = [
      line('a'),
      line('b'),
      line('read', { status: 'read' }),
      line('seal', { type: 'order_pending', title: 'Order waiting for approval', metadata: { orderId: 'ord-1' } }),
    ];
    render(
      <MemoryRouter>
        <HouseBell />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Notifications \(65 unread\)/ }));
    expect(screen.queryByText('Rule all off')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rule these 2 off' }));
    expect(bell.ruleOffShown).toHaveBeenCalledWith(['a', 'b']);
  });
});
