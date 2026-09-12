/**
 * /forgot-password — both sides of the public switch (ADR 0133 decision 1).
 *
 * Switch OFF: the rendered tree is pinned to the snapshot taken from the page
 * BEFORE this session touched it (2026-09-11). A change to the legacy branch
 * fails here and must stop.
 *
 * Switch ON: the house treatment. Every state the gateway can produce renders
 * as words — asked too often (429), the server's own text (5xx), unreachable
 * (network) — and the always-succeeds contract of the request stays exactly
 * as it is (enumeration resistance is the point, not a gap).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPassword } from './ForgotPassword';

const pub = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/mudavym/publicDesign', () => ({
  usePublicDesign: () => pub.on,
  isPublicDesignOn: () => pub.on,
  PUBLIC_OVERRIDE_KEY: 'mudavym.design.public',
}));

const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => {
  const isAxiosError = (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError;
  return { default: { post: http.post, isAxiosError }, isAxiosError };
});

function mount(path = '/forgot-password') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ForgotPassword />
    </MemoryRouter>,
  );
}

const axiosErr = (status: number | undefined, message?: string, code?: string) => ({
  isAxiosError: true,
  code,
  message: message ?? 'Request failed',
  response: status ? { status, data: message ? { message } : {} } : undefined,
});

beforeEach(() => {
  http.post.mockReset();
  pub.on = false;
});

describe('/forgot-password — switch off', () => {
  it('renders the legacy form byte-for-byte', () => {
    const { container } = mount('/forgot-password?email=ada%40sim.test');
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy submitted state byte-for-byte', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    const { container } = mount();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@sim.test' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);
    await screen.findByText(/check your email/i, { selector: 'p' });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy 429 copy byte-for-byte', async () => {
    http.post.mockRejectedValue(axiosErr(429));
    const { container } = mount();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@sim.test' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);
    await screen.findByText(/too many requests/i);
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('/forgot-password — switch on', () => {
  beforeEach(() => {
    pub.on = true;
  });

  it('wears the house treatment and prefills the address /login handed over', () => {
    const { container } = mount('/forgot-password?email=ada%40sim.test');
    expect(container.querySelector('.mudavym.pub-root')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/address on your account/i);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('ada@sim.test');
    expect(screen.getByRole('button', { name: /send the reset link/i })).toBeEnabled();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('asks the gateway and states the always-the-same answer with its provenance', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    mount();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@sim.test' } });
    fireEvent.submit(screen.getByRole('button', { name: /send the reset link/i }).closest('form')!);
    await waitFor(() => expect(http.post).toHaveBeenCalledTimes(1));
    expect(http.post.mock.calls[0][0]).toMatch(/\/api\/v1\/auth\/request-password-reset$/);
    expect(http.post.mock.calls[0][1]).toEqual({ email: 'ada@sim.test' });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i);
    expect(screen.getByText(/ada@sim\.test/)).toBeInTheDocument();
    expect(screen.getByText(/same answer for every address/i)).toBeInTheDocument();
  });

  it('says "asked too often" on a 429', async () => {
    http.post.mockRejectedValue(axiosErr(429));
    mount();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@sim.test' } });
    fireEvent.submit(screen.getByRole('button', { name: /send the reset link/i }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/asked too often/i);
  });

  it('prints the server\'s own text on a 5xx', async () => {
    http.post.mockRejectedValue(axiosErr(503, 'Mail relay is down for maintenance'));
    mount();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@sim.test' } });
    fireEvent.submit(screen.getByRole('button', { name: /send the reset link/i }).closest('form')!);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/503/);
    expect(alert).toHaveTextContent(/Mail relay is down for maintenance/);
  });

  it('says the server could not be reached when there is no response at all', async () => {
    http.post.mockRejectedValue(axiosErr(undefined, 'Network Error', 'ERR_NETWORK'));
    mount();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@sim.test' } });
    fireEvent.submit(screen.getByRole('button', { name: /send the reset link/i }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach/i);
  });
});
