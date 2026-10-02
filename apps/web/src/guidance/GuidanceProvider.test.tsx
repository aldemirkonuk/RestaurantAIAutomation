/**
 * Page tips leave when told to, and "Don't show tips again" means every page
 * (founder, 2026-10-01): "if I say don't ever show again then I don't want to
 * see it again until I press or check for it."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const updatePreferences = vi.fn();
// What the account's copy says, and whether it has answered yet. By default it
// is empty and has answered, so anything that leaves the screen does so on
// the provider's own local read.
let account: { preferences: Record<string, unknown>; isPlaceholderData: boolean } = {
  preferences: {},
  isPlaceholderData: false,
};
vi.mock('../hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ ...account, updatePreferences }),
}));
vi.mock('../stores', () => ({
  useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: 'u-1' } }),
}));
vi.mock('driver.js', () => ({ driver: () => ({ drive: vi.fn(), destroy: vi.fn() }) }));
// The orders tour, pinned to two steps on elements these tests draw or leave
// out, so the count on "Show me" is measured against a known page.
vi.mock('./tours/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tours/registry')>();
  return {
    ...actual,
    TOUR_REGISTRY: {
      ...actual.TOUR_REGISTRY,
      orders: {
        pageId: 'orders',
        steps: [
          { element: '#step-write', title: 'Write an order', description: '' },
          { element: '#step-approve', title: 'Approve it', description: '' },
        ],
      },
    },
  };
});

import { GuidanceProvider, useGuidance } from './GuidanceProvider';
import { PageTipStrip } from './components/PageTipStrip';

function TipsSwitch() {
  const g = useGuidance();
  return (
    <>
      <button type="button" onClick={() => g.resetTips()}>
        {g.state.global.hide_all_tips ? 'tips off' : 'tips on'}
      </button>
      <span data-testid="nudge-due">{String(g.isSetupNudgeDue)}</span>
      <span data-testid="copy-pending">{String(g.accountCopyPending)}</span>
    </>
  );
}

function mount(path: string, page?: ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <GuidanceProvider>
          <PageTipStrip />
          <Link to="/calendar">calendar</Link>
          <Link to="/inventory">inventory</Link>
          <TipsSwitch />
          {page}
        </GuidanceProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tip = () => screen.queryByRole('region', { name: 'Page tip' });
const showMe = () => screen.queryByRole('button', { name: /^Show me/ });
const ordersPage = (
  <>
    <div id="step-write" />
    <div id="step-approve" />
  </>
);
const LOCAL_KEY = 'wineops_guidance_v1';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  updatePreferences.mockReset();
  account = { preferences: {}, isPlaceholderData: false };
});
afterEach(() => vi.restoreAllMocks());

describe('page tips', () => {
  it('shows on a page the person has not seen', () => {
    mount('/orders');
    expect(tip()).toBeTruthy();
  });

  it('is a margin note with three verbs: Show me, Not now, Don\'t show tips again', () => {
    mount('/orders', ordersPage);
    expect(tip()).toHaveClass('mdv-tipnote');
    expect(screen.getByRole('button', { name: 'Show me — 2 steps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Don't show tips again" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take tour' })).toBeNull();
  });

  it('"Not now" takes it off the screen at once', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(tip()).toBeNull();
  });

  it('"Not now" is a four-hour snooze: off on a later visit inside it, back on one after it', () => {
    const first = mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    first.unmount();
    window.sessionStorage.clear(); // a new sitting
    const second = mount('/orders');
    expect(tip()).toBeNull();
    second.unmount();
    window.sessionStorage.clear();
    const later = Date.now() + 4 * 60 * 60 * 1000 + 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    mount('/orders');
    expect(tip()).toBeTruthy();
  });

  it('"Don\'t show tips again" takes it off at once and keeps every other page\'s tip off', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    expect(tip()).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'calendar' }));
    expect(tip()).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'inventory' }));
    expect(tip()).toBeNull();
    expect(screen.getByRole('button', { name: 'tips off' })).toBeTruthy();
  });

  it('stays off after a reload, from the local mirror alone', () => {
    const first = mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    first.unmount();
    window.sessionStorage.clear(); // a new sitting
    mount('/calendar');
    expect(tip()).toBeNull();
  });

  it('comes back only when the person turns tips back on', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    fireEvent.click(screen.getByRole('button', { name: 'tips off' }));
    fireEvent.click(screen.getByRole('link', { name: 'calendar' }));
    expect(tip()).toBeTruthy();
  });
});

describe('"Show me" never promises a step the page cannot show', () => {
  it('is not offered when none of the tour\'s elements is on the page', () => {
    mount('/orders');
    expect(tip()).toBeTruthy();
    expect(showMe()).toBeNull();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Don't show tips again" })).toBeInTheDocument();
  });

  it('counts only the steps whose element is on the page', () => {
    mount('/orders', <div id="step-approve" />);
    expect(screen.getByRole('button', { name: 'Show me — 1 step' })).toBeInTheDocument();
  });

  it('counts a step whose element is drawn after the tip, and drops one that goes', async () => {
    // Change the page, then let the observer's callback and the frame it asks
    // for both run, inside act.
    const change = (fn: () => void) =>
      act(async () => {
        fn();
        await Promise.resolve();
        await new Promise((done) => window.requestAnimationFrame(() => done(null)));
      });
    mount('/orders');
    expect(showMe()).toBeNull();
    const late = document.createElement('section');
    late.id = 'step-write';
    await change(() => document.body.appendChild(late));
    expect(screen.getByRole('button', { name: 'Show me — 1 step' })).toBeInTheDocument();
    await change(() => late.remove());
    expect(showMe()).toBeNull();
  });
});

describe('the newer copy wins, across browsers', () => {
  const EARLY = '2026-10-02T08:00:00.000Z';
  const LATE = '2026-10-02T09:00:00.000Z';
  const keep = (copy: Record<string, unknown>) =>
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));

  it('"Turn tips back on" in another browser brings tips back here, over an older "off" kept here', () => {
    keep({ global: { hide_all_tips: true }, pages: {}, saved_at: EARLY });
    account.preferences = { guidance: { global: { hide_all_tips: false }, pages: {}, saved_at: LATE } };
    mount('/calendar');
    expect(tip()).toBeTruthy();
  });

  it('"Don\'t show tips again" in another browser turns tips off here, over an older "on" kept here', () => {
    keep({ global: { hide_all_tips: false }, pages: {}, saved_at: EARLY });
    account.preferences = { guidance: { global: { hide_all_tips: true }, pages: {}, saved_at: LATE } };
    mount('/calendar');
    expect(tip()).toBeNull();
  });

  it('a save that never reached the account keeps its effect here', () => {
    keep({ global: { hide_all_tips: true }, pages: {}, saved_at: LATE });
    account.preferences = { guidance: { global: { hide_all_tips: false }, pages: {}, saved_at: EARLY } };
    mount('/calendar');
    expect(tip()).toBeNull();
  });

  it('on a tie, this browser\'s copy stays on top of what the gateway merged in', () => {
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    keep({ global: { hide_all_tips: false }, pages: { calendar: { tip: 'unseen', tour: 'unseen' } }, saved_at: LATE });
    account.preferences = {
      guidance: {
        global: { hide_all_tips: false },
        pages: { calendar: { tip: 'unseen', tour: 'unseen', snooze_until: later } },
        saved_at: LATE,
      },
    };
    mount('/calendar');
    expect(tip()).toBeTruthy();
  });

  it('every save carries its time, in this browser\'s copy and in the one sent to the account', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    const kept = JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? '{}');
    expect(Number.isFinite(Date.parse(kept.saved_at))).toBe(true);
    expect(updatePreferences).toHaveBeenCalledWith({
      guidance: expect.objectContaining({ saved_at: kept.saved_at }),
    });
  });
});

describe('before the account\'s copy answers', () => {
  it('shows no tip and holds the setup nudge, so neither acts on a stand-in', () => {
    account.isPlaceholderData = true;
    const first = mount('/calendar');
    expect(tip()).toBeNull();
    expect(screen.getByTestId('nudge-due')).toHaveTextContent('false');
    first.unmount();
    account.isPlaceholderData = false;
    mount('/calendar');
    expect(tip()).toBeTruthy();
    expect(screen.getByTestId('nudge-due')).toHaveTextContent('true');
  });
  it('tells the rest of the app the account copy is still pending, and when it has answered', () => {
    // Help's "Page tips" switch reads this to hold its on/off and its button.
    account.isPlaceholderData = true;
    const first = mount('/help');
    expect(screen.getByTestId('copy-pending')).toHaveTextContent('true');
    first.unmount();
    account.isPlaceholderData = false;
    mount('/help');
    expect(screen.getByTestId('copy-pending')).toHaveTextContent('false');
  });
});
