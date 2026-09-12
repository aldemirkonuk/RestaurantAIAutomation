/**
 * /invite/:code — both sides of the public switch (ADR 0133 decision 1).
 *
 * Switch OFF: the four legacy states (loading · invalid · valid signed-out ·
 * valid signed-in) pinned to the snapshots taken from the page BEFORE this
 * session touched it (2026-09-11).
 *
 * Switch ON: the resolved card ("You are expected at … — as a …"), the three
 * `reason` values as three sentences (invite-landing.md §13.2), the signed-in
 * question as a centred Panel (620) that closes with words (ADR 0112), and
 * "as if signed in": after the accept the joined house is the active one
 * before the person lands on `/`.
 *
 * Behaviour shared by both branches (bug fixes, not treatment): the accept
 * button no longer no-ops without a stored token — it sends the person to
 * `/login?redirect=/invite/<code>` (§13.1); the shared axios client (§13.5).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { InviteLanding } from './InviteLanding';

const pub = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/mudavym/publicDesign', () => ({
  usePublicDesign: () => pub.on,
  isPublicDesignOn: () => pub.on,
  PUBLIC_OVERRIDE_KEY: 'mudavym.design.public',
}));

type Branch = { id: string; name: string; city: string | null; chain_id: string | null; chain_name: string | null };
const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  user: null as { userId: string; email: string; name: string } | null,
  availableRestaurants: [] as Branch[],
  refreshBranches: vi.fn(),
  setActiveRestaurantId: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: auth.isAuthenticated,
    user: auth.user,
    availableRestaurants: auth.availableRestaurants,
    refreshBranches: auth.refreshBranches,
    setActiveRestaurantId: auth.setActiveRestaurantId,
  }),
}));

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../services/api/client', () => ({
  apiClient: { get: api.get, post: api.post },
  getErrorMessage: (e: unknown) => {
    const r = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    return r || (e as Error)?.message || 'An unexpected error occurred';
  },
}));

vi.mock('axios', () => {
  const isAxiosError = (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError;
  return { default: { isAxiosError }, isAxiosError };
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const HOUSE_A: Branch = { id: '11111111-1111-4111-8111-111111111111', name: 'The Old Mill', city: 'Ann Arbor', chain_id: null, chain_name: null };
const HOUSE_B: Branch = { id: '22222222-2222-4222-8222-222222222222', name: 'Lokanta Meyhane', city: 'Istanbul', chain_id: null, chain_name: null };

const VALID = { valid: true, organization: 'Lokanta Meyhane', restaurant: 'Lokanta Meyhane', city: 'Istanbul', inviter: 'Hasan', role: 'manager' };

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname + loc.search}</div>;
}

function mount(path = '/invite/KX7MP4QA') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:code" element={<InviteLanding />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const signIn = () => {
  auth.isAuthenticated = true;
  auth.user = { userId: 'u1', email: 'defne@sim.test', name: 'Defne' };
  auth.availableRestaurants = [HOUSE_A];
  window.localStorage.setItem('accessToken', 'a.b.c');
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  auth.refreshBranches.mockReset();
  auth.setActiveRestaurantId.mockReset();
  auth.setActiveRestaurantId.mockResolvedValue(undefined);
  auth.isAuthenticated = false;
  auth.user = null;
  auth.availableRestaurants = [];
  toast.success.mockReset();
  toast.error.mockReset();
  window.localStorage.clear();
  document.body.innerHTML = '';
  pub.on = false;
});

describe('/invite/:code — switch off', () => {
  it('renders the legacy loading state byte-for-byte', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy invalid state byte-for-byte', async () => {
    api.get.mockResolvedValue({ data: { valid: false, reason: 'used' } });
    const { container } = mount();
    await screen.findByText(/this invite has expired/i);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy signed-out card byte-for-byte', async () => {
    api.get.mockResolvedValue({ data: VALID });
    const { container } = mount();
    await screen.findByText(/sign in to accept/i);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy signed-in card byte-for-byte', async () => {
    signIn();
    api.get.mockResolvedValue({ data: VALID });
    const { container } = mount();
    await screen.findByRole('button', { name: /add lokanta meyhane/i });
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('/invite/:code — switch on', () => {
  beforeEach(() => {
    pub.on = true;
  });

  it('states the resolution as a loading state, in words', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    expect(container.querySelector('.mudavym.pub-root')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/resolving the invitation/i);
  });

  it.each([
    ['not_found', /no invitation carries this code/i],
    ['used', /already been used/i],
    ['expired', /has expired/i],
  ])('renders reason %s as its own sentence', async (reason, sentence) => {
    api.get.mockResolvedValue({ data: { valid: false, reason } });
    mount();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(sentence);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('a preview the gateway could not answer is a failure with its text, not "expired"', async () => {
    api.get.mockRejectedValue({ response: { data: { message: 'Too many requests' } } });
    mount();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/could not be read/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/too many requests/i);
    api.get.mockResolvedValue({ data: VALID });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/you are expected at/i);
  });

  it('signed out: the resolved card, the two doors, and no inviter name', async () => {
    api.get.mockResolvedValue({ data: VALID });
    const { container } = mount();
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/you are expected at lokanta meyhane/i);
    expect(h1).toHaveTextContent(/as a manager/i);
    expect(screen.getByText('Istanbul')).toBeInTheDocument();
    expect(screen.getByText(/expiry/i)).toBeInTheDocument();
    expect(screen.getByText(/not stated/i)).toBeInTheDocument();
    // The inviter's name is a founder fork (invite-landing.md §13.4): withheld until decided.
    expect(container.textContent).not.toMatch(/Hasan/);
    expect(screen.getByRole('link', { name: /sign in to accept/i })).toHaveAttribute(
      'href',
      '/login?redirect=%2Finvite%2FKX7MP4QA',
    );
    expect(screen.getByRole('link', { name: /create an account to accept/i })).toHaveAttribute(
      'href',
      '/register?invite=KX7MP4QA',
    );
  });

  it('signed in: the question is a centred panel that closes with words, and accepting lands in THAT house', async () => {
    signIn();
    api.get.mockResolvedValue({ data: VALID });
    api.post.mockResolvedValue({ data: { success: true, restaurant: 'Lokanta Meyhane', role: 'manager' } });
    auth.refreshBranches.mockResolvedValue([HOUSE_A, HOUSE_B]);
    mount();
    const dialog = await screen.findByRole('dialog', { name: /add lokanta meyhane to your houses/i });
    expect(within(dialog).getByText(/signed in as defne@sim\.test/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /not now/i })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^add lokanta meyhane$/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/invite/KX7MP4QA/accept'));
    await waitFor(() => expect(auth.setActiveRestaurantId).toHaveBeenCalledWith(HOUSE_B.id));
    expect(await screen.findByTestId('probe')).toHaveTextContent('/');
  });

  it('signed in: "Not now" closes the question and the card keeps a way to ask it again', async () => {
    signIn();
    api.get.mockResolvedValue({ data: VALID });
    mount();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /not now/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /add lokanta meyhane to my houses/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('signed in: 409 already_member is a success, and the house is selected by name', async () => {
    signIn();
    auth.availableRestaurants = [HOUSE_A, HOUSE_B];
    api.get.mockResolvedValue({ data: VALID });
    api.post.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message: 'already_member' } } });
    auth.refreshBranches.mockResolvedValue([HOUSE_A, HOUSE_B]);
    mount();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^add lokanta meyhane$/i }));
    await waitFor(() => expect(auth.setActiveRestaurantId).toHaveBeenCalledWith(HOUSE_B.id));
    expect(await screen.findByTestId('probe')).toHaveTextContent('/');
  });

  it('signed in: a refused accept prints the gateway\'s text inside the question', async () => {
    signIn();
    api.get.mockResolvedValue({ data: VALID });
    api.post.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { message: 'Invite code is invalid, expired, or already used' } } });
    mount();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^add lokanta meyhane$/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/invalid, expired, or already used/i);
    expect(auth.setActiveRestaurantId).not.toHaveBeenCalled();
  });

  it('signed in by context but with no stored token: the accept sends you to sign in, never a dead press', async () => {
    signIn();
    window.localStorage.removeItem('accessToken');
    api.get.mockResolvedValue({ data: VALID });
    mount();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^add lokanta meyhane$/i }));
    expect(await screen.findByTestId('probe')).toHaveTextContent('/login?redirect=%2Finvite%2FKX7MP4QA');
    expect(api.post).not.toHaveBeenCalled();
  });
});
