/**
 * The table and the phone's cards draw only the rows near the screen (r104 g2).
 * A house of 1,200 goods puts a few dozen rows in the page, a scroll brings a
 * late one in, a link to a late good draws it at first paint, and the list
 * stays whole for everything that reads it (select-all, the counts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InventoryTable, { GROUP_PX, ROW_PX, type InventoryTableProps } from './InventoryTable';
import { type InvRow } from './useInventoryNextData';

vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ bottle }: { bottle: number | null }) => <span data-testid="price-cell">{bottle}</span>,
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1',
    wineId: 'w1',
    name: 'Gravner Ribolla',
    libraryName: null,
    producer: 'Gravner',
    type: 'orange',
    kind: 'wine',
    vintage: 2016,
    grape: null,
    bottleSizeMl: 750,
    stock: 12,
    shadow: 0,
    par: 4,
    reorderPoint: null,
    analyticsReadable: true,
    velocity: 1,
    runway: 12,
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
    value: 480,
    lastCountedAt: null,
    openMl: null,
    zones: [{ locationId: 'z1', qty: 12 }],
    providerId: null,
    providerName: null,
    standing: 'above',
    active: true,
    ...over,
  };
}

const N = 1200;
const many = (over: (i: number) => Partial<InvRow> = () => ({})): InvRow[] =>
  Array.from({ length: N }, (_, i) => row({ id: `i${i}`, wineId: `w${i}`, name: `Good ${i}`, ...over(i) }));

function setPhone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('767'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const base: Omit<InventoryTableProps, 'rows'> = {
  openId: null,
  onToggle: vi.fn(),
  canManage: false,
  currency: { state: 'recorded', code: 'EUR' },
  zoneName: () => 'Cellar',
  locations: [],
  locationsUnavailable: false,
  providers: [],
  providersError: null,
  restaurantId: 'r1',
  advice: { status: 'loading' },
  onPriceChanged: vi.fn(),
  grouped: false,
};
const draw = (rows: InvRow[], over: Partial<InventoryTableProps> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InventoryTable {...base} rows={rows} {...over} />
    </QueryClientProvider>,
  );

/** Put the list's top `y` px above the screen's top, as a scrolled page does. */
function scrollTo(selector: string, y: number) {
  const el = document.querySelector(selector) as HTMLElement;
  el.getBoundingClientRect = () => ({ top: -y, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: -y, toJSON: () => ({}) });
  window.dispatchEvent(new Event('scroll'));
}

const original = window.matchMedia;
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

describe('the table draws only the rows near the screen', () => {
  beforeEach(() => setPhone(false));

  it('1,200 goods put at most 80 rows in the page, with the rest held as blank height', () => {
    draw(many());
    const drawn = document.querySelectorAll('tr.iv-row').length;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThanOrEqual(80);
    const after = screen.getByTestId('inv-rows-after').querySelector('td') as HTMLElement;
    expect(parseInt(after.style.height, 10)).toBe((N - drawn) * ROW_PX);
    expect(screen.queryByTestId('inv-rows-before')).toBeNull();
  });

  it('a scroll draws a late good and lets the first ones go', async () => {
    draw(many());
    expect(screen.queryByTestId('inv-row-i1000')).toBeNull();
    scrollTo('.iv-tablewrap', 1000 * ROW_PX);
    await waitFor(() => expect(screen.getByTestId('inv-row-i1000')).toBeTruthy());
    expect(screen.queryByTestId('inv-row-i0')).toBeNull();
    expect(document.querySelectorAll('tr.iv-row').length).toBeLessThanOrEqual(80);
  });

  it('a good opened by a link is drawn at the first paint, wherever it sits', () => {
    draw(many(), { openId: 'i1100' });
    expect(document.getElementById('iv-row-i1100')).not.toBeNull();
    expect(document.querySelectorAll('tr.iv-row').length).toBeLessThanOrEqual(80);
  });

  it('a good opened from outside the window is brought in', async () => {
    const view = draw(many());
    expect(screen.queryByTestId('inv-row-i900')).toBeNull();
    view.rerender(<InventoryTable {...base} rows={many()} openId="i900" />);
    await waitFor(() => expect(screen.getByTestId('inv-row-i900')).toBeTruthy());
  });

  it('select-all still covers every listed good, not the ones drawn', () => {
    const rows = many();
    const onSelectAll = vi.fn();
    draw(rows, { selected: new Set(rows.map((r) => r.id)), onSelect: vi.fn(), onSelectAll });
    const head = screen.getByLabelText('Clear the selection') as HTMLInputElement;
    expect(head.checked).toBe(true);
    expect(document.querySelectorAll('tr.iv-row').length).toBeLessThanOrEqual(80);
    fireEvent.click(head);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('a good that holds the keyboard stays drawn when the window moves past it', async () => {
    draw(many());
    const btn = document.querySelector('[data-row-id="i3"]') as HTMLButtonElement;
    btn.focus();
    scrollTo('.iv-tablewrap', 60 * ROW_PX);
    await waitFor(() => expect(screen.getByTestId('inv-row-i60')).toBeTruthy());
    expect(document.querySelector('[data-row-id="i3"]')).not.toBeNull();
  });

  it('grouped, the heads and the screen reader count stay right across the window', async () => {
    const rows = many((i) => (i < 5 ? { stock: 0, standing: 'out' as const } : {}));
    draw(rows, { grouped: true });
    const table = screen.getByTestId('inventory-table');
    const heads = new Set(rows.map((r) => (r.stock === 0 ? 0 : 2))).size;
    expect(table.getAttribute('aria-rowcount')).toBe(String(N + heads + 1));
    expect(document.querySelectorAll('tr.iv-group').length).toBe(heads);
    scrollTo('.iv-tablewrap', 700 * ROW_PX + heads * GROUP_PX);
    await waitFor(() => expect(screen.getByTestId('inv-row-i700')).toBeTruthy());
    const at = Number(screen.getByTestId('inv-row-i700').getAttribute('aria-rowindex'));
    expect(at).toBe(700 + heads + 2);
  });
});

describe("the phone's cards draw only the cards near the screen", () => {
  beforeEach(() => setPhone(true));

  it('1,200 goods put at most 80 cards in the page', () => {
    draw(many());
    const drawn = document.querySelectorAll('.ivc-card').length;
    expect(drawn).toBeGreaterThan(5);
    expect(drawn).toBeLessThanOrEqual(80);
    expect(screen.getByTestId('inv-cards-after')).toBeTruthy();
  });

  it('a scroll draws a late card', async () => {
    draw(many());
    scrollTo('.ivc-list', 1000 * 72);
    await waitFor(() => expect(screen.getByTestId('inv-row-i1000')).toBeTruthy());
    expect(document.querySelectorAll('.ivc-card').length).toBeLessThanOrEqual(80);
  });

  it('a good opened by a link is drawn at the first paint', () => {
    draw(many(), { openId: 'i1150' });
    expect(screen.getByTestId('inv-row-i1150')).toBeTruthy();
  });

  it('select-all still reads the whole list', () => {
    const rows = many();
    draw(rows, { selected: new Set(rows.map((r) => r.id)), onSelect: vi.fn(), onSelectAll: vi.fn() });
    expect((document.querySelector('.ivc-selectall input') as HTMLInputElement).checked).toBe(true);
  });
});
