/**
 * The opened row (INV-W4): formless, Write off only for owners and managers,
 * and Order more goes through /cellar's own OrderCeremony.
 *
 * The row's reads (ledger purchases, paper, lots, the till record) are
 * stubbed; the sheets and the ceremony stub are real mounts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
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

import RowDropdown, { type RowDropdownProps } from './RowDropdown';

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

  it('both acts are reachable from More, for staff as well as managers (legacy gates neither)', async () => {
    const m = await menu({ canManage: false });
    expect(within(m).getByRole('menuitem', { name: 'Mark inactive' })).toBeTruthy();
    expect(within(m).getByRole('menuitem', { name: 'Remove from inventory' })).toBeTruthy();
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
    expect(toasts.success.mock.calls[0][0]).toMatch(/2 shadow bottles booked into live, 5 on hand/);
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
