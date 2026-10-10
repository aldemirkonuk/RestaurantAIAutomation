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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MenuNext from './MenuNext';
import { housePriceNote } from './menu-price-note';
import {
  getMenu,
  discardMenuItem,
  addMenuItem,
  getDiscardedLines,
  restoreMenuItem,
  type ActiveMenu,
  type DiscardedLine,
  type MenuLine,
} from '../../../services/api/menus';
import { settingsApi, type HouseCurrency } from '../../../services/api/settings';

const auth = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, activeRole: auth.role }),
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
  return render(
    <QueryClientProvider client={qc}>
      <MenuNext />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGetMenu.mockReset();
  mockDiscard.mockReset();
  mockAdd.mockReset();
  mockDiscarded.mockReset();
  mockDiscarded.mockResolvedValue({ items: [] });
  mockRestore.mockReset();
  mockCurrency.mockReset();
  mockCurrency.mockResolvedValue(currency());
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
    expect(housePriceNote({ priceSync: 'no_price' })).toBeNull();
    expect(housePriceNote({ priceSync: 'not_linked' })).toBeNull();
    expect(housePriceNote({ priceSync: 'stale' })?.text).toMatch(/kept/);
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
