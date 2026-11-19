/**
 * The first-visit tour banner on the staff home waits for the first task
 * (design review round 2, c2 #14). Owners, managers and every other page keep it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const page = vi.hoisted(() => ({ pageId: 'dashboard' as string }));
vi.mock('../usePageGuidance', () => ({
  usePageGuidance: () => ({
    pageId: page.pageId,
    showTip: true,
    tipDef: { title: 'Dashboard', body: 'The day in one glance.' },
    guidance: { completeTipViaTour: vi.fn(), snoozeTip: vi.fn(), dismissTip: vi.fn() },
  }),
}));

import { PageTipStrip } from './PageTipStrip';
import { AuthContext } from '../../contexts/AuthContext';
import {
  applyAccountGroundAsk,
  noteGroundTaskDone,
  resetGroundAskForTests,
} from '../../lib/mudavym/groundAsk';

function mount(role: string | null) {
  return render(
    <AuthContext.Provider value={{ activeRole: role } as never}>
      <PageTipStrip />
    </AuthContext.Provider>,
  );
}
const strip = () => document.querySelector('[data-guidance="tip-strip"]');

beforeEach(() => {
  window.localStorage.clear();
  page.pageId = 'dashboard';
  resetGroundAskForTests();
});
afterEach(() => {
  cleanup();
  resetGroundAskForTests();
});

describe('PageTipStrip on the staff home', () => {
  it('[REVERT-FAILS] holds the banner for staff until the first task is done', () => {
    applyAccountGroundAsk(undefined);
    mount('staff');
    expect(strip()).toBeNull();
  });

  it('[REVERT-FAILS] holds it while the account has not answered, rather than guessing', () => {
    mount('staff');
    expect(strip()).toBeNull();
  });

  it('shows it the moment the first task lands', () => {
    applyAccountGroundAsk(undefined);
    mount('staff');
    expect(strip()).toBeNull();
    act(() => noteGroundTaskDone());
    expect(strip()).not.toBeNull();
  });

  it('shows it for staff who have already done a task', () => {
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T00:00:00.000Z' });
    mount('staff');
    expect(strip()).not.toBeNull();
  });

  it.each(['owner', 'manager'])('[REVERT-FAILS] never holds it for %s', (role) => {
    applyAccountGroundAsk(undefined);
    mount(role);
    expect(strip()).not.toBeNull();
  });

  it('never holds it on another page, even for staff', () => {
    page.pageId = 'inventory';
    applyAccountGroundAsk(undefined);
    mount('staff');
    expect(strip()).not.toBeNull();
  });

  it('[REVERT-FAILS] holds it while the signed-in role is not read yet, so it never flashes for staff', () => {
    applyAccountGroundAsk(undefined);
    mount(null);
    expect(strip()).toBeNull();
  });

  it('renders where there is no auth provider at all', () => {
    applyAccountGroundAsk(undefined);
    render(<PageTipStrip />);
    expect(strip()).not.toBeNull();
  });
});
