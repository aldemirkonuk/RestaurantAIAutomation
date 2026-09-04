/**
 * The house header — render contract.
 *
 * Every assertion here would FAIL against an empty bar: the page's name comes
 * from the slug map, the badge comes from the gateway's count rather than the
 * list length, a failed read prints words, and a folded line prints two stamps.
 * The four honesty states of the bell are each pinned separately, because the
 * defect this header exists to remove is a control that looks calm when it is
 * actually blind (ADR 0020).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/* ── the two contexts the header speaks for ─────────────────────────────── */

const auth = vi.hoisted(() => ({
  user: { userId: 'user-1', email: 'ada@sim.test', name: 'Ada Konuk', role: 'owner' } as
    | { userId: string; email: string; name: string; role: 'owner' | 'manager' | 'staff' }
    | null,
  activeRestaurantId: 'rest-A' as string | null,
  activeRole: 'manager' as 'owner' | 'manager' | 'staff' | null,
  availableRestaurants: [] as Array<{
    id: string;
    name: string;
    city: string | null;
    chain_id: string | null;
    chain_name: string | null;
  }>,
  logout: vi.fn(),
  setActiveRestaurantId: vi.fn(),
}));

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const AuthContext = React.createContext<unknown>(undefined);
  return {
    AuthContext,
    useAuth: () => {
      const c = React.useContext(AuthContext);
      if (!c) throw new Error('useAuth must be used within an AuthProvider');
      return c;
    },
  };
});

vi.mock('../../services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    patch: (...args: unknown[]) => api.patch(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { AuthContext } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { HouseHeader } from './HouseHeader';
import { PageGate } from './PageGate';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const HOUSE_A = {
  id: 'rest-A',
  name: 'Sim Meyhouse',
  city: 'İstanbul',
  chain_id: null,
  chain_name: null,
};
const HOUSE_B = { id: 'rest-B', name: 'Sim Karaköy', city: 'İstanbul', chain_id: null, chain_name: null };

const MINUTE = 60_000;

function lowStock(id: string, title: string, agoMs: number) {
  const iso = new Date(Date.now() - agoMs).toISOString();
  return {
    id,
    userId: 'user-1',
    restaurantId: 'rest-A',
    type: 'inventory_low_stock',
    title,
    message: 'x',
    status: 'unread',
    priority: 'high',
    metadata: {},
    timestamp: iso,
    createdAt: iso,
  };
}

/** `{ count }` for the unread endpoint, `{ data, total, hasMore }` for the book. */
function answer({
  count,
  rows,
  total,
  hasMore = false,
  countFails,
  bookFails,
}: {
  count?: number;
  rows?: unknown[];
  total?: number;
  hasMore?: boolean;
  countFails?: unknown;
  bookFails?: unknown;
}) {
  api.get.mockImplementation((url: string) => {
    if (url === '/notifications/unread/count') {
      return countFails ? Promise.reject(countFails) : Promise.resolve({ data: { count } });
    }
    if (url === '/notifications') {
      return bookFails
        ? Promise.reject(bookFails)
        : Promise.resolve({ data: { data: rows ?? [], total: total ?? (rows ?? []).length, hasMore } });
    }
    return Promise.resolve({ data: {} });
  });
}

function mount(ui: ReactNode, route = '/providers') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthContext.Provider value={auth as unknown as never}>{ui}</AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.user = { userId: 'user-1', email: 'ada@sim.test', name: 'Ada Konuk', role: 'owner' };
  auth.activeRestaurantId = 'rest-A';
  auth.activeRole = 'manager';
  auth.availableRestaurants = [HOUSE_A];
  api.get.mockReset();
  api.patch.mockReset().mockResolvedValue({ data: {} });
  answer({ count: 0, rows: [] });
});

/* No `vi.restoreAllMocks()` here: `__tests__/setup.ts` installs `matchMedia`,
   `ResizeObserver` and friends as `vi.fn()` implementations, and restoring
   would strip them for every test after the first. */

/* ── the bar itself ─────────────────────────────────────────────────────── */

