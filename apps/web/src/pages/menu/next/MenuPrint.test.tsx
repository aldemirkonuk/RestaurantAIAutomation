/**
 * r110 menu-g3: the current menu printed for the guests. Sections in printed order, a blank
 * price printed as none, every line of a 1001-line menu, the house's money, and a refusal
 * (with no print) while prices are still being carried to the house.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MenuPrint, { printedHeading, printedPrices, printedSections } from './MenuPrint';
import { getMenu, getMenuPlan, listMenuVersions, type MenuLine } from '../../../services/api/menus';
import { settingsApi, type HouseCurrency } from '../../../services/api/settings';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, activeRole: 'staff', availableRestaurants: [{ id: 'r1', name: 'Meyhouse' }] }),
}));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenu: vi.fn(), getMenuPlan: vi.fn(), listMenuVersions: vi.fn() };
});
vi.mock('../../../services/api/settings', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/settings')>('../../../services/api/settings');
  return { ...actual, settingsApi: { ...actual.settingsApi, houseCurrency: vi.fn() } };
});

const counts = (change = 0, newWine = 0) =>
  ({ change, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: newWine }) as never;

function line(over: Partial<MenuLine> & { line_no?: number | null } = {}): MenuLine {
  return {
    id: 'l1', name: 'Rakı', producer: null, category: 'Spirits', vintage: null, region: null, country: null,
    grape_variety: null, by_glass_price: null, bottle_price: 1250, wine_library_id: null, inventory_item_id: null,
    source: 'scan', status: 'approved', created_at: '2026-11-01T00:00:00Z', ...over,
  } as MenuLine;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MenuPrint />
    </QueryClientProvider>,
  );
}

const print = vi.fn();
beforeEach(() => {
  vi.mocked(getMenu).mockReset();
  vi.mocked(getMenuPlan).mockReset().mockResolvedValue({ menuId: 'm1', current: true, counts: counts() } as never);
  vi.mocked(listMenuVersions).mockReset().mockResolvedValue({
    current: { menuId: 'm1', current: true, madeCurrentAt: '2026-11-20T21:30:00Z' }, lastUsed: null, versions: [], timezone: 'Europe/Istanbul',
  } as never);
  vi.mocked(settingsApi.houseCurrency).mockReset().mockResolvedValue({ restaurantId: 'r1', code: 'TRY', country: 'Türkiye', readable: true, reason: null, statedAt: null } as HouseCurrency);
  print.mockReset();
  window.print = print;
});

describe('the menu printed for the guests', () => {
  it('lays the lines out in printed order under their sections, dishes too, with descriptions and marks', async () => {
    vi.mocked(getMenu).mockResolvedValue({
      menuId: 'm1', name: null, status: 'active',
      items: [
        line({ id: 'c', name: 'Künefe', category: 'Tatlılar', bottle_price: 150, line_no: 3, kitchen_line: true }),
        line({ id: 'a', name: 'Mercimek çorbası', category: 'Çorbalar', bottle_price: 180, line_no: 0, kitchen_line: true, description: 'Limonlu', printed_marks: ['V'] }),
        line({ id: 'b', name: 'Ezogelin', category: 'Çorbalar', bottle_price: 170, line_no: 1, kitchen_line: true }),
        line({ id: 'd', name: 'Rakı', category: 'Spirits', line_no: null }),
      ],
    });
    mount();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Çorbalar', 'Tatlılar', 'Spirits']);
    expect(screen.getAllByTestId('menu-print-line').map((l) => l.textContent)).toEqual([
      expect.stringContaining('Mercimek çorbası'),
      expect.stringContaining('Ezogelin'),
      expect.stringContaining('Künefe'),
      expect.stringContaining('Rakı'),
    ]);
    const soup = screen.getAllByTestId('menu-print-line')[0];
    expect(soup).toHaveTextContent('Limonlu');
    expect(soup).toHaveTextContent('V');
    expect(screen.getByTestId('menu-print-foot')).toHaveTextContent('Menu of Meyhouse, current since 2026-11-21.');
  });

  it('prints a line with no price with no price, never 0', async () => {
    vi.mocked(getMenu).mockResolvedValue({
      menuId: 'm1', name: null, status: 'active',
      items: [line({ id: 'a', name: 'Ayran', bottle_price: null, by_glass_price: null }), line({ id: 'b', name: 'Rakı' })],
    });
    mount();
    await waitFor(() => expect(print).toHaveBeenCalled());
    const [ayran, raki] = screen.getAllByTestId('menu-print-line');
    expect(within(ayran).queryByTestId('menu-print-price')).toBeNull();
    expect(ayran.textContent).not.toMatch(/0/);
    expect(within(raki).getByTestId('menu-print-price').textContent).toMatch(/1[.,]?250/);
  });

  it('prints every line of a 1001-line menu', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => line({ id: `l${i}`, name: `Line ${i}`, line_no: i }));
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items });
    mount();
    await waitFor(() => expect(print).toHaveBeenCalled());
    const printed = screen.getAllByTestId('menu-print-line');
    expect(printed).toHaveLength(1001);
    expect(printed[1000]).toHaveTextContent('Line 1000');
  });

  it('refuses in words, and never prints, while prices are still being carried to the house', async () => {
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items: [line()] });
    vi.mocked(getMenuPlan).mockResolvedValue({ menuId: 'm1', current: true, counts: counts(2, 1) } as never);
    mount();
    expect(await screen.findByTestId('menu-print-refused')).toHaveTextContent(
      "3 prices are still being carried to the house; print once they are, so the printed price is the till's.",
    );
    expect(screen.queryAllByTestId('menu-print-line')).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(print).not.toHaveBeenCalled();
    expect(getMenuPlan).toHaveBeenCalledWith('m1');
  });

  it('refuses when what is left to carry cannot be checked', async () => {
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items: [line()] });
    vi.mocked(getMenuPlan).mockRejectedValue({ response: { data: { message: 'the plan could not be read' } } });
    mount();
    expect(await screen.findByTestId('menu-print-refused')).toHaveTextContent(/could not be checked \(the plan could not be read\)/);
    expect(print).not.toHaveBeenCalled();
  });

  it("prints in the house's currency", async () => {
    vi.mocked(settingsApi.houseCurrency).mockResolvedValue({ restaurantId: 'r1', code: 'EUR', country: null, readable: true, reason: null, statedAt: null } as HouseCurrency);
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items: [line({ bottle_price: 42 })] });
    mount();
    await waitFor(() => expect(screen.getByTestId('menu-print-price').textContent).toMatch(/€/));
    expect(screen.getByTestId('menu-print-price').textContent).not.toMatch(/₺|\$/);
  });

  // r110 review R4: the page prints itself on fonts.ready; the currency read was never waited for.
  it('waits for the house currency before it prints, and never prints "currency not recorded"', async () => {
    let answer: (v: HouseCurrency) => void = () => {};
    vi.mocked(settingsApi.houseCurrency).mockReturnValue(new Promise<HouseCurrency>((r) => { answer = r; }));
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items: [line()] });
    mount();
    await screen.findByText(/Getting the current menu ready/);
    await new Promise((r) => setTimeout(r, 30));
    expect(print).not.toHaveBeenCalled();
    answer({ restaurantId: 'r1', code: 'TRY', country: null, readable: true, reason: null, statedAt: null } as HouseCurrency);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('menu-print-price').textContent).not.toMatch(/not recorded/);
  });

  it('refuses in words, and never prints, when the house has no currency set', async () => {
    vi.mocked(settingsApi.houseCurrency).mockResolvedValue({ restaurantId: 'r1', code: null, country: null, readable: false, reason: 'not set', statedAt: null } as HouseCurrency);
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items: [line()] });
    mount();
    expect(await screen.findByTestId('menu-print-refused')).toHaveTextContent(/no currency set.*Set the house's currency first/);
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByTestId('menu-print-price')).toBeNull();
  });

  it('refuses in words, and never prints, when the currency could not be read', async () => {
    vi.mocked(settingsApi.houseCurrency).mockRejectedValue({ response: { data: { message: 'settings are down' } } });
    vi.mocked(getMenu).mockResolvedValue({ menuId: 'm1', name: null, status: 'active', items: [line()] });
    mount();
    expect(await screen.findByTestId('menu-print-refused')).toHaveTextContent(/currency could not be read \(settings are down\)/);
    expect(print).not.toHaveBeenCalled();
  });

  it('prints a line\'s sizes when it prints two or more', async () => {
    vi.mocked(getMenu).mockResolvedValue({
      menuId: 'm1', name: null, status: 'active',
      items: [line({ printed_sizes: [{ label: '20 cl', price: 450 }, { label: '70 cl', price: 1250 }] } as never)],
    });
    mount();
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(screen.getByTestId('menu-print-price').textContent).toMatch(/^20 cl .*450.* · 70 cl .*1[.,]?250/);
  });

  // r110 review R3: PATCH and "Raise prices" change the till's price, never `printed_sizes`.
  it("prints the till's price, not a stale printed size, after a correction or a raise", async () => {
    vi.mocked(getMenu).mockResolvedValue({
      menuId: 'm1', name: null, status: 'active',
      items: [line({ by_glass_price: 15, bottle_price: 70, printed_sizes: [{ label: 'Glass', price: 15 }, { label: 'Bottle', price: 62.5 }] } as never)],
    });
    mount();
    await waitFor(() => expect(print).toHaveBeenCalled());
    const text = screen.getByTestId('menu-print-price').textContent ?? '';
    expect(text).toMatch(/Glass .*15/);
    expect(text).toMatch(/Bottle .*70/);
    expect(text).not.toMatch(/62/);
  });

  it('a sized line whose till price is unset prints no size price', () => {
    expect(printedPrices(line({ bottle_price: null, printed_sizes: [{ label: 'a', price: 1 }, { label: 'b', price: 2 }] } as never), 'TRY')).toEqual([]);
  });

  it('a line with no section and no place is printed after the placed ones, in the order received', () => {
    const s = printedSections([
      line({ id: 'x', name: 'X', category: null, line_no: null }),
      line({ id: 'y', name: 'Y', category: 'Spirits', line_no: 5 }),
      line({ id: 'z', name: 'Z', category: null, line_no: null }),
    ] as never);
    expect(s.map((x) => [x.heading, x.lines.map((l) => l.name)])).toEqual([
      ['Spirits', ['Y']],
      [null, ['X', 'Z']],
    ]);
  });

  // r110 review R7: a scanned line's category is a vocabulary word and a read dish's is "food", never the printed heading.
  it('heads a scanned wine by its vocabulary word as a heading, and a plain dish by no heading at all', () => {
    expect(['red', 'rose', 'soft drink', 'non-alcoholic'].map(printedHeading)).toEqual(['Red', 'Rosé', 'Soft drinks', 'Non-alcoholic']);
    expect(printedHeading('food')).toBeNull();
    expect(printedHeading('Çorbalar')).toBe('Çorbalar');
    expect(printedHeading('Red')).toBe('Red');
    expect(printedHeading(null)).toBeNull();
    const s = printedSections([
      line({ id: 'a', name: 'Mercimek', category: 'food', line_no: 0 }),
      line({ id: 'b', name: 'Kalecik', category: 'red', line_no: 1 }),
      line({ id: 'c', name: 'Künefe', category: 'food', line_no: 2 }),
    ] as never);
    expect(s.map((x) => [x.heading, x.lines.map((l) => l.name)])).toEqual([
      [null, ['Mercimek', 'Künefe']],
      ['Red', ['Kalecik']],
    ]);
  });
});
