/**
 * The opened row (INV-W4): formless, Write off only for owners and managers,
 * and Order more goes through /cellar's own OrderCeremony.
 *
 * The row's reads (ledger purchases, paper, lots, the till record) are
 * stubbed; the sheets and the ceremony stub are real mounts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cellMoney, EM, toRow, type InvRow } from './useInventoryNextData';
import { shortDate } from '../../cellar/next/cellar-format';
import type { Provider } from '../../../services/api/providers';

// Per-test overrides for the stubbed reads (INV-W8 / INV-W9).
const reads = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>,
  record: {} as Record<string, unknown>,
}));

vi.mock('./useInventoryNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowDetail: () => ({
    purchases: [],
    purchasesTotal: 0,
    purchasesError: null,
    paper: new Map(),
    lots: [],
    lotsError: null,
    rereadPurchases: () => {},
    rereadLots: () => {},
    ...reads.detail,
  }),
}));
vi.mock('../../cellar/next/useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRowRecord: () => ({ data: null, loading: false, error: null, ...reads.record }),
  useCellarSettings: () => ({
    data: {
      restaurantId: 'r1',
      holdCeremony: 'hold',
      holdCeremonyConfigured: false,
      gazetteerMeasures: ['bottles'],
      gazetteerMeasuresConfigured: false,
      setBy: null,
      setAt: null,
      readable: true,
      readError: null,
    },
    loading: false,
  }),
}));
vi.mock('../../cellar/next/OrderCeremony', () => ({
  default: ({ label }: { label: string }) => <div data-testid="order-ceremony">{label}</div>,
}));
// The two acts ported from the legacy page call the same API functions it does.
const inv = vi.hoisted(() => ({
  update: vi.fn(),
  reconcile: vi.fn(),
  del: vi.fn(),
  research: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  updateInventoryItem: inv.update,
  reconcileItem: inv.reconcile,
  deleteInventoryItem: inv.del,
  fetchHouseItemResearch: inv.research,
}));
const tableExport = vi.hoisted(() => ({ exportTable: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../lib/tableExport', () => ({ exportTable: tableExport.exportTable }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { success: toasts.success, error: toasts.error, warning: vi.fn(), message: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));

import RowDropdown, { bottleCost, COST_IS_A_MANAGERS, MARGIN_TAX_NOTE, type RowDropdownProps } from './RowDropdown';

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1',
    wineId: 'w1',
    name: 'Gravner Ribolla',
    libraryName: 'Ribolla Gialla Anfora',
    producer: 'Gravner',
    type: 'orange',
    kind: 'wine',
    vintage: 2016,
    grape: 'Ribolla Gialla',
    bottleSizeMl: 750,
    stock: 3,
    shadow: 2,
    par: 6,
    reorderPoint: null,
    analyticsReadable: true,
    velocity: 1,
    runway: 3,
    daysSinceSale: 1,
    deadStock: false,
    usageSource: null,
    usageSince: null,
    usageUntil: null,
    usageQty: null,
    bottle: 92,
    glass: 18,
    pourMl: 150,
    wac: 40,
    costProvenance: 'invoice',
    value: 120,
    lastCountedAt: '2026-09-30T10:00:00Z',
    openMl: 0,
    zones: [{ locationId: 'z1', qty: 3 }],
    providerId: 'p1',
    providerName: 'Vinoteca',
    standing: 'below',
    active: true,
    ...over,
  };
}

const PROVIDERS = [{ id: 'p1', name: 'Vinoteca' }] as unknown as Provider[];

function renderDrop(over: Partial<RowDropdownProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: RowDropdownProps = {
    row: row(),
    canManage: true,
    currency: { state: 'recorded', code: 'EUR' },
    zoneName: (id) => (id === 'z1' ? 'Cave' : 'Unassigned'),
    locations: [],
    locationsUnavailable: false,
    providers: PROVIDERS,
    providersError: null,
    restaurantId: 'r1',
    ...over,
  };
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RowDropdown {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RowDropdown', () => {
  it('is formless: no input, textarea or select in the opened row', () => {
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.querySelectorAll('input, textarea, select').length).toBe(0);
    expect(within(drop).getByText('Where the count comes from')).toBeTruthy();
    expect(within(drop).getByText('How fast it pours')).toBeTruthy();
    expect(within(drop).getByText('What it has cost')).toBeTruthy();
  });

  it('carries no Name and no Pin button', () => {
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(within(drop).queryByRole('button', { name: /^name/i })).toBeNull();
    expect(within(drop).queryByRole('button', { name: /pin/i })).toBeNull();
  });

  it('hides Write off from anyone who is not an owner or manager', () => {
    const { unmount } = renderDrop({ canManage: false });
    const actions = screen.getByRole('group', { name: 'What to do with this title' });
    expect(within(actions).queryByRole('button', { name: 'Write off' })).toBeNull();
    expect(within(actions).getByRole('button', { name: 'Record a count' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Order more' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write off' })).toBeNull();
    unmount();
    renderDrop({ canManage: true });
    expect(screen.getByRole('button', { name: 'Write off' })).toBeTruthy();
  });

  it('mounts the cellar OrderCeremony when Order more is pressed', () => {
    renderDrop();
    expect(screen.queryByTestId('order-ceremony')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Order more' }));
    const ceremony = screen.getByTestId('order-ceremony');
    // Par 6 less a stock of 3: three bottles bring it back.
    expect(ceremony.textContent).toBe('Hold to place 3 with Vinoteca');
  });

  it('shows head facts only where they were read', () => {
    renderDrop({ row: row({ grape: null, vintage: null, libraryName: null }) });
    const drop = screen.getByTestId('row-dropdown');
    expect(within(drop).queryByText('Grape')).toBeNull();
    expect(within(drop).queryByText('Vintage')).toBeNull();
    expect(within(drop).queryByText('On the library as')).toBeNull();
    expect(within(drop).getByText('House name')).toBeTruthy();
  });
});

describe('RowDropdown failed reads (INV-W8)', () => {
  beforeEach(() => {
    reads.detail = {};
    reads.record = {};
  });

  it('says a failed receipts read in plain words, with Read again, never the server text', () => {
    const rereadPurchases = vi.fn();
    reads.detail = {
      purchases: null,
      purchasesError: 'limit must not be greater than 500limit must be an integer number',
      rereadPurchases,
    };
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.textContent).toContain('The receipts could not be read. This is unread, not a title never bought.');
    expect(drop.textContent).not.toContain('limit must');
    fireEvent.click(within(drop).getAllByRole('button', { name: 'Read again' })[0]);
    expect(rereadPurchases).toHaveBeenCalledTimes(1);
  });

  it('says failed auction lots in plain words, with Read again', () => {
    const rereadLots = vi.fn();
    reads.detail = { lots: null, lotsError: 'Request failed with status code 500', rereadLots };
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.textContent).not.toContain('status code');
    fireEvent.click(within(drop).getByRole('button', { name: 'Read again' }));
    expect(rereadLots).toHaveBeenCalledTimes(1);
  });

  it('says a failed till read without the server text', () => {
    reads.record = { error: 'Request failed with status code 502' };
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.textContent).toContain('The till could not be read. This is unread, not a quiet night.');
    expect(drop.textContent).not.toContain('status code');
  });
});

describe('RowDropdown pour note (INV-W9)', () => {
  beforeEach(() => {
    reads.detail = {};
    reads.record = {};
  });

  it('with a pace on the books, never says the title was never rung up', () => {
    renderDrop({ row: row({ velocity: 0.3, runway: 15 }) });
    const note = screen.getByTestId('velocity-none');
    expect(note.textContent).toBe(
      'That pace is the last 30 days of sales on the books. The day-by-day chart is not drawn for this title yet.',
    );
    expect(screen.getByTestId('row-dropdown').textContent).not.toMatch(/never rung/i);
  });

  it('with a pace of zero, says there were no sales in 30 days', () => {
    renderDrop({ row: row({ velocity: 0, runway: null }) });
    expect(screen.getByTestId('velocity-none').textContent).toBe(
      'No day-by-day chart either: no sales on the books in the last 30 days.',
    );
  });

  it('with an unreadable till book, says it could not be read', () => {
    reads.record = {
      data: { books: [{ book: 'pos', readable: false, reason: 'relation does not exist', ledger: [] }] },
    };
    renderDrop();
    const note = screen.getByTestId('velocity-none');
    expect(note.textContent).toBe('The till could not be read. This is unread, not a quiet night.');
    expect(note.textContent).not.toContain('relation');
  });

  it('a record answer with no books array does not blank the row', () => {
    reads.record = { data: {} };
    renderDrop();
    expect(screen.getByTestId('row-dropdown')).toBeTruthy();
  });
});

describe('RowDropdown head facts (INV-W13, W16, W17)', () => {
  beforeEach(() => {
    reads.detail = {};
    reads.record = {};
  });

  it('says an unread selling pace in house words, never "the analytics join" (INV-W31)', () => {
    renderDrop({ row: row({ analyticsReadable: false }) });
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.textContent).toContain('Selling pace could not be read — the sales figures did not answer for this read.');
    expect(drop.textContent).not.toContain('join');
  });

  it('says a slow pace with its 30-day count, never "0.0 a day"', () => {
    renderDrop({ row: row({ velocity: 0.033, runway: 330 }) });
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.textContent).toContain('About 0.03 a day (1 sold in the last 30 days); at that pace it lasts 330 days.');
    expect(drop.textContent).not.toContain('0.0 a day');
  });

  it('a good measured by its counts says its use a day, the counts it comes from, and its runway', () => {
    renderDrop({
      row: row({
        velocity: 290,
        runway: 28,
        usageSource: 'counts',
        usageSince: '2026-10-22T09:00:00Z',
        usageUntil: '2026-11-11T09:00:00Z',
        usageQty: 5800,
      }),
      uom: 'g',
      kind: 'food',
    });
    const t = screen.getByTestId('row-dropdown').textContent ?? '';
    expect(t).toContain('About 290 g a day: 5.8 kg used between the counts of 22 Oct 2026 and 11 Nov 2026; at that pace, counting the use since the last count, it lasts 28 days.');
    expect(t).not.toContain('sold in the last 30 days');
  });

  it('a food not yet counted twice says how its use will be measured', () => {
    renderDrop({ row: row({ velocity: 0, runway: null }), uom: 'g', kind: 'food' });
    expect(screen.getByTestId('row-dropdown').textContent).toContain('count it twice, at least 3 days apart');
  });

  it('a good carried 10 days says what it sold in those 10 days, less voids', () => {
    renderDrop({
      row: row({ velocity: 1, runway: 3, usageSource: 'sales', usageSince: '2026-11-02T09:00:00Z', usageUntil: '2026-11-12T09:00:00Z', usageQty: 10 }),
    });
    expect(screen.getByTestId('row-dropdown').textContent).toContain(
      'About 1.0 a day (10 bottles sold in the last 10 days, less voids); at that pace it lasts 3 days.',
    );
  });

  it('says what is left in the open bottle', () => {
    renderDrop({ row: row({ openMl: 150 }) });
    const drop = screen.getByTestId('row-dropdown');
    expect(drop.textContent).toContain('150 ml left');
    expect(drop.textContent).not.toContain('poured from');
  });

  it('says why there is nothing to order to par, and keeps — for an unread stock', () => {
    const toPar = () => {
      const k = within(screen.getByTestId('row-dropdown')).getByText('Suggested to par');
      return k.parentElement!.textContent!.replace('Suggested to par', '').trim();
    };
    const { unmount } = renderDrop({ row: row({ stock: 3, par: 6 }) });
    expect(toPar()).toBe('3');
    unmount();
    const second = renderDrop({ row: row({ stock: 11, par: 5, standing: 'above' }) });
    expect(toPar()).toBe('none, at or above par');
    second.unmount();
    const third = renderDrop({ row: row({ stock: 11, par: null, standing: 'nopar' }) });
    expect(toPar()).toBe('no par set');
    third.unmount();
    renderDrop({ row: row({ stock: null, standing: 'unknown' }) });
    expect(toPar()).toBe('—');
  });
});

describe('RowDropdown counts read with grouped digits, as money does (INV-W33)', () => {
  it('groups par, the suggestion, zones, the open bottle, the 30-day sales and the runway', () => {
    renderDrop({
      row: row({ stock: 0, shadow: 1250, par: 1200, reorderPoint: 1100, openMl: 1500, zones: [{ locationId: 'z1', qty: 1240 }], velocity: 40, runway: 1500 }),
    });
    const t = screen.getByTestId('row-dropdown').textContent ?? '';
    expect(t).toContain('1,200 · 1,100');
    expect(t).toContain('Suggested to par1,200');
    expect(t).toContain('Cave 1,240');
    expect(t).toContain('1,500 ml left');
    expect(t).toContain('(1,200 sold in the last 30 days)');
    expect(t).toContain('it lasts 1,500 days');
  });

  it('groups a purchase line\'s bottles, a day bar\'s and an hour\'s sales, and the lots', () => {
    reads.detail = {
      purchases: [{ id: 'l1', at: '2026-09-20T10:00:00Z', qty: 1240, unitCost: 9, orderId: null }],
      purchasesTotal: 1,
      lots: Array.from({ length: 1000 }, (_, i) => ({ id: `lot${i}`, saleDate: '2026-09-01' })),
    };
    reads.record = { data: { books: [{ book: 'pos', readable: true, ledger: [{ at: '2026-09-29T19:00:00Z', qty: 1240, unitPrice: 10 }] }] } };
    try {
      renderDrop();
      const drop = screen.getByTestId('row-dropdown');
      expect(drop.querySelector('td[data-label="At the door"]')!.textContent).toBe('1,240');
      expect(drop.querySelector('.iv-bars i')!.getAttribute('title')).toBe('29 Sept 2026: 1,240');
      const heat = [...drop.querySelectorAll('.iv-heat-c')].map((c) => c.getAttribute('title') ?? '');
      expect(heat.filter((t) => t.endsWith(' — 1,240'))).toHaveLength(1);
      expect(drop.textContent).toContain('1,000 lots, the latest sold');
    } finally {
      reads.detail = {};
      reads.record = {};
    }
  });
});

describe('RowDropdown says what a title no zone holds reads (INV-W34)', () => {
  const where = () => {
    const dt = within(screen.getByTestId('row-dropdown')).getByText('Where');
    return dt.nextElementSibling!.textContent;
  };

  it('reads "none on hand" for a stock of 0, not a zone', () => {
    renderDrop({ row: row({ stock: 0, zones: [] }) });
    expect(where()).toBe('none on hand');
  });

  it('reads "Unassigned" for bottles on hand that no zone holds', () => {
    renderDrop({ row: row({ stock: 4, zones: [{ locationId: 'z1', qty: 0 }] }) });
    expect(where()).toBe('Unassigned');
  });

  it('shows — when the stock itself was not read, since it cannot say which', () => {
    renderDrop({ row: row({ stock: null, zones: [] }) });
    expect(where()).toBe('—');
  });
});

describe('RowDropdown day bars read dates the way the rest of the page does (INV-W35)', () => {
  it('writes the scale, the chart label and each bar title as "29 Sept 2026", not ISO', () => {
    reads.record = {
      data: {
        books: [
          {
            book: 'pos',
            readable: true,
            ledger: [
              { at: '2026-09-29T19:00:00Z', qty: 2, unitPrice: 10 },
              { at: '2026-09-30T20:00:00Z', qty: 3, unitPrice: 10 },
            ],
          },
        ],
      },
    };
    try {
      renderDrop();
      const drop = screen.getByTestId('row-dropdown');
      const bars = drop.querySelector('.iv-bars')!;
      expect(bars.getAttribute('aria-label')).toBe('Sold per day from 29 Sept 2026 to 30 Sept 2026');
      expect([...bars.querySelectorAll('i')].map((i) => i.getAttribute('title'))).toEqual(['29 Sept 2026: 2', '30 Sept 2026: 3']);
      expect(drop.querySelector('.iv-barscale')!.textContent).toBe('29 Sept 202630 Sept 2026');
      expect(drop.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    } finally {
      reads.record = {};
    }
  });
});

describe('INV-W36: the More menu keeps the menu keys', () => {
  async function openMore() {
    renderDrop();
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.click(more);
    const menu = await screen.findByRole('menu');
    // Keys step over a disabled item (Mark inactive waits while bottles are held).
    const items = (within(menu).getAllByRole('menuitem') as HTMLButtonElement[]).filter((b) => !b.disabled);
    // Wait for the Popover to place focus on the first item (it does so once positioned).
    await act(async () => {
      for (let n = 0; n < 20 && document.activeElement !== items[0]; n += 1) await new Promise((r) => setTimeout(r, 10));
    });
    return { more, menu, items };
  }

  it('ArrowDown and ArrowUp step through the items and wrap', async () => {
    const { items } = await openMore();
    expect(document.activeElement).toBe(items[0]);
    // fireEvent returns false when the handler cancelled the key: an arrow that
    // moved focus must not also scroll the page.
    for (let n = 1; n < items.length; n += 1) {
      expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })).toBe(false);
      expect(document.activeElement).toBe(items[n]);
    }
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })).toBe(false);
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 2]);
  });

  it('Home and End jump to the first and last item', async () => {
    const { items } = await openMore();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('a key the menu does not use is left alone', async () => {
    const { items } = await openMore();
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[0]);
  });

  // The browser's own Tab is not run by jsdom, so these pin what the browser
  // starts from: focus is on More when the keydown returns, and the event is not
  // cancelled. Where the browser then lands was checked live (P6).
  for (const shiftKey of [false, true]) {
    it(`${shiftKey ? 'Shift+Tab' : 'Tab'} hands focus to More before the browser moves it, and closes the menu`, async () => {
      const { more, items } = await openMore();
      const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      let focusWhenTheKeyReturns: Element | null = null;
      await act(async () => {
        // Read inside act, before React re-renders: the Popover's own restore on
        // close would put focus on More anyway, and hide a handler that did not.
        items[0].dispatchEvent(ev);
        focusWhenTheKeyReturns = document.activeElement;
      });
      expect(focusWhenTheKeyReturns).toBe(more);
      expect(ev.defaultPrevented).toBe(false);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(more.getAttribute('aria-expanded')).toBe('false');
    });
  }
});

describe('Ported acts in the More menu: Mark inactive and Remove from inventory', () => {
  beforeEach(() => {
    inv.update.mockReset().mockResolvedValue({});
    inv.reconcile.mockReset().mockResolvedValue({});
    inv.del.mockReset().mockResolvedValue(undefined);
    toasts.success.mockReset();
    toasts.error.mockReset();
  });

  async function menu(over: Partial<RowDropdownProps> = {}) {
    renderDrop(over);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.findByRole('menu');
  }

  it('a food or a good weighed in grams is never offered "Record a pour"; a wine still is', async () => {
    const food = await menu({ uom: 'g', kind: 'food' });
    expect(within(food).queryByRole('menuitem', { name: 'Record a pour' })).toBeNull();
    cleanup();
    const wine = await menu();
    expect(within(wine).getByRole('menuitem', { name: 'Record a pour' })).toBeTruthy();
  });

  // Inventory r28, gap 2: legacy gated neither, and so Remove (which counts a
  // good to zero and soft-deletes it) let staff do what Write off refuses them.
  // Both are now an owner's or a manager's, here and at the gateway.
  it('both acts are reachable from More for a manager, and neither for staff, who are told why', async () => {
    const m = await menu({ canManage: true });
    expect(within(m).getByRole('menuitem', { name: 'Mark inactive' })).toBeTruthy();
    expect(within(m).getByRole('menuitem', { name: 'Remove from inventory' })).toBeTruthy();
    expect(within(m).queryByTestId('remove-is-a-managers')).toBeNull();
    cleanup();
    const s = await menu({ canManage: false, row: row({ active: true, stock: 0, shadow: 0, openMl: 0 }) });
    expect(within(s).queryByRole('menuitem', { name: 'Mark inactive' })).toBeNull();
    expect(within(s).queryByRole('menuitem', { name: 'Remove from inventory' })).toBeNull();
    expect(within(s).getByTestId('remove-is-a-managers').textContent).toBe(
      'Removing a good or marking it inactive is for owners and managers.',
    );
  });

  it('Mark inactive sends the legacy PATCH body to updateInventoryItem for this row and house', async () => {
    const m = await menu({ row: row({ stock: 0, shadow: 0, openMl: 0 }) });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Mark inactive' }));
    });
    expect(inv.update).toHaveBeenCalledWith('i1', { isActive: false }, 'r1');
    expect(toasts.success.mock.calls[0][0]).toMatch(/Gravner Ribolla marked inactive/);
  });

  it('an inactive row offers Mark active, and a row whose state was not sent offers neither', async () => {
    const m = await menu({ row: row({ active: false }) });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Mark active' }));
    });
    expect(inv.update).toHaveBeenCalledWith('i1', { isActive: true }, 'r1');
  });

  it('shows no toggle when the server did not say whether the row is active', async () => {
    const m = await menu({ row: row({ active: null }) });
    expect(within(m).queryByRole('menuitem', { name: /Mark (in)?active/ })).toBeNull();
  });

  it('a refused toggle says nothing changed, in the house words', async () => {
    const { AxiosError } = await import('axios');
    inv.update.mockRejectedValue(
      new AxiosError('Request failed with status code 403', '403', undefined, {}, {
        status: 403,
        data: {},
        statusText: '',
        headers: {},
        config: {} as never,
      }),
    );
    const m = await menu({ row: row({ stock: 0, shadow: 0, openMl: 0 }) });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Mark inactive' }));
    });
    expect(toasts.error.mock.calls[0][0]).toMatch(/^Nothing changed — /);
    expect(toasts.error.mock.calls[0][0]).not.toMatch(/status code/);
  });

  it('Remove opens the shared remove modal, which zeroes the stock and then soft-deletes, as legacy does', async () => {
    const m = await menu();
    fireEvent.click(within(m).getByRole('menuitem', { name: 'Remove from inventory' }));
    const confirm = await screen.findByRole('button', { name: 'Remove wine' });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(inv.reconcile).toHaveBeenCalledWith('i1', expect.objectContaining({ wineId: 'w1', actualCount: 0 }));
    expect(inv.del).toHaveBeenCalledWith('i1');
  });

  it('a good with no library title is removed too: zeroed with no wineId, said in its unit, then soft-deleted', async () => {
    const m = await menu({
      uom: 'g',
      kind: 'food',
      row: row({ wineId: null, name: 'Flour 00', kind: 'food', stock: 2250, shadow: 0, openMl: 0 }),
    });
    const item = within(m).getByRole('menuitem', { name: 'Remove from inventory' }) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    expect(screen.queryByTestId('remove-blocked')).toBeNull();
    fireEvent.click(item);
    const confirm = await screen.findByRole('button', { name: 'Remove item' });
    expect(screen.getByText(/2\.25 kg live \/ 0 g shadow/)).toBeTruthy();
    expect(screen.queryByText(/Wine Library/)).toBeNull();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(inv.reconcile).toHaveBeenCalledTimes(1);
    const body = inv.reconcile.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({ actualCount: 0 }));
    expect('wineId' in body).toBe(false);
    expect(inv.del).toHaveBeenCalledWith('i1');
  });

  it('Remove waits when a count was not read: the modal would read it as 0 and skip the ledger row', async () => {
    const m = await menu({ row: row({ stock: null }) });
    const item = within(m).getByRole('menuitem', { name: 'Remove from inventory' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(screen.getByTestId('remove-blocked').textContent).toMatch(/did not say how many are held/);
  });

  it('Remove waits when the open bottle was not read, too', async () => {
    const m = await menu({ row: row({ openMl: null }) });
    const item = within(m).getByRole('menuitem', { name: 'Remove from inventory' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  for (const [label, over] of [
    ['live bottles', { stock: 3, shadow: 0, openMl: 0 }],
    ['shadow stock', { stock: 0, shadow: 2, openMl: 0 }],
    ['an open bottle', { stock: 0, shadow: 0, openMl: 300 }],
  ] as const) {
    it(`Mark inactive waits while ${label} are held, and sends nothing`, async () => {
      const m = await menu({ row: row(over) });
      const item = within(m).getByRole('menuitem', { name: 'Mark inactive' }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      expect(screen.getByTestId('inactive-blocked').textContent).toMatch(/bottles are still held\. Count it to zero or remove it first/);
      fireEvent.click(item);
      expect(inv.update).not.toHaveBeenCalled();
    });
  }

  for (const field of ['stock', 'shadow', 'openMl'] as const) {
    it(`Mark inactive waits when ${field} was not read`, async () => {
      const m = await menu({ row: row({ stock: 0, shadow: 0, openMl: 0, [field]: null }) });
      const item = within(m).getByRole('menuitem', { name: 'Mark inactive' }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      expect(screen.getByTestId('inactive-blocked').textContent).toMatch(/did not say how many are held/);
    });
  }

  it('Mark active is never held back by stock (bringing a row back loses nothing)', async () => {
    const m = await menu({ row: row({ active: false, stock: 3 }) });
    const item = within(m).getByRole('menuitem', { name: 'Mark active' }) as HTMLButtonElement;
    expect(item.disabled).toBe(false);
  });

  it('Export this row writes the valuation columns for this one row, named after it', async () => {
    tableExport.exportTable.mockClear();
    const m = await menu();
    fireEvent.click(within(m).getByRole('menuitem', { name: 'Export this row' }));
    expect(tableExport.exportTable).toHaveBeenCalledTimes(1);
    const arg = tableExport.exportTable.mock.calls[0][0];
    expect(arg.filename).toBe('gravner-ribolla');
    expect(arg.rows).toHaveLength(1);
    expect(arg.rows[0].id).toBe('i1');
    expect(arg.columns.map((c: { header: string }) => c.header)).toContain('Value at cost');
  });
});

describe('the cost column says per what, and to whom (inventory r28 gaps 9, 10)', () => {
  const eur = { state: 'recorded', code: 'EUR' } as const;
  async function menu(over: Partial<RowDropdownProps> = {}) {
    renderDrop(over);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.findByRole('menu');
  }
  beforeEach(() => {
    reads.detail = {
      purchases: [
        { id: 'l2', at: '2026-11-10T10:00:00Z', qty: 700, unitCost: 0.03, orderId: null },
        { id: 'l1', at: '2026-10-10T10:00:00Z', qty: 700, unitCost: 0.025, orderId: null },
      ],
    };
  });

  it('staff read that cost is an owner’s and a manager’s, never "none on the ledger", and keep the selling price', () => {
    renderDrop({ canManage: false });
    const drop = screen.getByTestId('row-dropdown');
    expect(screen.getByTestId('cost-is-a-managers')).toHaveTextContent(COST_IS_A_MANAGERS);
    expect(drop.textContent).not.toContain('none on the ledger');
    for (const k of ['Weighted average cost', 'Last bought', 'Before that', 'Margin on your bottle price', 'Auction lots'])
      expect(within(drop).queryByText(k)).toBeNull();
    expect(within(drop).getByText('Your price')).toBeTruthy();
  });

  it('staff are told about cost for a food too, with no selling price', () => {
    renderDrop({ canManage: false, kind: 'food', uom: 'g', row: row({ kind: 'food', bottle: null, glass: null }) });
    expect(screen.getByTestId('cost-is-a-managers')).toBeTruthy();
    expect(within(screen.getByTestId('row-dropdown')).queryByText('Your price')).toBeNull();
  });

  it('a spirit kept in ml reads its cost a litre and its margin on what one bottle cost', () => {
    // 0.03 a ml in a 700 ml bottle: 21 a bottle; sold at 60: a margin of 65 in a hundred.
    renderDrop({ row: row({ kind: 'spirit', bottleSizeMl: 700, bottle: 60, wac: 0.03 }), uom: 'ml', kind: 'spirit' });
    const text = screen.getByTestId('row-dropdown').textContent ?? '';
    expect(text).toContain(`Weighted average cost${cellMoney(30, eur)} a litre`);
    expect(text).toContain('Margin on your bottle price65%');
    expect(screen.getByTestId('margin-tax-note')).toHaveTextContent(MARGIN_TAX_NOTE);
  });

  it('a spirit with no bottle size gives no margin and says why, rather than comparing a bottle with a ml', () => {
    renderDrop({ row: row({ kind: 'spirit', bottleSizeMl: null, bottle: 60, wac: 0.03 }), uom: 'ml', kind: 'spirit' });
    const text = screen.getByTestId('row-dropdown').textContent ?? '';
    expect(text).toContain(`Margin on your bottle price${EM} the bottle size is not recorded`);
    expect(text).not.toContain('100%');
  });

  it('a spirit whose size only the gateway filled in (750) still gives no margin', () => {
    // The live row: bottleSizeMl 750 is the gateway's fallback; nothing was recorded.
    renderDrop({ row: row({ kind: 'spirit', bottleSizeMl: 750, bottleSizeRecordedMl: null, bottle: 60, wac: 0.03 }), uom: 'ml', kind: 'spirit' });
    const text = screen.getByTestId('row-dropdown').textContent ?? '';
    expect(text).toContain(`Margin on your bottle price${EM} the bottle size is not recorded`);
    expect(text).not.toContain('63%');
  });

  it('a recorded size wins over the field the gateway fills in', () => {
    renderDrop({ row: row({ kind: 'spirit', bottleSizeMl: 750, bottleSizeRecordedMl: 700, bottle: 60, wac: 0.03 }), uom: 'ml', kind: 'spirit' });
    expect(screen.getByTestId('row-dropdown').textContent ?? '').toContain('Margin on your bottle price65%');
  });

  it('toRow keeps the size the house recorded apart from the gateway fallback', () => {
    const base = { id: 'x', wineName: 'Vodka', uom: 'ml' } as Record<string, unknown>;
    expect(toRow({ ...base, bottle_size_ml: null, bottleSizeMl: 750 } as never).bottleSizeRecordedMl).toBeNull();
    expect(toRow({ ...base, bottle_size_ml: null, bottleSizeMl: 750 } as never).bottleSizeMl).toBe(750);
    expect(toRow({ ...base, bottle_size_ml: 700, bottleSizeMl: 700 } as never).bottleSizeRecordedMl).toBe(700);
    // A wine the house left unsized takes the library's size, as before.
    expect(toRow({ ...base, bottle_size_ml: null, bottleSizeMl: 750 } as never, { bottleSizeMl: 1500 } as never).bottleSizeRecordedMl).toBe(1500);
    // A caller that sends only the camel field keeps reading it.
    expect(toRow({ ...base, bottleSizeMl: 500 } as never).bottleSizeRecordedMl).toBe(500);
  });

  it('a wine kept in bottles keeps its cost a bottle', () => {
    // 40 a bottle sold at 92: 57.
    renderDrop({ row: row({ bottle: 92, wac: 40 }) });
    const text = screen.getByTestId('row-dropdown').textContent ?? '';
    expect(text).toContain(`Weighted average cost${cellMoney(40, eur)}`);
    expect(text).not.toContain('a litre');
    expect(text).toContain('Margin on your bottle price57%');
  });

  it('bottleCost converts only what it can', () => {
    expect(bottleCost(40, null, null)).toBe(40);
    expect(bottleCost(40, 'bottle', 750)).toBe(40);
    expect(bottleCost(0.03, 'ml', 700)).toBeCloseTo(21);
    expect(bottleCost(30, 'l', 700)).toBeCloseTo(21);
    expect(bottleCost(0.03, 'ml', null)).toBeNull();
    expect(bottleCost(0.03, 'ml', 0)).toBeNull();
    expect(bottleCost(2, 'g', 700)).toBeNull();
  });

  it('Export this row hands staff no cost columns, and a manager all of them', async () => {
    tableExport.exportTable.mockClear();
    const staff = await menu({ canManage: false });
    fireEvent.click(within(staff).getByRole('menuitem', { name: 'Export this row' }));
    const headers = tableExport.exportTable.mock.calls[0][0].columns.map((c: { header: string }) => c.header);
    expect(headers).not.toContain('WAC');
    expect(headers).not.toContain('Value at cost');
    expect(headers).toContain('Live');
    cleanup();
    tableExport.exportTable.mockClear();
    const manager = await menu({ canManage: true });
    fireEvent.click(within(manager).getByRole('menuitem', { name: 'Export this row' }));
    const all = tableExport.exportTable.mock.calls[0][0].columns.map((c: { header: string }) => c.header);
    expect(all).toContain('WAC');
    expect(all).toContain('Value at cost');
  });
});

describe('Name this wine in the opened row (ADR 0192, ported from RowExpansion.tsx:166)', () => {
  const FLAG = 'If you name this wine, we can help you build a better menu.';
  beforeEach(() => {
    inv.update.mockReset().mockResolvedValue({});
    inv.research.mockReset();
  });

  it('shows nothing when the research list has no flag for this title', async () => {
    inv.research.mockResolvedValue([{ inventoryId: 'i1', status: 'matched', reason: '', flag: null, updatedAt: '' }]);
    renderDrop();
    await screen.findByTestId('row-dropdown');
    await act(async () => {});
    expect(screen.queryByTestId('name-this-wine')).toBeNull();
  });

  it('saves the new name through the same PATCH and says what the re-read list says', async () => {
    inv.research
      .mockResolvedValueOnce([{ inventoryId: 'i1', status: 'not_findable', reason: '', flag: FLAG, updatedAt: '' }])
      .mockResolvedValue([{ inventoryId: 'i1', status: 'queued', reason: '', flag: null, updatedAt: '' }]);
    renderDrop({ row: row({ name: 'house red' }) });
    const band = await screen.findByTestId('name-this-wine');
    expect(band.textContent).toContain(FLAG);
    fireEvent.click(within(band).getByRole('button', { name: 'Name this wine' }));
    fireEvent.change(screen.getByLabelText('The wine’s name'), { target: { value: 'Kavaklıdere Yakut 2019' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));
    });
    expect(inv.update).toHaveBeenCalledWith('i1', { wineName: 'Kavaklıdere Yakut 2019' }, 'r1');
    expect((await screen.findByTestId('name-this-wine-says')).textContent).toBe(
      'Saved. We will look this wine up by its new name.',
    );
  });

  it('refuses an empty name before any request, and says a refusal in the house words', async () => {
    inv.research.mockResolvedValue([{ inventoryId: 'i1', status: 'not_findable', reason: '', flag: FLAG, updatedAt: '' }]);
    renderDrop();
    const band = await screen.findByTestId('name-this-wine');
    fireEvent.click(within(band).getByRole('button', { name: 'Name this wine' }));
    fireEvent.change(screen.getByLabelText('The wine’s name'), { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));
    });
    expect(inv.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('name-this-wine-problem').textContent).toMatch(/Write the wine’s name/);

    inv.update.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: { message: 'FORBIDDEN_ROLE' } },
      }),
    );
    fireEvent.change(screen.getByLabelText('The wine’s name'), { target: { value: 'Musar 2015' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));
    });
    const problem = screen.getByTestId('name-this-wine-problem').textContent ?? '';
    expect(problem).toMatch(/^The name was not saved — /);
    expect(problem).not.toMatch(/FORBIDDEN_ROLE|status code/);
  });
});

describe('the evidence-only copy the drawer mounts (actions={false})', () => {
  it('is named apart from the opened row, draws no acts, and asks the holder for the count sheet', () => {
    const onSheet = vi.fn();
    renderDrop({ actions: false, sections: ['where'], onSheet, sheet: null });
    expect(screen.queryByTestId('row-dropdown')).toBeNull();
    const ev = screen.getByTestId('row-evidence');
    expect(ev.getAttribute('aria-label')).toBe('Gravner Ribolla: the evidence');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    fireEvent.click(within(ev).getByRole('button', { name: 'Record a count' }));
    expect(onSheet).toHaveBeenCalledWith('count');
  });

  it('draws no sheet even when the shared state names one; the acts copy draws it', () => {
    renderDrop({ actions: false, sections: ['where'], onSheet: vi.fn(), sheet: 'count' });
    expect(screen.queryByRole('textbox', { name: 'Bottles counted' })).toBeNull();
    cleanup();
    renderDrop({ sections: [], onSheet: vi.fn(), sheet: 'count' });
    expect(screen.getByRole('textbox', { name: 'Bottles counted' })).toBeTruthy();
  });
});

describe('the rest of the legacy expansion (round 4 census)', () => {
  beforeEach(() => {
    inv.reconcile.mockReset().mockResolvedValue({});
    inv.research.mockReset().mockResolvedValue([]);
    toasts.success.mockReset();
    toasts.error.mockReset();
  });
  const openMore = async (over: Partial<RowDropdownProps> = {}) => {
    renderDrop(over);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.findByRole('menu');
  };

  it('Reconcile N into live posts live + shadow to the legacy reconcile route', async () => {
    const m = await openMore({ row: row({ stock: 3, shadow: 2 }) });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    expect(inv.reconcile).toHaveBeenCalledWith('i1', { wineId: 'w1', actualCount: 5, notes: 'Shadow reconciled into live' });
    expect(toasts.success.mock.calls[0][0]).toBe('Gravner Ribolla: live set to 5, the shadow bottles counted in.');
    expect(toasts.success.mock.calls[0][0]).not.toMatch(/booked|moved/);
  });

  it('a good with no library title reconciles its shadow too, and sends no wineId', async () => {
    const m = await openMore({ row: row({ wineId: null, stock: 3, shadow: 2 }) });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    expect(inv.reconcile).toHaveBeenCalledWith('i1', { actualCount: 5, notes: 'Shadow reconciled into live' });
  });

  it('a good kept in grams reconciles in kg, never "bottles"', async () => {
    const m = await openMore({ row: row({ stock: 3_000, shadow: 2_500 }), uom: 'g', kind: 'food' });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Reconcile 2.5 kg into live' }));
    });
    expect(inv.reconcile).toHaveBeenCalledWith('i1', { wineId: 'w1', actualCount: 5_500, notes: 'Shadow reconciled into live' });
    expect(toasts.success.mock.calls[0][0]).toBe('Gravner Ribolla: live set to 5.5 kg, the shadow counted in.');
  });

  it('holds Reconcile while live stock is unread', async () => {
    const m = await openMore({ row: row({ stock: null, shadow: 2 }) });
    expect((within(m).getByRole('menuitem', { name: 'Reconcile 2 into live' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no Reconcile when there is no shadow stock', async () => {
    const m = await openMore({ row: row({ shadow: 0 }) });
    expect(within(m).queryByRole('menuitem', { name: /Reconcile/ })).toBeNull();
  });

  it('a refused reconcile says nothing was reconciled, in the house words', async () => {
    inv.reconcile.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), { isAxiosError: true, response: { status: 403, data: {} } }),
    );
    const m = await openMore({ row: row({ stock: 3, shadow: 2 }) });
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    expect(toasts.error.mock.calls[0][0]).toMatch(/^Nothing was reconciled — /);
  });

  // The route sets live to an absolute count and leaves the shadow lots alone, so a
  // second tap on the re-read row (live 5, shadow 2) would set live to 7.
  function mountShared(r: InvRow) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = (rr: InvRow): RowDropdownProps => ({
      row: rr,
      canManage: true,
      currency: { state: 'recorded', code: 'EUR' },
      zoneName: () => 'Cave',
      locations: [],
      locationsUnavailable: false,
      providers: PROVIDERS,
      providersError: null,
      restaurantId: 'r1',
    });
    const tree = (rr: InvRow) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RowDropdown {...props(rr)} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(tree(r));
    return { ...view, show: (rr: InvRow) => view.rerender(tree(rr)), qc, tree };
  }
  const menu = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.findByRole('menu');
  };

  it('holds Reconcile after one landed, before and after the re-read, even after the row reopens', async () => {
    const v = mountShared(row({ stock: 3, shadow: 2 }));
    const m0 = await menu();
    await act(async () => {
      fireEvent.click(within(m0).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    expect(inv.reconcile).toHaveBeenCalledTimes(1);
    let m = await menu();
    expect(within(m).queryByRole('menuitem', { name: /Reconcile/ })).toBeNull();
    expect(within(m).getByTestId('reconcile-held').textContent).toMatch(/already set with the shadow bottles counted in/);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    v.show(row({ stock: 5, shadow: 2 }));
    m = await menu();
    expect(within(m).queryByRole('menuitem', { name: /Reconcile/ })).toBeNull();
    v.unmount();
    render(v.tree(row({ stock: 5, shadow: 2 })));
    m = await menu();
    expect(within(m).queryByRole('menuitem', { name: /Reconcile/ })).toBeNull();
    expect(inv.reconcile).toHaveBeenCalledTimes(1);
  });

  it('holds Reconcile after an unknown outcome, and says it may have landed', async () => {
    inv.reconcile.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} }));
    mountShared(row({ stock: 3, shadow: 2 }));
    const m0 = await menu();
    await act(async () => {
      fireEvent.click(within(m0).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    const m = await menu();
    expect(within(m).queryByRole('menuitem', { name: /Reconcile/ })).toBeNull();
    expect(within(m).getByTestId('reconcile-held').textContent).toMatch(/may have landed/);
  });

  it('does not hold Reconcile after a refusal, since nothing was written', async () => {
    inv.reconcile.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), { isAxiosError: true, response: { status: 403, data: {} } }),
    );
    mountShared(row({ stock: 3, shadow: 2 }));
    const m0 = await menu();
    await act(async () => {
      fireEvent.click(within(m0).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    const m = await menu();
    expect((within(m).getByRole('menuitem', { name: 'Reconcile 2 into live' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers Reconcile again once live or shadow reads differently', async () => {
    const v = mountShared(row({ stock: 3, shadow: 2 }));
    const m0 = await menu();
    await act(async () => {
      fireEvent.click(within(m0).getByRole('menuitem', { name: 'Reconcile 2 into live' }));
    });
    v.show(row({ stock: 5, shadow: 4 }));
    const m = await menu();
    expect((within(m).getByRole('menuitem', { name: 'Reconcile 4 into live' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(m).queryByTestId('reconcile-held')).toBeNull();
  });

  it('Copy the name keeps a name with a newline on one line', async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderDrop({ row: row({ name: 'Gravner\r\nRibolla' }) });
    const m0 = await menu();
    await act(async () => {
      fireEvent.click(within(m0).getByRole('menuitem', { name: 'Copy the name' }));
    });
    expect(write).toHaveBeenCalledWith('Gravner Ribolla');
  });

  it('links View the ledger to the legacy destination', async () => {
    renderDrop();
    expect((await screen.findByTestId('row-view-ledger')).getAttribute('href')).toBe('/documents-reports');
  });

  it('Copy the name puts the title on the clipboard', async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const m = await openMore();
    await act(async () => {
      fireEvent.click(within(m).getByRole('menuitem', { name: 'Copy the name' }));
    });
    expect(write).toHaveBeenCalledWith('Gravner Ribolla');
  });
});

describe('the format reads in the house unit (RowExpansion.tsx:69,172)', () => {
  it('says ounces when the house measures in oz, and ml otherwise', async () => {
    const { useRestaurantSettingsStore } = await import('../../../stores/restaurantSettingsStore');
    useRestaurantSettingsStore.setState({ measurementUnit: 'oz' });
    const { unmount } = renderDrop();
    expect(screen.getByText(/oz$/)).toBeTruthy();
    unmount();
    useRestaurantSettingsStore.setState({ measurementUnit: 'ml' });
    renderDrop();
    expect(screen.getByText('750ml')).toBeTruthy();
  });
});

describe('a food or supply is costed in its own unit, with no price, margin, market or lots (#1221 follow-up)', () => {
  const food = row({ name: 'Bread Flour', kind: 'food', bottleSizeMl: null, bottle: null, glass: null, wac: 0.009, openMl: 0 });
  const eur = { state: 'recorded', code: 'EUR' } as const;

  beforeEach(() => {
    reads.detail = {
      purchases: [
        { id: 'l2', at: '2026-11-10T10:00:00Z', qty: 5000, unitCost: 0.009, orderId: null },
        { id: 'l1', at: '2026-10-10T10:00:00Z', qty: 5000, unitCost: 0.0075, orderId: null },
      ],
    };
  });

  it('a food kept in g reads its costs a kg and says it is costed, not priced', () => {
    renderDrop({ row: food, kind: 'food', uom: 'g' });
    const drop = screen.getByTestId('row-dropdown');
    const kg = (n: number) => `${cellMoney(n, eur)} a kg`;
    expect(drop.textContent).toContain(`Weighted average cost${kg(9)}`);
    expect(drop.textContent).toContain(`${kg(7.5)} → ${kg(9)} (+20%)`);
    for (const k of ['Your price', 'Margin on your bottle price', 'Market', 'Auction lots']) expect(within(drop).queryByText(k)).toBeNull();
    expect(screen.getByTestId('good-not-priced')).toHaveTextContent('A food is costed, not priced');
  });

  it('a supply kept each reads each; one with no recorded unit reads a dash, never a guessed bottle', () => {
    renderDrop({ row: food, kind: 'supply', uom: 'each' });
    expect(screen.getByTestId('row-dropdown').textContent).toContain(`Weighted average cost${cellMoney(0.009, eur)} each`);
    expect(screen.getByTestId('good-not-priced')).toHaveTextContent('A supply is costed, not priced.');
    cleanup();
    renderDrop({ row: food, kind: 'supply', uom: null });
    expect(screen.getByTestId('row-dropdown').textContent).toContain(`Weighted average cost${EM}`);
  });

  it('a lira house writes the cost change and the margin the way it writes its money (r23 walk)', () => {
    const tl = { state: 'recorded', code: 'TRY' } as const;
    renderDrop({ row: food, kind: 'food', uom: 'g', currency: tl });
    expect(screen.getByTestId('row-dropdown').textContent).toContain('(+%20)');
    cleanup();
    // 92 a bottle on a cost of 40: a margin of 57 in a hundred.
    renderDrop({ currency: tl });
    expect(screen.getByTestId('row-dropdown').textContent).toContain('Margin on your bottle price%57');
    cleanup();
    renderDrop({ currency: { state: 'recorded', code: 'GBP' } });
    expect(screen.getByTestId('row-dropdown').textContent).toContain('Margin on your bottle price57%');
  });

  it('a drink is drawn as before', () => {
    renderDrop();
    const drop = screen.getByTestId('row-dropdown');
    for (const k of ['Your price', 'Margin on your bottle price', 'Market', 'Auction lots']) expect(within(drop).getByText(k)).toBeTruthy();
    expect(screen.queryByTestId('good-not-priced')).toBeNull();
  });
});

describe('Last bought reads the settled price, not only the ledger (r35, gap 8 slice 2)', () => {
  const eur = { state: 'recorded', code: 'EUR' } as const;
  const food = row({ name: 'Bread Flour', kind: 'food', bottleSizeMl: null, bottle: null, glass: null, wac: 0.009, openMl: 0 });
  const kg = (n: number) => `${cellMoney(n, eur)} a kg`;
  const kv = (k: string) => within(screen.getByTestId('row-dropdown')).getByText(k).parentElement!.textContent ?? '';

  beforeEach(() => {
    // A door delivery: booked with no cost, never restated on the ledger.
    reads.detail = { purchases: [{ id: 'l1', at: '2026-11-10T10:00:00Z', qty: 5000, unitCost: null, orderId: 'o1' }] };
  });

  it('a delivery whose price was settled reads it, newest first, with the change between the last two', () => {
    renderDrop({
      row: food,
      kind: 'food',
      uom: 'g',
      settled: [
        { receivedAt: '2026-09-01T10:00:00Z', unitCost: 0.006 },
        { receivedAt: '2026-10-01T10:00:00Z', unitCost: 0.0075 },
        { receivedAt: '2026-11-01T10:00:00Z', unitCost: 0.009 },
      ],
    });
    expect(kv('Last bought')).toContain(`${kg(9)} · settled ${shortDate('2026-11-01T10:00:00Z')}`);
    expect(kv('Before that')).toContain(`${kg(7.5)} · settled ${shortDate('2026-10-01T10:00:00Z')}`);
    expect(kv('Was → now')).toContain(`${kg(7.5)} → ${kg(9)} (+20%)`);
    expect(screen.getByTestId('row-dropdown').textContent).not.toContain('none on the ledger');
  });

  it('no settled price falls back to the ledger, which here has no priced line', () => {
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: [] });
    expect(kv('Last bought')).toContain('none on the ledger');
    cleanup();
    reads.detail = { purchases: [{ id: 'l1', at: '2026-11-10T10:00:00Z', qty: 5000, unitCost: 0.008, orderId: null }] };
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: null });
    expect(kv('Last bought')).toContain(`${kg(8)} · ${shortDate('2026-11-10T10:00:00Z')}`);
    expect(kv('Last bought')).not.toContain('settled');
  });

  it('a settled price is shown even while the ledger read failed or is still reading', () => {
    reads.detail = { purchases: null, purchasesError: 'timeout' };
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: [{ receivedAt: '2026-11-01T10:00:00Z', unitCost: 0.009 }] });
    expect(kv('Last bought')).toContain(kg(9));
    expect(kv('Last bought')).not.toContain('could not be read');
    expect(kv('Before that')).toContain('none settled before it');
    cleanup();
    reads.detail = { purchases: null, purchasesError: null };
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: [{ receivedAt: '2026-11-01T10:00:00Z', unitCost: 0.009 }] });
    expect(kv('Last bought')).toContain(kg(9));
  });

  // r36 inventory audit, gap 9: while the figures read, or after they failed,
  // whether a price was settled is not known. The ledger's door lines carry no
  // cost, so falling back to it said "none on the ledger" under a Cost card
  // that says the costs could not be read.
  it('while the figures read, Last bought reads a dash, never the ledger', () => {
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: 'reading' });
    expect(kv('Last bought')).toContain('—');
    expect(screen.getByTestId('row-dropdown').textContent).not.toContain('none on the ledger');
  });

  it('after the figures failed, Last bought says it could not be read, even with a priced ledger line', () => {
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: 'failed' });
    expect(kv('Last bought')).toContain('could not be read');
    expect(screen.getByTestId('row-dropdown').textContent).not.toContain('none on the ledger');
    cleanup();
    reads.detail = {
      purchases: [
        { id: 'l1', at: '2026-11-10T10:00:00Z', qty: 5000, unitCost: 0.008, orderId: null },
        { id: 'l0', at: '2026-10-10T10:00:00Z', qty: 5000, unitCost: 0.006, orderId: null },
      ],
    };
    renderDrop({ row: food, kind: 'food', uom: 'g', settled: 'failed' });
    expect(kv('Last bought')).toContain('could not be read');
    expect(kv('Last bought')).not.toContain(kg(8));
    // no change is worked out from a ledger the figures may have replaced
    expect(kv('Was → now')).not.toContain('%');
  });
});
