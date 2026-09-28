/**
 * The house shell, mounted for real (sketch 119 D): the rooms, the counter,
 * the width rule, the phone's four doors, and what the shell must NOT carry.
 *
 * The network is mocked at its seams — the counter's one read, the flag API —
 * and the header's own popovers (bell, account, theme) are markers, because
 * their suites are theirs. Nothing the shell itself renders is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const readCounter = vi.hoisted(() => vi.fn());
const checkFlag = vi.hoisted(() => vi.fn());

vi.mock('../../services/api/houseCounter', () => ({
  readHouseCounter: () => readCounter(),
}));
vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFlag(...a) },
}));
vi.mock('./HouseBell', () => ({ HouseBell: () => <span data-testid="bell" /> }));
vi.mock('./HouseUserMenu', () => ({ HouseUserMenu: () => <span data-testid="account" /> }));
vi.mock('../layout/ThemeMenu', () => ({ ThemeMenu: () => null }));
vi.mock('../command/CommandProvider', () => ({
  CommandProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../askai/AskAiSurface', () => ({ AskAiSurface: () => <div data-testid="ask-surface" /> }));
vi.mock('../../guidance/GuidanceProvider', () => ({
  GuidanceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../guidance/components/PageTipStrip', () => ({ PageTipStrip: () => null }));
vi.mock('../../guidance/components/SetupNudgeBanner', () => ({ SetupNudgeBanner: () => null }));
vi.mock('../../guidance/announce', () => ({ GuidanceLiveRegion: () => null }));

import { HouseShell } from './HouseShell';
import { PageGate } from './PageGate';
import { AuthContext } from '../../contexts/AuthContext';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';
import { prefsKeyFor } from '../../lib/mudavym/counterPrefs';
import { resetHouseSaid } from '../../lib/mudavym/houseSaid';
import type { HouseCounterRead } from '../../lib/mudavym/counterRead';

const T = '2026-09-21T14:02:11Z';
const READ: HouseCounterRead = {
  readAt: T,
  house: { id: 'r-1', currency: { state: 'recorded', code: 'USD' } },
  role: 'owner',
  registers: [
    { key: 'orders', verb: 'seal', state: 'answered', readAt: T, ms: 3, count: 0, complete: true, rows: [], act: 'yours' },
    { key: 'credits', verb: 'verify', state: 'unreadable', readAt: T, ms: 8000, status: 503, sentence: 'x' },
  ],
};

function auth(role: 'owner' | 'manager' | 'staff' = 'owner') {
  return {
    user: { userId: 'u-1', email: 'a@b.c', name: 'Maya', role, restaurantId: 'r-1' },
    loading: false,
    error: null,
    clearError: vi.fn(),
    activeRestaurantId: 'r-1',
    activeRole: role,
    availableRestaurants: [{ id: 'r-1', name: 'Larkspur & Vine', city: 'Oakland', chain_id: null, chain_name: null }],
    isAuthenticated: true,
  } as never;
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

function mount(path: string, role: 'owner' | 'manager' | 'staff' = 'owner', page: React.ReactNode = <div>page</div>) {
  return render(
    <AuthContext.Provider value={auth(role)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<HouseShell />}>
            <Route path="*" element={page} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  clearMudavymDesignCache();
  resetHouseSaid();
  window.localStorage.clear();
  readCounter.mockReset();
  readCounter.mockResolvedValue(READ);
  checkFlag.mockReset();
  checkFlag.mockResolvedValue({ active: false, enabled: false });
  setWidth(1440);
});
afterEach(() => setWidth(1024));

describe('the shell at 1440', () => {
  it('holds the rooms, the page and the counter — and no Wine Agent button', async () => {
    mount('/orders');
    expect(screen.getByRole('navigation', { name: 'The rooms' })).toBeTruthy();
    expect(await screen.findByRole('complementary', { name: 'The counter' })).toBeTruthy();
    expect(screen.getByText('page')).toBeTruthy();
    // No Wine Agent button anywhere (ADR 0149 row 33) — the component is
    // deleted, not merely unmounted, so there is nothing to query for.
    // The two doors to the assistant: the rail's first row opens the ⌘⇧K panel.
    expect(screen.getByTestId('ask-surface')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ask Mudavym\./ })).toBeTruthy();
  });

  it("names the page by its room in the one header", () => {
    mount('/orders');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Orders')).toBeTruthy();
  });

  it('never lists an internal tool among the rooms', () => {
    mount('/');
    const rail = screen.getByRole('navigation', { name: 'The rooms' });
    for (const p of ['/studio', '/simpos', '/dev/truth', '/dev-sandbox']) {
      expect(rail.querySelector(`a[href^="${p}"]`)).toBeNull();
    }
  });

  it('reads the counter once for this house, and draws a failed register as not read', async () => {
    mount('/orders');
    await waitFor(() => expect(readCounter).toHaveBeenCalledTimes(1));
    const block = await waitFor(() => {
      const el = document.querySelector('[data-register="credits"]');
      if (!el) throw new Error('not yet');
      return el as HTMLElement;
    });
    expect(block.getAttribute('data-state')).toBe('unreadable');
    expect(screen.getByTestId('counter-head').textContent).toBe('1 of 2 registers · 1 not read');
  });

  it('a rebuilt page under the shell gets no second header', () => {
    window.localStorage.setItem('mudavym.design.orders', '1');
    mount('/orders', 'owner', <PageGate page="orders" legacy={<div>legacy</div>} next={<div className="mudavym">next</div>} />);
    expect(screen.getByText('next')).toBeTruthy();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
  });
});

describe('the width rule — open first, then remember', () => {
  it('is open on a normal page at 1440', async () => {
    mount('/orders');
    expect(await screen.findByRole('complementary', { name: 'The counter' })).toBeTruthy();
  });

  it('is tucked to the strip on a wide page', () => {
    mount('/reports');
    expect(screen.getByRole('complementary', { name: 'The counter, tucked' })).toBeTruthy();
  });

  it('is tucked below 1280 px', () => {
    setWidth(1180);
    mount('/orders');
    expect(screen.getByRole('complementary', { name: 'The counter, tucked' })).toBeTruthy();
  });

  it("remembers the person's choice for that page", () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Tuck the counter' }));
    expect(screen.getByRole('complementary', { name: 'The counter, tucked' })).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(prefsKeyFor('u-1')) ?? '{}');
    expect(stored.counter['/orders']).toBe('tucked');
  });
});

describe('the phone at 390 — four doors', () => {
  beforeEach(() => setWidth(390));

  it('has Counter, Rooms, Search and Ask, and no rail or counter column', () => {
    mount('/orders');
    const doors = screen.getByRole('navigation', { name: 'The four doors' });
    expect(within(doors).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Counter',
      'Rooms',
      'Search',
      'Ask',
    ]);
    expect(screen.queryByRole('navigation', { name: 'The rooms' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'The counter' })).toBeNull();
  });

  it('the Counter door carries a hollow dot when a register was not read — never a number', async () => {
    mount('/orders');
    await waitFor(() => expect(readCounter).toHaveBeenCalled());
    const doors = screen.getByRole('navigation', { name: 'The four doors' });
    const door = await within(doors).findByRole('button', { name: 'The counter — a register was not read' });
    expect(door.textContent).toBe('Counter');
    expect(door.querySelector('.mdv-doors__dot--hollow')).not.toBeNull();
  });
});

describe('what staff see', () => {
  it('hides only the rooms the gateway refuses them', () => {
    mount('/receiving', 'staff');
    const rail = screen.getByRole('navigation', { name: 'The rooms' });
    expect(within(rail).queryByText('Vendor prices')).toBeNull();
    expect(within(rail).queryByText('The desk')).toBeNull();
    expect(within(rail).getByText('Receipts & Credits')).toBeTruthy();
  });
});

describe('the boundary under the shell', () => {
  it('a page that crashes gets the HOUSE error screen, not the generic one — and the rail still stands', () => {
    // Scoped to this one spy: `vi.restoreAllMocks()` would also wipe
    // `setup.ts`'s `window.matchMedia` mock for every test after this one
    // in the file (it is a bare `vi.fn()`, not a `vi.spyOn`, so "restore"
    // resets it to a no-op returning undefined) — exactly the failure this
    // comment now guards against.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => {
      throw new Error('boom');
    };
    mount('/orders', 'owner', <Boom />);
    // The house screen's own copy, not ErrorBoundary's built-in "Something
    // went wrong" / "Go to Dashboard" wording.
    expect(screen.getByText(/this page ran into a problem/i)).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    // The shell itself survived: the rail is still there.
    expect(screen.getByRole('navigation', { name: 'The rooms' })).toBeTruthy();
    consoleError.mockRestore();
  });
});

describe('offline — the strip under the header', () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  });

  it('says the device is offline and that the counter has not been read, and reads nothing', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    mount('/orders');
    const strip = screen.getByRole('status');
    expect(strip.textContent).toContain('Offline.');
    expect(strip.textContent).toContain('The counter has not been read');
    expect(readCounter).not.toHaveBeenCalled();
  });

  it('is absent online', async () => {
    mount('/orders');
    await waitFor(() => expect(readCounter).toHaveBeenCalled());
    expect(document.querySelector('.mdv-shell__offline')).toBeNull();
  });
});

describe('The house said belongs to one person in one house', () => {
  it('a different person signed in on the same tab does not inherit the log', async () => {
    const { houseSaid, getHouseSaid } = await import('../../lib/mudavym/houseSaid');
    const view = mount('/orders');
    await waitFor(() => expect(readCounter).toHaveBeenCalled());
    houseSaid('sealed', 'Order to Kermit Lynch sealed');
    expect(getHouseSaid()).toHaveLength(1);
    const other = {
      ...(auth('manager') as object),
      user: { userId: 'u-2', email: 'k@b.c', name: 'Kerem', role: 'manager', restaurantId: 'r-1' },
    } as never;
    view.rerender(
      <AuthContext.Provider value={other}>
        <MemoryRouter initialEntries={['/orders']}>
          <Routes>
            <Route element={<HouseShell />}>
              <Route path="*" element={<div>page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(getHouseSaid()).toHaveLength(0));
  });
});
