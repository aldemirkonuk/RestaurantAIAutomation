/**
 * PricePick across kinds (ADR 0340 rules 19, 21; lane 6). With Drinks and
 * Desserts live, a line names its menu; a correction that moves the house
 * price says the other live kinds it also changed on; and the make-live
 * review's conflict pick names each price's menu and holds the pick.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ConflictPick, PricePick, alsoOnKinds, conflictKey } from './PricePick';
import { reviewMenuItem, type MenuLine, type PriceConflict } from '../../../services/api/menus';
import { listPriceLocks } from '../../../services/api/pricing';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, reviewMenuItem: vi.fn(), getMenu: vi.fn() };
});
vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>('../../../services/api/pricing');
  return { ...actual, listPriceLocks: vi.fn(), changeLockedPrice: vi.fn() };
});

const mockReview = vi.mocked(reviewMenuItem);
const mockLocks = vi.mocked(listPriceLocks);
const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2));

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

function item(over: Partial<MenuLine>): MenuLine {
  return {
    id: 'l1',
    name: 'Tokaji',
    producer: null,
    category: null,
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: null,
    bottle_price: 900,
    wine_library_id: 'w1',
    inventory_item_id: 'inv-1',
    source: 'scan',
    status: 'approved',
    created_at: '2026-10-01T00:00:00Z',
    menu_id: 'm-drinks',
    menu_type: 'beverage',
    line_kind: 'drink',
    ...over,
  };
}

beforeEach(() => {
  mockReview.mockReset();
  mockLocks.mockReset();
  mockLocks.mockResolvedValue({ readable: true, locks: [] } as never);
});

describe('alsoOnKinds (rule 21)', () => {
  it('names the other live kinds the same house item is a drink on, once each', () => {
    const items = [
      item({}),
      item({ id: 'l2', menu_id: 'm-des', menu_type: 'desserts' }),
      item({ id: 'l3', menu_id: 'm-des', menu_type: 'desserts' }),
      item({ id: 'l4', menu_id: 'm-food', menu_type: 'food', line_kind: 'dish' }),
      item({ id: 'l5', inventory_item_id: 'inv-2', menu_type: 'food' }),
    ];
    expect(alsoOnKinds(items, items[0])).toEqual(['Desserts']);
  });

  it('is empty for a line with no house item, or a reply that does not say its menu', () => {
    const items = [item({}), item({ id: 'l2', menu_type: 'desserts' })];
    expect(alsoOnKinds(items, item({ inventory_item_id: null }))).toEqual([]);
    expect(alsoOnKinds(items, item({ menu_type: undefined }))).toEqual([]);
  });
});

describe('PricePick across kinds', () => {
  it('names the menu, and a correction that moved the house price says where else it changed', async () => {
    mockReview.mockResolvedValue({ menuItemId: 'l1', fieldName: 'bottle_price', newValue: '900', priceSync: 'changed' });
    wrap(
      <PricePick
        house="h1"
        inventoryId="inv-1"
        lineId="l1"
        kind="bottle"
        linePrice={900}
        housePrice={950}
        canPick
        fmt={fmt}
        menuKind="Drinks"
        alsoOn={['Desserts']}
      />,
    );
    expect(screen.getByTestId('menu-house-price-bottle')).toHaveTextContent('Your price 950.00 — the Drinks menu says 900.00');
    fireEvent.click(screen.getByTestId('price-pick-menu-bottle'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The house now charges 900.00, as the menu says; also changed on Desserts.',
    );
  });

  it('with one kind live, says "the menu" and names nowhere else', async () => {
    mockReview.mockResolvedValue({ menuItemId: 'l1', fieldName: 'bottle_price', newValue: '900', priceSync: 'changed' });
    wrap(<PricePick house="h1" inventoryId="inv-1" lineId="l1" kind="bottle" linePrice={900} housePrice={950} canPick fmt={fmt} />);
    expect(screen.getByTestId('menu-house-price-bottle')).toHaveTextContent('Your price 950.00 — the menu says 900.00');
    fireEvent.click(screen.getByTestId('price-pick-menu-bottle'));
    expect(await screen.findByRole('status')).toHaveTextContent(/^The house now charges 900\.00, as the menu says\.$/);
  });
});

const CONFLICT: PriceConflict = {
  wineLibraryId: 'w1',
  inventoryId: 'inv-1',
  kind: 'bottle',
  name: 'Tokaji',
  prices: [
    { price: 950, menuId: 'm-drinks', menuItemId: 'l1', live: false, menuKind: 'beverage' },
    { price: 1000, menuId: 'm-des', menuItemId: 'l2', live: true, menuKind: 'desserts' },
  ],
};

describe('ConflictPick (rule 19)', () => {
  it('names each price\'s menu and whether it is live, and a tap picks one', () => {
    const onPick = vi.fn();
    render(
      <ul>
        <ConflictPick conflict={CONFLICT} picked={null} canPick onPick={onPick} fmt={fmt} />
      </ul>,
    );
    expect(screen.getByTestId('conflict-pick')).toHaveTextContent('Tokaji (bottle): 950.00 on Drinks (draft) · 1000.00 on Desserts (live)');
    fireEvent.click(screen.getByRole('button', { name: '1000.00' }));
    expect(onPick).toHaveBeenCalledWith(1000);
    expect(conflictKey(CONFLICT)).toBe('w1:bottle');
  });

  it('a held pick is pressed and said; staff get no buttons', () => {
    const { rerender } = render(
      <ul>
        <ConflictPick conflict={CONFLICT} picked={950} canPick onPick={vi.fn()} fmt={fmt} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: '950.00' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Picked 950\.00: every draft line of it takes this price/)).toBeInTheDocument();
    rerender(
      <ul>
        <ConflictPick conflict={CONFLICT} picked={null} canPick={false} onPick={vi.fn()} fmt={fmt} />
      </ul>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
