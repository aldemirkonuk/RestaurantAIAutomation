/**
 * Page tips leave when told to, and "Don't show tips again" means every page
 * (founder, 2026-10-01): "if I say don't ever show again then I don't want to
 * see it again until I press or check for it."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const updatePreferences = vi.fn();
// What the account's copy says, and whether a read of it has succeeded. By
// default it is empty and has been read, so anything that leaves the screen
// does so on the provider's own local read.
let account: { preferences: Record<string, unknown>; isAccountRead: boolean; error: Error | null } = {
  preferences: {},
  isAccountRead: true,
  error: null,
};
// Every test stands the hook in with `account` above, except the two-browser
// ones at the end, which set `realHook` and run the real one, with only the
// request itself (`apiClient`) stood in.
let realHook = false;
vi.mock('../hooks/useUserPreferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useUserPreferences')>();
  return {
    ...actual,
    useUserPreferences: () =>
      // `realHook` is fixed for the whole of a test, so the hooks run in the same order every render.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      realHook ? actual.useUserPreferences() : { ...account, updatePreferences },
  };
});
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
import { PAGE_TOUR_IDS } from './types';
import { apiClient } from '../services/api/client';
import { queryKeys } from '../lib/query-keys';

function TipsSwitch() {
  const g = useGuidance();
  return (
    <>
      <button type="button" onClick={() => g.resetTips()}>
        {g.state.global.hide_all_tips ? 'tips off' : 'tips on'}
      </button>
      <span data-testid="nudge-due">{String(g.isSetupNudgeDue)}</span>
      <span data-testid="account-copy">{g.accountCopy}</span>
      <span data-testid="paused">{String(g.tipsPausedInThisTab)}</span>
      <button type="button" onClick={() => g.startTour('orders')}>
        start orders tour
      </button>
      <button type="button" onClick={() => g.markSetupNudgeShown()}>
        nudge shown
      </button>
      <button type="button" onClick={() => g.hideAllTips()}>
        hide all
      </button>
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
  account = { preferences: {}, isAccountRead: true, error: null };
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

  it('on a tie, this browser\'s own saves stay on top of the account\'s copy', () => {
    // The phone app saves with no stamp, so a save made there leaves the tie.
    keep({ global: { hide_all_tips: true }, saved_at: LATE });
    account.preferences = { guidance: { global: { hide_all_tips: false }, pages: {}, saved_at: LATE } };
    mount('/calendar');
    expect(tip()).toBeNull();
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

describe('a save sends only what its action changed', () => {
  const sent = () => updatePreferences.mock.calls.at(-1)?.[0];

  it('"Not now" sends that page\'s snooze and the time', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(sent()).toEqual({
      guidance: { pages: { orders: { tip: 'snoozed', snooze_until: expect.any(String) } }, saved_at: expect.any(String) },
    });
  });

  it('"Don\'t show tips again" sends the switch, that page\'s tip and the time', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    expect(sent()).toEqual({
      guidance: { global: { hide_all_tips: true }, pages: { orders: { tip: 'dismissed' } }, saved_at: expect.any(String) },
    });
  });

  it('"Turn tips back on" sends every page\'s tip back with its snooze taken away, and leaves tours alone', () => {
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    account.preferences = {
      guidance: {
        global: { hide_all_tips: true },
        pages: { calendar: { tip: 'snoozed', tour: 'completed', snooze_until: later } },
        saved_at: '2026-10-02T08:00:00.000Z',
      },
    };
    mount('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'tips off' }));
    const pages = Object.fromEntries(PAGE_TOUR_IDS.map((id) => [id, { tip: 'unseen', snooze_until: null }]));
    expect(sent()).toEqual({
      guidance: { global: { hide_all_tips: false, tips_snoozed_until: null }, pages, saved_at: expect.any(String) },
    });
    expect(tip()).toBeTruthy();
  });
});

describe('before the account\'s copy answers', () => {
  it('shows no tip and holds the setup nudge, so neither acts on a stand-in', () => {
    account.isAccountRead = false;
    const first = mount('/calendar');
    expect(tip()).toBeNull();
    expect(screen.getByTestId('nudge-due')).toHaveTextContent('false');
    first.unmount();
    account.isAccountRead = true;
    mount('/calendar');
    expect(tip()).toBeTruthy();
    expect(screen.getByTestId('nudge-due')).toHaveTextContent('true');
  });
  it('tells the rest of the app whether the account copy is loading, failed or read', () => {
    // Help's "Page tips" switch reads this to hold its on/off and its button.
    account.isAccountRead = false;
    const first = mount('/help');
    expect(screen.getByTestId('account-copy')).toHaveTextContent('loading');
    first.unmount();
    account = { preferences: {}, isAccountRead: false, error: new Error('read failed') };
    const second = mount('/help');
    expect(screen.getByTestId('account-copy')).toHaveTextContent('failed');
    second.unmount();
    account = { preferences: {}, isAccountRead: true, error: null };
    const third = mount('/help');
    expect(screen.getByTestId('account-copy')).toHaveTextContent('read');
    third.unmount();
    // A refetch that fails after a good read: TanStack keeps the copy it read.
    account = { preferences: {}, isAccountRead: true, error: new Error('refetch failed') };
    mount('/help');
    expect(screen.getByTestId('account-copy')).toHaveTextContent('read');
  });
});

describe('when the account\'s copy could not be read', () => {
  // What the hook hands back after the first read and its one retry fail,
  // with nothing read before: `preferences` falls back to {}, nothing has been
  // read, and an error.
  beforeEach(() => {
    account = { preferences: {}, isAccountRead: false, error: new Error('read failed') };
  });

  it('shows no tip and holds the setup nudge', () => {
    mount('/calendar');
    expect(tip()).toBeNull();
    expect(screen.getByTestId('nudge-due')).toHaveTextContent('false');
  });

  it('saves nothing, here or to the account, from the stand-in', () => {
    mount('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'nudge shown' }));
    fireEvent.click(screen.getByRole('button', { name: 'hide all' }));
    fireEvent.click(screen.getByRole('button', { name: /^tips (on|off)$/ }));
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  it('saves again once a read succeeds', () => {
    const first = mount('/calendar');
    first.unmount();
    account = { preferences: {}, isAccountRead: true, error: null };
    mount('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'nudge shown' }));
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });
});

describe('when a refetch fails after a good read', () => {
  // TanStack keeps the copy it read and sets the error beside it.
  beforeEach(() => {
    account = { preferences: {}, isAccountRead: true, error: new Error('refetch failed') };
  });

  it('goes on from the copy it read: the tip shows, the nudge is due, and saves go out', () => {
    mount('/calendar');
    expect(tip()).toBeTruthy();
    expect(screen.getByTestId('nudge-due')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('button', { name: 'hide all' }));
    expect(updatePreferences).toHaveBeenCalledWith({
      guidance: expect.objectContaining({ global: expect.objectContaining({ hide_all_tips: true }) }),
    });
  });
});

describe('two tips or tours turned away in one tab', () => {
  it('pause tips in this tab after two "Not now", and "Turn tips back on" ends the pause', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByTestId('paused')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('link', { name: 'calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByTestId('paused')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('link', { name: 'inventory' }));
    expect(tip()).toBeNull();
    // Tips are still on: only this tab is paused.
    expect(screen.getByRole('button', { name: 'tips on' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'tips on' }));
    expect(screen.getByTestId('paused')).toHaveTextContent('false');
    expect(tip()).toBeTruthy();
  });

  it('counts a tour that cannot start (no step on the page) as turned away', async () => {
    // TourEngine reads `window.matchMedia` before it looks for steps.
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as unknown as MediaQueryList);
    mount('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'start orders tour' }));
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem('wineops_guidance_session') ?? '{}').skips).toBe(1),
    );
    expect(screen.getByTestId('paused')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'start orders tour' }));
    await waitFor(() => expect(screen.getByTestId('paused')).toHaveTextContent('true'));
    expect(tip()).toBeNull();
  });
});

describe('two browsers, one account, with the real preferences hook and the gateway\'s merge', () => {
  // PR #570's gate round-7 audit (at 37841f602) ran this sequence, as
  // reviewer B's throwaway test: one browser holds a read made before the
  // other's "Don't show tips again", presses "Not now", and the off is
  // undone. Each browser has its own QueryClient and its own copy of
  // guidance; jsdom has one localStorage, so a browser's copy is put in it
  // while that browser acts and reads.
  const T = (s: number) => `2026-10-03T12:00:${String(s).padStart(2, '0')}.000Z`;
  let server: Record<string, unknown>;

  // The gateway's merge (apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53).
  function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      if (
        source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
  const serverGlobal = () => (server.guidance as { global: { hide_all_tips: boolean } }).global;

  type Browser = { qc: QueryClient; view: ReturnType<typeof render>; copy: string | null };
  let current: Browser | null = null;

  // Put this browser's own copy of guidance in localStorage, keeping the
  // other's aside. The browser in use already has its copy there.
  function use(b: Browser) {
    if (current === b) return;
    if (current) current.copy = window.localStorage.getItem(LOCAL_KEY);
    if (b.copy === null) window.localStorage.removeItem(LOCAL_KEY);
    else window.localStorage.setItem(LOCAL_KEY, b.copy);
    current = b;
  }
  const settle = (b: Browser) => waitFor(() => expect(b.qc.isFetching() + b.qc.isMutating()).toBe(0));
  async function open(path: string): Promise<Browser> {
    const qc = new QueryClient();
    const b: Browser = { qc, view: undefined as unknown as Browser['view'], copy: null };
    use(b);
    b.view = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <GuidanceProvider>
            <PageTipStrip />
            <Link to="/calendar">calendar</Link>
            <Link to="/inventory">inventory</Link>
            <TipsSwitch />
          </GuidanceProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await settle(b);
    return b;
  }
  const inB = (b: Browser) => within(b.view.container);
  const tipIn = (b: Browser) => inB(b).queryByRole('region', { name: 'Page tip' });
  async function press(b: Browser, name: string, at: number) {
    vi.setSystemTime(new Date(T(at)));
    use(b);
    fireEvent.click(inB(b).getByRole('button', { name }));
    await settle(b);
  }
  async function readAgain(b: Browser, at: number) {
    vi.setSystemTime(new Date(T(at)));
    use(b);
    await act(() => b.qc.invalidateQueries());
    await settle(b);
  }

  beforeEach(() => {
    realHook = true;
    current = null;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T(0)));
    server = { guidance: { global: { hide_all_tips: false }, pages: {}, saved_at: T(0) } };
    vi.spyOn(apiClient, 'get').mockImplementation(async () => ({ data: { preferences: structuredClone(server) } }));
    vi.spyOn(apiClient, 'patch').mockImplementation(async (_url: string, body?: unknown) => {
      server = deepMerge(server, (body as { preferences: Record<string, unknown> }).preferences);
      return { data: { preferences: structuredClone(server) } };
    });
  });
  afterEach(() => {
    realHook = false;
    vi.useRealTimers();
  });

  it('"Not now" in a browser holding an old read does not undo "Don\'t show tips again" made in the other', async () => {
    const x = await open('/orders');
    const y = await open('/calendar');
    expect(tipIn(x)).toBeTruthy();
    expect(tipIn(y)).toBeTruthy();
    // Y has saved the switch before, so its own copy holds `hide_all_tips: false`.
    await press(y, 'tips on', 5);

    await press(x, "Don't show tips again", 10);
    expect(serverGlobal().hide_all_tips).toBe(true);

    // Y has not read again: it still shows its tip from the read after its 12:00:05 save.
    use(y);
    expect(tipIn(y)).toBeTruthy();
    await press(y, 'Not now', 20);
    expect(serverGlobal().hide_all_tips).toBe(true);
    // Y's save is followed by a read, and the off made in X now shows in Y.
    expect(inB(y).getByRole('button', { name: /^tips (on|off)$/ })).toHaveTextContent('tips off');

    await readAgain(x, 30);
    expect(inB(x).getByRole('button', { name: /^tips (on|off)$/ })).toHaveTextContent('tips off');
    fireEvent.click(inB(x).getByRole('link', { name: 'inventory' }));
    expect(tipIn(x)).toBeNull();
  });

  it('while a save is on its way, the cached copy keeps every key the save does not name', async () => {
    server = { guidance: { global: { hide_all_tips: true }, pages: {}, saved_at: T(0) } };
    const x = await open('/orders');
    vi.mocked(apiClient.patch).mockImplementation(() => new Promise(() => {}));
    vi.setSystemTime(new Date(T(10)));
    fireEvent.click(inB(x).getByRole('button', { name: 'nudge shown' }));
    await waitFor(() =>
      expect(
        (x.qc.getQueryData(queryKeys.user.preferences('u-1')) as { guidance: { saved_at: string } }).guidance.saved_at,
      ).toBe(T(10)),
    );
    expect(inB(x).getByRole('button', { name: /^tips (on|off)$/ })).toHaveTextContent('tips off');
    expect(tipIn(x)).toBeNull();
  });

  it('"Turn tips back on" in one browser brings back a tip put off with "Not now" in the other', async () => {
    const x = await open('/calendar');
    const y = await open('/orders');
    await press(x, 'Not now', 10);
    expect(tipIn(x)).toBeNull();

    await readAgain(y, 15);
    await press(y, 'tips on', 20);

    await readAgain(x, 30);
    expect(tipIn(x)).toBeTruthy();
  });
});
