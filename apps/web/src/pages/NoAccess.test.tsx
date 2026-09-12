/**
 * /no-access — both sides of the public switch (ADR 0133 decisions 1 and 4).
 *
 * Switch OFF: the two legacy states (signed in · signed out) pinned to the
 * snapshots taken from the page BEFORE this session touched it (2026-09-11).
 *
 * Switch ON: the honest terminal state for "your account is real, your
 * membership is not" (no-access.md §12). It renders the three states of the
 * branches fetch that `AuthContext` now exposes — loading, failed (with the
 * gateway's text and a retry), empty — and never reads a failure as "no
 * houses". The one way out is an invitation code, which routes to
 * `/invite/:code`; sign out; back to sign in. A person who does have houses
 * and typed this URL is told so and sent to the house.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NoAccess } from './NoAccess';

const pub = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/mudavym/publicDesign', () => ({
  usePublicDesign: () => pub.on,
  isPublicDesignOn: () => pub.on,
  PUBLIC_OVERRIDE_KEY: 'mudavym.design.public',
}));

type Branch = { id: string; name: string; city: string | null; chain_id: string | null; chain_name: string | null };
type BranchesState = { status: 'loading' | 'ready' | 'empty' | 'failed'; error: string | null; checkedAt: string | null };
const auth = vi.hoisted(() => ({
  user: { userId: 'u1', email: 'defne@sim.test', name: 'Defne' } as { userId: string; email: string; name: string } | null,
  availableRestaurants: [] as Branch[],
  branches: { status: 'empty', error: null, checkedAt: '2026-09-11T14:12:00.000Z' } as BranchesState,
  logout: vi.fn(),
  refreshBranches: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    isAuthenticated: !!auth.user,
    availableRestaurants: auth.availableRestaurants,
    branches: auth.branches,
    logout: auth.logout,
    refreshBranches: auth.refreshBranches,
  }),
}));

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}</div>;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/no-access']}>
      <Routes>
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.user = { userId: 'u1', email: 'defne@sim.test', name: 'Defne' };
  auth.availableRestaurants = [];
  auth.branches = { status: 'empty', error: null, checkedAt: '2026-09-11T14:12:00.000Z' };
  auth.logout.mockReset();
  auth.refreshBranches.mockReset();
  auth.refreshBranches.mockResolvedValue([]);
  pub.on = false;
});

describe('/no-access — switch off', () => {
  it('renders the legacy signed-in card byte-for-byte', () => {
    const { container } = mount();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy signed-out card byte-for-byte', () => {
    auth.user = null;
    const { container } = mount();
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('/no-access — switch on', () => {
  beforeEach(() => {
    pub.on = true;
  });

  it('empty: names the signed-in address, says an owner\'s invitation is the way in, and dates the check', () => {
    const { container } = mount();
    expect(container.querySelector('.mudavym.pub-root')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/signed in as defne@sim\.test/i);
    expect(screen.getByText(/owner's invitation/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/no houses/i);
    expect(screen.getByRole('status')).toHaveTextContent(/checked/i);
  });

  it('empty: an invitation code is the one way out — it opens /invite/<code>', async () => {
    mount();
    fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: ' kx7mp4qa ' } });
    fireEvent.submit(screen.getByRole('button', { name: /open the invitation/i }).closest('form')!);
    expect(await screen.findByTestId('probe')).toHaveTextContent('/invite/KX7MP4QA');
  });

  it('empty: a code that is not eight characters is refused in words, not sent', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'abc' } });
    fireEvent.submit(screen.getByRole('button', { name: /open the invitation/i }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent(/eight characters/i);
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('loading: says the houses are being checked', () => {
    auth.branches = { status: 'loading', error: null, checkedAt: null };
    mount();
    expect(screen.getByRole('status')).toHaveTextContent(/checking your houses/i);
  });

  it('failed: prints the gateway\'s text and offers a retry — never "no houses"', async () => {
    auth.branches = { status: 'failed', error: 'Request failed with status code 503', checkedAt: null };
    mount();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/could not be read/i);
    expect(status).toHaveTextContent(/503/);
    expect(status).not.toHaveTextContent(/no houses/i);
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    await waitFor(() => expect(auth.refreshBranches).toHaveBeenCalledTimes(1));
  });

  it('with houses: says so and sends the person to the house', async () => {
    auth.availableRestaurants = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'The Old Mill', city: null, chain_id: null, chain_name: null },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Lokanta Meyhane', city: null, chain_id: null, chain_name: null },
    ];
    auth.branches = { status: 'ready', error: null, checkedAt: '2026-09-11T14:12:00.000Z' };
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/2 houses/i);
    fireEvent.click(screen.getByRole('button', { name: /go to the house/i }));
    expect(await screen.findByTestId('probe')).toHaveTextContent('/');
  });

  it('sign out calls logout; back to sign in is a link', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('signed out: says so and points at sign in', () => {
    auth.user = null;
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not signed in/i);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});
