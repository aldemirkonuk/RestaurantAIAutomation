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
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MenuNext from './MenuNext';
import { housePriceNote } from './menu-price-note';
import { getMenu, discardMenuItem, addMenuItem, getMenuSheet, listMenuVersions, reviewMenuItem, type ActiveMenu, type MenuLine } from '../../../services/api/menus';
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
    getMenuSheet: vi.fn(),
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
const mockVersions = vi.mocked(listMenuVersions);
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

  it('an unreachable gateway is said in words, never the transport\'s "Network Error", on the menu and on the kept menus', async () => {
    mockGetMenu.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    mockVersions.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    mount();
    const err = await screen.findByTestId('menu-error');
    expect(err).toHaveTextContent('The menu could not be read (Mudavym could not be reached just now.).');
    const kept = await screen.findByTestId('menu-versions-error');
    expect(kept).toHaveTextContent('could not be read: Mudavym could not be reached just now.');
    expect(err.textContent).not.toContain('Network Error');
    expect(kept.textContent).not.toContain('Network Error');
  });

  it('names the current menu the way the kept list names it, never by the gateway\'s stored name (r104 menu-7, F4)', async () => {
    mockGetMenu.mockResolvedValue(menu({ menuId: 'm1', name: 'Menu from a spreadsheet, 2026-11' }));
    mockVersions.mockResolvedValue({
      current: null,
      lastUsed: null,
      timezone: 'UTC',
      versions: [
        {
          menuId: 'm1', name: 'Menu from a spreadsheet, 2026-11', status: 'active', current: true,
          cadence: 'monthly', menuDate: '2026-11', menuDatePrecision: 'month', sourceMethod: 'csv',
          source: { kept: false, mime: null, bytes: null, failure: null }, linesExtracted: 1, readWarnings: null,
          readState: 'done', readFailure: null, extractedAt: '2026-11-02T10:00:00Z', extractedBy: null,
          madeCurrentAt: null, madeCurrentBy: null, retiredAt: null, retiredBy: null, createdAt: null,
        },
      ],
    });
    mount();
    const standing = await screen.findByText(/on the 2026-11 menu \(monthly\)\./);
    expect(standing).toBeInTheDocument();
    expect(screen.queryByText(/Menu from a spreadsheet/)).not.toBeInTheDocument();
  });

  it('says a failed read plainly, never as an empty menu', async () => {
    mockGetMenu.mockRejectedValue(new Error('ECONNREFUSED'));
    mount();
    const err = await screen.findByTestId('menu-error');
    expect(err).toHaveTextContent('ECONNREFUSED');
    expect(screen.queryByTestId('menu-row')).not.toBeInTheDocument();
  });

  it("says the gateway's own sentence for a failed read, with Retry, and Retry reads again", async () => {
    const said = "The current menu could not be read just now. Try again (statement timeout).";
    mockGetMenu.mockRejectedValueOnce({ response: { status: 500, data: { statusCode: 500, message: said } } });
    mockGetMenu.mockResolvedValue(menu({ items: [line({ name: 'Raki' })] }));
    mount();
    const err = await screen.findByTestId('menu-error');
    expect(err).toHaveTextContent(said);
    expect(err).not.toHaveTextContent('Internal server error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByTestId('menu-row')).toHaveLength(1);
    expect(screen.queryByTestId('menu-error')).not.toBeInTheDocument();
  });

  it('Retry reads the kept menus again too, so their could-not-be-read sentence clears with the menu', async () => {
    mockGetMenu.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockGetMenu.mockResolvedValue(menu());
    mockVersions.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mount();
    await screen.findByTestId('menu-error');
    expect(await screen.findByTestId('menu-versions-error')).toBeInTheDocument();
    // One Retry on the page while both reads failed, not one per panel (r103 menu-3).
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(screen.queryByTestId('menu-versions-retry')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByTestId('menu-row')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('menu-versions-error')).not.toBeInTheDocument());
    expect(await screen.findByTestId('menu-versions-standing')).toBeInTheDocument();
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

  it('a failed add on an unreachable gateway says so in words', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [] }));
    mockAdd.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Tea' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to menu/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Mudavym could not be reached just now.'));
    expect(screen.getByRole('alert').textContent).not.toContain('Network Error');
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

  // r104 walk w-menu: the page's header said 3 lines while the kept list still said 4 for the same menu.
  it('reads the kept list again after a discard, so its line count follows the page', async () => {
    mockGetMenu.mockResolvedValue(menu({ menuId: 'm1', items: [line({ id: 'l9', name: 'Raki' }), line({ id: 'l8', name: 'Efes' })] }));
    mockDiscard.mockResolvedValue(undefined as never);
    mockVersions.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockVersions.mockClear();
    mount();
    const discardRaki = await screen.findByRole('button', { name: 'Discard Raki' });
    await waitFor(() => expect(mockVersions).toHaveBeenCalledTimes(1));
    fireEvent.click(discardRaki);
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('r1', 'l9'));
    await waitFor(() => expect(mockVersions).toHaveBeenCalledTimes(2));
  });

  it('discards on click, and reports a failure without pretending the line is gone', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockRejectedValue(new Error('no reason given'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('r1', 'l9'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not discarded');
  });

  it("says the gateway's sentence for a failed discard and offers Retry, which discards the same line again", async () => {
    const said = 'The menu line could not be discarded just now. It is still on the menu and nothing was changed. Try again (connection reset).';
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'l9', name: 'Raki' })] }));
    mockDiscard.mockRejectedValueOnce({ response: { status: 500, data: { statusCode: 500, message: said } } });
    mockDiscard.mockResolvedValue({ menuItemId: 'l9', status: 'discarded' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    const err = await screen.findByTestId('menu-discard-error');
    expect(err).toHaveTextContent(said);
    expect(err).not.toHaveTextContent('Internal server error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledTimes(2));
    expect(mockDiscard).toHaveBeenLastCalledWith('r1', 'l9');
    await waitFor(() => expect(screen.queryByTestId('menu-discard-error')).not.toBeInTheDocument());
  });
});

