/**
 * The Full menu (ADR 0340 rule 22, lane 7): every live kind as one document in
 * the house's order, sections a manager renames and moves, 86 marks, the
 * legacy-dishes card, the print label, and the copy kept on this device with
 * its "as of" time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FULL_MENU_PRINT_LABEL,
  FullMenu,
  droppedOn,
  fullMenuCacheKey,
  kindOrderWith,
  linePriceWords,
  loadFullMenu,
  movedBy,
} from './FullMenu';
import {
  getFullMenu,
  renameMenuSection,
  reorderMenuSections,
  setMenuKindOrder,
  type FullMenu as FullMenuDoc,
  type MenuLine,
} from '../../../services/api/menus';
import { offlineStorage } from '../../../lib/offline-storage';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return {
    ...actual,
    getFullMenu: vi.fn(),
    renameMenuSection: vi.fn(),
    reorderMenuSections: vi.fn(),
    setMenuKindOrder: vi.fn(),
  };
});

vi.mock('../../../lib/offline-storage', () => {
  const kept = new Map<string, unknown>();
  return {
    offlineStorage: {
      cacheEntity: vi.fn(async (key: string, data: unknown) => {
        kept.set(key, data);
      }),
      getCachedEntity: vi.fn(async (key: string) => kept.get(key) ?? null),
      __kept: kept,
    },
  };
});

const mockGet = vi.mocked(getFullMenu);
const mockRename = vi.mocked(renameMenuSection);
const mockReorder = vi.mocked(reorderMenuSections);
const mockOrder = vi.mocked(setMenuKindOrder);
const kept = (offlineStorage as unknown as { __kept: Map<string, unknown> }).__kept;

function line(over: Partial<MenuLine>): MenuLine {
  return {
    id: 'l',
    name: 'Line',
    producer: null,
    category: null,
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: null,
    bottle_price: null,
    wine_library_id: null,
    inventory_item_id: null,
    source: 'manual',
    status: 'approved',
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function doc(over: Partial<FullMenuDoc> = {}): FullMenuDoc {
  return {
    readAt: '2026-10-12T10:00:00Z',
    kindOrder: ['beverage', 'food', 'desserts'],
    kindOrderSet: false,
    kinds: [
      {
        kind: 'beverage',
        menuId: 'mb',
        name: 'Drinks',
        madeCurrentAt: null,
        sections: [
          {
            id: 's-red',
            parentId: null,
            title: 'Red',
            position: 0,
            drinkCategory: 'red',
            lines: [line({ id: 'w1', name: 'Barolo', bottle_price: 90, by_glass_price: 18, sold_out: true })],
            sections: [],
          },
          {
            id: 's-white',
            parentId: null,
            title: 'White',
            position: 1,
            drinkCategory: 'white',
            lines: [line({ id: 'w2', name: 'Soave', bottle_price: 40 })],
            sections: [],
          },
        ],
        unsorted: [line({ id: 'c1', name: 'Negroni', bottle_price: 12, sold_out: true, sold_out_because: ['Campari'] })],
      },
      {
        kind: 'food',
        menuId: 'mf',
        name: 'Food',
        madeCurrentAt: null,
        sections: [
          {
            id: 's-mains',
            parentId: null,
            title: 'Mains',
            position: 0,
            drinkCategory: null,
            lines: [line({ id: 'd1', name: 'Köfte', price: 24, line_kind: 'dish' })],
            sections: [],
          },
        ],
        unsorted: [],
      },
    ],
    hiddenDishes: [
      { id: 'h1', name: 'Hummus', menuId: 'mb', onFood: false },
      { id: 'h2', name: 'Köfte', menuId: 'mb', onFood: true },
    ],
    rawLineWithheld: true,
    soldOutReadable: true,
    soldOutReason: null,
    ...over,
  };
}

function mount(canManage: boolean, house = 'house-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FullMenu house={house} canManage={canManage} currency="EUR" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockRename.mockReset();
  mockReorder.mockReset();
  mockOrder.mockReset();
  kept.clear();
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

describe('the pure helpers', () => {
  it('moves an item one place, and leaves the list as it was at an end', () => {
    expect(movedBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movedBy(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(movedBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(movedBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('a drop places the dragged item where the target was', () => {
    expect(droppedOn(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(droppedOn(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
    expect(droppedOn(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
  });

  it('a kind not live keeps its place in the stored order', () => {
    // Desserts is not live: moving Food before Drinks leaves it last.
    expect(kindOrderWith(['beverage', 'food', 'desserts'], ['beverage', 'food'], ['food', 'beverage'])).toEqual([
      'food',
      'beverage',
      'desserts',
    ]);
    expect(kindOrderWith(['beverage', 'desserts', 'food'], ['beverage', 'food'], ['food', 'beverage'])).toEqual([
      'food',
      'desserts',
      'beverage',
    ]);
  });

  it("a dish shows its own price; a drink its glass and bottle", () => {
    expect(linePriceWords(line({ line_kind: 'dish', price: 24 }), 'EUR')).toMatch(/24/);
    const drink = linePriceWords(line({ by_glass_price: 18, bottle_price: 90 }), 'EUR');
    expect(drink).toMatch(/^glass .*18.* · bottle .*90/);
    expect(linePriceWords(line({}), 'EUR')).toBe('');
  });
});

describe('the copy kept on this device', () => {
  it('keeps every read under this house only, with the time it was read', async () => {
    mockGet.mockResolvedValue(doc());
    const read = await loadFullMenu('house-1');
    expect(read.asOf).toBeNull();
    expect(kept.get(fullMenuCacheKey('house-1'))).toEqual({ asOf: '2026-10-12T10:00:00Z', menu: doc() });
    expect(kept.has(fullMenuCacheKey('house-2'))).toBe(false);
  });

  it('a failed read shows the kept copy with its "as of" time and why', async () => {
    kept.set(fullMenuCacheKey('house-1'), { asOf: '2026-10-11T08:00:00Z', menu: doc() });
    mockGet.mockRejectedValue(new Error('Network Error'));
    const read = await loadFullMenu('house-1');
    expect(read.asOf).toBe('2026-10-11T08:00:00Z');
    expect(read.failure).toBe('Network Error');
  });

  it("another house's copy is never shown, and with no copy the failure stands", async () => {
    kept.set(fullMenuCacheKey('house-2'), { asOf: '2026-10-11T08:00:00Z', menu: doc() });
    mockGet.mockRejectedValue(new Error('Network Error'));
    await expect(loadFullMenu('house-1')).rejects.toThrow('Network Error');
  });

  it('a copy not kept leaves the live read standing', async () => {
    vi.mocked(offlineStorage.cacheEntity).mockRejectedValueOnce(new Error('quota'));
    mockGet.mockResolvedValue(doc());
    const read = await loadFullMenu('house-1');
    expect(read.menu.kinds).toHaveLength(2);
  });
});

describe('FullMenu', () => {
  it('lays out every live kind in the house order, with sections, prices, 86 marks and the print label', async () => {
    mockGet.mockResolvedValue(doc());
    mount(false);
    const drinks = await screen.findByTestId('full-menu-kind-beverage');
    const kinds = screen.getAllByRole('region').filter((r) => r.className === 'fm-kind');
    expect(kinds.map((k) => k.getAttribute('aria-label'))).toEqual(['Drinks', 'Food']);
    const sections = within(drinks).getAllByTestId('full-menu-section');
    expect(sections[0]).toHaveTextContent('Red');
    expect(sections[0]).toHaveTextContent('Barolo');
    expect(within(sections[0]).getByTestId('full-menu-sold-out')).toBeInTheDocument();
    expect(within(drinks).getByTestId('full-menu-unsorted')).toHaveTextContent('Not in a section');
    expect(within(drinks).getByTestId('full-menu-unsorted')).toHaveTextContent('Campari is sold out (86)');
    expect(screen.getByTestId('full-menu-kind-food')).toHaveTextContent('Köfte');
    expect(screen.getByTestId('full-menu-print-label')).toHaveTextContent(FULL_MENU_PRINT_LABEL);
    expect(FULL_MENU_PRINT_LABEL).toBe('House copy — no allergen information');
  });

  it('staff read it with no controls and no legacy-dishes card', async () => {
    mockGet.mockResolvedValue(doc());
    mount(false);
    await screen.findByTestId('full-menu-kind-beverage');
    expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /earlier$|later$/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('full-menu-dishes-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('full-menu-kind-beverage').getAttribute('draggable')).toBe('false');
  });

  it('a manager renames a section on the live menu', async () => {
    mockGet.mockResolvedValue(doc());
    mockRename.mockResolvedValue({});
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Red' }));
    fireEvent.change(screen.getByLabelText('New name for Red'), { target: { value: 'Reds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockRename).toHaveBeenCalledWith('mb', 's-red', 'Reds'));
  });

  it('a manager moves a section among its siblings, by button and by drag', async () => {
    mockGet.mockResolvedValue(doc());
    mockReorder.mockResolvedValue(undefined as never);
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Move White earlier' }));
    await waitFor(() => expect(mockReorder).toHaveBeenCalledWith('mb', null, ['s-white', 's-red']));
    expect(screen.getByRole('button', { name: 'Move Red earlier' })).toBeDisabled();

    mockReorder.mockClear();
    const sections = within(screen.getByTestId('full-menu-kind-beverage')).getAllByTestId('full-menu-section');
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', effectAllowed: '' };
    fireEvent.dragStart(sections[1], { dataTransfer });
    fireEvent.drop(sections[0], { dataTransfer });
    await waitFor(() => expect(mockReorder).toHaveBeenCalledWith('mb', null, ['s-white', 's-red']));
  });

  it("a manager moves a kind block, and the house's whole order is sent", async () => {
    mockGet.mockResolvedValue(doc());
    mockOrder.mockResolvedValue({ kindOrder: ['food', 'beverage', 'desserts'] });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Move Food earlier' }));
    await waitFor(() => expect(mockOrder).toHaveBeenCalledWith('house-1', ['food', 'beverage', 'desserts']));
  });

  it('a refused change is said, and the menu stays as read', async () => {
    mockGet.mockResolvedValue(doc());
    mockOrder.mockRejectedValue({ response: { status: 403 } });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Move Food earlier' }));
    expect(await screen.findByTestId('full-menu-write-error')).toHaveTextContent(
      'Not changed: only an owner or a manager can change the full menu.',
    );
  });

  it('names the legacy dishes left off once Food is live, not those already on Food, and the card can be put away', async () => {
    mockGet.mockResolvedValue(doc());
    const view = mount(true);
    const card = await screen.findByTestId('full-menu-dishes-card');
    expect(card).toHaveTextContent('1 dish on your Drinks menu is not shown here, because your Food menu is live: Hummus.');
    expect(card).not.toHaveTextContent('Köfte');
    fireEvent.click(within(card).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('full-menu-dishes-card')).not.toBeInTheDocument();
    view.unmount();
    mount(true);
    await screen.findByTestId('full-menu-kind-beverage');
    expect(screen.queryByTestId('full-menu-dishes-card')).not.toBeInTheDocument();
  });

  it('a failed read with a kept copy shows it with its "as of" time, read only', async () => {
    kept.set(fullMenuCacheKey('house-1'), { asOf: '2026-10-11T08:00:00Z', menu: doc() });
    mockGet.mockRejectedValue(new Error('Network Error'));
    mount(true);
    expect(await screen.findByTestId('full-menu-as-of')).toHaveTextContent(/copy kept on this device, as of/);
    expect(screen.getByTestId('full-menu-kind-beverage')).toHaveTextContent('Barolo');
    expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument();
  });

  it('a failed read with no copy says so -- never an empty menu', async () => {
    mockGet.mockRejectedValue(new Error('Network Error'));
    mount(true);
    expect(await screen.findByTestId('full-menu-error')).toHaveTextContent(/could not be read \(Network Error\)/);
    expect(screen.queryByTestId('full-menu-none')).not.toBeInTheDocument();
  });

  it('a house with no live menu says so', async () => {
    mockGet.mockResolvedValue(doc({ kinds: [], hiddenDishes: [] }));
    mount(true);
    expect(await screen.findByTestId('full-menu-none')).toHaveTextContent('No menu is live yet.');
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('prints with the browser', async () => {
    mockGet.mockResolvedValue(doc());
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mount(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
