/**
 * "Who may send to vendors" — the owners' register of grants on /team
 * (ADR 0112 F12; founder, 2026-09-21: "only an owner issues, any owner
 * revokes, every grant/revocation told to all owners, 'granted by' shown
 * where used").
 *
 * The gateway's own rules are proved in organizations/authority-grants.service.spec.ts;
 * what is proved here is that the page offers only what the gateway allows,
 * asks the owner every question instead of defaulting one, and says a failed
 * read as unknown.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => api.get(...a),
    post: (...a: unknown[]) => api.post(...a),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import {
  SendGrantsSection,
  emptyRegisterSentence,
  grantSentence,
  type AuthorityGrantView,
} from './SendGrantsSection';
import type { TeamMember } from '../../../services/api/team';

const LIVE: AuthorityGrantView = {
  id: 'g-1',
  scope: 'vendor_send',
  grantee: { userId: 'u-gul', name: 'Gül' },
  grantedBy: { userId: 'u-olcay', name: 'Olcay' },
  vouchedBy: { userId: 'u-olcay', name: 'Olcay' },
  limitAmount: null,
  limitCurrency: null,
  expiresAt: null,
  createdAt: '2026-09-20T09:00:00.000Z',
  revokedAt: null,
  revokedBy: null,
  awaitingSince: null,
  awaitingReason: null,
  ownerOnly: false,
  state: 'live',
};

const WAITING: AuthorityGrantView = {
  ...LIVE,
  id: 'g-2',
  state: 'awaiting_reapproval',
  awaitingSince: '2026-09-21T09:00:00.000Z',
  awaitingReason: 'voucher_no_longer_owner',
};

/** The hold, on the keyboard: the first Enter arms it (and mints the seal), the second approves. */
function hold(die: HTMLElement) {
  fireEvent.keyDown(die, { key: 'Enter' });
  fireEvent.keyDown(die, { key: 'Enter' });
}

/** A gateway that mints a seal on every `seal-challenge` and answers the act. */
function sealsThen(answer: unknown) {
  api.post.mockImplementation(async (path: string) =>
    String(path).endsWith('seal-challenge') ? { data: { challenge: 'seal-1' } } : { data: answer },
  );
}

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: 'm',
    restaurant_id: 'r1',
    user_id: null,
    display_name: 'x',
    email: null,
    phone: null,
    avatar_url: null,
    position: null,
    employment_type: 'full_time',
    home_location: null,
    hourly_wage: null,
    skills: [],
    hire_date: null,
    status: 'active',
    notes: null,
    role: 'staff',
    accountLinked: true,
    ...over,
  };
}

const MEMBERS: TeamMember[] = [
  member({ id: 'm1', user_id: 'u-ayse', display_name: 'Ayşe', role: 'staff' }),
  member({ id: 'm2', user_id: 'u-mert', display_name: 'Mert', role: 'manager' }),
  member({ id: 'm3', user_id: null, display_name: 'No account', role: 'staff', accountLinked: false }),
];

