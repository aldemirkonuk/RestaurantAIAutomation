/**
 * DD-r108-13: the first-menu page's "Invite your people" lands on
 * /settings?tab=team&invite=1. The sign-in data-terms sheet cannot be
 * dismissed, so the invite sheet must not open over it (ADR 0112: one topmost
 * overlay). The intent is kept and the sheet opens once the terms are no
 * longer busy.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeamSection } from './TeamSection';
import type { SettingsNextData } from './useSettingsNextData';

let busy = true;
vi.mock('@/hooks/queries/useDataTerms', () => ({ useDataTermsSignInBusy: () => busy }));
vi.mock('@/components/team/InviteTeamDialog', () => ({
  InviteTeamDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="invite-sheet" /> : null),
}));
vi.mock('@/components/team/TeamLaborSettings', () => ({ TeamLaborSettings: () => null }));
vi.mock('@/components/team/TeamGoalsSettings', () => ({ TeamGoalsSettings: () => null }));
vi.mock('./SectionKit', async () => {
  const actual = await vi.importActual<typeof import('./SectionKit')>('./SectionKit');
  return { ...actual, Register: () => null };
});

const data = {
  team: { reload: vi.fn() },
  role: 'owner',
  canManage: true,
  restaurantId: 'r1',
  writer: { busy: null },
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  revokeInvite: vi.fn(),
  userId: 'u1',
} as unknown as SettingsNextData;

function mount() {
  return render(
    <MemoryRouter initialEntries={['/settings?tab=team&invite=1']}>
      <TeamSection data={data} />
    </MemoryRouter>,
  );
}

describe('the invite sheet waits for the data terms', () => {
  it('stays shut while the terms sheet is busy, and opens once it is not', () => {
    busy = true;
    const view = mount();
    expect(screen.queryByTestId('invite-sheet')).toBeNull();
    busy = false;
    view.rerender(
      <MemoryRouter initialEntries={['/settings?tab=team&invite=1']}>
        <TeamSection data={data} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('invite-sheet')).toBeTruthy();
  });

  it('opens on arrival when no terms are pending', () => {
    busy = false;
    mount();
    expect(screen.getByTestId('invite-sheet')).toBeTruthy();
  });
});
