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

import { SendGrantsSection, grantSentence, type AuthorityGrantView } from './SendGrantsSection';
import type { TeamMember } from '../../../services/api/team';

const LIVE: AuthorityGrantView = {
  id: 'g-1',
  scope: 'vendor_send',
  grantee: { userId: 'u-gul', name: 'Gül' },
  grantedBy: { userId: 'u-olcay', name: 'Olcay' },
  limitAmount: null,
  limitCurrency: null,
  expiresAt: null,
  createdAt: '2026-09-20T09:00:00.000Z',
  revokedAt: null,
  revokedBy: null,
  state: 'live',
};

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

  it('an owner revokes any grant', async () => {
    draw({ viewerIsOwner: true, grants: [LIVE] });
    api.post.mockResolvedValue({ data: { says: 'Revoked. Gül can no longer send with one hold.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/authority/grants/g-1/revoke'));
    await waitFor(() => expect(screen.getByTestId('send-grants-says')).toHaveTextContent(/Revoked/));
  });

  it('a grantee sees their own grant and is offered nothing it would be refused', async () => {
    // What the gateway sends a non-owner: only the grants that name them.
    draw({ viewerIsOwner: false, grants: [LIVE] });
    await waitFor(() => expect(screen.getByTestId('send-grants-live')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.queryByTestId('send-grants-form')).toBeNull();
  });

  it('a manager is never told "nobody has been named" off a list filtered to their own grants', async () => {
    // A manager holds no grant, so the gateway sends them an empty list even
    // when staff have been named (AuthorityGrantsService.list).
    draw({ viewerIsOwner: false, grants: [] });
    await waitFor(() =>
      expect(screen.getByTestId('send-grants-none')).toHaveTextContent(
        'No grant names you. Only owners see who else has been named.',
      ),
    );
    expect(screen.getByTestId('send-grants')).not.toHaveTextContent(/Nobody has been named/);
    expect(screen.queryByTestId('send-grants-form')).toBeNull();
  });

  it('an owner with no grants live is told nobody has been named', async () => {
    draw({ viewerIsOwner: true, grants: [] });
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

  it('names someone with every answer stated — letters only, until revoked — never a missing key', async () => {
    draw({ viewerIsOwner: true, grants: [] });
    api.post.mockResolvedValue({ data: { says: 'Ayşe may now send to vendors with one hold.' } });
    fireEvent.change(await screen.findByLabelText('Name someone'), { target: { value: 'u-ayse' } });
    const die = screen.getByRole('button', { name: /Hold to name them/ });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenCalledWith('/authority/grants', {
      granteeUserId: 'u-ayse',
      scope: 'vendor_send',
      limitAmount: null,
      limitCurrency: null,
      expiresAt: null,
    });
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
