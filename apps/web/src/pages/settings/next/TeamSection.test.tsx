/**
 * F-1140 (sim 39, re-hit of F-176): the invite book labelled every row with its
 * code alone, and offered Revoke on an owner's invite to a manager. A row now
 * names the address the invite was made for, and a manager is told that an
 * owner's invite is an owner's to withdraw (the gateway refuses it too).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamSection } from './TeamSection';
import type { SettingsNextData } from './useSettingsNextData';

vi.mock('@/components/team/InviteTeamDialog', () => ({ InviteTeamDialog: () => null }));
vi.mock('@/components/team/TeamLaborSettings', () => ({ TeamLaborSettings: () => null }));
vi.mock('@/lib/houseZone', () => ({ useHouseZone: () => 'Europe/Istanbul' }));

const FUTURE = '2099-01-01T00:00:00Z';

const INVITES = [
  { id: 'i1', code: 'OWNR2345', role: 'owner', expires_at: FUTURE, created_at: null, target_email: 'deniz@example.test' },
  { id: 'i2', code: 'STAF2345', role: 'staff', expires_at: FUTURE, created_at: null, target_email: null },
];

function mount(role: 'owner' | 'manager', invites: unknown[] = INVITES) {
  const data = {
    role,
    canManage: true,
    restaurantId: 'r1',
    userId: 'u-me',
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    setMemberRole: vi.fn(),
    removeMember: vi.fn(),
    revokeInvite: vi.fn(),
    team: {
      status: 'ok',
      error: null,
      reload: vi.fn(),
      set: vi.fn(),
      data: {
        members: [],
        invitesDenied: false,
        invites,
      },
    },
  } as unknown as SettingsNextData;
  render(<TeamSection data={data} />);
}

describe('the invite book (F-1140)', () => {
  it('names the address an invite was made for, and says a bare code is for whoever holds it', () => {
    mount('owner');
    expect(screen.getByText('deniz@example.test')).toBeInTheDocument();
    expect(screen.getByText(/Joins as owner with code OWNR2345/)).toBeInTheDocument();
    expect(screen.getByText('Code STAF2345')).toBeInTheDocument();
    expect(screen.getByText(/whoever holds this code joins as staff/)).toBeInTheDocument();
  });

  it('a manager is not offered Revoke on an owner’s invite, and is told who can', () => {
    mount('manager');
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
    expect(screen.getByText('Only an owner can withdraw an invite for an owner.')).toBeInTheDocument();
  });

  it('an owner is offered Revoke on both', () => {
    mount('owner');
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(2);
  });
});

// F-1298 left this owed (F-1313): the gateway sends no code for an invite the
// viewer could not have given, so a manager's book lists an owner's bare-code
// invite as "An owner’s invite", never "Code null", and offers no Revoke.
describe('an owner’s invite a manager sees without its code (F-1298, F-1313)', () => {
  const codeless = [
    { id: 'i3', code: null, role: 'owner', expires_at: FUTURE, created_at: null, target_email: null },
  ];

  it('is named as an owner’s invite, with no code anywhere on the row', () => {
    mount('manager', codeless);
    expect(screen.getByText('An owner’s invite')).toBeInTheDocument();
    expect(screen.getByText(/Its code is shown only to someone who could give this invite/)).toBeInTheDocument();
    expect(screen.queryByText(/Code /)).toBeNull();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('offers no Revoke, and says who can withdraw it', () => {
    mount('manager', codeless);
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.getByText('Only an owner can withdraw an invite for an owner.')).toBeInTheDocument();
  });
});
