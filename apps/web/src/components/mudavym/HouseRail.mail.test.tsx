/**
 * r107 mail-gap g5, on the rail the person actually sees. The shell gate is live
 * for every house, so the Communications room in the rooms rail (and in the
 * phone's Rooms sheet, which shares the list) carries how many people wait on
 * the house, said in words for a screen reader, hidden at 0 and while unread.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'u1', name: 'Ada', role: 'manager', restaurantId: 'rest-1' },
    activeRestaurantId: 'rest-1',
    activeRole: 'manager',
  }),
}));

import { HouseRail } from './HouseRail';

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <HouseRail role="manager" flags={{ connections: true } as never} tucked={false} onToggle={() => {}} mod="⌘" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => api.get.mockReset());

describe('the rooms rail and the people waiting on the house', () => {
  it('names the count on the Communications room, and says who waits', async () => {
    api.get.mockResolvedValue({ data: { waitingPeople: 6 } });
    mount();
    const room = await screen.findByRole('link', { name: 'Communications, 6 waiting on the house' });
    expect(room).toHaveTextContent('6');
    expect(room).not.toHaveTextContent(/on you/);
  });

  it('draws nothing at 0, and no other room gets a count', async () => {
    api.get.mockResolvedValue({ data: { waitingPeople: 0 } });
    mount();
    const room = await screen.findByRole('link', { name: 'Communications' });
    expect(room).toHaveTextContent(/^Communications$/);
    expect(screen.queryByText(/waiting on the house/)).toBeNull();
  });
});
