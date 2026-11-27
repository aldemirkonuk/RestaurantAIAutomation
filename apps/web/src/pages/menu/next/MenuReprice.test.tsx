/**
 * r108 menu-g9: "Raise prices" on /menu makes a new DRAFT and opens its plan;
 * the preview is the gateway's own arithmetic (menu-reprice.ts mirrors
 * apps/api-gateway/src/menus/menu-reprice.ts, and these cases match its spec).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuReprice, repriceSentence, sectionsOf, typedPercent } from './MenuReprice';
import { repricePrice, repriceLine } from './menu-reprice';
import { repriceMenu, type MenuLine } from '../../../services/api/menus';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, repriceMenu: vi.fn() };
});
vi.mock('./MenuPlan', () => ({
  MenuPlan: ({ menuId }: { menuId: string }) => <div data-testid="plan-for">{menuId}</div>,
}));

const css = readFileSync(resolve(__dirname, '../../../components/mudavym/drop-zone.css'), 'utf8');

let n = 0;
const line = (over: Partial<MenuLine> = {}): MenuLine =>
  ({
    id: `l-${++n}`,
    name: `Wine ${n}`,
    producer: null,
    category: 'Red',
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: null,
    bottle_price: 9.5,
    wine_library_id: null,
    inventory_item_id: null,
    source: 'scan',
    status: 'approved',
    created_at: '2027-01-01T00:00:00Z',
    ...over,
  }) as MenuLine;

function mount(lines: MenuLine[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuReprice menuId="cur-1" lines={lines} money={(v) => (v === null ? '—' : v.toFixed(2))} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(repriceMenu).mockReset());

describe('the page arithmetic is the gateway arithmetic', () => {
  it.each([
    [9.5, 10, 0.5, 10.5],
    [45, 7.5, 1, 48],
    [33.33, 3, 0.01, 34.33],
    [1, 0.5, 0.01, 1.01],
    [4, -50, 10, 4],
  ])('%p moved %p%% to the nearest %p is %p', (old, p, step, out) => expect(repricePrice(old, p, step)).toBe(out));
  it('a blank price stays blank', () => expect(repricePrice(null, 10, 1)).toBeNull());
  it('a line held in another money is left as printed', () =>
    expect(repriceLine({ bottle_price: 50, price_flag: 'other_currency' }, 10, 1).bottle_price).toBe(50));
});

describe('helpers', () => {
  it('sections come in first-appearance order, a line with none as ""', () =>
    expect(sectionsOf([{ category: 'White' }, { category: null }, { category: 'Red' }, { category: 'White' }])).toEqual([
      'White',
      '',
      'Red',
    ]));
  it('a typed percent reads 7,5 and +10', () => {
    expect(typedPercent('7,5')).toBe(7.5);
    expect(typedPercent('+10')).toBe(10);
    expect(typedPercent('ten')).toBeNaN();
  });
  it('the reply is said in one sentence that says no price changed yet', () =>
    expect(repriceSentence({ menuId: 'd', name: 'Wine List, prices +10%', changed: 3, unchanged: 1, heldOtherMoney: 2 })).toMatch(
      /3 lines with a new price, 1 as they were, 2 priced in another money.*No price has changed yet/,
    ));
});

describe('<MenuReprice>', () => {
  it('the fold is closed until asked, and opens with no transition under reduced motion', () => {
    mount([line()]);
    const body = document.getElementById('menu-reprice-body')!;
    expect(body.dataset.open).toBe('false');
    fireEvent.click(screen.getByTestId('menu-reprice-cue'));
    expect(body.dataset.open).toBe('true');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.mdv-fold__body[\s\S]*?transition:\s*none/);
  });

  it('previews the first five moved lines, before -> after', () => {
    mount(Array.from({ length: 7 }, () => line()));
    fireEvent.change(screen.getByTestId('menu-reprice-percent'), { target: { value: '10' } });
    const rows = screen.getAllByTestId('menu-reprice-preview-row');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText('9.50 → 10.50')).toBeTruthy();
  });

  it('only the chosen sections show and are sent', async () => {
    vi.mocked(repriceMenu).mockResolvedValue({ menuId: 'draft-9', name: 'x', changed: 1, unchanged: 1, heldOtherMoney: 0 });
    mount([line({ category: 'Red', name: 'R' }), line({ category: 'White', name: 'W', bottle_price: 40 })]);
    fireEvent.change(screen.getByTestId('menu-reprice-percent'), { target: { value: '10' } });
    fireEvent.click(screen.getAllByTestId('menu-reprice-section')[0]); // Red off
    expect(screen.getAllByTestId('menu-reprice-preview-row').map((r) => r.textContent)).toEqual(['W40.00 → 44.00—']);
    fireEvent.click(screen.getByTestId('menu-reprice-go'));
    await waitFor(() => expect(repriceMenu).toHaveBeenCalledWith('cur-1', { percent: 10, roundTo: 0.5, sections: ['White'] }));
  });

  it('0% and an out-of-bounds percent are refused in words, and nothing is sent', () => {
    mount([line()]);
    fireEvent.change(screen.getByTestId('menu-reprice-percent'), { target: { value: '0' } });
    expect(screen.getByRole('alert').textContent).toMatch(/0% changes nothing/);
    fireEvent.change(screen.getByTestId('menu-reprice-percent'), { target: { value: '150' } });
    expect(screen.getByRole('alert').textContent).toMatch(/-50 to \+100/);
    expect((screen.getByTestId('menu-reprice-go') as HTMLButtonElement).disabled).toBe(true);
    expect(repriceMenu).not.toHaveBeenCalled();
  });

  it('submitting makes a draft of every section and opens that draft\'s plan', async () => {
    vi.mocked(repriceMenu).mockResolvedValue({ menuId: 'draft-1', name: 'Wine List, prices +10%', changed: 1, unchanged: 0, heldOtherMoney: 0 });
    mount([line()]);
    fireEvent.change(screen.getByTestId('menu-reprice-percent'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('menu-reprice-go'));
    await waitFor(() => expect(screen.getByTestId('plan-for').textContent).toBe('draft-1'));
    expect(repriceMenu).toHaveBeenCalledWith('cur-1', { percent: 10, roundTo: 0.5 });
    expect(screen.getByTestId('menu-reprice-said').textContent).toMatch(/No price has changed yet/);
  });

  it("the gateway's refusal is said in its words, in an alert", async () => {
    vi.mocked(repriceMenu).mockRejectedValueOnce({ response: { data: { message: "Only managers and owners can raise the menu's prices" } } });
    mount([line()]);
    fireEvent.change(screen.getByTestId('menu-reprice-percent'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('menu-reprice-go'));
    await waitFor(() => expect(screen.getByTestId('menu-reprice-refused').textContent).toMatch(/Only managers and owners/));
    expect(screen.queryByTestId('plan-for')).toBeNull();
  });
});
