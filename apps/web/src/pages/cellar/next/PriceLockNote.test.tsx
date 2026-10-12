/**
 * PriceLockNote -- the cellar says a locked price where it shows the price
 * (ADR 0193 round 3, L8, L25, L26). The API module is the boundary mocked
 * here; the component under test is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PriceLockNote from './PriceLockNote';
import { setCellarCurrency } from './cellar-format';
import { listPriceLocks as listPriceLocksReal, type LockReadout, type PriceLock } from '../../../services/api/pricing';
import { getMenu as getMenuReal, reviewMenuItem as reviewMenuItemReal, type ActiveMenu } from '../../../services/api/menus';
import { useAuthStore } from '../../../stores';

vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>('../../../services/api/pricing');
  return { ...actual, listPriceLocks: vi.fn() };
});
const listPriceLocks = vi.mocked(listPriceLocksReal);

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenu: vi.fn(), reviewMenuItem: vi.fn() };
});
const getMenu = vi.mocked(getMenuReal);
const reviewMenuItem = vi.mocked(reviewMenuItemReal);


function lock(over: Partial<PriceLock> = {}): PriceLock {
  return {
    lockId: 'lk-1',
    inventoryId: 'inv-1',
    kind: 'bottle',
    lockedPrice: 95,
    lockedAt: '2026-09-21T10:00:00Z',
    ageDays: 0,
    note: null,
    movedFromLockId: null,
    lockedBy: { userId: 'u-1', name: 'Ayse' },
    wine: { name: 'Boğazkere', vintage: 2021, masterWineId: 'w1', active: true, housePrice: 95 },
    dormant: false,
    menuPrice: null,
    markers: [],
    advice: null,
    adviceUnknownReason: null,
    ...over,
  };
}

function readout(locks: PriceLock[], over: Partial<LockReadout> = {}): LockReadout {
  return {
    restaurantId: 'r1',
    generatedAt: '2026-09-21T12:00:00Z',
    readable: true,
    reason: null,
    scope: 'this house',
    currentMenus: [],
    locks,
    counts: { open: locks.length, onCurrentMenu: 0, notOnCurrentMenu: locks.length, toReview: 0 },
    namesReadable: true,
    namesReason: null,
    markersReadable: true,
    markersReason: null,
    ...over,
  };
}

function mount(inventoryId = 'inv-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PriceLockNote inventoryId={inventoryId} />
    </QueryClientProvider>,
  );
}

// A braced body: a hook that RETURNS a function has it run as the test's teardown
// (vitest), and mockReset() returns the mock itself.
beforeEach(() => {
  // A dollar house: the currency CellarNext reads before any note draws.
  setCellarCurrency('USD');
  listPriceLocks.mockReset();
});

describe('PriceLockNote -- a locked price is said beside the price', () => {
  it("says this wine's lock: the price, who, since when, at this house; never another wine's", async () => {
    listPriceLocks.mockResolvedValue(
      readout([lock(), lock({ lockId: 'lk-2', inventoryId: 'inv-2', lockedPrice: 40, lockedBy: { userId: 'u-2', name: 'Kerem' } })]),
    );
    mount();
    const line = await screen.findByTestId('bottle-leaf-lock-bottle');
    expect(line).toHaveTextContent(
      'The bottle price is locked at $95.00 at this house, by Ayse since 2026-09-21. No menu, correction or advice changes it; an owner or a manager does, on Menu, under Locked prices.',
    );
    expect(screen.queryByText(/\$40\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kerem/)).not.toBeInTheDocument();
  });

  it('says the bottle lock before the glass lock when both kinds are held', async () => {
    listPriceLocks.mockResolvedValue(
      readout([lock({ lockId: 'g', kind: 'glass', lockedPrice: 14 }), lock({ lockId: 'b', kind: 'bottle' })]),
    );
    mount();
    const box = await screen.findByTestId('bottle-leaf-locks');
    const lines = box.querySelectorAll('p');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('The bottle price is locked at $95.00');
    expect(lines[1]).toHaveTextContent('The glass price is locked at $14.00');
  });

  it('shows nothing when the locks were read and none holds this wine (no lock is the ordinary state)', async () => {
    listPriceLocks.mockResolvedValue(readout([lock({ inventoryId: 'inv-9' })]));
    const { container } = mount();
    await waitFor(() => expect(listPriceLocks).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says an unreadable lock list as unreadable, with the reason -- never as "not locked" (L25)', async () => {
    listPriceLocks.mockResolvedValue(
      readout([], { readable: false, reason: 'The price locks could not be read: timeout. This is not the same as having none.' }),
    );
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Whether this price is locked could not be read');
    expect(alert).toHaveTextContent('timeout');
    expect(alert).toHaveTextContent('This is not the same as not locked.');
  });

  it('says a failed request as unreadable too', async () => {
    listPriceLocks.mockRejectedValue(new Error('Network Error'));
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Whether this price is locked could not be read (Network Error)');
  });

  it("tells a name that could not be read apart from one that is not on record", async () => {
    listPriceLocks.mockResolvedValue(
      readout([lock({ lockedBy: { userId: 'u-1', name: null } })], { namesReadable: false, namesReason: 'users: timeout' }),
    );
    mount();
    expect(await screen.findByTestId('bottle-leaf-lock-bottle')).toHaveTextContent('by someone whose name could not be read');
  });

  it('says "not on record" when the names were read and this one has none', async () => {
    listPriceLocks.mockResolvedValue(readout([lock({ lockedBy: { userId: 'u-1', name: null } })]));
    mount();
    expect(await screen.findByTestId('bottle-leaf-lock-bottle')).toHaveTextContent('by someone whose name is not on record');
  });
});

describe('PriceLockNote -- the menu prints another price for this wine (F-618, S202)', () => {
  const twoPrices: ActiveMenu = {
    menuId: 'm1',
    name: 'Main menu',
    status: 'active',
    housePricesReadable: true,
    items: [
      {
        id: 'a', name: 'Boğazkere', producer: null, category: null, vintage: null, region: null, country: null,
        grape_variety: null, by_glass_price: null, bottle_price: 80, wine_library_id: 'w1', inventory_item_id: 'inv-1',
        source: 'scan', status: 'approved', created_at: '2026-10-01T00:00:00Z', house_bottle_price: 95, house_glass_price: null,
      },
    ],
  };
  afterEach(() => {
    useAuthStore.setState({ activeRestaurantId: null, user: null } as never);
    getMenu.mockReset();
    reviewMenuItem.mockReset();
  });

  it("says 'Locked at X — the menu says Y' on the wine, and an owner keeps the locked price with one tap", async () => {
    useAuthStore.setState({ activeRestaurantId: 'r1', user: { role: 'owner' } } as never);
    listPriceLocks.mockResolvedValue(readout([lock({ menuPrice: 80, markers: ['menu_differs'] })]));
    getMenu.mockResolvedValue(twoPrices);
    reviewMenuItem.mockResolvedValue({ menuItemId: 'a', fieldName: 'bottle_price', newValue: '95', priceSync: 'locked' });
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('menu-house-price-bottle')).toHaveTextContent('Locked at $95.00 — the menu says $80.00'),
    );
    expect(getMenu).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByTestId('price-pick-keep-bottle'));
    await waitFor(() => expect(reviewMenuItem).toHaveBeenCalledWith('a', 'bottle_price', '95'));
    expect(await screen.findByRole('status')).toHaveTextContent('The menu now says $95.00, the price the house charges.');
  });

  it('staff read both prices on the wine and get no pick', async () => {
    useAuthStore.setState({ activeRestaurantId: 'r1', user: { role: 'staff' } } as never);
    listPriceLocks.mockResolvedValue(readout([]));
    getMenu.mockResolvedValue(twoPrices);
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('menu-house-price-bottle')).toHaveTextContent('Your price $95.00 — the menu says $80.00'),
    );
    expect(screen.queryByTestId('price-pick-keep-bottle')).toBeNull();
    expect(screen.queryByTestId('price-pick-menu-bottle')).toBeNull();
  });

  it('says a menu that could not be read, never as "no difference"', async () => {
    useAuthStore.setState({ activeRestaurantId: 'r1', user: { role: 'owner' } } as never);
    listPriceLocks.mockResolvedValue(readout([]));
    getMenu.mockRejectedValue(new Error('timeout'));
    mount();
    expect(await screen.findByTestId('wine-menu-prices-unread')).toHaveTextContent(
      'Whether the current menu prints another price for this wine could not be read (timeout).',
    );
  });
});
