/**
 * /inventory on a phone (critic c2 P0-2): the table hands its rows to two-line
 * cards below 768 px, a tap opens the same drawer, and the touch rules (44 px
 * chips, 16 px fields) live in the stylesheet this page loads.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import InventoryTable, { type InventoryTableProps } from './InventoryTable';
import type { InvRow } from './useInventoryNextData';

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

function setPhone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('767'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const toggle = vi.fn();
const base: Omit<InventoryTableProps, 'rows'> = {
  openId: null,
  onToggle: toggle,
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
  render(<InventoryTable {...base} rows={rows} {...over} />);

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
  toggle.mockClear();
});

describe('/inventory on a phone', () => {
  beforeEach(() => setPhone(true));

  it('draws a good as two lines in a card, not a table row', () => {
    draw([row()]);
    expect(screen.queryByTestId('inventory-table')).toBeNull();
    const card = screen.getByTestId('inv-row-i1');
    expect(within(card).getByText('Gravner Ribolla')).toBeTruthy();
    expect(within(card).getByText('12 live · par 4')).toBeTruthy();
    expect(card.textContent).toContain('92');
  });

  it('says the status in a word a reader can hear, and shows it when it needs you', () => {
    draw([row({ id: 'a', standing: 'above' }), row({ id: 'b', name: 'Low one', standing: 'below', stock: 1 })]);
    expect(within(screen.getByTestId('inv-row-a')).getByText('Above par').className).toContain('iv-sr');
    expect(within(screen.getByTestId('inv-row-b')).getByText('Below par').className).toContain('ivc-word');
  });

  it('shows an unread count as a dash, never zero', () => {
    draw([row({ stock: null, par: null, standing: 'unknown' })]);
    expect(screen.getByText('— live · par —')).toBeTruthy();
  });

  it('opens the drawer from the tap and says it is open', () => {
    const { rerender } = draw([row()]);
    fireEvent.click(screen.getByRole('button', { name: /Gravner Ribolla/ }));
    expect(toggle).toHaveBeenCalledWith('i1');
    rerender(<InventoryTable {...base} rows={[row()]} openId="i1" />);
    expect(screen.getByRole('button', { name: /Gravner Ribolla/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the group heads of "Needs you first"', () => {
    draw([row({ id: 'o', standing: 'out', stock: 0 }), row({ id: 'k' })], { grouped: true });
    expect(screen.getByRole('heading', { name: /^Out/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Everything else, by runway' })).toBeTruthy();
  });

  it('lets a manager set the price from the card and shows a reader the figure', () => {
    const { unmount } = draw([row()], { canManage: true });
    expect(screen.getByTestId('price-cell')).toBeTruthy();
    unmount();
    draw([row()]);
    expect(screen.queryByTestId('price-cell')).toBeNull();
  });

  it('selects from a 44 px checkbox beside the card', () => {
    const onSelect = vi.fn();
    draw([row()], { selected: new Set<string>(), onSelect, onSelectAll: vi.fn() });
    fireEvent.click(screen.getByLabelText('Select Gravner Ribolla'));
    expect(onSelect).toHaveBeenCalledWith('i1');
  });
});

describe('/inventory on a wide screen', () => {
  it('keeps the table', () => {
    setPhone(false);
    draw([row()]);
    expect(screen.getByTestId('inventory-table')).toBeTruthy();
    expect(screen.queryByTestId('inventory-cards')).toBeNull();
  });
});

describe('the touch rules', () => {
  const here = (f: string) => readFileSync(resolve(process.cwd(), 'src/pages/inventory/next', f), 'utf8');
  const css = here('inventory-next.css');
  const touch = css.slice(css.indexOf('touch: 44 px targets'));

  it('raises the chips to 44 px and fields to 16 px on a phone or a coarse pointer', () => {
    const block = touch.slice(0, touch.indexOf('phone: the filter chips'));
    expect(block).toMatch(/@media \(max-width: 767px\), \(pointer: coarse\)/);
    expect(block).toMatch(/\.iv-page \.iv-chip,[\s\S]*?min-height: 44px/);
    expect(block).toMatch(/\.iv-page \.iv-field,[\s\S]*?font-size: 16px/);
  });

  it('gives the price button and its editor fields 44 px and 16 px on a card', () => {
    const block = touch.slice(0, touch.indexOf('phone: the filter chips'));
    expect(block).toMatch(/\.iv-page \.ivc-price button,\s*\.iv-page \.ivc-price input \{\s*min-height: 44px;/);
    expect(block).toMatch(/\.iv-page \.ivc-price input \{\s*font-size: 16px;/);
  });

  it('moves only transform and opacity, and never says transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/);
    const cards = css.slice(css.indexOf('phone cards:'));
    expect(cards).toMatch(/transition: transform 90ms/);
    expect(cards).toMatch(/@keyframes ivc-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(6px\);/);
  });

  it('lets the drawer be a bottom sheet at 639 px and below', () => {
    const drawer = here('item-drawer.css');
    expect(drawer).toMatch(/@media \(min-width: 640px\) and \(max-width: 767px\) \{\s*\.mdv-ovl\.mdv-ovl--sheet/);
    expect(here('ItemDrawer.tsx')).not.toMatch(/detents=\{\['full'\]\}\s*\n\s*className="iv-drawer"/);
  });
});