function draw(readout: unknown) {
  api.get.mockResolvedValue({ data: readout });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SendGrantsSection restaurantId="r1" members={MEMBERS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('who may send to vendors', () => {
  it('says each grant in one sentence, with who named them', async () => {
    draw({ viewerIsOwner: true, grants: [LIVE] });
    await waitFor(() =>
      expect(screen.getByTestId('send-grants-live')).toHaveTextContent(
        'Gül may send to vendors with one hold (letters only), named by Olcay, until an owner revokes it.',
      ),
    );
  });

  it('an owner revokes any grant with a hold that carries a server seal', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [LIVE] });
    sealsThen({ says: 'Revoked. Gül can no longer send with one hold.' });
    hold(await screen.findByRole('button', { name: /Hold to revoke/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/authority/grants/g-1/revoke', undefined, {
        headers: { 'x-seal-challenge': 'seal-1' },
      }),
    );
    expect(api.post).toHaveBeenCalledWith('/authority/grants/g-1/seal-challenge', { act: 'revoke' });
    await waitFor(() => expect(screen.getByTestId('send-grants-says')).toHaveTextContent(/Revoked/));
  });

  it('a grantee sees their own grant and is offered nothing it would be refused', async () => {
    // What the gateway sends staff: only the grants that name them.
    draw({ viewerIsOwner: false, viewer: 'other', grants: [LIVE] });
    await waitFor(() => expect(screen.getByTestId('send-grants-live')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Hold to revoke/ })).toBeNull();
    expect(screen.queryByTestId('send-grants-form')).toBeNull();
  });

  it('a manager reads the register (founder answer 2) and is offered no owner act', async () => {
    draw({ viewerIsOwner: false, viewer: 'manager', grants: [LIVE, WAITING] });
    await waitFor(() => expect(screen.getByTestId('send-grants-live')).toBeInTheDocument());
    expect(screen.getByTestId('send-grants-waiting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull();
    expect(screen.queryByTestId('send-grants-form')).toBeNull();
  });

  it('an empty register is worded for who reads it — never "nobody" to someone who cannot see everything', async () => {
    expect(emptyRegisterSentence('owner')).toMatch(/^Nobody has been named\./);
    expect(emptyRegisterSentence('manager')).toMatch(/that managers can see\. An owner may keep a grant owner-only/);
    expect(emptyRegisterSentence('other')).toMatch(/^No grant names you\./);
    draw({ viewerIsOwner: false, viewer: 'manager', grants: [] });
    await waitFor(() =>
      expect(screen.getByTestId('send-grants-none')).toHaveTextContent(/that managers can see/),
    );
    expect(screen.queryByTestId('send-grants-form')).toBeNull();
  });

  it('a grant whose owner went waits, says so, and an owner re-approves it under a seal', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [WAITING] });
    await waitFor(() =>
      expect(screen.getByTestId('send-grants-waiting')).toHaveTextContent(
        /Gül can no longer send \(letters only\): Olcay, who named them, is no longer an owner here, so it stopped/,
      ),
    );
    expect(screen.getByTestId('send-grants-waiting')).toHaveTextContent(/waits for an owner to re-approve it, or to delete it/);
    sealsThen({ says: 'Re-approved.' });
    hold(screen.getByRole('button', { name: /Hold to re-approve/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/authority/grants/g-2/reapprove', undefined, {
        headers: { 'x-seal-challenge': 'seal-1' },
      }),
    );
  });

  it('an owner deletes a waiting grant under a seal', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [WAITING] });
    sealsThen({ says: 'Deleted.' });
    hold(await screen.findByRole('button', { name: /Hold to delete/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/authority/grants/g-2/seal-challenge', { act: 'delete' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/authority/grants/g-2/delete', undefined, {
        headers: { 'x-seal-challenge': 'seal-1' },
      }),
    );
  });

  it('a hold whose seal could not be issued does nothing and says so', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [LIVE] });
    api.post.mockRejectedValue(new Error('not an owner'));
    hold(await screen.findByRole('button', { name: /Hold to revoke/ }));
    await waitFor(() => expect(screen.getByTestId('send-grants-problem')).toHaveTextContent(/seal could not be issued/));
    expect(api.post.mock.calls.some((c: unknown[]) => String(c[0]).endsWith('/revoke'))).toBe(false);
  });

  it('an owner marks a grant owner-only', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [LIVE] });
    api.post.mockResolvedValue({ data: { says: 'Owner-only.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Make it owner-only' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/authority/grants/g-1/owner-only', { ownerOnly: true }));
  });

  it('a re-approved grant names who it rests on now', () => {
    expect(grantSentence({ ...LIVE, vouchedBy: { userId: 'u-cem', name: 'Cem' } })).toMatch(
      /named by Olcay, re-approved by Cem, until an owner revokes it/,
    );
  });

  it('an owner with no grants live is told nobody has been named', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [] });
    await waitFor(() =>
      expect(screen.getByTestId('send-grants-none')).toHaveTextContent(/^Nobody has been named\./),
    );
  });

  it('offers only people with an account who are not already owners or managers', async () => {
    draw({ viewerIsOwner: true, grants: [] });
    const select = (await screen.findByLabelText('Name someone')) as HTMLSelectElement;
    const names = Array.from(select.options).map((o) => o.textContent);
    expect(names).toContain('Ayşe');
    expect(names).not.toContain('Mert');
    expect(names).not.toContain('No account');
  });

  it('names someone with every answer stated — letters only, until revoked — under a seal minted over exactly that', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [] });
    sealsThen({ says: 'Ayşe may now send to vendors with one hold.' });
    fireEvent.change(await screen.findByLabelText('Name someone'), { target: { value: 'u-ayse' } });
    hold(screen.getByRole('button', { name: /Hold to name them/ }));
    const body = {
      granteeUserId: 'u-ayse',
      scope: 'vendor_send',
      limitAmount: null,
      limitCurrency: null,
      expiresAt: null,
      ownerOnly: false,
    };
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, '/authority/grants/seal-challenge', body);
    expect(api.post).toHaveBeenNthCalledWith(2, '/authority/grants', body, { headers: { 'x-seal-challenge': 'seal-1' } });
  });

  it('an owner can name someone owner-only from the start', async () => {
    draw({ viewerIsOwner: true, viewer: 'owner', grants: [] });
    sealsThen({ says: 'Named.' });
    fireEvent.change(await screen.findByLabelText('Name someone'), { target: { value: 'u-ayse' } });
    fireEvent.click(screen.getByLabelText(/owner-only \(managers will not see it\)/));
    hold(screen.getByRole('button', { name: /Hold to name them/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/authority/grants/seal-challenge', expect.objectContaining({ ownerOnly: true })),
    );
  });

  it('a deal limit needs both an amount and a currency before the hold is offered', async () => {
    draw({ viewerIsOwner: true, grants: [] });
    fireEvent.change(await screen.findByLabelText('Name someone'), { target: { value: 'u-ayse' } });
    fireEvent.click(screen.getByLabelText(/letters, and deals up to/));
    const die = screen.getByRole('button', { name: /Hold to name them/ });
    expect(die).toBeDisabled();
    fireEvent.change(screen.getByLabelText('The largest deal it covers'), { target: { value: '5000' } });
    expect(die).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Currency of the limit (three letters)'), { target: { value: 'try' } });
    expect(die).not.toBeDisabled();
  });

  it('a failed read is unknown, not nobody', async () => {
    api.get.mockRejectedValue(new Error('permission denied'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SendGrantsSection restaurantId="r1" members={MEMBERS} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/unknown, not nobody/));
  });

  it('says ended and revoked grants plainly', () => {
    expect(grantSentence({ ...LIVE, state: 'revoked', revokedAt: '2026-09-21T10:00:00Z', revokedBy: { userId: 'u-cem', name: 'Cem' } })).toMatch(
      /Gül — named by Olcay, revoked by Cem on/,
    );
    expect(grantSentence({ ...LIVE, state: 'expired', expiresAt: '2026-09-01T00:00:00Z' })).toMatch(/Gül — named by Olcay, ended/);
  });
});
