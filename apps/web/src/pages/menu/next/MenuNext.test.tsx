/**
 * MenuNext — ADR 0160 sec110 item 7.
 *
 * The build this fixes had NO test for this page at all: deleting the
 * add/discard/currency behaviour below it would have left every other test
 * in the repo green. These pin the contracts the fix pass restored:
 *
 *  - money is in the HOUSE'S OWN currency, never a hardcoded `$`
 *    (`check_money_states_its_currency.py`'s own guard);
 *  - a failed add leaves the person's typed entry in the form; a
 *    SUCCESSFUL add clears it — never the reverse;
 *  - each discard button names the line it acts on (`aria-label`);
 *  - the no-active-menu, loading and read-error states.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MenuNext, { refusalReason } from './MenuNext';
import { housePriceNote } from './menu-price-note';
import {
  getMenu,
  discardMenuItem,
  addMenuItem,
  getDiscardedLines,
  restoreMenuItem,
  reviewMenuItem,
  type ActiveMenu,
  type DiscardedLine,
  type MenuLine,
} from '../../../services/api/menus';
import { settingsApi, type HouseCurrency } from '../../../services/api/settings';
import { changeLockedPrice, listPriceLocks, type LockReadout, type PriceLock } from '../../../services/api/pricing';


// The house's thousands mark and the screen's, held per test (F-878). Left
// undefined, the real readers answer, as every earlier test here expects.
const marks = vi.hoisted(() => ({
  house: undefined as '.' | ',' | null | undefined,
  screen: undefined as '.' | ',' | null | undefined,
}));
vi.mock('../../../hooks/useHouseGroupMark', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../hooks/useHouseGroupMark')>();
  return { useHouseGroupMark: () => (marks.house === undefined ? real.useHouseGroupMark() : marks.house) };
});
vi.mock('../../../lib/parseDecimal', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/parseDecimal')>();
  return { ...real, displayGroupMark: (l?: string) => (marks.screen === undefined ? real.displayGroupMark(l) : marks.screen) };
});

// The role is set per test: Edit is an owner's or a manager's (F-065).
// The house too, so a test can switch it (F-1004).
const auth = vi.hoisted(() => ({ role: null as string | null, house: 'r1' }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.house, loading: false, activeRole: auth.role }),
}));

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>(
    '../../../services/api/menus',
  );
  return {
    ...actual,
    getMenu: vi.fn(),
    discardMenuItem: vi.fn(),
    addMenuItem: vi.fn(),
    getDiscardedLines: vi.fn(),
    restoreMenuItem: vi.fn(),
    reviewMenuItem: vi.fn(),
    // The kept-menus panel (MenuVersions.tsx, its own test file) reads on
    // mount; here it answers "none kept" so this file tests the current menu.
    listMenuVersions: vi.fn().mockResolvedValue({ current: null, lastUsed: null, versions: [] }),
  };
});

// The Locked prices section (LockedPrices.tsx, its own test file) reads on
// mount; here it answers "no locks" so this file tests the current menu.
vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>(
    '../../../services/api/pricing',
  );
  return {
    ...actual,
    listPriceLocks: vi.fn().mockResolvedValue({
      restaurantId: 'r1',
      generatedAt: '2026-09-21T12:00:00Z',
      readable: true,
      reason: null,
      scope: 'this house',
      currentMenus: [],
      locks: [],
      counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 },
      namesReadable: true,
      namesReason: null,
      markersReadable: true,
      markersReason: null,
    }),
    // F-618 / S202: "Use the menu's price" on a locked price.
    changeLockedPrice: vi.fn(),
  };
});

vi.mock('../../../services/api/settings', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/settings')>(
    '../../../services/api/settings',
  );
  return { ...actual, settingsApi: { ...actual.settingsApi, houseCurrency: vi.fn() } };
});

const mockGetMenu = vi.mocked(getMenu);
const mockDiscard = vi.mocked(discardMenuItem);
const mockAdd = vi.mocked(addMenuItem);
const mockDiscarded = vi.mocked(getDiscardedLines);
const mockRestore = vi.mocked(restoreMenuItem);
const mockReview = vi.mocked(reviewMenuItem);
const mockCurrency = vi.mocked(settingsApi.houseCurrency);

function line(over: Partial<MenuLine> = {}): MenuLine {
  return {
    id: 'l1',
    name: 'Turkish coffee',
    producer: null,
    category: 'Hot drinks',
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: 62,
    bottle_price: null,
    wine_library_id: null,
    inventory_item_id: null,
    source: 'manual',
    status: 'approved',
    created_at: '2026-09-17T00:00:00Z',
    ...over,
  };
}

function menu(over: Partial<ActiveMenu> = {}): ActiveMenu {
  return { menuId: 'm1', name: 'Main menu', status: 'active', items: [line()], ...over };
}

function currency(over: Partial<HouseCurrency> = {}): HouseCurrency {
  return {
    restaurantId: 'r1',
    code: 'TRY',
    country: 'Türkiye',
    readable: true,
    reason: null,
    statedAt: '2026-09-05T00:00:00Z',
    ...over,
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <QueryClientProvider client={qc}>
      <MenuNext />
    </QueryClientProvider>
  );
  const r = render(page());
  return { ...r, rerenderPage: () => r.rerender(page()) };
}

// F-920/F-999: a refusal as the request library throws it -- its own message
// is "Request failed with status code ...", the gateway's words are under it.
const refused = (status: number, message?: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: message === undefined ? {} : { message } },
  });

beforeEach(() => {
  mockGetMenu.mockReset();
  mockDiscard.mockReset();
  mockAdd.mockReset();
  mockDiscarded.mockReset();
  mockDiscarded.mockResolvedValue({ items: [] });
  mockRestore.mockReset();
  mockReview.mockReset();
  auth.role = null;
  auth.house = 'r1';
  mockCurrency.mockReset();
  mockCurrency.mockResolvedValue(currency());
  marks.house = undefined;
  marks.screen = undefined;
});

describe('MenuNext — reading', () => {
  it('shows a loading state, then the lines once the read settles', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mount();
    // The kept-menus panel reads on mount too, so the menu's own status line
    // is named rather than "the only status on the page".
    expect(screen.getByText('Reading the menu…')).toHaveAttribute('role', 'status');
    expect(await screen.findAllByTestId('menu-row')).toHaveLength(1);
  });

  it('says a failed read plainly, never as an empty menu', async () => {
    mockGetMenu.mockRejectedValue(new Error('ECONNREFUSED'));
    mount();
    const err = await screen.findByTestId('menu-error');
    expect(err).toHaveTextContent('ECONNREFUSED');
    expect(screen.queryByTestId('menu-row')).not.toBeInTheDocument();
  });

  it('says plainly when the house has no active menu, rather than an empty add form', async () => {
    mockGetMenu.mockResolvedValue(menu({ menuId: null, name: null, status: null, items: [] }));
    mount();
    expect(await screen.findByTestId('menu-no-active')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-add-form')).not.toBeInTheDocument();
  });
});

describe("MenuNext — a line price that is not the house's own (F-618)", () => {
  it("shows the house's price under a line price that differs, and counts the lines", async () => {
    mockGetMenu.mockResolvedValue(
      menu({
        housePricesReadable: true,
        items: [
          line({ id: 'a', name: 'Yakut', bottle_price: 80, by_glass_price: 14, inventory_item_id: 'inv-1', house_bottle_price: 95, house_glass_price: 14 }),
          line({ id: 'b', name: 'Same', bottle_price: 60, by_glass_price: null, inventory_item_id: 'inv-2', house_bottle_price: 60, house_glass_price: null }),
        ],
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('menu-row');
    expect(rows[0].querySelector('[data-testid="menu-house-price-bottle"]')?.textContent).toMatch(/Your price .*95.* — the menu says .*80/);
    expect(rows[0].querySelector('[data-testid="menu-house-price-glass"]')).toBeNull();
    expect(rows[1].querySelector('[data-testid^="menu-house-price"]')).toBeNull();
    expect(screen.getByTestId('menu-house-prices-differ')).toHaveTextContent('1 line prints a price');
  });

  it("shows the kept house price beside a blank line price", async () => {
    mockGetMenu.mockResolvedValue(
      menu({ items: [line({ bottle_price: null, by_glass_price: null, inventory_item_id: 'inv-1', house_bottle_price: 95, house_glass_price: null, price_flag: 'blank_kept_last_known' })] }),
    );
    mount();
    const row = (await screen.findAllByTestId('menu-row'))[0];
    expect(row.querySelector('[data-testid="menu-house-price-bottle"]')?.textContent).toMatch(/95/);
  });

  it("says when the house's prices could not be read, rather than marking nothing", async () => {
    mockGetMenu.mockResolvedValue(menu({ housePricesReadable: false, housePricesReason: "This house's own prices could not be read (timeout)." }));
    mount();
    expect(await screen.findByTestId('menu-house-prices-unread')).toHaveTextContent('timeout');
    expect(screen.queryByTestId('menu-house-prices-differ')).not.toBeInTheDocument();
  });
});

describe('MenuNext — two prices, and an owner picks one (F-618, S202)', () => {
  const twoPrices = () =>
    menu({
      housePricesReadable: true,
      items: [line({ id: 'a', name: 'Yakut', bottle_price: 80, by_glass_price: null, inventory_item_id: 'inv-1', house_bottle_price: 95, house_glass_price: null })],
    });
  const noLocks = (locks: PriceLock[] = []): LockReadout => ({
    restaurantId: 'r1',
    generatedAt: '2026-10-12T12:00:00Z',
    readable: true,
    reason: null,
    scope: 'this house',
    currentMenus: [{ menuId: 'm1', name: 'Main menu' }],
    locks,
    counts: { open: locks.length, onCurrentMenu: locks.length, notOnCurrentMenu: 0, toReview: 0 },
    namesReadable: true,
    namesReason: null,
    markersReadable: true,
    markersReason: null,
  });
  const lockAt95: PriceLock = {
    lockId: 'lk-1',
    inventoryId: 'inv-1',
    kind: 'bottle',
    lockedPrice: 95,
    lockedAt: '2026-10-01T10:00:00Z',
    ageDays: 11,
    note: null,
    movedFromLockId: null,
    lockedBy: { userId: 'u-1', name: 'Ayse' },
    wine: { name: 'Yakut', vintage: null, masterWineId: 'w1', active: true, housePrice: 95 },
    dormant: false,
    menuPrice: 80,
    markers: ['menu_differs'],
    advice: null,
    adviceUnknownReason: null,
  };
  afterEach(() => {
    vi.mocked(listPriceLocks).mockResolvedValue(noLocks());
    vi.mocked(changeLockedPrice).mockReset();
  });

  it('an owner keeps the house price: the menu line is corrected to it', async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(twoPrices());
    mockReview.mockResolvedValue({ menuItemId: 'a', fieldName: 'bottle_price', newValue: '95', priceSync: 'unchanged' });
    mount();
    fireEvent.click(await screen.findByTestId('price-pick-keep-bottle'));
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('a', 'bottle_price', '95'));
    expect(await screen.findByText(/The menu now says .*95.*, the price the house charges\./)).toHaveAttribute('role', 'status');
  });

  it("an owner takes the menu's price: the house price is set to it through the line", async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(twoPrices());
    mockReview.mockResolvedValue({ menuItemId: 'a', fieldName: 'bottle_price', newValue: '80', priceSync: 'changed' });
    mount();
    fireEvent.click(await screen.findByTestId('price-pick-menu-bottle'));
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('a', 'bottle_price', '80'));
    expect(await screen.findByText(/The house now charges .*80.*, as the menu says\./)).toBeInTheDocument();
  });

  it("a locked price says 'Locked at X — the menu says Y', and the menu's price changes the lock, kept locked", async () => {
    auth.role = 'manager';
    vi.mocked(listPriceLocks).mockResolvedValue(noLocks([lockAt95]));
    vi.mocked(changeLockedPrice).mockResolvedValue({
      outcome: 'changed_and_locked',
      lock: { lockId: 'lk-2', inventoryId: 'inv-1', kind: 'bottle', lockedPrice: 80 },
      previousLockId: 'lk-1',
      housePrice: 80,
      sentence: 'The bottle price is now 80.00 and stays locked.',
    });
    mockGetMenu.mockResolvedValue(twoPrices());
    mount();
    const row = (await screen.findAllByTestId('menu-row'))[0];
    await waitFor(() =>
      expect(row.querySelector('[data-testid="menu-house-price-bottle"]')?.textContent).toMatch(/^Locked at .*95.* — the menu says .*80/),
    );
    fireEvent.click(within(row).getByTestId('price-pick-menu-bottle'));
    await waitFor(() => expect(vi.mocked(changeLockedPrice)).toHaveBeenCalledWith('lk-1', 80, "picked the menu's price on Menu"));
    expect(mockReview).not.toHaveBeenCalled();
    expect(await screen.findByText('The bottle price is now 80.00 and stays locked.')).toBeInTheDocument();
  });

  it('staff read both prices and get no pick', async () => {
    auth.role = 'staff';
    mockGetMenu.mockResolvedValue(twoPrices());
    mount();
    const row = (await screen.findAllByTestId('menu-row'))[0];
    expect(row.querySelector('[data-testid="menu-house-price-bottle"]')?.textContent).toMatch(/the menu says/);
    expect(within(row).queryByTestId('price-pick-keep-bottle')).toBeNull();
    expect(within(row).queryByTestId('price-pick-menu-bottle')).toBeNull();
  });
});

describe("MenuNext — a drink 86'd shows sold out on the house's menu (F-145)", () => {
  it('marks only the sold-out line', async () => {
    mockGetMenu.mockResolvedValue(
      menu({
        items: [
          line({ id: 'a', name: 'Xinomavro', inventory_item_id: 'inv-1', sold_out: true }),
          line({ id: 'b', name: 'Assyrtiko', inventory_item_id: 'inv-2' }),
        ],
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('menu-row');
    expect(rows[0].querySelector('[data-testid="menu-sold-out"]')?.textContent).toBe('sold out');
    expect(rows[1].querySelector('[data-testid="menu-sold-out"]')).toBeNull();
  });

  it('says when which drinks are sold out could not be read', async () => {
    mockGetMenu.mockResolvedValue(menu({ soldOutReadable: false, soldOutReason: 'Which drinks are sold out could not be read (timeout).' }));
    mount();
    expect(await screen.findByTestId('menu-sold-out-unread')).toHaveTextContent('timeout');
  });
});

describe('MenuNext — money states its own house currency', () => {
  it('prints the HOUSE currency, never a bare dollar sign', async () => {
    mockCurrency.mockResolvedValue(currency({ code: 'TRY' }));
    mockGetMenu.mockResolvedValue(menu({ items: [line({ by_glass_price: 62, bottle_price: 900 })] }));
    mount();
    const row = (await screen.findAllByTestId('menu-row'))[0];
    expect(row.textContent).toMatch(/TRY/);
    expect(row.textContent).not.toMatch(/\$62/);
  });

  it('says "currency not recorded" rather than defaulting to a dollar sign', async () => {
    mockCurrency.mockResolvedValue(currency({ code: null }));
    mockGetMenu.mockResolvedValue(menu({ items: [line({ by_glass_price: 62 })] }));
    mount();
    const row = (await screen.findAllByTestId('menu-row'))[0];
    expect(row.textContent).toContain('currency not recorded');
    expect(row.textContent).not.toMatch(/\$62/);
  });
});

describe('MenuNext — add', () => {
  beforeEach(() => {
    auth.role = 'manager';
  });
  afterEach(() => {
    auth.role = null;
  });

  it.each(['staff', null])('%s see no Add form: adding to the current menu is an owner\'s or a manager\'s (F-698)', async (role) => {
    auth.role = role;
    mockGetMenu.mockResolvedValue(menu({ items: [line({ name: 'Raki' })] }));
    mount();
    expect(await screen.findByText('Raki')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to menu/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-add-managers-only')).toHaveTextContent('An owner or a manager adds lines to the current menu.');
  });

  it('clears the form on a SUCCESSFUL add, never before', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({} as never);
    mount();
    const nameField = await screen.findByLabelText('Name');
    fireEvent.change(nameField, { target: { value: 'American black coffee' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    await waitFor(() => expect(nameField).toHaveValue(''));
  });

  it('keeps the person\'s typed entry after a FAILED add — a draft is not lost on error', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockRejectedValue(new Error('Forbidden'));
    mount();
    const nameField = await screen.findByLabelText('Name');
    fireEvent.change(nameField, { target: { value: 'American black coffee' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Forbidden'));
    expect(nameField).toHaveValue('American black coffee');
  });

  // ADR 0193: a priced line also sets the linked wine's own price, and the
  // gateway says per line whether it did. A failed price write must not read
  // as a price that moved.
  it('says plainly when the line was added but the house price was NOT updated', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({ priceSync: 'failed', priceSyncError: 'the price writer is down' } as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/NOT updated \(the price writer is down\)/),
    );
  });

  it('says when the house price now follows the line, and says nothing for a line with no price', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValueOnce({ priceSync: 'changed' } as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() =>
      expect(screen.getByTestId('menu-add-price-note')).toHaveTextContent(/now matches the line/),
    );
    expect(housePriceNote({ priceSync: 'no_price' }, null)).toBeNull();
    expect(housePriceNote({ priceSync: 'not_linked' }, null)).toBeNull();
    expect(housePriceNote({ priceSync: 'stale' }, null)?.text).toMatch(/kept/);
  });
});

// F-358: the prices were type="number" read with Number(), so "12,50" went out
// as NaN (null in JSON) and the line was added with no price, silently.
describe('MenuNext — a typed price is read the way the house writes it', () => {
  // F-698: only an owner or a manager sees the Add form.
  beforeEach(() => {
    auth.role = 'manager';
  });
  afterEach(() => {
    auth.role = null;
  });

  it('sends "12,50" and "1.250,00" as 12.5 and 1250, from decimal-keypad text fields', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({ priceSync: 'not_linked' } as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    const glass = screen.getByLabelText('Glass');
    expect(glass).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(glass, { target: { value: '12,50' } });
    fireEvent.change(screen.getByLabelText('Bottle'), { target: { value: '1.250,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0][1]).toEqual(
      expect.objectContaining({ name: 'Barolo', by_glass_price: 12.5, bottle_price: 1250 }),
    );
  });

  it('F-878: "1,250" that the house and the screen read two ways is asked, and nothing is added', async () => {
    // A house whose country is not recorded, on an English screen.
    marks.house = null;
    marks.screen = ',';
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    fireEvent.change(screen.getByLabelText('Bottle'), { target: { value: '1,250' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/“1,250” could be 1\.25 or 1,250\.00/);
    expect(screen.getByRole('button', { name: /Add to menu/ })).toBeDisabled();
    fireEvent.submit(screen.getByTestId('menu-add-form'));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('holds the add and says so when a price is not a number', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    fireEvent.change(screen.getByLabelText('Glass'), { target: { value: '12,5,0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('“12,5,0” is not a price');
    expect(screen.getByRole('button', { name: /Add to menu/ })).toBeDisabled();
  });
});

describe('MenuNext — the footer says only what is true (F-697)', () => {
  it('never promises a guest-facing effect: no guest menu exists', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mount();
    const foot = await screen.findByText(/Discard takes a line off this house's current menu here/);
    expect(foot).toHaveTextContent('Mudavym shows no menu to guests');
    expect(document.body).not.toHaveTextContent(/what guests see/);
  });
});

describe('MenuNext — discard', () => {
  beforeEach(() => {
    auth.role = 'manager';
  });
  afterEach(() => {
    auth.role = null;
  });

  it('staff see no Discard: taking a line off the menu is an owner\'s or a manager\'s (F-268)', async () => {
    auth.role = 'staff';
    mockGetMenu.mockResolvedValue(menu({ items: [line({ name: 'Raki' })] }));
    mount();
    expect(await screen.findByText('Raki')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard Raki' })).not.toBeInTheDocument();
  });

  it('names the line it discards, for a screen reader', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ name: 'Raki' })] }));
    mount();
    expect(await screen.findByRole('button', { name: 'Discard Raki' })).toBeInTheDocument();
  });

  it('discards on click, and reports a failure without pretending the line is gone', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockRejectedValue(new Error('no reason given'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('r1', 'l9'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not discarded');
  });
});

describe('MenuNext — put a discarded line back (F-268)', () => {
  beforeEach(() => {
    auth.role = 'manager';
  });
  afterEach(() => {
    auth.role = null;
  });

  function gone(over: Partial<DiscardedLine> = {}): DiscardedLine {
    return { ...line(), status: 'discarded', prior_status: 'approved', ...over };
  }

  it('offers the line just discarded back in place, and puts it back on click', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockResolvedValue({ menuItemId: 'l9', status: 'discarded' });
    mockRestore.mockResolvedValue({ menuItemId: 'l9', status: 'approved' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    expect(await screen.findByTestId('menu-just-discarded')).toHaveTextContent('Raki is off the menu.');
    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('r1', 'l9'));
    await waitFor(() => expect(screen.queryByTestId('menu-just-discarded')).not.toBeInTheDocument());
  });

  it('moves focus to "Put it back" after a discard, and back to the line once it is back (F-1425)', async () => {
    let onMenu = true;
    mockGetMenu.mockImplementation(async () =>
      menu({ items: onMenu ? [line({ id: 'l9', name: 'Raki' })] : [] }),
    );
    mockDiscard.mockImplementation(async () => {
      onMenu = false;
      return { menuItemId: 'l9', status: 'discarded' };
    });
    mockRestore.mockImplementation(async () => {
      onMenu = true;
      return { menuItemId: 'l9', status: 'approved' };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    const undo = await screen.findByRole('button', { name: 'Put it back' });
    await waitFor(() => expect(undo).toHaveFocus());
    fireEvent.click(undo);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discard Raki' })).toHaveFocus(),
    );
  });

  it('lists the lines taken off, says what each goes back as, and puts one back', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mockDiscarded.mockResolvedValue({
      items: [gone({ id: 'd1', name: 'Raki' }), gone({ id: 'd2', name: 'Ouzo', prior_status: null })],
    });
    mockRestore.mockResolvedValue({ menuItemId: 'd2', status: 'in_review' });
    mount();
    const list = await screen.findByTestId('menu-discarded');
    expect(list).toHaveTextContent('Taken off the menu (2)');
    expect(list).toHaveTextContent('Goes back as approved.');
    expect(list).toHaveTextContent('Goes back as in review — what it was before is not known.');
    fireEvent.click(screen.getByRole('button', { name: 'Put Ouzo back on the menu' }));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('r1', 'd2'));
  });

  it('staff are not shown the lines taken off, and the page does not ask for them', async () => {
    auth.role = 'staff';
    mockGetMenu.mockResolvedValue(menu());
    mockDiscarded.mockResolvedValue({ items: [gone({ name: 'Raki' })] });
    mount();
    expect(await screen.findByText('Turkish coffee')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-discarded')).not.toBeInTheDocument();
    expect(mockDiscarded).not.toHaveBeenCalled();
  });

  it('says so when a line could not be put back', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mockDiscarded.mockResolvedValue({ items: [gone({ id: 'd1', name: 'Raki' })] });
    mockRestore.mockRejectedValue(new Error('the line is gone'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Put Raki back on the menu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not put back');
  });
});

describe('MenuNext — kind-neutral words (F-066)', () => {
  it('counts the lines on the current menu, never by the name the importer gave it', async () => {
    mockGetMenu.mockResolvedValue(menu({ name: 'Wine List' }));
    mount();
    expect(await screen.findByText('1 line on the current menu.')).toBeInTheDocument();
    expect(screen.queryByText(/Wine List/)).not.toBeInTheDocument();
  });
});

describe('MenuNext — why a line is flagged (F-151)', () => {
  it('a line added or corrected by hand says so, and is not read as a missing price', async () => {
    mockGetMenu.mockResolvedValue(
      menu({
        items: [
          line({ id: 'a', name: 'Ayva Highball', status: 'flagged', review_notes: 'Manually added during review', by_glass_price: 16 }),
          line({ id: 'b', name: 'Efes draft', status: 'flagged', review_notes: 'Manager corrected by_glass_price' }),
          line({ id: 'c', name: 'Raki', status: 'flagged', review_notes: null }),
        ],
      }),
    );
    mount();
    const rows = await screen.findAllByTestId('menu-row');
    expect(rows[0]).toHaveTextContent('by hand');
    expect(rows[0]).toHaveTextContent('Added by hand.');
    expect(rows[0]).not.toHaveTextContent('flagged');
    expect(rows[1]).toHaveTextContent('Glass price changed by hand.');
    expect(rows[1]).not.toHaveTextContent('by_glass_price');
    // No note: the status is all there is to say.
    expect(rows[2]).toHaveTextContent('flagged');
    expect(within(rows[2]).queryByTestId('menu-flag-reason')).toBeNull();
  });
});

describe('MenuNext — edit a line in place (F-065)', () => {
  it('staff are offered no Edit', async () => {
    auth.role = 'staff';
    mockGetMenu.mockResolvedValue(menu());
    mount();
    await screen.findAllByTestId('menu-row');
    expect(screen.queryByRole('button', { name: 'Edit Turkish coffee' })).toBeNull();
  });

  it('a manager changes the name and the glass price; each changed field is saved, in order, and said', async () => {
    auth.role = 'manager';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockResolvedValueOnce({ menuItemId: 'l1', fieldName: 'name', newValue: 'Türk kahvesi' });
    mockReview.mockResolvedValueOnce({ menuItemId: 'l1', fieldName: 'by_glass_price', newValue: '70', priceSync: 'changed' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Name of Turkish coffee'), { target: { value: 'Türk kahvesi' } });
    fireEvent.change(screen.getByLabelText('Glass price of Turkish coffee'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockReview).toHaveBeenCalledTimes(2));
    expect(mockReview.mock.calls).toEqual([
      ['l1', 'name', 'Türk kahvesi'],
      ['l1', 'by_glass_price', '70'],
    ]);
    const said = await screen.findByTestId('menu-edit-said');
    expect(said).toHaveTextContent('Turkish coffee: Saved: Name, Glass price.');
    expect(said).toHaveTextContent("The house's own glass price now matches the line.");
    expect(screen.queryByTestId('menu-edit-row')).toBeNull();
  });

  it('a refused field is named, with what was saved before it, and the form stays open', async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockResolvedValueOnce({ menuItemId: 'l1', fieldName: 'category', newValue: 'Coffee' });
    mockReview.mockRejectedValueOnce(new Error('the gateway refused'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Section of Turkish coffee'), { target: { value: 'Coffee' } });
    fireEvent.change(screen.getByLabelText('Bottle price of Turkish coffee'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const said = await screen.findByTestId('menu-edit-said');
    expect(said).toHaveTextContent('Bottle price was not saved (the gateway refused). Saved: Section.');
    expect(screen.getByTestId('menu-edit-row')).toBeInTheDocument();
  });


  it('F-920: a rename refused with a 403 shows the gateway\'s reason', async () => {
    auth.role = 'manager';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockRejectedValueOnce(refused(403, 'Only managers and owners can rename a wine on the menu'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Name of Turkish coffee'), { target: { value: 'Türk kahvesi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const said = await screen.findByTestId('menu-edit-said');
    expect(said).toHaveTextContent(
      'Name was not saved (Only managers and owners can rename a wine on the menu). Nothing was changed.',
    );
    expect(said).not.toHaveTextContent('status code');
  });

  it('F-920: a rename refused with a 500 shows why the stock was not renamed', async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockRejectedValueOnce(
      refused(500, 'The wine could not be renamed in your stock, so the menu line was not renamed either: timeout'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Name of Turkish coffee'), { target: { value: 'Türk kahvesi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const said = await screen.findByTestId('menu-edit-said');
    expect(said).toHaveTextContent(
      'Name was not saved (The wine could not be renamed in your stock, so the menu line was not renamed either: timeout).',
    );
    expect(said).not.toHaveTextContent('status code');
  });

  it('F-920: a 403 or a 500 with no words of its own is said plainly, never as a status code', () => {
    expect(refusalReason(refused(403))).toBe('only an owner or a manager can change this line');
    expect(refusalReason(refused(500))).toBe('the server could not save it and gave no reason; try again');
    expect(refusalReason(refused(400, ['name must be text']))).toBe('name must be text');
    expect(refusalReason(new Error('the gateway refused'))).toBe('the gateway refused');
  });

  it('F-878: the line edit reads "45,50" the way the house writes it, from a text field', async () => {
    auth.role = 'manager';
    marks.house = '.';
    marks.screen = '.';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockResolvedValueOnce({ menuItemId: 'l1', fieldName: 'by_glass_price', newValue: '45.5', priceSync: 'changed' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    const glass = screen.getByLabelText('Glass price of Turkish coffee');
    expect(glass).toHaveAttribute('type', 'text');
    expect(glass).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(glass, { target: { value: '45,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('l1', 'by_glass_price', '45.5'));
  });

  it('F-878: a line price that reads two ways is asked, and nothing is sent', async () => {
    auth.role = 'manager';
    marks.house = null;
    marks.screen = ',';
    mockGetMenu.mockResolvedValue(menu());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Bottle price of Turkish coffee'), { target: { value: '1,250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/“1,250” could be 1\.25 or 1,250\.00/);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('a price cannot be cleared from here, and nothing is sent', async () => {
    auth.role = 'manager';
    mockGetMenu.mockResolvedValue(menu());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Glass price of Turkish coffee'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Glass price cannot be cleared here.');
    expect(mockReview).not.toHaveBeenCalled();
  });
});

describe('MenuNext — focus follows the edit in and back out (F-1038)', () => {
  it('Edit puts focus on the name field, and Cancel returns it to Edit', async () => {
    auth.role = 'manager';
    mockGetMenu.mockResolvedValue(menu());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    expect(screen.getByLabelText('Name of Turkish coffee')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit Turkish coffee' })).toHaveFocus();
  });

  it('after a Save that went through, focus is back on that line\'s Edit', async () => {
    auth.role = 'manager';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockResolvedValueOnce({ menuItemId: 'l1', fieldName: 'category', newValue: 'Coffee' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Section of Turkish coffee'), { target: { value: 'Coffee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByTestId('menu-edit-said');
    await waitFor(() => expect(screen.queryByTestId('menu-edit-row')).toBeNull());
    expect(screen.getByRole('button', { name: 'Edit Turkish coffee' })).toHaveFocus();
  });
});

describe("MenuNext — a failed edit says what was changed, not more (F-1002)", () => {
  async function rename() {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Name of Turkish coffee'), { target: { value: 'Türk kahvesi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    return screen.findByTestId('menu-edit-said');
  }

  it('a rename that renamed the stock but not the line never says "Nothing was changed"', async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockRejectedValueOnce(
      refused(500, 'The wine was renamed in your stock, but the menu line was not: timeout'),
    );
    mount();
    const said = await rename();
    expect(said).toHaveTextContent(
      'Name was not saved (The wine was renamed in your stock, but the menu line was not: timeout).',
    );
    expect(said).not.toHaveTextContent('Nothing was changed');
  });

  it('a 500 with no reason asks for a reload rather than claiming nothing changed', async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockRejectedValueOnce(refused(500));
    mount();
    const said = await rename();
    expect(said).toHaveTextContent('Reload the page to see what was kept.');
    expect(said).not.toHaveTextContent('Nothing was changed');
  });
});

describe("MenuNext — Add, Discard and Put back show the gateway's reason (F-999)", () => {
  beforeEach(() => {
    auth.role = 'manager';
  });

  it('a refused add', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockRejectedValue(refused(403, 'Only an owner or a manager can add a line to the current menu.'));
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Raki' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Only an owner or a manager can add a line to the current menu.');
    expect(alert).not.toHaveTextContent('status code');
  });

  it('a refused discard', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockRejectedValue(refused(404, 'No menu item of this restaurant'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That line was not discarded (No menu item of this restaurant).',
    );
  });

  it('a refused put back', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mockDiscarded.mockResolvedValue({ items: [{ ...line({ id: 'd1', name: 'Raki' }), status: 'discarded', prior_status: 'approved' }] });
    mockRestore.mockRejectedValue(refused(404, 'No menu item of this restaurant'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Put Raki back on the menu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That line was not put back (No menu item of this restaurant).',
    );
  });

  it('a failed read of the lines taken off, with no reason, is never a status code', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mockDiscarded.mockRejectedValue(refused(500));
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The lines taken off the menu could not be read (the server gave no reason; try again).');
    expect(alert).not.toHaveTextContent('status code');
  });
});

describe('MenuNext — a house switch starts the page empty (F-1004)', () => {
  it("drops the house just left's 'Put it back', so it is never sent to the next house", async () => {
    auth.role = 'manager';
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockResolvedValue({ menuItemId: 'l9', status: 'discarded' });
    const { rerenderPage } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    expect(await screen.findByTestId('menu-just-discarded')).toHaveTextContent('Raki is off the menu.');
    auth.house = 'r2';
    rerenderPage();
    await waitFor(() => expect(mockGetMenu).toHaveBeenCalledWith('r2'));
    // The next house's menu is read and shown before anything is asserted.
    expect(await screen.findByRole('button', { name: 'Discard Raki' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-just-discarded')).not.toBeInTheDocument();
  });

  it('drops the Edit sentence of the house just left', async () => {
    auth.role = 'owner';
    mockGetMenu.mockResolvedValue(menu());
    mockReview.mockResolvedValueOnce({ menuItemId: 'l1', fieldName: 'name', newValue: 'Türk kahvesi' });
    const { rerenderPage } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Turkish coffee' }));
    fireEvent.change(screen.getByLabelText('Name of Turkish coffee'), { target: { value: 'Türk kahvesi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('menu-edit-said')).toHaveTextContent('Saved: Name.');
    auth.house = 'r2';
    rerenderPage();
    await waitFor(() => expect(mockGetMenu).toHaveBeenCalledWith('r2'));
    expect(await screen.findByRole('button', { name: 'Edit Turkish coffee' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-edit-said')).not.toBeInTheDocument();
  });
});
