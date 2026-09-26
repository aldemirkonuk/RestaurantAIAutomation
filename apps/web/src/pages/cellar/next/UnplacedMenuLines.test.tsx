/**
 * "Show me the N it could not place" on /cellar — OD-140, founder 2026-09-25
 * ("Separate list endpoint"; round 4 item 18: the control lives on /cellar,
 * next to the registers).
 *
 * Goes through the real client contract (`apiClient`), not a mocked hook, so
 * the request path and the "read only when asked" rule are asserted on the
 * actual call, not on a rendered string.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => api.get(...args) },
}));

import UnplacedMenuLines from './UnplacedMenuLines';
import type { MenuLineTallyVM, SourceStatusVM } from './useCellarNextData';

const MENU_OK: SourceStatusVM = { readable: true, reason: null, rows: 12 };

function draw(menuLines: MenuLineTallyVM | null | undefined, menuSource: SourceStatusVM = MENU_OK) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <UnplacedMenuLines menuLines={menuLines} menuSource={menuSource} />
    </QueryClientProvider>,
  );
}

const UNPLACED_PATH = '/cellar/r1/registers/unplaced';

beforeEach(() => {
  api.get.mockReset();
});

describe('UnplacedMenuLines — the count', () => {
  it('claims nothing when the readout does not carry the tally', () => {
    const { container } = draw(undefined);
    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('says an unread menu is unknown, never zero, and offers no control', () => {
    draw(null, { readable: false, reason: 'permission denied for menu_items', rows: null });
    expect(screen.getByTestId('menu-lines-unread')).toHaveTextContent(
      /menu could not be read \(permission denied for menu_items\).*unknown — not zero/,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says an empty menu is empty, not "every line placed"', () => {
    draw({ read: 0, placed: 0, notPlaced: 0 });
    expect(screen.getByTestId('menu-lines-empty')).toHaveTextContent(/no lines yet/);
    expect(screen.queryByTestId('menu-lines-all-placed')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says every line was placed, with no control, when none are left over', () => {
    draw({ read: 12, placed: 12, notPlaced: 0 });
    expect(screen.getByTestId('menu-lines-all-placed')).toHaveTextContent(
      'The reader placed every one of the 12 menu lines in a register.',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('UnplacedMenuLines — "Show me the N"', () => {
  it('prints the count and reads the list only when asked', async () => {
    api.get.mockResolvedValue({
      data: {
        restaurantId: 'r1',
        read: 12,
        lines: [
          { id: 'm1', category: 'Desserts', name: 'Tiramisu' },
          { id: 'm2', category: null, name: '  ' },
        ],
      },
    });
    draw({ read: 12, placed: 10, notPlaced: 2 });
    expect(screen.getByTestId('menu-lines-not-placed')).toHaveTextContent(
      /2 of the 12 menu lines could not be placed in any register/,
    );
    const btn = screen.getByRole('button', { name: 'Show me the 2 it could not place' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(api.get).not.toHaveBeenCalled();

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(btn).toHaveAttribute('aria-controls', 'cl-unplaced-lines');
    expect(await screen.findByText('Tiramisu')).toBeInTheDocument();
    expect(screen.getByText('under “Desserts”')).toBeInTheDocument();
    expect(screen.getByText('A line with no name')).toBeInTheDocument();
    expect(screen.getByText('no section')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith(UNPLACED_PATH);
    expect(screen.queryByTestId('unplaced-lines-changed')).toBeNull();
  });

  it('says it is reading while the list is on its way', async () => {
    api.get.mockReturnValue(new Promise(() => {}));
    draw({ read: 5, placed: 4, notPlaced: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Show me the 1 it could not place' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Reading the line it could not place…');
  });

  it('says a failed read as a failure — never as an empty list', async () => {
    api.get.mockRejectedValue(new Error('Request failed with status code 500'));
    draw({ read: 12, placed: 9, notPlaced: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Show me the 3 it could not place' }));
    const alert = await screen.findByTestId('unplaced-lines-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(/could not be read \(Request failed with status code 500\)/);
    expect(alert).toHaveTextContent('The count above still stands.');
    expect(screen.queryByText(/places every line/)).toBeNull();
  });

  it('says so when the list and the count disagree — the menu changed between reads', async () => {
    api.get.mockResolvedValue({
      data: { restaurantId: 'r1', read: 13, lines: [{ id: 'm1', category: 'Mains', name: 'Stew' }] },
    });
    draw({ read: 12, placed: 9, notPlaced: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Show me the 3 it could not place' }));
    expect(await screen.findByTestId('unplaced-lines-changed')).toHaveTextContent(
      'The menu changed since the count above: this read finds 1 of 13 lines it could not place.',
    );
    expect(screen.getByText('Stew')).toBeInTheDocument();
  });

  it('hides the list again on a second press', async () => {
    api.get.mockResolvedValue({ data: { restaurantId: 'r1', read: 2, lines: [{ id: 'm1', category: 'A', name: 'X' }] } });
    draw({ read: 2, placed: 1, notPlaced: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Show me the 1 it could not place' }));
    await screen.findByText('X');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the line it could not place' }));
    await waitFor(() => expect(screen.queryByTestId('unplaced-lines')).toBeNull());
  });
});
