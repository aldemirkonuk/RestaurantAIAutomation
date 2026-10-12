/**
 * F-1321: a session in no house can see, add and remove its passkeys.
 *
 * The gateway allows it (`@AllowsNoHouse`, F-1262; ADR 0229, item 44), but
 * /profile -- the only page that drew them -- is behind the house-required
 * shell. So /no-access (both treatments) and /choose-house carry the same
 * `PasskeyRows`, closed until opened. The API modules are mocked at their
 * boundary; `PasskeyRows.test.tsx` owns what the rows themselves say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ getPasskeys: vi.fn() }));

vi.mock('../../../services/api/passkeys', () => ({
  PASSKEYS_QUERY_KEY: ['passkeys'],
  getPasskeys: () => api.getPasskeys(),
  passkeysSupported: () => true,
  addPasskey: vi.fn(),
  removePasskey: vi.fn(),
  checkPasskey: vi.fn(),
  sendStepUpCode: vi.fn(),
  StepUpRequired: class StepUpRequired extends Error {},
}));
const profile = vi.hoisted(() => ({
  getMe: vi.fn(),
  changePassword: vi.fn(),
  unlinkProvider: vi.fn(),
}));
vi.mock('../../../services/api/profile', () => ({ profileApi: profile }));
const deleteAccountAndSignOut = vi.hoisted(() => vi.fn());
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  default: client,
  apiClient: client,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { useAuth } from '../../../contexts/AuthContext';
import apiClient from '../../../services/api/client';
import { NoAccess } from '../../NoAccess';
import { ChooseHouse } from '../../ChooseHouse';
import { PUBLIC_OVERRIDE_KEY } from '../../../lib/mudavym/publicDesign';


function authAs(restaurantId: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'p@house.test',
      name: 'P',
      restaurantId,
      role: null,
      emailVerified: true,
    },
    loading: false,
    logout: vi.fn(),
    setActiveRestaurantId: vi.fn(),
    deleteAccountAndSignOut,
  } as never);
}

function draw(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/no-access" element={<NoAccess />} />
          <Route path="/choose-house" element={<ChooseHouse />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const LIVE = {
  id: 'p1',
  nickname: 'Work laptop',
  createdAt: '2026-09-20T10:00:00.000Z',
  lastUsedAt: null,
  deviceType: 'multiDevice',
  backedUp: true,
  transports: ['internal'],
  rpId: 'mudavym.com',
  revokedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getPasskeys.mockResolvedValue({
    readable: true,
    reason: null,
    passkeys: [LIVE],
    eligible: true,
    eligibilityReason: null,
  });
});
afterEach(() => {
  cleanup();
  try {
    window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY);
  } catch {
    /* storage blocked */
  }
});

async function openAndSeeRows() {
  // Closed until asked: the page's own job comes first, and nothing is read.
  expect(api.getPasskeys).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Your passkeys' }));
  expect(await screen.findByText('Work laptop')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
}

describe('NoHousePasskeys (F-1321)', () => {
  it('/no-access shows the passkey rows to a session in no house', async () => {
    authAs('');
    draw('/no-access');
    await openAndSeeRows();
  });

  it('/no-access shows them in the older treatment too', async () => {
    window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'off');
    authAs('');
    draw('/no-access');
    expect(screen.getByText('No house yet')).toBeTruthy();
    await openAndSeeRows();
  });

  it('/choose-house shows them while the session has no house', async () => {
    authAs('');
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        houses: [],
        held: [
          {
            membershipId: 'm1',
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'Moda',
            city: null,
            role: 'staff',
          },
        ],
        accessEnded: false,
      },
    } as never);
    draw('/choose-house');
    expect(await screen.findByText('Join Moda')).toBeTruthy();
    await openAndSeeRows();
  });

  it('/choose-house does not offer them to a session already in a house (that is /profile)', async () => {
    authAs('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        houses: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Moda', city: null }],
        held: [],
        accessEnded: false,
      },
    } as never);
    draw('/choose-house');
    expect(await screen.findByText('Moda')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Your passkeys' })).toBeNull();
  });
});

/**
 * F-1396: the same pages carry the password, the sign-ins and deleting the
 * account, which the gateway serves without a house and /profile cannot.
 */
describe('NoHouseAccount (F-1396)', () => {
  beforeEach(() => {
    profile.getMe.mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'p@house.test',
      name: 'P',
      role: 'staff',
      hasPassword: false,
      linkedProviders: { google: true, microsoft: false },
    });
    profile.changePassword.mockResolvedValue(undefined);
    deleteAccountAndSignOut.mockResolvedValue(undefined);
  });

  const openAccount = async () => {
    expect(profile.getMe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Password, sign-ins and deleting your account' }));
    expect(await screen.findByText('Set a password')).toBeTruthy();
  };

  it('/no-access lets a session in no house set a first password', async () => {
    authAs('');
    draw('/no-access');
    await openAccount();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new one' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a brand new one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() =>
      expect(profile.changePassword).toHaveBeenCalledWith({ currentPassword: undefined, newPassword: 'a brand new one' }),
    );
    expect(await screen.findByText(/Password saved/)).toBeTruthy();
  });

  it('/no-access says why the only sign-in cannot be unlinked', async () => {
    authAs('');
    draw('/no-access');
    await openAccount();
    expect((screen.getByRole('button', { name: 'Unlink' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/This is your only way to sign in/)).toBeTruthy();
  });

  it('/no-access lets a session in no house delete its account', async () => {
    authAs('');
    draw('/no-access');
    await openAccount();
    fireEvent.change(screen.getByLabelText('Type DELETE to arm the seal'), { target: { value: 'DELETE' } });
    const hold = () => screen.getByRole('button', { name: 'Hold to delete this account' });
    fireEvent.keyDown(hold(), { key: 'Enter' });
    fireEvent.keyDown(hold(), { key: 'Enter' });
    await waitFor(() => expect(deleteAccountAndSignOut).toHaveBeenCalledWith(undefined));
  }, 20_000);

  it('/choose-house offers it while the session has no house', async () => {
    authAs('');
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        houses: [],
        held: [
          { membershipId: 'm1', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Moda', city: null, role: 'staff' },
        ],
        accessEnded: false,
      },
    } as never);
    draw('/choose-house');
    expect(await screen.findByText('Join Moda')).toBeTruthy();
    await openAccount();
  });

  it('/no-access lets the last owner of an organisation hand it over, which the delete refusal points to (F-1460)', async () => {
    authAs('');
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        organizations: [
          {
            id: 'org-1',
            name: 'Meyhane Group',
            candidates: [{ userId: 'user-heir', name: 'Deniz', email: 'deniz@example.com' }],
          },
        ],
      },
    } as never);
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} } as never);
    draw('/no-access');
    await openAccount();
    expect(apiClient.get).toHaveBeenCalledWith('/auth/me/organisations');
    expect(screen.getByText(/hand your organisation over first \(just above\)/)).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Meyhane Group: hand it to'), { target: { value: 'user-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Click again to hand it over' }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/auth/me/organisations/org-1/hand-over', {
        toUserId: 'user-heir',
        emailCode: undefined,
      }),
    );
  });
});
