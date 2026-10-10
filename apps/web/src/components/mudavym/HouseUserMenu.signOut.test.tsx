/**
 * A chosen sign-out from the house header opens a clean sign-in (F-438): no
 * `from`, so the next person on a shared tablet does not land on this one's
 * page after signing in.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HouseUserMenu } from './HouseUserMenu';

const h = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'u-owner', name: 'Selin', email: 's@house.test', role: 'owner' },
    logout: h.logout,
    activeRole: 'owner',
    activeRestaurantId: 'r1',
    availableRestaurants: [{ id: 'r1', name: 'Tuzlu' }],
  }),
}));

function SignIn() {
  const loc = useLocation();
  return <div data-testid="sign-in">{JSON.stringify(loc.state)}</div>;
}

describe('HouseUserMenu — sign-out', () => {
  it('goes to /login with no page carried over', async () => {
    h.logout.mockResolvedValueOnce(true);
    render(
      <MemoryRouter initialEntries={['/orders/o-1']}>
        <Routes>
          <Route path="/login" element={<SignIn />} />
          <Route path="*" element={<HouseUserMenu />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByTestId('sign-in')).toHaveTextContent('null'));
  });
});
