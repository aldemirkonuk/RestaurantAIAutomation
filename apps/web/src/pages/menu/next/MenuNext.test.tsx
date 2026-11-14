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
import MenuNext from './MenuNext';
import { housePriceNote } from './menu-price-note';
import { formatMoney } from '../../../lib/currency';
import { getMenu, discardMenuItem, addMenuItem, reviewMenuItem, type ActiveMenu, type MenuLine } from '../../../services/api/menus';
import { settingsApi, type HouseCurrency } from '../../../services/api/settings';

// ADR 0358 D2: discarding a line is an owner's or a manager's, so the page
// offers it only to them. A manager reads by default; one case reads as staff.
let role: string | null = 'manager';
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, activeRole: role }),
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
  mockReview.mockReset();
  role = 'manager';
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

describe('MenuNext — a dish is not listed among the drinks (menu walk 2026-11-11)', () => {
  it('sets a kitchen line apart under "From the kitchen", and never names the menu "Wine List"', async () => {
    mockGetMenu.mockResolvedValue(
      menu({
        name: 'Wine List',
        items: [
          line({ id: 'w1', name: 'Chianti', category: 'red', bottle_price: 48, kitchen_line: false }),
          line({ id: 'k1', name: 'Tiramisu', category: 'dessert', bottle_price: 9, kitchen_line: true }),
        ],
      }),
    );
    mount();
    const drinks = await screen.findAllByTestId('menu-row');
    expect(drinks.map((r) => r.textContent)).toEqual([expect.stringContaining('Chianti')]);
    const kitchen = screen.getByTestId('menu-kitchen');
    expect(kitchen).toHaveTextContent('From the kitchen');
    expect(kitchen).toHaveTextContent('carried nowhere');
    expect(screen.getAllByTestId('menu-kitchen-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Tiramisu'),
    ]);
    const standing = screen.getByTestId('menu-standing');
    expect(standing).toHaveTextContent('1 drink on the current menu, and 1 line from the kitchen, set apart below.');
    expect(standing).not.toHaveTextContent('Wine List');
  });

  it('works the split out itself when an older gateway sends no kitchen_line', async () => {
    mockGetMenu.mockResolvedValue(
      menu({
        items: [
          line({ id: 'k1', name: 'Tiramisu', category: 'dessert', bottle_price: 9 }),
          line({ id: 'w2', name: 'Sauternes', category: 'dessert', vintage: '2015', bottle_price: 80 }),
        ],
      }),
    );
    mount();
    expect((await screen.findAllByTestId('menu-row')).map((r) => r.textContent)).toEqual([
      expect.stringContaining('Sauternes'),
    ]);
    expect(screen.getAllByTestId('menu-kitchen-row')).toHaveLength(1);
  });

  it('a line whose section the owner chose on the first proof reads "set by hand: its section", never "flagged" (walk 2026-11-12)', async () => {
    mockGetMenu.mockResolvedValue(
      menu({ items: [line({ name: 'Soave', category: 'white', status: 'flagged', flag_reason: 'corrected', flag_field: 'category' })] }),
    );
    mount();
    const chip = await screen.findByTestId('menu-line-status');
    expect(chip).toHaveTextContent('set by hand: its section');
    expect(chip).toHaveAttribute('title', 'A manager set its section after the menu was read. Nothing more is needed.');
    expect(screen.getByTestId('menu-row')).not.toHaveTextContent(/flagged/i);
  });

  it('a menu of drinks only shows no kitchen group', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mount();
    await screen.findAllByTestId('menu-row');
    expect(screen.queryByTestId('menu-kitchen')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-standing')).toHaveTextContent('1 drink on the current menu.');
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

describe('MenuNext — add, prices as typed (r28 G7)', () => {
  it('sends a decimal-comma price as typed, in a text box, never through Number()', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({} as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    const glass = screen.getByLabelText('Glass');
    const bottle = screen.getByLabelText('Bottle');
    expect(glass).not.toHaveAttribute('type', 'number');
    expect(bottle).not.toHaveAttribute('type', 'number');
    expect(glass).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(glass, { target: { value: '45,50' } });
    fireEvent.change(bottle, { target: { value: ' 1.250,00 ' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const sent = mockAdd.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(sent).toMatchObject({ name: 'Barolo', by_glass_typed: '45,50', bottle_typed: '1.250,00' });
    expect(sent).not.toHaveProperty('by_glass_price');
    expect(sent).not.toHaveProperty('bottle_price');
  });

  it('sends no price at all when the boxes are empty', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({} as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    fireEvent.change(screen.getByLabelText('Glass'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const sent = mockAdd.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(sent.by_glass_typed).toBeUndefined();
    expect(sent.bottle_typed).toBeUndefined();
  });

  it("shows the gateway's refusal and keeps what was typed", async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    // The gateway's 400, as axios rejects it: the sentence is in the body, the
    // message is only the status.
    mockAdd.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { message: 'The bottle price "1.250" is not a price: it could be 1250 or 1.25. Nothing was added.' } },
      }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Barolo' } });
    fireEvent.change(screen.getByLabelText('Bottle'), { target: { value: '1.250' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could be 1250 or 1.25/));
    expect(screen.getByLabelText('Bottle')).toHaveValue('1.250');
  });
});

describe('MenuNext — discard', () => {
  afterEach(() => {
    role = 'manager';
  });

  it('offers staff no discard: taking a line off the menu is an owner\'s or a manager\'s (ADR 0358 D2)', async () => {
    role = 'staff';
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

// Menu r21: the page could add and discard a line, never change its price.
describe('MenuNext — a price changes on its line', () => {
  const chianti = () => line({ id: 'w1', name: 'Chianti', category: 'red', by_glass_price: 12, bottle_price: 48, inventory_item_id: 'inv-1', kitchen_line: false });

  async function openEditor(name: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Change the price of ${name}` }));
  }

  it('a manager changes the bottle price; the menu is read again and the answer names the house price', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mockReview.mockResolvedValue({ menuItemId: 'w1', fieldName: 'bottle_price', newValue: '45.5', priceSync: 'changed', priceSyncError: null, priceHeld: [] });
    mount();
    await openEditor('Chianti');
    fireEvent.change(screen.getByLabelText('Bottle price of Chianti'), { target: { value: '45,50' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    const note = await screen.findByTestId('menu-price-note');
    expect(mockReview).toHaveBeenCalledTimes(1);
    expect(mockReview).toHaveBeenCalledWith('w1', 'bottle_price', '45,50');
    expect(note).toHaveAttribute('role', 'status');
    expect(note.textContent).toMatch(/^Chianti: the bottle price is now .*45\.50 on the menu, and the house's own bottle price is .*45\.50 too\.$/);
    await waitFor(() => expect(mockGetMenu).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('menu-price-save')).not.toBeInTheDocument();
  });

  it('the boxes open in the house form: a lira house reads "48,00", never "48" or "48.5" (r23 walk)', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [{ ...chianti(), by_glass_price: 12.5 }] }));
    mount();
    await screen.findAllByTestId('menu-row');
    // The row prints the lira first, so the house's money is read before the box opens.
    await waitFor(() => expect(screen.getAllByTestId('menu-row')[0].textContent).toMatch(/TRY|₺/));
    await openEditor('Chianti');
    expect(screen.getByLabelText('Bottle price of Chianti')).toHaveValue('48,00');
    expect(screen.getByLabelText('Glass price of Chianti')).toHaveValue('12,50');
    // Opened and saved untouched, the house form is the price it had: nothing is sent.
    fireEvent.click(screen.getByTestId('menu-price-save'));
    expect(await screen.findByTestId('menu-price-note')).toHaveTextContent('Chianti: no price was changed.');
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('a pound house opens its boxes the English way', async () => {
    mockCurrency.mockResolvedValue(currency({ code: 'GBP', country: 'United Kingdom' }));
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mount();
    await screen.findAllByTestId('menu-row');
    await waitFor(() => expect(screen.getAllByTestId('menu-row')[0].textContent).toMatch(/£/));
    await openEditor('Chianti');
    expect(screen.getByLabelText('Bottle price of Chianti')).toHaveValue('48.00');
  });

  it('an empty box or an unchanged one sends nothing for that price', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mount();
    await openEditor('Chianti');
    fireEvent.change(screen.getByLabelText('Glass price of Chianti'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    expect(await screen.findByTestId('menu-price-note')).toHaveTextContent('Chianti: no price was changed.');
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('a locked price is said as locked, never as changed', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mockReview.mockResolvedValue({
      menuItemId: 'w1', fieldName: 'by_glass_price', newValue: '14', priceSync: 'locked', priceSyncError: null,
      priceHeld: [{ kind: 'glass', lockId: 'L1', lockedPrice: 12, lockedBy: 'u1', lockedAt: '2026-11-01T10:00:00Z' }],
    });
    mount();
    await openEditor('Chianti');
    fireEvent.change(screen.getByLabelText('Glass price of Chianti'), { target: { value: '14' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    const note = await screen.findByTestId('menu-price-note');
    expect(note.textContent).toMatch(/the glass price is now .*14\.00 on the menu, but the house's glass price is locked at .*12\.00, so it was not changed/);
    expect(note.textContent).not.toMatch(/too\./);
  });

  it('a refused price keeps the boxes open and says the gateway\'s reason', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mockReview.mockRejectedValue({ response: { status: 400, data: { message: '"1,250" is not a price: it could be 1250 or 1.25; write it as 1250 or 1.25. Nothing was changed.' } } });
    mount();
    await openEditor('Chianti');
    fireEvent.change(screen.getByLabelText('Bottle price of Chianti'), { target: { value: '1,250' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    const note = await screen.findByTestId('menu-price-note');
    expect(note).toHaveAttribute('role', 'alert');
    expect(note).toHaveTextContent('the bottle price was not changed ("1,250" is not a price: it could be 1250 or 1.25');
    expect(screen.getByTestId('menu-price-save')).toBeInTheDocument();
    expect(mockGetMenu).toHaveBeenCalledTimes(1);
  });

  it('a dish says it has no house price', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'k1', name: 'Tiramisu', category: 'dessert', by_glass_price: null, bottle_price: 9, kitchen_line: true })] }));
    mockReview.mockResolvedValue({ menuItemId: 'k1', fieldName: 'bottle_price', newValue: '11', priceSync: 'kitchen_line', priceSyncError: null, priceHeld: [] });
    mount();
    await openEditor('Tiramisu');
    fireEvent.change(screen.getByLabelText('Price of Tiramisu'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    const note = await screen.findByTestId('menu-price-note');
    expect(note.textContent).toMatch(/^Tiramisu: the price is now .*11\.00 on the menu\. A dish has no house price and no stock, so nothing else changed\.$/);
  });

  // r26 (r24 walk): Enter in a price box did not save; the boxes are in two
  // table cells, not a form. Enter saves, Escape puts back and closes.
  it('Enter in a price box saves what the boxes hold, as the Save button does', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mockReview.mockResolvedValue({ menuItemId: 'w1', fieldName: 'bottle_price', newValue: '45.5', priceSync: 'changed', priceSyncError: null, priceHeld: [] });
    mount();
    await openEditor('Chianti');
    const box = screen.getByLabelText('Bottle price of Chianti');
    fireEvent.change(box, { target: { value: '45,50' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByTestId('menu-price-note');
    expect(mockReview).toHaveBeenCalledTimes(1);
    expect(mockReview).toHaveBeenCalledWith('w1', 'bottle_price', '45,50');
  });

  it('a second Enter while the first is saving sends nothing more', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    let settle: (v: Awaited<ReturnType<typeof mockReview>>) => void = () => {};
    mockReview.mockReturnValue(new Promise((r) => { settle = r; }));
    mount();
    await openEditor('Chianti');
    const box = screen.getByLabelText('Bottle price of Chianti');
    fireEvent.change(box, { target: { value: '50' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('menu-price-save')).toBeDisabled());
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(mockReview).toHaveBeenCalledTimes(1);
    settle({ menuItemId: 'w1', fieldName: 'bottle_price', newValue: '50', priceSync: 'changed', priceSyncError: null, priceHeld: [] });
    await screen.findByTestId('menu-price-note');
  });

  it('Enter while an input method is still composing is the method\'s, not a save', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mount();
    await openEditor('Chianti');
    const box = screen.getByLabelText('Bottle price of Chianti');
    fireEvent.change(box, { target: { value: '50' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(mockReview).not.toHaveBeenCalled();
    expect(screen.getByTestId('menu-price-save')).toBeInTheDocument();
  });

  it('Escape closes the boxes, sends nothing, and the next open starts from the stored price', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mount();
    await openEditor('Chianti');
    const box = screen.getByLabelText('Bottle price of Chianti');
    fireEvent.change(box, { target: { value: '99' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByTestId('menu-price-save')).not.toBeInTheDocument();
    expect(mockReview).not.toHaveBeenCalled();
    await openEditor('Chianti');
    expect(screen.getByLabelText('Bottle price of Chianti')).not.toHaveValue('99');
  });

  it('opening puts the cursor in the first box; Escape gives it back to "Change price"', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mount();
    await openEditor('Chianti');
    const glass = screen.getByLabelText('Glass price of Chianti');
    expect(glass).toHaveFocus();
    fireEvent.keyDown(glass, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Change the price of Chianti' })).toHaveFocus();
  });

  // r21 production-build walk: staff were handed Glass/Bottle boxes on the
  // add form, and a priced add came back "Request failed with status code 403".
  it('staff add a line with no price boxes, and are told it stands unpriced', async () => {
    role = 'staff';
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({} as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Raki' } });
    expect(screen.queryByLabelText('Glass')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Bottle')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-add-unpriced').textContent).toMatch(/no price; an owner or a manager sets it/);
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    // The add form sends a price as typed (r28 G7): staff send neither form.
    const sent = mockAdd.mock.calls[0][1] as { by_glass_price?: number; bottle_price?: number; by_glass_typed?: string; bottle_typed?: string };
    expect(sent.by_glass_price).toBeUndefined();
    expect(sent.bottle_price).toBeUndefined();
    expect(sent.by_glass_typed).toBeUndefined();
    expect(sent.bottle_typed).toBeUndefined();
  });

  it('a price typed before the role became staff is not sent', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockResolvedValue({} as never);
    const view = mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Raki' } });
    fireEvent.change(screen.getByLabelText('Bottle'), { target: { value: '30' } });
    role = 'staff';
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MenuNext />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const sent = mockAdd.mock.calls[0][1] as { bottle_price?: number; bottle_typed?: string };
    expect(sent.bottle_price).toBeUndefined();
    expect(sent.bottle_typed).toBeUndefined();
  });

  it('a manager keeps the price boxes', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mount();
    await screen.findByLabelText('Name');
    expect(screen.getByLabelText('Glass')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-add-unpriced')).not.toBeInTheDocument();
  });

  it('a refused add says the gateway\'s words, not the status', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    const said = 'Only managers and owners can put a price on the current menu: it sets the house\'s own price. Nothing was added.';
    mockAdd.mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { message: said } } }));
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Raki' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(said));
  });

  it('staff are offered no price change', async () => {
    role = 'staff';
    mockGetMenu.mockResolvedValue(menu({ items: [chianti()] }));
    mount();
    await screen.findAllByTestId('menu-row');
    expect(screen.queryByTestId('menu-price-edit')).not.toBeInTheDocument();
  });
});

// r28 G13: the kitchen table reused the drinks head, so a dish's one price sat
// under "Bottle" and Change price opened a Glass and a Bottle box.
describe('MenuNext — a dish has one price (r28 G13)', () => {
  const tiramisu = (over: Partial<MenuLine> = {}) =>
    line({ id: 'k1', name: 'Tiramisu', category: 'Tatlılar', by_glass_price: null, bottle_price: 9, kitchen_line: true, ...over });
  const chianti = () => line({ id: 'w1', name: 'Chianti', category: 'red', by_glass_price: 12, bottle_price: 48, kitchen_line: false });
  const heads = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((h) => h.textContent);

  it('the kitchen table says Price, and the drinks table keeps Glass and Bottle', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [chianti(), tiramisu()] }));
    mount();
    await screen.findAllByTestId('menu-kitchen-row');
    expect(heads(screen.getByRole('table', { name: 'Kitchen lines on the current menu' }))).toEqual([
      'Name', 'Section', 'Price', 'Status', '',
    ]);
    expect(heads(screen.getByRole('table', { name: 'Drinks on the current menu' }))).toEqual([
      'Name', 'Section', 'Producer / region', 'Glass', 'Bottle', 'Status', '',
    ]);
    const dish = screen.getByTestId('menu-kitchen-row');
    expect(within(dish).getAllByRole('cell')).toHaveLength(5);
    await waitFor(() => expect(within(dish).getByTestId('menu-dish-price')).toHaveTextContent(/^(₺|TRY\s?)9[.,]00$/));
    expect(within(dish).queryByTestId('menu-dish-glass-price')).not.toBeInTheDocument();
  });

  it('Change price on a dish opens one Price box, and saves it as the dish\'s price', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [tiramisu()] }));
    mockReview.mockResolvedValue({ menuItemId: 'k1', fieldName: 'bottle_price', newValue: '11', priceSync: 'kitchen_line', priceSyncError: null, priceHeld: [] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Change the price of Tiramisu' }));
    const dish = screen.getByTestId('menu-kitchen-row');
    expect(within(dish).getAllByRole('textbox')).toHaveLength(1);
    const box = within(dish).getByLabelText('Price of Tiramisu') as HTMLInputElement;
    expect(box).toHaveFocus();
    // r33 walk: the price it holds is selected, so what is typed replaces it.
    expect(box.value).not.toBe('');
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
    expect(within(dish).queryByLabelText(/Glass/)).not.toBeInTheDocument();
    expect(within(dish).queryByLabelText(/Bottle/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('k1', 'bottle_price', '11'));
    expect(mockReview).toHaveBeenCalledTimes(1);
  });

  it('a dish set by hand says "its price" on its line, a drink keeps "its bottle price" (r33 walk)', async () => {
    const hand = { status: 'flagged', flag_reason: 'corrected', flag_field: 'bottle_price' } as Partial<MenuLine>;
    mockGetMenu.mockResolvedValue(menu({ items: [line({ ...chianti(), ...hand }), tiramisu(hand)] }));
    mount();
    const dish = await screen.findByTestId('menu-kitchen-row');
    expect(within(dish).getByTestId('menu-line-status')).toHaveTextContent(/^set by hand: its price$/);
    expect(within(screen.getByTestId('menu-row')).getByTestId('menu-line-status')).toHaveTextContent(/^set by hand: its bottle price$/);
  });

  it('a dish that holds a glass-column price still shows it, and its box, named apart', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [tiramisu({ by_glass_price: 4 })] }));
    mockReview.mockResolvedValue({ menuItemId: 'k1', fieldName: 'by_glass_price', newValue: '5', priceSync: 'kitchen_line', priceSyncError: null, priceHeld: [] });
    mount();
    const dish = await screen.findByTestId('menu-kitchen-row');
    await waitFor(() => expect(within(dish).getByTestId('menu-dish-glass-price')).toHaveTextContent(/^and (₺|TRY\s?)4[.,]00 in the glass column$/));
    fireEvent.click(screen.getByRole('button', { name: 'Change the price of Tiramisu' }));
    expect(within(dish).getAllByRole('textbox')).toHaveLength(2);
    fireEvent.change(within(dish).getByLabelText('Glass-column price of Tiramisu'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    const note = await screen.findByTestId('menu-price-note');
    expect(note.textContent).toMatch(/^Tiramisu: the glass-column price is now /);
    expect(mockReview).toHaveBeenCalledWith('k1', 'by_glass_price', '5');
  });

  it('the answer under a dish spans the kitchen table, not the drinks table', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [tiramisu()] }));
    mockReview.mockResolvedValue({ menuItemId: 'k1', fieldName: 'bottle_price', newValue: '11', priceSync: 'kitchen_line', priceSyncError: null, priceHeld: [] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Change the price of Tiramisu' }));
    fireEvent.change(screen.getByLabelText('Price of Tiramisu'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('menu-price-save'));
    const note = await screen.findByTestId('menu-price-note');
    expect(note.closest('td')).toHaveAttribute('colspan', '5');
  });
});

// r28 G15 + G17: a failed discard printed axios's own text, and the footer
// promised guests a menu no guest can open.
describe('MenuNext — discard words (r28 G15, G17)', () => {
  it('a refused discard says who may discard, never "Request failed with status code 403"', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: {} } }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    const said = await screen.findByTestId('menu-discard-refused');
    expect(said).toHaveTextContent('That line was not discarded (only an owner or a manager can discard a line).');
    expect(said).not.toHaveTextContent('status code');
  });

  it('a failed discard says the gateway\'s own sentence', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500, data: { message: 'The menu line could not be read.' } },
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    expect(await screen.findByTestId('menu-discard-refused')).toHaveTextContent(
      'That line was not discarded (The menu line could not be read.).',
    );
  });

  it('the footer says what Discard does, and promises no guest-facing menu', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mount();
    await screen.findAllByTestId('menu-row');
    const foot = document.querySelector('footer') as HTMLElement;
    expect(foot).toHaveTextContent('Discard takes a line off the current menu.');
    expect(foot).not.toHaveTextContent(/guest/i);
    expect(foot).toHaveTextContent("a dish's one price");
  });
});

// r28 G20: a house with two menus marked current got an error for the whole page.
describe('MenuNext — more than one menu marked current (r28 G20)', () => {
  it('says how many more are marked current, which one the page shows, and how to settle it', async () => {
    mockGetMenu.mockResolvedValue(menu({ otherCurrent: 1 }));
    mount();
    const note = await screen.findByTestId('menu-other-current');
    expect(note).toHaveTextContent(
      '1 other menu is also marked current at this house, from before choosing a menu set the others aside. This page shows the one made current last. Open the one you sell from under Menus kept and make it current: the others are set aside, and nothing is deleted.',
    );
    expect(screen.getAllByTestId('menu-row')).toHaveLength(1);
  });

  it('counts two or more in the plural, and says nothing when there is one', async () => {
    mockGetMenu.mockResolvedValue(menu({ otherCurrent: 2 }));
    const { unmount } = mount();
    expect(await screen.findByTestId('menu-other-current')).toHaveTextContent(/^2 other menus are also marked current/);
    unmount();
    mockGetMenu.mockResolvedValue(menu());
    mount();
    await screen.findAllByTestId('menu-row');
    expect(screen.queryByTestId('menu-other-current')).not.toBeInTheDocument();
  });
});

// r28 G11: the house's own price beside the printed one, when they differ.
describe("MenuNext — the house's own price beside the menu's (r28 G11)", () => {
  it("says the house's price in house money under a line whose price differs, and nothing under one that matches", async () => {
    mockGetMenu.mockResolvedValue(
      menu({
        items: [
          line({ id: 'l1', name: 'Chianti', category: 'Red', by_glass_price: 12, bottle_price: 48, inventory_item_id: 'inv-1', house_price: { bottle: 1250, glass: 12, removed: false } }),
          line({ id: 'l2', name: 'Barolo', category: 'Red', by_glass_price: null, bottle_price: 90, inventory_item_id: 'inv-2', house_price: { bottle: 90, glass: null, removed: false } }),
        ],
      }),
    );
    mount();
    const notes = await screen.findAllByTestId('menu-house-price');
    expect(notes).toHaveLength(1);
    // House money, through the one formatter (this test runtime's ICU may write "TRY 1,250.00").
    await waitFor(() =>
      expect(notes[0].textContent).toBe(`The house's own price on Inventory (Your price) is not the menu's: bottle ${formatMoney(1250, 'TRY')}.`),
    );
    expect(notes[0].textContent).not.toContain('1250.00');
    expect(notes[0].closest('tr')).toHaveTextContent('Chianti');
  });

  it('hides the note while the line is being re-priced', async () => {
    mockGetMenu.mockResolvedValue(
      menu({ items: [line({ id: 'l1', name: 'Chianti', category: 'Red', bottle_price: 48, inventory_item_id: 'inv-1', house_price: { bottle: 55, glass: null, removed: false } })] }),
    );
    mount();
    await screen.findByTestId('menu-house-price');
    fireEvent.click(screen.getByTestId('menu-price-edit'));
    expect(screen.queryByTestId('menu-house-price')).not.toBeInTheDocument();
  });

  it('says once when the house prices could not be read', async () => {
    mockGetMenu.mockResolvedValue(menu({ housePricesUnreadable: "the house's own prices could not be read: pooler timeout" }));
    mount();
    expect(await screen.findByTestId('menu-house-prices-unreadable')).toHaveTextContent(
      "The house's own prices on Inventory could not be read (pooler timeout), so no line below says whether Inventory holds another price.",
    );
  });
});
