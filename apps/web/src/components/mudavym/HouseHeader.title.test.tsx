/**
 * The tab title carries the count of people waiting on the house (DD-r108-9 /
 * DD-r108-44): '(6) Vendors · Mudavym' while anyone waits, the plain title at
 * zero and on a failed read. The count's hook and its query are real; only the
 * gateway answer and the header's other speakers are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => api.get(...a) },
  getErrorMessage: () => 'x',
}));
vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const AuthContext = React.createContext<unknown>(undefined);
  return {
    AuthContext,
    useAuth: () => React.useContext(AuthContext),
  };
});
vi.mock('./HouseBell', () => ({ HouseBell: () => null }));
vi.mock('./HouseUserMenu', () => ({ HouseUserMenu: () => null }));
vi.mock('../layout/RestaurantBranchSwitcher', () => ({ RestaurantBranchSwitcher: () => null }));

import { AuthContext } from '../../contexts/AuthContext';
import { HouseHeader } from './HouseHeader';

const AUTH = {
  user: { userId: 'u1', email: 'a@sim.test', name: 'Ada', role: 'owner', restaurantId: 'rest-A' },
  activeRestaurantId: 'rest-A',
  activeRole: 'owner',
  availableRestaurants: [],
};

function mount(page: 'providers' | 'receiving_door' = 'providers', route = '/vendors') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <AuthContext.Provider value={AUTH as never}>
          <HouseHeader page={page} />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const summary = (waitingPeople: number) => (url: string) =>
  url === '/mail/summary' ? Promise.resolve({ data: { waitingPeople } }) : Promise.resolve({ data: {} });

beforeEach(() => {
  document.title = 'before';
  api.get.mockReset();
});

describe('the tab title', () => {
  it('puts the waiting count in front while anyone waits', async () => {
    api.get.mockImplementation(summary(6));
    mount();
    await waitFor(() => expect(document.title).toBe('(6) Vendors · Mudavym'));
    expect(api.get).toHaveBeenCalledWith('/mail/summary');
  });

  it('is the plain title when nobody waits', async () => {
    api.get.mockImplementation(summary(0));
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/mail/summary'));
    await waitFor(() => expect(document.title).toBe('Vendors · Mudavym'));
  });

  it('is the plain title when the summary read fails', async () => {
    api.get.mockImplementation((url: string) =>
      url === '/mail/summary' ? Promise.reject(new Error('502')) : Promise.resolve({ data: {} }),
    );
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/mail/summary'));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe('Vendors · Mudavym');
  });

  it('counts on a chrome-free page too, which still has a title', async () => {
    api.get.mockImplementation(summary(3));
    const { container } = mount('receiving_door', '/receiving/o1/door');
    expect(container.querySelector('.mdv-hdr')).toBeNull();
    await waitFor(() => expect(document.title).toMatch(/^\(3\) /));
  });
});
