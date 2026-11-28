/**
 * The palette's Goods (r108 inventory g13): one cache with /inventory, keyed
 * by the active house; local ranking with no read per keystroke; a row with
 * no money for any role; Enter opens the good's drawer.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { queryKeys } from '../../lib/query-keys';
import type { InventoryItem } from '../../services/api/types';
import { GOODS_CAP, goodsFrom, onHandWords, rankGoods, usePaletteGoods } from './paletteGoods';

const { getInventory, auth } = vi.hoisted(() => ({
  getInventory: vi.fn<(rid: string) => Promise<unknown[]>>(),
  auth: { user: { restaurantId: 'A' }, activeRestaurantId: 'A' as string | null },
}));
vi.mock('../../services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  inventoryApi: { getInventory: (rid: string) => getInventory(rid) },
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { get: () => Promise.resolve({ data: {} }) },
}));

const A = 'A';
const B = 'B';
const good = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, wineName: id, stockLive: 12, kind: 'wine', uom: 'bottle', ...over }) as unknown as InventoryItem;
const HOUSE_A = [
  good('Barolo Riserva', { id: 'a1', wineName: 'Barolo Riserva', wineProducer: 'Giacomo Conterno', libraryName: 'Monfortino 2015' }),
  good('Flour', { id: 'a2', wineName: 'Flour', kind: 'food', uom: 'kg', stockLive: 3.5 }),
];
const HOUSE_B = [good('Bordeaux', { id: 'b1', wineName: 'Bordeaux' })];

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getInventory.mockReset();
  auth.activeRestaurantId = A;
});

describe('goods rows', () => {
  it('a row says the house name, the kind and what is on hand, and no money for any role', () => {
    const rich = good('x', { id: 'x1', wineName: 'Chablis', wac: 12.37, menuPriceBottle: 64.5, value: 148.44, last_purchase_price: 11.9 });
    const [row] = rankGoods(goodsFrom([rich]), 'chab');
    expect(row).toMatchObject({ title: 'Chablis', subtitle: 'Wine · 12 bottles', section: 'Goods', href: '/inventory?open=x1' });
    expect(JSON.stringify(row)).not.toMatch(/12\.37|64\.5|148\.44|11\.9/);
  });

  it('finds a good by its producer or its library name, and caps at 8', () => {
    const goods = goodsFrom(HOUSE_A);
    expect(rankGoods(goods, 'conterno').map((c) => c.title)).toEqual(['Barolo Riserva']);
    expect(rankGoods(goods, 'monfortino').map((c) => c.title)).toEqual(['Barolo Riserva']);
    const many = goodsFrom(Array.from({ length: 30 }, (_, i) => good(`Gin ${i}`, { id: `g${i}`, wineName: `Gin ${i}` })));
    expect(rankGoods(many, 'gin')).toHaveLength(GOODS_CAP);
    expect(rankGoods(many, '')).toEqual([]);
  });

  it('says a measure as it is, and a piece in its plural', () => {
    expect(onHandWords(3.5, 'kg')).toBe('3.5 kg');
    expect(onHandWords(1, 'bottle')).toBe('1 bottle');
    expect(onHandWords(2, 'glass')).toBe('2 glasses');
    expect(onHandWords(null, 'kg')).toBe('On hand not read');
  });
});

describe('one cache with /inventory, keyed by the house', () => {
  it('reads the list /inventory has cached under its own key, with no request', async () => {
    qc.setQueryData(queryKeys.inventory.list(A), HOUSE_A);
    const { result } = renderHook(() => usePaletteGoods(true, A, 'barolo'), { wrapper });
    await waitFor(() => expect(result.current.map((c) => c.title)).toEqual(['Barolo Riserva']));
    expect(getInventory).not.toHaveBeenCalled();
  });

  it("house A's cache is never ranked under house B, even while B's list is on its way", async () => {
    qc.setQueryData(queryKeys.inventory.list(A), HOUSE_A);
    let landB: (v: unknown[]) => void = () => {};
    getInventory.mockImplementation((rid) => (rid === B ? new Promise((ok) => (landB = ok)) : Promise.resolve([])));
    const { result, rerender } = renderHook(({ rid, q }) => usePaletteGoods(true, rid, q), {
      wrapper,
      initialProps: { rid: A, q: 'b' },
    });
    await waitFor(() => expect(result.current.map((c) => c.title)).toContain('Barolo Riserva'));
    rerender({ rid: B, q: 'b' });
    expect(result.current.map((c) => c.title)).not.toContain('Barolo Riserva');
    expect(getInventory).toHaveBeenCalledWith(B);
    await act(async () => landB(HOUSE_B));
    await waitFor(() => expect(result.current.map((c) => c.title)).toEqual(['Bordeaux']));
  });

  it('a keystroke reaches no network: one read per open, the ranking is local', async () => {
    getInventory.mockResolvedValue(HOUSE_A);
    const { result, rerender } = renderHook(({ q }) => usePaletteGoods(true, A, q), { wrapper, initialProps: { q: '' } });
    for (const q of ['f', 'fl', 'flo', 'flou', 'flour']) rerender({ q });
    await waitFor(() => expect(result.current.map((c) => c.title)).toEqual(['Flour']));
    expect(getInventory).toHaveBeenCalledTimes(1);
  });

  it('a closed palette reads nothing', () => {
    renderHook(() => usePaletteGoods(false, A, 'flour'), { wrapper });
    expect(getInventory).not.toHaveBeenCalled();
  });
});

describe('in the palette', () => {
  it('Enter on a good opens its drawer at /inventory?open=<id>', async () => {
    qc.setQueryData(queryKeys.inventory.list(A), HOUSE_A);
    // jsdom draws no layout, so it has no scrollIntoView for the active row.
    Element.prototype.scrollIntoView = () => {};
    const { CommandPalette } = await import('./CommandPalette');
    const Where = () => {
      const l = useLocation();
      return createElement('p', { 'data-testid': 'where' }, `${l.pathname}${l.search}`);
    };
    render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ['/'] },
          createElement(CommandPalette, { open: true, onClose: () => {} }),
          createElement(Routes, null, createElement(Route, { path: '*', element: createElement(Where) })),
        ),
      ),
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'conterno' } });
    await screen.findByText('Barolo Riserva');
    expect(screen.getByText('Goods')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/inventory?open=a1');
  });
});
