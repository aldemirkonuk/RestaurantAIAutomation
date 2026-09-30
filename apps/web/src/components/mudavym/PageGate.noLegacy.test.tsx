/**
 * A gate whose legacy file group was deleted (ADR 0149 cutover,
 * `.planning/07-reference/deploy/CUTOVER-MANIFEST-2026-09-28.md`) passes no
 * `legacy`, and then renders `next` whatever the gate resolves: the QA
 * override `mudavym.design.<page> = 0` has nothing left to show, so it must
 * not blank the page. A gate that still passes `legacy` keeps today's
 * behaviour. `arrival` is used below only because it is the one key still
 * resolved through the house flag, so it exercises the flag-off path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const checkFlag = vi.hoisted(() => vi.fn());

vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFlag(...a) },
}));
// Under test is the gate's choice of tree, not the header it adds.
vi.mock('./HouseHeader', () => ({ HouseHeader: () => null }));

import { PageGate } from './PageGate';
import { AuthContext } from '../../contexts/AuthContext';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';

const auth = {
  user: { userId: 'u-1', email: 'a@b.c', name: 'Maya', role: 'owner', restaurantId: 'r1' },
  activeRestaurantId: 'r1',
  availableRestaurants: [],
} as never;

function mount(node: React.ReactNode) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>{node}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  checkFlag.mockReset();
  checkFlag.mockResolvedValue({ active: false, enabled: false });
});
afterEach(() => window.localStorage.clear());

describe('a gate with no legacy slot', () => {
  it('renders next on a live page', () => {
    mount(<PageGate page="dashboard" next={<main data-testid="next" />} />);
    expect(screen.getByTestId('next')).toBeTruthy();
  });

  it("renders next under the QA override '0' — there is no legacy page to force", () => {
    window.localStorage.setItem('mudavym.design.dashboard', '0');
    mount(<PageGate page="dashboard" next={<main data-testid="next" />} />);
    expect(screen.getByTestId('next')).toBeTruthy();
  });

  it('renders next on a held-back page whose flag is off', () => {
    mount(<PageGate page="arrival" next={<main data-testid="next" />} />);
    expect(screen.getByTestId('next')).toBeTruthy();
  });
});

describe('a gate that still has a legacy slot keeps its behaviour', () => {
  it("the QA override '0' still shows legacy", () => {
    window.localStorage.setItem('mudavym.design.dashboard', '0');
    mount(<PageGate page="dashboard" legacy={<p>legacy</p>} next={<main data-testid="next" />} />);
    expect(screen.getByText('legacy')).toBeTruthy();
    expect(screen.queryByTestId('next')).toBeNull();
  });

  it('a held-back page with its flag off shows legacy', () => {
    mount(<PageGate page="arrival" legacy={<p>legacy</p>} next={<main data-testid="next" />} />);
    expect(screen.getByText('legacy')).toBeTruthy();
  });
});