// r102 menu-motion-4: a row dims while its discard is pending, goes at once on success,
// and a line that turns up later inks in (DD-r103-7).
describe('MenuNext — rows move, they do not jump (r102 menu-motion-4)', () => {
  const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

  it('a pending discard dims the row and takes its pointer', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'a', name: 'Raki' })] }));
    mockDiscard.mockReturnValue(new Promise(() => {}));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    await waitFor(() => expect(rowOf('Raki')).toHaveAttribute('data-state', 'pending'));
  });

  it('a discarded row goes at once, with no fade state and no wait on the refetch', async () => {
    mockGetMenu.mockResolvedValueOnce(menu({ items: [line({ id: 'a', name: 'Raki' }), line({ id: 'b', name: 'Tea' })] }));
    // The confirming read is slow: the row must already be gone before it answers.
    mockGetMenu.mockReturnValue(new Promise(() => {}));
    mockDiscard.mockResolvedValue(undefined as never);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Raki' }));
    await waitFor(() => expect(screen.queryByText('Raki')).not.toBeInTheDocument());
    expect(screen.getByText('Tea')).toBeInTheDocument();
    expect(document.querySelector('[data-state="leaving"]')).toBeNull();
  });

  it('the first list animates nothing; a line that arrives later is new', async () => {
    mockGetMenu.mockResolvedValueOnce(menu({ items: [line({ id: 'a', name: 'Raki' }), line({ id: 'b', name: 'Tea' })] }));
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'b', name: 'Tea' }), line({ id: 'c', name: 'Salep' })] }));
    mockDiscard.mockResolvedValue(undefined as never);
    mount();
    await screen.findByText('Raki');
    expect(rowOf('Raki')).not.toHaveAttribute('data-new');
    fireEvent.click(screen.getByRole('button', { name: 'Discard Raki' }));
    await screen.findByText('Salep');
    expect(rowOf('Salep')).toHaveAttribute('data-new', 'true');
    expect(rowOf('Tea')).not.toHaveAttribute('data-new');
  });

  it('under reduced motion a discarded row goes at once, with no fade state', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as never;
    try {
      mockGetMenu.mockResolvedValueOnce(menu({ items: [line({ id: 'a', name: 'Raki' })] }));
      mockGetMenu.mockResolvedValue(menu({ items: [] }));
      mockDiscard.mockResolvedValue(undefined as never);
      const seen = new Set<string | null>();
      const watch = new MutationObserver(() => {
        const tr = document.querySelector('[data-testid="menu-row"]');
        if (tr) seen.add(tr.getAttribute('data-state'));
      });
      mount();
      await screen.findByText('Raki');
      watch.observe(document.body, { attributes: true, subtree: true, childList: true });
      fireEvent.click(screen.getByRole('button', { name: 'Discard Raki' }));
      await waitFor(() => expect(screen.queryByText('Raki')).not.toBeInTheDocument());
      watch.disconnect();
      expect(seen.has('leaving')).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('the stylesheet dims 160 ms and inks a new line in 160 ms: no enter, no wash, no exit hold; reduced motion has none', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'menu-rows.css'), 'utf8');
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/\.mdv-row\s*\{[^}]*opacity 160ms/);
    expect(code).toMatch(/mdv-row-ink 160ms/);
    expect(code).not.toMatch(/mdv-row-enter|mdv-row-wash|seal-tint|240ms|600ms|data-state='leaving'/);
    expect(code).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation: none/);
  });
});

