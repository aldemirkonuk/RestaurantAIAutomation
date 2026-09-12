/**
 * /reset-password — both sides of the public switch (ADR 0133 decision 1).
 *
 * Switch OFF: three legacy states pinned to the snapshots taken from the page
 * BEFORE this session touched it (2026-09-11).
 *
 * Switch ON: the house treatment. The server's own message is printed
 * verbatim (holding the token already proves inbox access, so nothing is
 * leaked by saying why it failed); the success state says plainly that other
 * signed-in devices stay signed in, because they do (reset-password.md §11)
 * and revoking them is a founder decision this page does not take.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResetPassword } from './ResetPassword';

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

function mount(path = '/reset-password?token=11111111-1111-4111-8111-111111111111') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

const fill = (a: string, b: string) => {
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: a } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: b } });
};

beforeEach(() => {
  http.post.mockReset();
  pub.on = false;
});

describe('/reset-password — switch off', () => {
  it('renders the legacy form byte-for-byte', () => {
    const { container } = mount();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy missing-token state byte-for-byte', () => {
    const { container } = mount('/reset-password');
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the legacy success state byte-for-byte', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    const { container } = mount();
    fill('correct-horse-battery', 'correct-horse-battery');
    fireEvent.submit(screen.getByRole('button', { name: /reset password/i }).closest('form')!);
    await screen.findByText(/password updated/i);
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('/reset-password — switch on', () => {
  beforeEach(() => {
    pub.on = true;
  });

  it('states a missing token in words and offers a new link', () => {
    const { container } = mount('/reset-password');
    expect(container.querySelector('.mudavym.pub-root')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/carries no token/i);
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('refuses a short or mismatched password before asking the gateway', async () => {
    mount();
    fill('short', 'short');
    fireEvent.submit(screen.getByRole('button', { name: /set the password/i }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    fill('correct-horse-battery', 'correct-horse-batter');
    fireEvent.submit(screen.getByRole('button', { name: /set the password/i }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('sends token and password, then says other devices stay signed in', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    mount();
    fill('correct-horse-battery', 'correct-horse-battery');
    fireEvent.submit(screen.getByRole('button', { name: /set the password/i }).closest('form')!);
    await waitFor(() => expect(http.post).toHaveBeenCalledTimes(1));
    expect(http.post.mock.calls[0][0]).toMatch(/\/api\/v1\/auth\/reset-password$/);
    expect(http.post.mock.calls[0][1]).toEqual({
      token: '11111111-1111-4111-8111-111111111111',
      newPassword: 'correct-horse-battery',
    });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/password is set/i);
    expect(screen.getByText(/stay signed in/i)).toBeInTheDocument();
  });

  it('prints the gateway\'s own reason when the token is refused', async () => {
    http.post.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      response: { status: 400, data: { message: 'Reset token has already been used' } },
    });
    mount();
    fill('correct-horse-battery', 'correct-horse-battery');
    fireEvent.submit(screen.getByRole('button', { name: /set the password/i }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/i);
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });
});
