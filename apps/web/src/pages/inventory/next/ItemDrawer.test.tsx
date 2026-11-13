/**
 * The /inventory item drawer (ItemDrawer.tsx): eight cards, a failed read
 * said as failed and never 0, no money for staff, a food in its own unit.
 * The page wiring (a row opens it, Back closes it) is in InventoryNext.test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
import { ALLERGENS, type HouseFields, type ItemFigures, type ItemNutrition } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ figures: vi.fn(), usedIn: vi.fn(), nutrition: vi.fn(), dishes: vi.fn() }));
vi.mock('../../../services/api/itemDishes', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemDishes: api.dishes,
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemFigures: api.figures,
  getItemUsedIn: api.usedIn,
  getItemNutrition: api.nutrition,
}));
vi.mock('./RowDropdown', () => ({
  default: (p: { sections?: string[]; actions?: boolean; uom?: string | null; kind?: string | null }) => (
    <div
      data-testid="row-dropdown"
      data-sections={p.sections === undefined ? 'all' : p.sections.join(',')}
      data-actions={String(p.actions !== false)}
      data-uom={p.uom ?? ''}
      data-kind={p.kind ?? ''}
    />
  ),
}));

import ItemDrawer, { type NutritionCardProps } from './ItemDrawer';

const row = (over: Partial<InvRow> = {}) =>
  ({
    id: 'i1', wineId: 'w1', name: 'Gravner Ribolla', libraryName: null, producer: 'Gravner', type: 'orange', kind: 'wine',
    vintage: 2016, grape: null, bottleSizeMl: 750, stock: 12, shadow: 0, par: 6, reorderPoint: null, analyticsReadable: true,
    velocity: 1, runway: 12, daysSinceSale: 1, deadStock: false, usageSource: null, usageSince: null, usageUntil: null, usageQty: null, bottle: 92, glass: 18, pourMl: 150, wac: 40,
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

const nothingStated: ItemNutrition = {
  item: { id: 'i1', name: 'Gravner Ribolla', kind: 'wine', uom: 'bottle' },
  suggestedBasis: '100ml',
  figures: null,
  allergens: ALLERGENS.map((a) => ({ allergen: a, status: 'not_stated' as const, statedByName: null, statedAt: null })),
};

const NO_HOUSE: HouseFields = { kind: null, uom: null, displayName: null };
const CURRENCY = /€|EUR|\$|£|₺|TRY|USD/;

function open(
  r: InvRow | null,
  opts: { canManage?: boolean; house?: HouseFields; NutritionCard?: (p: NutritionCardProps) => JSX.Element } = {},
) {
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
        NutritionCard={opts.NutritionCard}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.figures.mockReset();
  api.figures.mockResolvedValue(figures());
  api.usedIn.mockReset();
  api.usedIn.mockImplementation(() => new Promise(() => undefined));
  api.dishes.mockReset();
  api.dishes.mockImplementation(() => new Promise(() => undefined));
  api.nutrition.mockReset();
  api.nutrition.mockResolvedValue(nothingStated);
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

  it('draws a food with no library row in kg, without bottle words', () => {
    open(row({ wineId: null, name: 'Un', type: null, kind: null, stock: 12400 }), { house: { kind: 'food', uom: 'g', displayName: 'Un' } });
    expect(screen.getByTestId('ivd-card-onhand').textContent).toContain('12.4 kg');
    expect(screen.getByTestId('ivd-head').textContent).toContain('Food');
    expect(screen.getByTestId('ivd-head').textContent).not.toContain('ml bottle');
  });

  it('keeps every gram a count wrote: 1750 g reads 1.75 kg, never 1.8 kg', () => {
    open(row({ wineId: null, name: 'Sugar', type: null, kind: null, stock: 1750, wac: 0.0024 }), { house: { kind: 'food', uom: 'g', displayName: 'Sugar' } });
    expect(screen.getByTestId('ivd-card-onhand').textContent).toContain('1.75 kg');
    expect(screen.getByTestId('ivd-card-cost').textContent).toContain('2.40 a kg');
  });

  it('prices a good kept as items "each", never "a item"', () => {
    open(row({ wineId: null, name: 'Lemons', type: null, kind: null, stock: 40, wac: 0.35 }), { house: { kind: 'food', uom: 'each', displayName: 'Lemons' } });
    const cost = screen.getByTestId('ivd-card-cost').textContent ?? '';
    expect(cost).toContain('0.35 each');
    expect(cost).not.toContain('a item');
  });

  it('prices a good kept in litres "a litre"', () => {
    open(row({ wineId: null, name: 'Oil', type: null, kind: null, stock: 4, wac: 9 }), { house: { kind: 'food', uom: 'l', displayName: 'Oil' } });
    expect(screen.getByTestId('ivd-card-cost').textContent).toContain('a litre');
  });

  it('gives the drawer body its side gutter', () => {
    open(row());
    expect(screen.getByTestId('ivd-head').closest('.iv-sheet-body')).not.toBeNull();
  });

  it('says an id not on the list is not on the list, and reads nothing', () => {
    open(null);
    expect(screen.getByTestId('ivd-gone')).toBeTruthy();
    expect(screen.queryByTestId('ivd-cards')).toBeNull();
    expect(api.figures).not.toHaveBeenCalled();
  });

  it('keeps the acts under the cards with no card open, and no evidence panel drawn', () => {
    open(row(), { house: { kind: 'food', uom: 'g', displayName: 'Un' } });
    const acts = screen.getAllByTestId('row-dropdown');
    expect(acts).toHaveLength(1);
    expect(acts[0].dataset).toMatchObject({ sections: '', actions: 'true', uom: 'g', kind: 'food' });
    expect(screen.queryByTestId('ivd-evidence')).toBeNull();
  });

  it('a card opens its own evidence, without a second set of acts', () => {
    open(row());
    const opened = (id: string) => {
      fireEvent.click(screen.getByTestId(`ivd-card-${id}`));
      const panel = within(screen.getByTestId('ivd-evidence')).queryByTestId('row-dropdown');
      const sections = panel?.dataset.sections ?? null;
      if (panel) expect(panel.dataset.actions).toBe('false');
      fireEvent.click(screen.getByTestId(`ivd-card-${id}`));
      return sections;
    };
    expect(opened('gap')).toBe('where');
    expect(opened('usage')).toBe('pace');
    expect(opened('cost')).toBe('cost,paper');
    expect(opened('onhand')).toBe('where,facts');
    // "What's in it" opens the nutrition card alone.
    expect(opened('inside')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All the evidence' }));
    expect(within(screen.getByTestId('ivd-evidence')).getByTestId('row-dropdown').dataset.sections).toBe('facts,where,pace,cost,paper');
  });

  it('a food its counts have not measured says how to measure it, never "not enough history"', () => {
    open(row({ velocity: 0, runway: null, kind: 'food' }), { house: { kind: 'food', uom: 'g', displayName: 'Un' } });
    expect(screen.getByTestId('ivd-card-usage').textContent).toContain('Not measured yet');
    expect(screen.getByTestId('ivd-card-usage').textContent).toContain('count it twice, at least 3 days apart');
    expect(screen.getByTestId('ivd-card-cover').textContent).toContain('Not known');
    expect(screen.getByTestId('ivd-card-usage').textContent).not.toContain('Not enough history');
  });

  it('a food measured by its counts says its use a day, where it came from, and its days of cover', () => {
    open(
      row({
        velocity: 290,
        runway: 28,
        stock: 8200,
        kind: null,
        usageSource: 'counts',
        usageSince: '2026-10-22T09:00:00Z',
        usageUntil: '2026-11-11T09:00:00Z',
        usageQty: 5800,
      }),
      { house: { kind: 'food', uom: 'g', displayName: 'Flour' } },
    );
    const usage = screen.getByTestId('ivd-card-usage').textContent ?? '';
    expect(usage).toContain('290 g');
    expect(usage).toContain('5.8 kg used between the counts of 22 Oct 2026 and 11 Nov 2026 (20 days)');
    expect(usage).not.toContain('Not measured yet');
    const cover = screen.getByTestId('ivd-card-cover').textContent ?? '';
    expect(cover).toContain('28 days');
    expect(cover).toContain('On hand less what was used since the last count (11 Nov 2026), at its usage a day between its last counts.');
  });

  it('counts that show nothing used say so, and that it is not running down', () => {
    open(
      row({ velocity: 0, runway: null, usageSource: 'counts', usageSince: '2026-10-28T09:00:00Z', usageUntil: '2026-11-07T09:00:00Z', usageQty: 0 }),
      { house: { kind: 'supply', uom: 'each', displayName: 'Napkins' } },
    );
    expect(screen.getByTestId('ivd-card-usage').textContent).toContain('None used');
    expect(screen.getByTestId('ivd-card-cover').textContent).toContain('Not running down');
  });

  it('a good the till sells says what was sold and over how many days it was carried', () => {
    open(
      row({ velocity: 1, runway: 10, stock: 10, usageSource: 'sales', usageSince: '2026-11-02T09:00:00Z', usageUntil: '2026-11-12T09:00:00Z', usageQty: 10 }),
    );
    const usage = screen.getByTestId('ivd-card-usage').textContent ?? '';
    expect(usage).toContain('10 bottles sold in the last 10 days, from the stock ledger, less voids.');
    expect(screen.getByTestId('ivd-card-cover').textContent).toContain('10 days');
  });

  it('a food whose pace could not be read stays unread, never "not drawn by sales"', () => {
    open(row({ velocity: null, runway: null, kind: 'food', analyticsReadable: false }), {
      house: { kind: 'food', uom: 'g', displayName: 'Un' },
    });
    const usage = screen.getByTestId('ivd-card-usage').textContent ?? '';
    expect(usage).not.toContain('Not drawn by sales');
    expect(usage).not.toContain('A sale does not draw');
    expect(usage).toContain('The sales pace could not be read');
    expect(screen.getByTestId('ivd-card-cover').textContent).not.toContain('not measured by sales');
  });

  it('a wine with no sales yet still says not enough history', () => {
    open(row({ velocity: null, runway: null }));
    expect(screen.getByTestId('ivd-card-usage').textContent).toContain('Not enough history');
  });
  it('opens the item detail card, with the NutritionCard slot, from every KPI card', () => {
    open(row());
    for (const id of ['onhand', 'value', 'usage', 'cover', 'cost', 'waste', 'gap', 'inside']) {
      const card = screen.getByTestId(`ivd-card-${id}`);
      expect(card.tagName).toBe('BUTTON');
      fireEvent.click(card);
      const detail = screen.getByTestId('ivd-evidence');
      expect(card.getAttribute('aria-expanded')).toBe('true');
      expect(card.getAttribute('aria-controls')).toBe('ivd-evidence');
      const slot = within(detail).getByTestId('ivd-nutrition-slot');
      expect(slot.getAttribute('data-slot')).toBe('NutritionCard');
      // The slot holds the nutrition card: reading, or what is recorded. Never empty, never 0.
      expect(within(slot).getByTestId('ivn')).toBeTruthy();
      expect(slot.textContent).not.toMatch(/\b0 (kcal|g)\b/);
      fireEvent.click(card);
      expect(screen.queryByTestId('ivd-evidence')).toBeNull();
      expect(card.getAttribute('aria-controls')).toBeNull();
    }
  });

  it('shows energy per 100 ml on the "What’s in it" card, and the nutrition card in the slot', async () => {
    api.nutrition.mockResolvedValue({
      ...nothingStated,
      figures: {
        basis: '100ml', energyKcal: 69, fatG: null, saturatesG: null, carbohydrateG: null, sugarsG: null, proteinG: null,
        saltG: null, abvPct: 12.5, energyFromAbv: true, source: 'house', sourceRef: null, statedByName: 'Ayşe', statedAt: '2026-11-07T10:00:00Z',
      },
      allergens: nothingStated.allergens.map((a) => (a.allergen === 'sulphites' ? { ...a, status: 'contains' as const } : a)),
    });
    open(row(), { canManage: false });
    await waitFor(() => expect(screen.getByTestId('ivd-card-inside').textContent).toContain('69 kcal per 100 ml'));
    expect(screen.getByTestId('ivd-card-inside').textContent).toContain('Contains 1 of the 14 allergens');
    expect(api.nutrition).toHaveBeenCalledWith('i1', 'r1');
    fireEvent.click(screen.getByTestId('ivd-card-inside'));
    const slot = within(screen.getByTestId('ivd-evidence')).getByTestId('ivd-nutrition-slot');
    expect(within(slot).getByTestId('ivn-figures').textContent).toContain('from the alcohol alone');
    expect(within(slot).getByTestId('ivn-allergens').textContent).toContain('Contains sulphites.');
    // The drawer hands its canManage to the card: staff read only.
    expect(within(slot).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(api.nutrition).toHaveBeenCalledTimes(1);
  });

  it('says the "What’s in it" card could not be read, never "not recorded"', async () => {
    api.nutrition.mockRejectedValue(new Error('Network Error'));
    open(row());
    await waitFor(() => expect(screen.getByTestId('ivd-card-inside').textContent).toContain('could not be read'));
    expect(screen.getByTestId('ivd-card-inside').textContent).not.toContain('Not recorded');
  });

  it('mounts a given NutritionCard once, in the slot, handed the item', () => {
    const seen: NutritionCardProps[] = [];
    const Nutrition = (p: NutritionCardProps) => {
      seen.push(p);
      return <div data-testid="nutrition-card">{p.row.name}</div>;
    };
    open(row(), { NutritionCard: Nutrition, house: { kind: 'food', uom: 'g', displayName: 'Flour' } });
    expect(screen.queryByTestId('nutrition-card')).toBeNull();
    fireEvent.click(screen.getByTestId('ivd-card-inside'));
    expect(screen.getAllByTestId('nutrition-card')).toHaveLength(1);
    expect(within(screen.getByTestId('ivd-nutrition-slot')).getByTestId('nutrition-card').textContent).toBe('Gravner Ribolla');
    expect(seen.at(-1)).toMatchObject({ row: { id: 'i1' }, house: { kind: 'food' }, restaurantId: 'r1', canManage: true });
  });

  it('says a count-gap read that failed could not be read, never "Never counted"', async () => {
    api.figures.mockResolvedValue(figures({ countGap: { readable: false, last: null, source: 'timeout' } }));
    open(row());
    await waitFor(() => expect(screen.getByTestId('ivd-card-gap').textContent).toContain('could not be read'));
    expect(screen.getByTestId('ivd-card-gap').textContent).not.toContain('Never counted');
  });

  it('says on hand could not be read when the stock is unknown, never 0', () => {
    open(row({ stock: null, value: null }));
    const text = (screen.getByTestId('ivd-card-onhand').textContent ?? '').replace('On hand', '');
    expect(text).toContain('could not be read');
    expect(text).not.toMatch(/\d/);
  });

  it('reads a food kept in grams in kg, and gives it no bottle size', () => {
    open(row({ stock: 12400, kind: null, type: null, bottleSizeMl: 750 }), { house: { kind: 'food', uom: 'g', displayName: 'Flour' } });
    expect(screen.getByTestId('ivd-card-onhand').textContent).toContain('12.4 kg');
    expect(screen.getByTestId('ivd-card-onhand').textContent).not.toContain('bottle');
  });

  it('gives a food with no unit recorded no bottle size', () => {
    open(row({ kind: null, type: null, bottleSizeMl: 750 }), { house: { kind: 'food', uom: null, displayName: 'Flour' } });
    expect(screen.getByTestId('ivd-head').textContent).toMatch(/^Food · Cave/);
    expect(screen.getByTestId('ivd-head').textContent).not.toContain('ml bottle');
  });
  it('says where the item is used could not be read when that read fails, and reads it again on asking', async () => {
    api.usedIn.mockRejectedValueOnce(new Error('Network Error'));
    open(row());
    const used = await screen.findByText(/Where this item is used could not be read/);
    expect(screen.getByTestId('ivd-used').textContent).not.toContain('Reading where it is used');
    expect(api.usedIn).toHaveBeenCalledTimes(1);
    fireEvent.click(within(used).getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(api.usedIn).toHaveBeenCalledTimes(2));
  });
  it('lists the dishes whose recipe uses a food, and keeps the nutrition slot', async () => {
    api.dishes.mockResolvedValue({
      dishes: [
        {
          dishId: 'd1', name: 'Pide', section: null, price: 10, hasRecipe: true, yieldServes: 8, lineCount: 1,
          cost: { perServe: 2.5, perServeExact: 2.5, priced: 1, of: 1, complete: true, partial: 0 },
          uses: [{ label: 'Flour', qtyEntered: 250, unitCode: 'g' }],
        },
      ],
    });
    open(row(), { house: { kind: 'food', uom: 'g', displayName: 'Flour' } });
    fireEvent.click(screen.getByTestId('ivd-card-inside'));
    const recipes = screen.getByTestId('ivd-used-recipes');
    await waitFor(() => expect(within(recipes).getByText('Pide')).toBeTruthy());
    expect(screen.getByTestId('ivd-nutrition-slot')).toBeTruthy();
  });
});

describe('a supply has nothing in it to state', () => {
  const napkins = { kind: 'supply', uom: 'each', displayName: 'Napkins' } as HouseFields;

  it('a supply shows no "What’s in it" card and never reads nutrition or allergens', async () => {
    open(row({ kind: 'supply', name: 'Napkins', bottleSizeMl: null }), { house: napkins });
    await waitFor(() => expect(api.figures).toHaveBeenCalled());
    expect(screen.queryByTestId('ivd-card-inside')).toBeNull();
    expect(screen.queryByText(/allergen/i)).toBeNull();
    expect(api.nutrition).not.toHaveBeenCalled();
  });

  it('all the evidence for a supply has no nutrition slot', () => {
    open(row({ kind: 'supply', name: 'Napkins', bottleSizeMl: null }), { house: napkins });
    fireEvent.click(screen.getByRole('button', { name: 'All the evidence' }));
    const detail = screen.getByTestId('ivd-evidence');
    expect(within(detail).queryByTestId('ivd-nutrition-slot')).toBeNull();
    expect(detail.textContent).not.toContain('What’s in it');
  });

  it('a food still states what is in it', async () => {
    open(row({ kind: 'food', name: 'Bread flour', bottleSizeMl: null }), { house: { kind: 'food', uom: 'g', displayName: 'Bread flour' } });
    await waitFor(() => expect(api.nutrition).toHaveBeenCalled());
    expect(screen.getByTestId('ivd-card-inside')).toBeTruthy();
  });
});