// r103 menu-7 (walk F2): the room of the current menu's table is held while it is read.
describe('MenuNext — the table\'s room is held while it is read (r103 menu-7)', () => {
  afterEach(() => window.localStorage.clear());

  it('holds 287 px for the 4 lines it assumes, 63 for the head and 56 a line', async () => {
    const { reservedFor } = await import('./MenuNext');
    expect(reservedFor(4)).toBe(287);
    expect(reservedFor(0)).toBe(0);
  });

  it('while the menu is read, the box is held at the last count this device saw', async () => {
    window.localStorage.setItem('mdv.menu.lines.r1', '2');
    mockGetMenu.mockReturnValue(new Promise(() => {}));
    mount();
    const held = await screen.findByTestId('menu-reserve');
    expect(held.style.getPropertyValue('--mdv-reserve')).toBe('175px');
    expect(within(held).getByText('Reading the menu…')).toBeInTheDocument();
  });

  it('with no count kept it holds 4 lines, and the count is kept once the menu lands', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ id: 'a', name: 'Raki' }), line({ id: 'b', name: 'Tea' }), line({ id: 'c', name: 'Salep' })] }));
    mount();
    expect(screen.getByTestId('menu-reserve').style.getPropertyValue('--mdv-reserve')).toBe('287px');
    await screen.findAllByTestId('menu-row');
    await waitFor(() => expect(window.localStorage.getItem('mdv.menu.lines.r1')).toBe('3'));
  });

  // r104 menu-g4 (r103 F8): a house with no current menu held the room while reading and gave it all back.
  it('a house with no current menu keeps the room it held while reading (cold device: 4 lines)', async () => {
    mockGetMenu.mockResolvedValue(menu({ menuId: null, items: [] }));
    mount();
    const held = (await screen.findByTestId('menu-no-active-reserve')) as HTMLElement;
    expect(held.style.getPropertyValue('--mdv-reserve')).toBe('287px');
    expect(within(held).getByTestId('menu-no-active')).toBeInTheDocument();
  });

  // r104 walk w-menu: the count was read again on every render, so the 0 the page stored for a
  // no-current house took the room away at the next render (CLS 0.11 at 1440 px, cold device).
  it('keeps the room it held through a later render, though the page has stored a 0 by then', async () => {
    mockGetMenu.mockResolvedValue(menu({ menuId: null, items: [] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={qc}>
        <MenuNext />
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    await screen.findByTestId('menu-no-active-reserve');
    await waitFor(() => expect(window.localStorage.getItem('mdv.menu.lines.r1')).toBe('0'));
    rerender(tree());
    expect(screen.getByTestId('menu-no-active-reserve').style.getPropertyValue('--mdv-reserve')).toBe('287px');
  });

  it('holds the stored count\'s room for it, and nothing when the stored count is 0', async () => {
    window.localStorage.setItem('mdv.menu.lines.r1', '2');
    mockGetMenu.mockResolvedValue(menu({ menuId: null, items: [] }));
    const a = mount();
    expect((await screen.findByTestId('menu-no-active-reserve')).style.getPropertyValue('--mdv-reserve')).toBe('175px');
    a.unmount();
    window.localStorage.setItem('mdv.menu.lines.r1', '0');
    mount();
    expect((await screen.findByTestId('menu-no-active-reserve')).style.getPropertyValue('--mdv-reserve')).toBe('0px');
  });

  it('is held on desktop only, where the jump was measured', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'menu-rows.css'), 'utf8');
    expect(css).toMatch(/@media \(min-width: 900px\)\s*\{\s*\.mdv-reserve\s*\{\s*min-height: var\(--mdv-reserve/);
  });
});

describe('MenuNext — a newer menu is due (menu r104 g1)', () => {
  afterEach(() => {
    role = 'manager';
  });
  const dueReply = (state: 'ok' | 'due' | 'overdue') => ({
    current: null,
    lastUsed: null,
    versions: [],
    due: { state, cadence: 'monthly' as const, daysSince: 35 },
  });

  it('says it, under the standing line, to an owner and a manager', async () => {
    for (const r of ['owner', 'manager']) {
      role = r;
      mockGetMenu.mockResolvedValue(menu());
      mockVersions.mockResolvedValue(dueReply('due') as never);
      const { unmount } = mount();
      const said = await screen.findByTestId('menu-due');
      expect(said).toHaveTextContent('This menu was made current 5 weeks ago and you keep it monthly, so a newer one is due.');
      expect(screen.getByRole('button', { name: 'Read the new one below.' })).toBeInTheDocument();
      unmount();
    }
  });

  it('tells overdue from due, in words (DD-r108-17)', async () => {
    mockGetMenu.mockResolvedValue(menu());
    mockVersions.mockResolvedValue(dueReply('overdue') as never);
    mount();
    const said = await screen.findByTestId('menu-due');
    expect(said).toHaveTextContent('This menu was made current 5 weeks ago and you keep it monthly, so a newer one is overdue.');
    expect(said).not.toHaveTextContent(/is due\./);
  });

  it('says nothing to staff, and nothing while the menu is not yet due', async () => {
    role = 'staff';
    mockGetMenu.mockResolvedValue(menu());
    mockVersions.mockResolvedValue(dueReply('due') as never);
    const a = mount();
    await screen.findByTestId('menu-versions-standing');
    expect(screen.queryByTestId('menu-due')).not.toBeInTheDocument();
    a.unmount();

    role = 'manager';
    mockVersions.mockResolvedValue(dueReply('ok') as never);
    mount();
    await screen.findByTestId('menu-versions-standing');
    expect(screen.queryByTestId('menu-due')).not.toBeInTheDocument();
  });
});

describe('MenuNext — the menu as a sheet (menu r104 g3)', () => {
  afterEach(() => {
    role = 'manager';
  });

  it('offers an owner or a manager the sheet, and saves what the gateway sends', async () => {
    mockGetMenu.mockResolvedValue(menu());
    vi.mocked(getMenuSheet).mockResolvedValue('name\r\nRaki\r\n');
    const create = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Download this menu as a sheet' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(getMenuSheet).toHaveBeenCalledWith('export');
    expect(create).toHaveBeenCalled();
    expect(screen.getByTestId('menu-sample')).toHaveTextContent('Sample sheet');
    click.mockRestore();
  });

  it('offers staff neither the sheet nor the sample', async () => {
    role = 'staff';
    mockGetMenu.mockResolvedValue(menu());
    mount();
    await screen.findByTestId('menu-versions-standing');
    expect(screen.queryByRole('button', { name: 'Download this menu as a sheet' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-sample')).not.toBeInTheDocument();
  });

  it('says so when the sheet could not be had, with the gateway\'s words', async () => {
    mockGetMenu.mockResolvedValue(menu());
    vi.mocked(getMenuSheet).mockRejectedValue({ response: { data: { message: 'There is no current menu to download yet.' } } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Download this menu as a sheet' }));
    expect(await screen.findByTestId('menu-export-error')).toHaveTextContent('There is no current menu to download yet.');
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
    fireEvent.change(screen.getByLabelText('Bottle price of Tiramisu'), { target: { value: '11' } });
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
    const sent = mockAdd.mock.calls[0][1] as { by_glass_price?: number; bottle_price?: number };
    expect(sent.by_glass_price).toBeUndefined();
    expect(sent.bottle_price).toBeUndefined();
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
    expect((mockAdd.mock.calls[0][1] as { bottle_price?: number }).bottle_price).toBeUndefined();
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

// r106 menu-3 (walk r105 finding 2): at 375 px the lines table was 703 wide in a 341 box, with
// Change price and Discard off-screen. Below 600 px each line is a stacked card, its actions 44 px.
describe('MenuNext — a narrow screen gets cards, not a table to scroll (r106 menu-3)', () => {
  it('marks the lines table and its action cell as cards, with the actions in one cell', async () => {
    mockGetMenu.mockResolvedValue(menu({ items: [line({ name: 'Raki' })] }));
    mount();
    const row = (await screen.findAllByTestId('menu-row'))[0];
    expect(row.closest('table')).toHaveClass('mdv-cards');
    const acts = row.querySelector('td.mdv-acts');
    expect(acts).not.toBeNull();
    expect(within(acts as HTMLElement).getByRole('button', { name: 'Discard Raki' })).toBeInTheDocument();
    expect(row.querySelector('td[data-label="Bottle"]')).not.toBeNull();
  });

  it('the narrow rule gives every action 44 px and adds no animation or transition', async () => {
    const css = readFileSync('src/pages/menu/next/menu-rows.css', 'utf8');
    const narrow = css.slice(css.indexOf('@media (max-width: 599px)'));
    expect(narrow).toContain('min-height: 44px');
    expect(narrow).toContain('.mdv-cards .mdv-acts');
    expect(narrow).not.toMatch(/animation|transition/);
  });
});
