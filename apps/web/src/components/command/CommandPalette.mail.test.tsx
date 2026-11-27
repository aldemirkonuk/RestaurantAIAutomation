/**
 * r108 mail g10: people in the house's Mail are found from the palette. The
 * request is debounced, the previous one aborted, and nothing is asked
 * without a house or a known role. Opening a row opens that person's mail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { CommandPalette } from './CommandPalette';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const PEOPLE = {
  people: [
    { key: 'vendor:p1', name: 'Bodega Álvaro', waiting: true },
    { key: 'guest:ana@example.com', name: null, waiting: false },
  ],
};

function mount() {
  render(
    <MemoryRouter>
      <CommandPalette open onClose={vi.fn()} />
      <Where />
    </MemoryRouter>,
  );
}
const type = (v: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value: v } });
const mailCalls = () => api.get.mock.calls.filter((c) => c[0] === '/mail/people');

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => (url === '/mail/people' ? { data: PEOPLE } : { data: {} }));
  auth.current = { user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' };
});
afterEach(() => vi.useRealTimers());

describe('the palette Mail section', () => {
  it('asks nothing for one character, and after 200 ms asks once for the last two-plus-character term', async () => {
    mount();
    type('b');
    await act(async () => void vi.advanceTimersByTime(300));
    expect(mailCalls()).toHaveLength(0);
    type('bo');
    await act(async () => void vi.advanceTimersByTime(150));
    type('bod');
    await act(async () => void vi.advanceTimersByTime(150));
    expect(mailCalls()).toHaveLength(0); // debounced: nothing yet
    await act(async () => void vi.advanceTimersByTime(100));
    expect(mailCalls()).toHaveLength(1);
    expect(mailCalls()[0]![1].params).toEqual({ q: 'bod', limit: 5 });
  });

  it('aborts the previous request when the term changes', async () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    mount();
    type('bo');
    await act(async () => void vi.advanceTimersByTime(250));
    const first = mailCalls()[0]![1].signal as AbortSignal;
    expect(first.aborted).toBe(false);
    type('bod');
    expect(first.aborted).toBe(true);
  });

  it('asks nothing with no house, or with no known role', async () => {
    auth.current = { user: { role: 'manager' }, activeRestaurantId: null, activeRole: 'manager' };
    mount();
    type('bodega');
    await act(async () => void vi.advanceTimersByTime(400));
    expect(mailCalls()).toHaveLength(0);
  });

  it('asks nothing for an unknown role', async () => {
    auth.current = { user: { restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: null };
    mount();
    type('bodega');
    await act(async () => void vi.advanceTimersByTime(400));
    expect(mailCalls()).toHaveLength(0);
  });

  it('says who waits, falls back to the address, and opens ?with= on click', async () => {
    mount();
    type('bodega');
    await act(async () => void vi.advanceTimersByTime(400));
    expect(screen.getByText('Bodega Álvaro · Waiting on you')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Bodega Álvaro · Waiting on you'));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?tab=mail&with=vendor%3Ap1');
  });

  it('fails quietly: a refused search is no rows and no error', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/mail/people') throw new Error('boom');
      return { data: {} };
    });
    mount();
    type('bodega');
    await act(async () => void vi.advanceTimersByTime(400));
    expect(screen.queryByText(/Waiting on you/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
