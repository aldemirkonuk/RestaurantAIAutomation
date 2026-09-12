/**
 * /verify-email — both sides of the public switch (ADR 0133 decision 1).
 *
 * Switch OFF: the two legacy modes (no token · with token) pinned to the
 * snapshots taken from the page BEFORE this session touched it (2026-09-11).
 *
 * Switch ON: the house treatment, and the honesty the doc asked for
 * (verify-email.md §12-13): a resend that the gateway reports as NOT sent
 * reads as not sent, in words on the page, never as a success toast; the
 * gateway's own text on a refusal; the onward routing (Get Started vs the
 * house) stays; the once-a-minute resend stays and is stated as a time.
 *
 * Behaviour shared by both branches (bug fixes, not treatment): the shared
 * axios client instead of raw fetch, and `navigate` after the profile is
 * reloaded instead of a full-page `window.location.href` — with the reload
 * kept as the fallback when the profile cannot be re-read.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { VerifyEmail } from './VerifyEmail';

const pub = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/mudavym/publicDesign', () => ({
  usePublicDesign: () => pub.on,
  isPublicDesignOn: () => pub.on,
  PUBLIC_OVERRIDE_KEY: 'mudavym.design.public',
}));

const auth = vi.hoisted(() => ({
  user: { userId: 'u1', email: 'ada@sim.test', name: 'Ada', restaurantId: '', role: 'owner' } as
    | { userId: string; email: string; name: string; restaurantId: string; role: string }
    | null,
  reloadUser: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, reloadUser: auth.reloadUser }),
}));

const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../services/api/client', () => ({
  apiClient: { post: api.post, get: api.get },
  getErrorMessage: (e: unknown) => {
    const r = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    return r || (e as Error)?.message || 'An unexpected error occurred';
  },
}));

const menus = vi.hoisted(() => ({ getOnboardingProgress: vi.fn() }));
vi.mock('../services/api/menus', () => ({ getOnboardingProgress: menus.getOnboardingProgress }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}</div>;
}

function mount(path = '/verify-email') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.post.mockReset();
  api.get.mockReset();
  menus.getOnboardingProgress.mockReset();
  auth.reloadUser.mockReset();
  auth.reloadUser.mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
  window.localStorage.clear();
  pub.on = false;
});

describe('/verify-email — switch off', () => {
  it('renders the legacy no-token mode byte-for-byte', () => {
    const { container } = mount();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy with-token mode byte-for-byte', () => {
    const { container } = mount('/verify-email?token=abc');
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('/verify-email — switch on', () => {
  beforeEach(() => {
    pub.on = true;
  });

  it('with a token: one press redeems it, reloads the profile and goes on to Get Started', async () => {
    api.post.mockResolvedValue({ data: { accessToken: 'a.b.c', refreshToken: 'r' } });
    menus.getOnboardingProgress.mockResolvedValue(null);
    const { container } = mount('/verify-email?token=abc');
    expect(container.querySelector('.mudavym.pub-root')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/one letter, one press/i);
    fireEvent.click(screen.getByRole('button', { name: /verify my email/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/verify-email', { token: 'abc' }));
    await waitFor(() => expect(auth.reloadUser).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem('accessToken')).toBe('a.b.c');
    expect(window.localStorage.getItem('refreshToken')).toBe('r');
    expect(await screen.findByTestId('probe')).toHaveTextContent('/get-started');
  });

  it('with a token: goes to the house when a list is already in the books', async () => {
    api.post.mockResolvedValue({ data: { accessToken: 'a.b.c', refreshToken: 'r' } });
    menus.getOnboardingProgress.mockResolvedValue({ menu_uploaded: true });
    mount('/verify-email?token=abc');
    fireEvent.click(screen.getByRole('button', { name: /verify my email/i }));
    expect(await screen.findByTestId('probe')).toHaveTextContent('/');
  });

  it('with a token: falls back to a full reload when the profile cannot be re-read', async () => {
    api.post.mockResolvedValue({ data: { accessToken: 'a.b.c', refreshToken: 'r' } });
    menus.getOnboardingProgress.mockResolvedValue(null);
    auth.reloadUser.mockRejectedValue(new Error('429'));
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true, configurable: true });
    try {
      mount('/verify-email?token=abc');
      fireEvent.click(screen.getByRole('button', { name: /verify my email/i }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/get-started'));
    } finally {
      Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
    }
  });

  it('with a token: prints the gateway\'s refusal and keeps the way out', async () => {
    api.post.mockRejectedValue({ response: { data: { message: 'Verification token has expired' } } });
    mount('/verify-email?token=abc');
    fireEvent.click(screen.getByRole('button', { name: /verify my email/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/token has expired/i);
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('without a token: names the address it wrote to and resends once, stating when it can again', async () => {
    api.post.mockResolvedValue({ data: { success: true, sent: true } });
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/we wrote to ada@sim\.test/i);
    fireEvent.click(screen.getByRole('button', { name: /send the letter again/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/resend-verification'));
    expect(await screen.findByText(/can be sent again at/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send the letter again/i })).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('without a token: a resend the gateway reports as not sent reads as not sent', async () => {
    api.post.mockResolvedValue({ data: { success: true, sent: false } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /send the letter again/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no verification mail can be sent from this deployment/i);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('without a token: the gateway\'s cooldown text is printed, not toasted', async () => {
    api.post.mockRejectedValue({ response: { data: { message: 'Please wait 1 minute before resending' } } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /send the letter again/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait 1 minute/i);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('without a session it still speaks, to an unnamed inbox', () => {
    auth.user = null;
    try {
      mount();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/we wrote to your inbox/i);
    } finally {
      auth.user = { userId: 'u1', email: 'ada@sim.test', name: 'Ada', restaurantId: '', role: 'owner' };
    }
  });
});
