/**
 * Opening a good stops waiting on cold reads (r105 g3). A 150 ms rest on a row
 * or card, or keyboard focus, warms figures, nutrition and used-in; a quick
 * flyover, a touch, save-data and a supply do not. The drawer then finds the
 * cache and asks nothing more. Each case fails without the hover handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useItemPrefetch } from './use-item-prefetch';
import ItemDrawer from './ItemDrawer';
import type { InvRow } from './useInventoryNextData';
import { inventoryItemKeys } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ figures: vi.fn(), usedIn: vi.fn(), nutrition: vi.fn(), dishes: vi.fn(), drinks: vi.fn(), taste: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: api.taste }));
vi.mock('../../../services/api/itemDishes', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemDishes: api.dishes,
  getItemDrinks: api.drinks,
}));
vi.mock('./RowDropdown', () => ({ default: () => <div data-testid="row-dropdown" /> }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemFigures: api.figures,
  getItemUsedIn: api.usedIn,
  getItemNutrition: api.nutrition,
}));

const RID = 'r1';
const kinds: Record<string, string> = { a: 'wine', s: 'supply' };

function List() {
  const p = useItemPrefetch(RID, (id) => kinds[id]);
  return (
    <div data-testid="list" onPointerOver={p.onPointerOver} onPointerOut={p.onPointerOut} onPointerDown={p.onPointerDown} onFocus={p.onFocusRow} onBlur={p.onBlurRow}>
      {['a', 'b', 's'].map((id) => (
        <button key={id} data-row-id={id} data-testid={`row-${id}`}>row {id}</button>
      ))}
    </div>
  );
}

// The real table: `data-row-id` sits on the title button only; the other cells of the row are bare.
function TableList() {
  const p = useItemPrefetch(RID, (id) => kinds[id]);
  return (
    <table onPointerOver={p.onPointerOver} onPointerOut={p.onPointerOut}>
      <tbody>
        <tr data-testid="tr-a"><td><button data-row-id="a">Title a</button></td><td data-testid="cell-a">12 / 14</td><td data-testid="cell-a2">US$30</td></tr>
        <tr><td><button data-row-id="b">Title b</button></td><td data-testid="cell-b">3 / 4</td></tr>
      </tbody>
    </table>
  );
}

let qc: QueryClient;
const mount = () => render(<QueryClientProvider client={qc}><List /></QueryClientProvider>);
const cached = (id: string) =>
  [inventoryItemKeys.figures(RID, id), inventoryItemKeys.nutrition(RID, id), inventoryItemKeys.usedIn(RID, id)].map(
    (k) => qc.getQueryData(k) !== undefined,
  );

beforeEach(() => {
  vi.useFakeTimers();
  qc = new QueryClient();
  api.figures.mockReset().mockResolvedValue({
    waste: { readable: true, qty30d: 2, given30d: 1, value30d: 80, source: 'w' },
    countGap: { readable: true, last: [{ countedAt: '2026-09-30T10:00:00Z', expected: 13, counted: 12, variance: -1, by: 'A', money: -40 }], source: 'c' },
    costTrend: { readable: true, points: [{ receivedAt: '2026-08-01T10:00:00Z', unitCost: 37 }, { receivedAt: '2026-09-01T10:00:00Z', unitCost: 40 }], changePct: 8, source: 't' },
  });
  const grp = { readable: true, lines: [], source: '' };
  api.usedIn.mockReset().mockResolvedValue({ item: { id: 'a', kind: 'wine', displayName: null }, soldAs: grp, inCocktails: grp, namedNotLinked: grp });
  api.nutrition.mockReset().mockResolvedValue({ item: { id: 'a', name: 'A', kind: 'wine', uom: 'bottle' }, suggestedBasis: '100ml', figures: null, allergens: [] });
  api.dishes.mockReset().mockImplementation(() => new Promise(() => undefined));
  api.drinks.mockReset().mockImplementation(() => new Promise(() => undefined));
  api.taste.mockReset().mockResolvedValue({ state: 'absent' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
});

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe('hover-intent prefetch of a good', () => {
  it('a 150 ms rest puts the three reads in the cache with no drawer mounted', async () => {
    mount();
    fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(cached('a')).toEqual([true, true, true]);
    expect(api.figures).toHaveBeenCalledTimes(1);
    expect(api.nutrition).toHaveBeenCalledTimes(1);
    expect(api.usedIn).toHaveBeenCalledTimes(1);
  });

  it('a 100 ms flyover fetches nothing', async () => {
    mount();
    fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.pointerOut(screen.getByTestId('row-a'), { pointerType: 'mouse', relatedTarget: document.body });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.figures).not.toHaveBeenCalled();
    expect(api.usedIn).not.toHaveBeenCalled();
  });

  it('keyboard focus that stays warms the row; a touch does not', async () => {
    mount();
    fireEvent.focus(screen.getByTestId('row-b'));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(api.figures).toHaveBeenCalledTimes(1);
    api.figures.mockClear();
    fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'touch' });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(api.figures).not.toHaveBeenCalled();
  });

  it('save-data skips it, and a supply is never asked for nutrition', async () => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    mount();
    fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.figures).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
    fireEvent.pointerOver(screen.getByTestId('row-s'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect(api.figures).toHaveBeenCalledTimes(1);
    expect(api.nutrition).not.toHaveBeenCalled();
  });

  it('resting on the same row again while its prefetch is in flight asks once', async () => {
    api.figures.mockImplementation(() => new Promise(() => undefined));
    mount();
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'mouse' });
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      fireEvent.pointerOut(screen.getByTestId('row-a'), { pointerType: 'mouse', relatedTarget: document.body });
    }
    expect(api.figures).toHaveBeenCalledTimes(1);
  });

  it('a drawer opened after the prefetch issues no second request for those three reads', async () => {
    mount();
    fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await settle();
    expect([api.figures.mock.calls.length, api.nutrition.mock.calls.length, api.usedIn.mock.calls.length]).toEqual([1, 1, 1]);
    cleanup();
    const row = {
      id: 'a', wineId: 'w1', name: 'A', libraryName: null, producer: 'P', type: 'red', kind: 'wine', vintage: 2016, grape: null,
      bottleSizeMl: 750, stock: 12, shadow: 0, par: 6, reorderPoint: null, analyticsReadable: true, velocity: 1, runway: 12,
      daysSinceSale: 1, deadStock: false, usageSource: null, usageSince: null, usageUntil: null, usageQty: null, bottle: 92,
      glass: 18, pourMl: 150, wac: 40, costProvenance: 'invoice', value: 480, lastCountedAt: '2026-09-30T10:00:00Z', openMl: null,
      zones: [{ locationId: 'z1', qty: 12 }], providerId: null, providerName: null, standing: 'above', active: true,
    } as unknown as InvRow;
    render(
      <QueryClientProvider client={qc}>
        <ItemDrawer
          row={row}
          house={{ kind: null, uom: null, displayName: null }}
          canManage
          currency={{ state: 'recorded', code: 'EUR' }}
          zoneName={() => 'Cave'}
          locations={[]}
          locationsUnavailable={false}
          providers={[]}
          providersError={null}
          restaurantId={RID}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await settle();
    expect([api.figures.mock.calls.length, api.nutrition.mock.calls.length, api.usedIn.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it('resting on any cell of a table row warms that row, and moving between its cells keeps the wait', async () => {
    render(<QueryClientProvider client={qc}><TableList /></QueryClientProvider>);
    fireEvent.pointerOver(screen.getByTestId('cell-a'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.pointerOut(screen.getByTestId('cell-a'), { pointerType: 'mouse', relatedTarget: screen.getByTestId('cell-a2') });
    fireEvent.pointerOver(screen.getByTestId('cell-a2'), { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    await settle();
    expect(cached('a')).toEqual([true, true, true]);
    expect(api.figures).toHaveBeenCalledTimes(1);
  });
});
