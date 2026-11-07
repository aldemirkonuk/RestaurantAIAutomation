/**
 * The /inventory item drawer (ItemDrawer.tsx): eight cards, a failed read
 * said as failed and never 0, no money for staff, a food in its own unit.
 * The page wiring (a row opens it, Back closes it) is in InventoryNext.test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
import type { HouseFields, ItemFigures } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ figures: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemFigures: api.figures,
}));
vi.mock('./RowDropdown', () => ({ default: () => <div data-testid="row-dropdown" /> }));

import ItemDrawer from './ItemDrawer';

const row = (over: Partial<InvRow> = {}) =>
  ({
    id: 'i1', wineId: 'w1', name: 'Gravner Ribolla', libraryName: null, producer: 'Gravner', type: 'orange', kind: 'wine',
    vintage: 2016, grape: null, bottleSizeMl: 750, stock: 12, shadow: 0, par: 6, reorderPoint: null, analyticsReadable: true,
    velocity: 1, runway: 12, daysSinceSale: 1, deadStock: false, bottle: 92, glass: 18, pourMl: 150, wac: 40,
    costProvenance: 'invoice', value: 480, lastCountedAt: '2026-09-30T10:00:00Z', openMl: null,
    zones: [{ locationId: 'z1', qty: 12 }], providerId: null, providerName: null, standing: 'above', active: true, ...over,
  }) as InvRow;

const figures = (over: Partial<ItemFigures> = {}): ItemFigures => ({
  waste: { readable: true, qty30d: 2, given30d: 1, value30d: 80, source: 'Written off in the last 30 days.' },
  countGap: {
    readable: true,
    last: [{ countedAt: '2026-09-30T10:00:00Z', expected: 13, counted: 12, variance: -1, by: 'Ayşe', money: -40 }],
    source: 'The last counts.',
  },
  costTrend: {
    readable: true,
    points: [
      { receivedAt: '2026-08-01T10:00:00Z', unitCost: 37 },
      { receivedAt: '2026-09-01T10:00:00Z', unitCost: 40 },
    ],
    changePct: 8,
    source: 'What each delivery cost.',
  },
  ...over,
});

const NO_HOUSE: HouseFields = { kind: null, uom: null, displayName: null };
const CURRENCY = /€|EUR|\$|£|₺|TRY|USD/;

function open(r: InvRow | null, opts: { canManage?: boolean; house?: HouseFields } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ItemDrawer
        row={r}
        house={opts.house ?? NO_HOUSE}
        canManage={opts.canManage ?? true}
        currency={{ state: 'recorded', code: 'EUR' }}
        zoneName={() => 'Cave'}
        locations={[]}
        locationsUnavailable={false}
        providers={[]}
        providersError={null}
        restaurantId="r1"
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.figures.mockReset();
  api.figures.mockResolvedValue(figures());
});

describe('the item drawer', () => {
  it('(a) shows the eight cards, in order, from the row and the figures read', async () => {
    open(row());
    const ids = [...screen.getByTestId('ivd-cards').querySelectorAll('[data-testid^="ivd-card-"]')].map((c) => c.getAttribute('data-testid'));
    expect(ids).toEqual(['onhand', 'value', 'usage', 'cover', 'cost', 'waste', 'gap', 'inside'].map((k) => `ivd-card-${k}`));
    expect(api.figures).toHaveBeenCalledWith('i1', 'r1');
    await waitFor(() => expect(screen.getByTestId('ivd-card-cost').textContent).toContain('Up 8% since August'));
    expect(screen.getByTestId('ivd-card-onhand').textContent).toContain('12 bottles');
    expect(screen.getByTestId('ivd-card-gap').textContent).toContain('−1 bottle');
    expect(screen.getByTestId('ivd-head').textContent).toContain('Orange wine · 750 ml bottle · Cave · counted');
  });

  it('(b) a waste read that failed says so, shows no 0 and no database words', async () => {
    api.figures.mockResolvedValue(
      figures({ waste: { readable: false, qty30d: null, given30d: null, value30d: null, source: 'relation "x" does not exist' } }),
    );
    open(row());
    await waitFor(() => expect(screen.getByTestId('ivd-card-waste').textContent).toContain('could not be read'));
    const text = (screen.getByTestId('ivd-card-waste').textContent ?? '').replace('Waste (30 days)', '');
    expect(text).not.toMatch(/\b0\b/);
    expect(text).not.toContain('does not exist');
  });

  it('says every figures card failed when the whole read failed', async () => {
    api.figures.mockRejectedValue(new Error('Network Error'));
    open(row());
    await waitFor(() => expect(screen.getByTestId('ivd-card-gap').textContent).toContain('could not be read'));
    expect(screen.getByTestId('ivd-card-waste').textContent).toContain('could not be read');
  });

  it('says why there is no cost trend when the server keeps none, not "too few receipts"', async () => {
    const why = "What each delivery cost is not shown yet: no record here keeps a delivery's final price.";
    api.figures.mockResolvedValue(figures({ costTrend: { readable: true, points: null, changePct: null, source: why } }));
    open(row());
    await waitFor(() => expect(screen.getByTestId('ivd-card-cost').textContent).toContain(why));
    expect(screen.getByTestId('ivd-card-cost').textContent).not.toContain('Not enough receipts');
  });

  it('(c) staff see no currency and no Value card', async () => {
    api.figures.mockResolvedValue(
      figures({
        waste: { readable: true, qty30d: 2, given30d: 1, value30d: null, source: 'Written off.' },
        costTrend: { readable: true, points: null, changePct: null, source: 'Cost is shown to owners and managers.' },
      }),
    );
    open(row(), { canManage: false });
    await waitFor(() => expect(screen.getByTestId('ivd-card-waste').textContent).toContain('given away'));
    const panel = screen.getByTestId('ivd-cards').closest('.mdv-ovl__panel') as HTMLElement;
    expect(panel.textContent).not.toMatch(CURRENCY);
    expect(within(panel).queryByTestId('ivd-card-value')).toBeNull();
  });

  it('says an id not on the list is not on the list, and reads nothing', () => {
    open(null);
    expect(screen.getByTestId('ivd-gone')).toBeTruthy();
    expect(screen.queryByTestId('ivd-cards')).toBeNull();
    expect(api.figures).not.toHaveBeenCalled();
  });

  it('opens the evidence under the cards from a card', () => {
    open(row());
    expect(screen.queryByTestId('row-dropdown')).toBeNull();
    fireEvent.click(screen.getByTestId('ivd-card-gap'));
    expect(within(screen.getByTestId('ivd-evidence')).getByTestId('row-dropdown')).toBeTruthy();
  });
});
