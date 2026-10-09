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
    openMl: null,
    zones: [{ locationId: 'z1', qty: 3 }],
    providerId: 'p1',
    providerName: 'Vinoteca',
    standing: 'below',
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
    const items = within(menu).getAllByRole('menuitem');
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
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })).toBe(false);
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })).toBe(false);
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
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
