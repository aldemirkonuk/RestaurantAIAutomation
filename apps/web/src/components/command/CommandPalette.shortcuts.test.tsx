/**
 * The palette footer says "? for all shortcuts" (F-727). The house-wide `?`
 * stops at typing targets, and the palette's search field is one, so the
 * palette must answer `?` itself — while nothing is typed — or not say it.
 *
 * The palette is mounted for real; only its network seam and the two contexts
 * it reads for unrelated features are stubbed (same shape as shellPalette.test).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(() => Promise.reject(new Error('not in this test'))) },
}));
vi.mock('../../contexts/AuthContext', async (orig) => ({
  ...(await orig<typeof import('../../contexts/AuthContext')>()),
  useAuth: () => ({ user: { restaurantId: null } }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { CommandPalette } from './CommandPalette';

beforeAll(() => {
  // jsdom has no layout; the palette scrolls its active row into view.
  Element.prototype.scrollIntoView = vi.fn();
});

function paint(onShortcuts = vi.fn()) {
  render(
    <MemoryRouter>
      <CommandPalette open onClose={vi.fn()} onShortcuts={onShortcuts} />
    </MemoryRouter>,
  );
  return { onShortcuts, input: screen.getByPlaceholderText(/search pages/i) };
}

describe('CommandPalette — ? for all shortcuts', () => {
  it('opens the shortcut list on ? while the search is empty', () => {
    const { onShortcuts, input } = paint();
    expect(screen.getByText(/for all shortcuts/)).toBeInTheDocument();

    fireEvent.keyDown(input, { key: '?' });
    expect(onShortcuts).toHaveBeenCalledTimes(1);
  });

  it('once something is typed, ? is part of the search and the hint steps aside', () => {
    const { onShortcuts, input } = paint();
    fireEvent.change(input, { target: { value: 'what' } });

    fireEvent.keyDown(input, { key: '?' });
    expect(onShortcuts).not.toHaveBeenCalled();
    expect(screen.queryByText(/for all shortcuts/)).toBeNull();
  });
});
