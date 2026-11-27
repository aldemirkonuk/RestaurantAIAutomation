/**
 * r109 onboarding walk Finding 1: a new owner who clicked "Invite your people"
 * lands on /settings?tab=team&invite=1 and meets the data terms first. Once
 * they are accepted, the invite sheet opens, and the one-time theme ask must
 * NOT open over it (ADR 0112, one topmost overlay). It waits for the sheet to
 * close, then asks. Mounts the real terms gate, the real theme ask and the real
 * Team section together and counts the dialogs at each turn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TeamSection } from './TeamSection';
import type { SettingsNextData } from './useSettingsNextData';
import { GroundFirstChoice } from '@/components/mudavym/GroundFirstChoice';
import { DataTermsSignInGate } from '@/components/settings/DataTermsSignInGate';
import { applyAccountGround, resetGroundChoiceForTests, setGroundOwner } from '@/lib/mudavym/groundChoice';
import { dataTermsQueryKey } from '@/hooks/queries/useDataTerms';
import type { DataTermsReadout } from '@/services/api/dataTerms';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', activeRestaurantId: 'house-1' }),
}));
const terms = vi.hoisted(() => ({ getDataTerms: vi.fn() }));
vi.mock('@/services/api/dataTerms', () => ({
  getDataTerms: terms.getDataTerms,
  issueDataTermsSealChallenge: vi.fn(),
  acceptDataTerms: vi.fn(),
}));
vi.mock('@/components/team/InviteTeamDialog', () => ({
  InviteTeamDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Invite a Team Member">
        <button type="button" onClick={onClose}>Close invite</button>
      </div>
    ) : null,
}));
vi.mock('@/components/team/TeamLaborSettings', () => ({ TeamLaborSettings: () => null }));
vi.mock('@/components/team/TeamGoalsSettings', () => ({ TeamGoalsSettings: () => null }));
vi.mock('./SectionKit', async () => {
  const actual = await vi.importActual<typeof import('./SectionKit')>('./SectionKit');
  return { ...actual, Register: () => null };
});

function readout(current: boolean): DataTermsReadout {
  return {
    readable: true,
    reason: null,
    version: 1,
    digest: 'a'.repeat(64),
    statements: [{ key: 'k', kind: 'fact', text: 'Jev reads masked vendor mail.', evidence: ['x'] }],
    subprocessors: [],
    changedSince: {},
    acceptance: null,
    current,
    jev: { enabled: false, effective: false, pausedBecause: null },
  } as DataTermsReadout;
}

const data = {
  team: { reload: vi.fn() },
  role: 'owner',
  canManage: true,
  restaurantId: 'house-1',
  writer: { busy: null },
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  revokeInvite: vi.fn(),
  userId: 'u1',
} as unknown as SettingsNextData;

let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings?tab=team&invite=1']}>
        <DataTermsSignInGate />
        <GroundFirstChoice />
        <TeamSection data={data} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const dialogs = () => screen.queryAllByRole('dialog');
const THEME = /Choose how Mudavym looks for you/;

beforeEach(() => {
  terms.getDataTerms.mockReset();
  window.localStorage.clear();
  resetGroundChoiceForTests();
  // The account has answered: this owner never chose a theme, so it would ask.
  setGroundOwner('owner-1');
  applyAccountGround(undefined);
});

describe('terms, then the invite sheet, then the theme: one dialog at a time', () => {
  it('after the terms are accepted only the invite sheet is up, and the theme asks once it closes', async () => {
    terms.getDataTerms.mockResolvedValue(readout(false));
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: /hold to accept/i })).toBeInTheDocument());
    expect(dialogs()).toHaveLength(1);

    // The owner accepts (the gateway now answers current).
    act(() => client.setQueryData(dataTermsQueryKey('house-1'), readout(true)));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Invite a Team Member' })).toBeInTheDocument());
    expect(dialogs()).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: THEME })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close invite' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: THEME })).toBeInTheDocument());
    expect(dialogs()).toHaveLength(1);
  });

  it('with the terms already accepted, the invite sheet is up alone and the theme waits until it closes', async () => {
    terms.getDataTerms.mockResolvedValue(readout(true));
    mount();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Invite a Team Member' })).toBeInTheDocument());
    expect(dialogs()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close invite' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: THEME })).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Invite a Team Member' })).toBeNull();
  });
});
