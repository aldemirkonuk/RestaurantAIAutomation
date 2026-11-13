/**
 * The root's three readers (ADR 0320): a stranger sees the landing page, a
 * person whose stored session is still loading sees the house loader, and a
 * signed-in person sees the dashboard through the layout's outlet.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useAuth } from '../../contexts/AuthContext';
import { RootDoor } from './RootDoor';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../components/layout/DashboardLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    DashboardLayout: () => (
      <div data-testid="layout">
        <Outlet />
      </div>
    ),
  };
});
vi.mock('../../components/mudavym/HousePageLoader', () => ({
  HousePageLoader: () => <div data-testid="loader" />,
}));

function mount() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootDoor landing={<div data-testid="landing" />} />}>
          <Route index element={<div data-testid="dashboard" />} />
        </Route>
        <Route path="/login" element={<div data-testid="login" />} />
        <Route path="/choose-house" element={<div data-testid="choose-house" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const auth = (v: Partial<ReturnType<typeof useAuth>>) => (useAuth as Mock).mockReturnValue(v);

describe('RootDoor', () => {
  afterEach(() => {
    window.localStorage.removeItem('accessToken');
    vi.clearAllMocks();
  });

  it('shows a stranger the landing page, not the sign-in door', () => {
    auth({ user: null, loading: false, isAuthenticated: false });
    mount();
    expect(screen.getByTestId('landing')).toBeInTheDocument();
    expect(screen.queryByTestId('login')).toBeNull();
    expect(screen.queryByTestId('layout')).toBeNull();
  });

  it('holds the house loader while a stored session is still being read', () => {
    window.localStorage.setItem('accessToken', 'stored');
    auth({ user: null, loading: true, isAuthenticated: false });
    mount();
    expect(screen.getByTestId('loader')).toBeInTheDocument();
    expect(screen.queryByTestId('landing')).toBeNull();
  });

  it('does not make a stranger wait on the loader when nothing is stored', () => {
    auth({ user: null, loading: true, isAuthenticated: false });
    mount();
    expect(screen.getByTestId('landing')).toBeInTheDocument();
    expect(screen.queryByTestId('loader')).toBeNull();
  });

  it('shows a signed-in person the dashboard through the layout', () => {
    auth({
      user: { id: 'u1', restaurantId: 'r1', emailVerified: true, role: 'owner' } as never,
      loading: false,
      isAuthenticated: true,
    });
    mount();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('landing')).toBeNull();
  });

  it('keeps the protected route\'s own doors for a signed-in person without a house', () => {
    auth({
      user: { id: 'u1', restaurantId: null, emailVerified: true, role: 'owner' } as never,
      loading: false,
      isAuthenticated: true,
    });
    mount();
    expect(screen.getByTestId('choose-house')).toBeInTheDocument();
  });
});