describe('the bar', () => {
  it('names the page from its slug', async () => {
    mount(<HouseHeader page="providers" />);
    expect(await screen.findByText('Providers')).toBeTruthy();
  });

  it('names the ROUTE for the cellar family, because one slug serves eight', async () => {
    mount(<HouseHeader page="cellar" />, '/wines');
    expect(await screen.findByText('Wines')).toBeTruthy();
    expect(screen.queryByText('Cellar')).toBeNull();
  });

  it('refuses to render on the receiving door, which is chrome-free by decision', () => {
    const { container } = mount(<HouseHeader page="receiving_door" />, '/receiving/o1/door');
    expect(container.querySelector('.mdv-hdr')).toBeNull();
  });

  it('renders nothing when there is no identity to speak for', () => {
    const { container } = render(
      <MemoryRouter>
        <ThemeProvider>
          <HouseHeader page="providers" />
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(container.querySelector('.mdv-hdr')).toBeNull();
  });

  it('carries the charcoal ground on the SAME element as `.mudavym`', () => {
    const { container } = mount(<HouseHeader page="providers" ground="charcoal" />);
    const bar = container.querySelector('.mdv-hdr') as HTMLElement;
    expect(bar.classList.contains('mudavym')).toBe(true);
    expect(bar.getAttribute('data-ground')).toBe('charcoal');
  });

  it('opens the command palette with the event the provider already listens for', () => {
    const heard = vi.fn();
    window.addEventListener('wineops:command-open', heard);
    mount(<HouseHeader page="providers" />);
    fireEvent.click(screen.getByText('Search or act'));
    window.removeEventListener('wineops:command-open', heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

/* ── which house ────────────────────────────────────────────────────────── */

describe('which house', () => {
  it('prints the house name with no control when there is only one', async () => {
    mount(<HouseHeader page="providers" />);
    expect(await screen.findByText('Sim Meyhouse')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /switch/i })).toBeNull();
  });

  it('gives the switcher back the moment a second house exists', async () => {
    auth.availableRestaurants = [HOUSE_A, HOUSE_B];
    const { container } = mount(<HouseHeader page="providers" />);
    await waitFor(() => expect(container.querySelector('.mdv-hdr__branch')).toBeTruthy());
    expect(container.querySelector('.mdv-hdr__house')).toBeNull();
  });

  it('says the name is unread rather than inventing one', async () => {
    auth.availableRestaurants = [];
    const { container } = mount(<HouseHeader page="providers" />);
    const slot = await waitFor(() => container.querySelector('.mdv-hdr__house--unknown'));
    expect(slot?.textContent).toBe('—');
  });
});

/* ── the bell ───────────────────────────────────────────────────────────── */

describe('the bell', () => {
  it('shows the GATEWAY count, not the length of the folded list', async () => {
    answer({
      count: 41,
      rows: [lowStock('n1', '7 wines dropped below par', 3 * 24 * 60 * MINUTE)],
      total: 41,
      hasMore: true,
    });
    mount(<HouseHeader page="providers" />);
    const bell = await screen.findByRole('button', { name: 'Notifications (41 unread)' });
    expect(bell.querySelector('.mdv-hdr__badge')?.textContent).toBe('41');
  });

  it('withholds the count in words when the count read fails — never a zero', async () => {
    answer({ countFails: { message: 'network down' }, rows: [] });
    mount(<HouseHeader page="providers" />);
    const bell = await screen.findByRole('button', {
      name: 'Notifications — the unread count could not be read',
    });
    expect(bell.querySelector('.mdv-hdr__badge')?.textContent).toBe('');
    expect(bell.textContent).not.toContain('0');
    fireEvent.click(bell);
    expect(await screen.findByText(/The unread count could not be read \(network down\)/)).toBeTruthy();
  });

  it('says which register is closed instead of showing an empty book', async () => {
    answer({ count: 3, bookFails: { response: { status: 403 }, message: 'Forbidden' } });
    mount(<HouseHeader page="providers" />);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(
      await screen.findByText(/not allowed to read this house’s notifications \(403\)/),
    ).toBeTruthy();
  });

  it('prints BOTH stamps for a fold whose surviving line is older than its news', async () => {
    answer({
      count: 2,
      rows: [
        lowStock('old-big', '7 wines dropped below par', 3 * 24 * 60 * MINUTE),
        lowStock('new-small', '2 wines dropped below par', 5 * MINUTE),
      ],
      total: 2,
    });
    mount(<HouseHeader page="providers" />);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    // The winner is the older, bigger burst — `pickStackWinner` max_count.
    expect(await screen.findByText('7 wines dropped below par')).toBeTruthy();
    // The news leads; the surviving line's own age is printed under it.
    expect(screen.getByText('5m ago')).toBeTruthy();
    expect(screen.getByText(/this line 3d ago/)).toBeTruthy();
  });

  it('reads the count on every page but the rows only once someone looks', async () => {
    answer({ count: 4, rows: [] });
    mount(<HouseHeader page="providers" />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const urls = api.get.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/notifications/unread/count');
    expect(urls).not.toContain('/notifications');
  });

  it('is quiet only when the register actually said so', async () => {
    answer({ count: 0, rows: [] });
    mount(<HouseHeader page="providers" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (nothing unread)' }));
    expect(await screen.findByText('Nothing unread. The bell is quiet.')).toBeTruthy();
  });
});

/* ── the account ────────────────────────────────────────────────────────── */

describe('the account menu', () => {
  it('names the role at the ACTIVE house', async () => {
    mount(<HouseHeader page="providers" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('Manager at Sim Meyhouse.')).toBeTruthy();
  });

  it('falls back to the account record and says that is what it did', async () => {
    auth.activeRole = null;
    mount(<HouseHeader page="providers" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(
      await screen.findByText(/Owner on the account\. The role at this house was not read/),
    ).toBeTruthy();
  });

  it('claims no role at all when neither register answered', async () => {
    auth.activeRole = null;
    auth.user = { userId: 'user-1', email: 'ada@sim.test', name: 'Ada Konuk', role: undefined as never };
    mount(<HouseHeader page="providers" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText(/Your role was not read/)).toBeTruthy();
  });
});

/* ── where it mounts ────────────────────────────────────────────────────── */

describe('PageGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('puts the header BEFORE the page, so its controls come first in the tab order', async () => {
    window.localStorage.setItem('mudavym.design.providers', '1');
    const { container } = mount(
      <PageGate page="providers" legacy={<p>legacy</p>} next={<main>the page</main>} />,
    );
    await waitFor(() => expect(container.querySelector('.mdv-hdr')).toBeTruthy());
    const bar = container.querySelector('.mdv-hdr') as HTMLElement;
    const page = container.querySelector('main') as HTMLElement;
    expect(bar.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never renders the header over a legacy page', async () => {
    window.localStorage.setItem('mudavym.design.providers', '0');
    const { container } = mount(
      <PageGate page="providers" legacy={<p>legacy</p>} next={<main>the page</main>} />,
    );
    expect(screen.getByText('legacy')).toBeTruthy();
    expect(container.querySelector('.mdv-hdr')).toBeNull();
  });
});
