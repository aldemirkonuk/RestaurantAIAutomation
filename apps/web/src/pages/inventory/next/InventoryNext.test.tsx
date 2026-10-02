/**
 * /inventory rework (INV-W4) — the page's states and its pure rules.
 *
 * The page's data hook is replaced with a controllable stand-in; the pure
 * functions in the same module (sort, fold, chips, the read sentence) are the
 * real ones. Heavy panels reused from the legacy page are stubbed: they own
 * their own tests, and none of them is under test here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
import { fmtPace, MAP_WORDS, mapTone, sold30 } from './useInventoryNextData';

const mock = vi.hoisted(() => ({ data: {} as Record<string, unknown>, mapProps: null as Record<string, unknown> | null }));
const exportSpy = vi.hoisted(() => vi.fn(async (_opts: unknown) => undefined));
vi.mock('../../../lib/tableExport', () => ({ exportTable: exportSpy }));

vi.mock('./useInventoryNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useInventoryNextData: () => mock.data,
}));
vi.mock('../command/CellarMapView', () => ({
  CellarMapView: (p: Record<string, unknown>) => {
    mock.mapProps = p;
    return <div data-testid="cellar-map" />;
  },
}));
vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ bottle, money }: { bottle: number | null; money?: (n: number | null) => string }) => (
    <span data-testid="house-price">{money ? money(bottle) : String(bottle)}</span>
  ),
}));
vi.mock('../../../components/inventory/PosMappingPanel', () => ({ PosMappingPanel: () => null, default: () => null }));
vi.mock('../../../components/inventory/StorageLocationManager', () => ({ StorageLocationManager: () => null }));
vi.mock('../../../components/scanner/MenuScannerFlow', () => ({ MenuScannerFlow: () => null }));
vi.mock('@/components/mudavym/DeliveriesToName', () => ({
  DELIVERIES_TO_NAME_KEY: ['deliveries-to-name'],
  DeliveriesToName: () => <div data-testid="deliveries-to-name" />,
}));

import { toast } from 'sonner';
import InventoryNext from './InventoryNext';
import { fold, matchesSearch, needsYouFirst, readSentence, sortRows, sortWords, toRow, typeLabel, typeOf } from './useInventoryNextData';

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
    grape: 'Ribolla Gialla',
    bottleSizeMl: 750,
    stock: 12,
    shadow: 0,
    par: 6,
    reorderPoint: null,
    analyticsReadable: true,
    velocity: 1,
    runway: 12,
    daysSinceSale: 1,
    deadStock: false,
    bottle: 92,
    glass: 18,
    pourMl: 150,
    wac: 40,
    costProvenance: 'invoice',
    value: 480,
    lastCountedAt: '2026-09-30T10:00:00Z',
    openMl: null,
    zones: [{ locationId: 'z1', qty: 12 }],
    providerId: null,
    providerName: null,
    standing: 'above',
    ...over,
  };
}

function data(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'ready',
    error: null,
    stale: false,
    refetch: vi.fn(),
    rid: 'r1',
    canManage: true,
    branches: [],
    rows: [],
    rawItems: [],
    libraryUnread: false,
    libraryAnswered: true,
    paceUnread: false,
    currency: { state: 'recorded', code: 'EUR' },
    locations: { list: [{ id: 'z1', name: 'Cave' }], loading: false, unavailable: false, setLocations: vi.fn() },
    providers: { list: [], error: null },
    advice: { status: 'loading' },
    refetchAdvice: vi.fn(),
    waiting: {
      invoices: { n: 0, failed: false },
      deliveries: { n: 0, failed: false },
      outbox: { n: 0, failed: false },
    },
    unread: [],
    pending: [],
    rereadUnread: vi.fn(),
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InventoryNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A bare 0 anywhere in the text — the figure this page must never invent. */
const BARE_ZERO = /(^|[^\d.,])0([^\d.,]|$)/;

afterEach(() => {
  vi.useRealTimers();
});

describe('Needs you first', () => {
  it('puts a stock-out with no runway first, ahead of shorter runways', () => {
    const out = row({ id: 'out', name: 'Out, no sale', stock: 0, velocity: null, runway: null, standing: 'out' });
    const below = row({ id: 'below', name: 'Below', stock: 3, runway: 3, standing: 'below' });
    const dry = row({ id: 'dry', name: 'Dry soon', stock: 8, par: 6, runway: 0.8, standing: 'above' });
    const fine = row({ id: 'fine', name: 'Fine', runway: 40 });
    const nobody = row({ id: 'nobody', name: 'Nobody buys', velocity: null, runway: null });

    const sorted = [fine, nobody, dry, below, out].sort(needsYouFirst).map((r) => r.id);
    expect(sorted).toEqual(['out', 'below', 'dry', 'fine', 'nobody']);
    expect(sortRows([nobody, out], 'needs')[0].id).toBe('out');
  });

  it('draws the rows in that order, headed by severity', () => {
    mock.data = data({
      rows: [
        row({ id: 'fine', name: 'Fine', runway: 40 }),
        row({ id: 'out', name: 'Out, no sale', stock: 0, velocity: null, runway: null, standing: 'out' }),
        row({ id: 'below', name: 'Below', stock: 3, runway: 3, standing: 'below' }),
      ],
    });
    renderPage();
    const ids = [...screen.getByTestId('inventory-table').querySelectorAll('tr[data-testid^="inv-row-"]')].map((tr) =>
      tr.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['inv-row-out', 'inv-row-below', 'inv-row-fine']);
    const groups = [...screen.getByTestId('inventory-table').querySelectorAll('tr.iv-group')].map((g) => g.textContent);
    expect(groups).toEqual(['Out 1', 'Below par 1', 'Everything else, by runway']);
  });
});

describe('search ignores accents and folds the Turkish i', () => {
  it('folds diacritics, dotted İ and dotless ı', () => {
    expect(fold('Château')).toBe('chateau');
    expect(fold('İSTANBUL')).toBe('istanbul');
    expect(fold('ıstanbul')).toBe('istanbul');
    expect(fold('Kavaklıdere Öküzgözü')).toBe('kavaklidere okuzgozu');
  });

  it('matches across name, producer and zone with the fold applied', () => {
    const zoneName = (id: string | null) => (id === 'z1' ? 'Büyük Mahzen' : null);
    const r = row({ name: 'Château Musar', producer: 'Kavaklıdere', zones: [{ locationId: 'z1', qty: 2 }] });
    expect(matchesSearch(r, 'chateau musar', zoneName)).toBe(true);
    expect(matchesSearch(r, 'KAVAKLIDERE', zoneName)).toBe(true);
    expect(matchesSearch(r, 'buyuk mahzen', zoneName)).toBe(true);
    expect(matchesSearch(r, 'chateau margaux', zoneName)).toBe(false);
  });

  it('filters the table as you type', () => {
    mock.data = data({
      rows: [row({ id: 'a', name: 'Château Musar' }), row({ id: 'b', name: 'İstanbul Kırmızı' })],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: 'istanbul' } });
    expect(screen.queryByTestId('inv-row-a')).toBeNull();
    expect(screen.getByTestId('inv-row-b')).toBeTruthy();
  });
});

describe('unknown is never zero', () => {
  it('shows nothing for 400ms, then "Reading the cellar…", and never a 0', () => {
    vi.useFakeTimers();
    mock.data = data({ state: 'reading', rows: null });
    const { container } = renderPage();
    expect(screen.getByTestId('inventory-reading').textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText('Reading the cellar…')).toBeTruthy();
    expect(container.textContent).not.toMatch(BARE_ZERO);
    expect(screen.queryByTestId('inventory-chips')).toBeNull();
    expect(screen.queryByTestId('inventory-table')).toBeNull();
  });

  it('says the stock could not be read when the read fails, and claims nothing else', () => {
    mock.data = data({ state: 'failed', rows: null, error: 'Network Error' });
    const { container } = renderPage();
    expect(screen.getByText('The stock could not be read.')).toBeTruthy();
    expect(container.textContent).not.toMatch(BARE_ZERO);
    expect(screen.queryByTestId('inventory-empty')).toBeNull();
    expect(screen.queryByTestId('inventory-chips')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect((mock.data.refetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('draws an unread stock, cost and currency as the dash', () => {
    mock.data = data({
      currency: { state: 'reading', code: null },
      rows: [
        row({
          id: 'u',
          stock: null,
          shadow: null,
          wac: null,
          value: null,
          velocity: null,
          runway: null,
          zones: null,
          standing: 'unknown',
        }),
      ],
      canManage: false,
    });
    renderPage();
    const tr = screen.getByTestId('inv-row-u');
    const cells = within(tr);
    expect(cells.getByText('Stock not read')).toBeTruthy();
    const live = tr.querySelector('td[data-label="Live / shadow · par"]')!;
    expect(live.textContent).toContain('—');
    expect(live.textContent).not.toMatch(/^0/);
    expect(tr.querySelector('td[data-label="Value at cost"]')!.textContent).toBe('—');
    expect(tr.querySelector('td[data-label="Zone"]')!.textContent).toBe('—');
    expect(tr.querySelector('td[data-label="Your price"]')!.textContent).toBe('— · —');
  });

  it('never says "0 bottles" when no stock was read', () => {
    const s = readSentence(
      [row({ stock: null, value: null, standing: 'unknown' }), row({ id: 'b', stock: null, value: null, standing: 'unknown' })],
      { state: 'recorded', code: 'EUR' },
      true,
    );
    expect(s).not.toMatch(BARE_ZERO);
    expect(s).toContain('no title');
    expect(s).not.toContain('Nothing is out');
  });
});

describe('the empty house', () => {
  it('shows the first steps and hides the chips, the filters and the table', () => {
    mock.data = data({ rows: [] });
    renderPage();
    expect(screen.getByText('No bottles on the books yet.')).toBeTruthy();
    expect(screen.getByTestId('inventory-headline').textContent).toBe('Inventory.');
    expect(screen.getByRole('link', { name: 'Receive a delivery' }).getAttribute('href')).toBe('/receiving');
    expect(screen.getByRole('link', { name: 'Upload an invoice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan your menu' })).toBeTruthy();
    expect(document.body.textContent).toContain('Carry one wine into the book with its first count.');
    expect(document.body.textContent).toContain('Other drinks come in from a scanned menu.');
    expect(document.body.textContent).not.toContain('wine list');
    expect(screen.getByRole('button', { name: 'Set up storage locations' })).toBeTruthy();
    expect(screen.queryByTestId('inventory-chips')).toBeNull();
    expect(screen.queryByTestId('inventory-toolbar')).toBeNull();
    expect(screen.queryByTestId('inventory-table')).toBeNull();
    expect(screen.queryByTestId('inventory-read-sentence')).toBeNull();
  });

  it('still shows the quiet line when an invoice waits', () => {
    mock.data = data({
      rows: [],
      waiting: { invoices: { n: 2, failed: false }, deliveries: { n: 0, failed: false }, outbox: { n: 0, failed: false } },
    });
    renderPage();
    expect(screen.getByTestId('inventory-quiet-line').textContent).toContain('2 invoices wait for a match');
  });
});

describe('the quiet line', () => {
  it('is absent when nothing waits', () => {
    mock.data = data({ rows: [row()] });
    renderPage();
    expect(screen.queryByTestId('inventory-quiet-line')).toBeNull();
  });

  it('names delivered lines and the device outbox, and opens the naming card', () => {
    mock.data = data({
      rows: [row()],
      waiting: { invoices: { n: 0, failed: false }, deliveries: { n: 3, failed: false }, outbox: { n: 2, failed: false } },
    });
    renderPage();
    const line = screen.getByTestId('inventory-quiet-line');
    expect(line.textContent).toContain('3 delivered lines wait for their item');
    expect(line.textContent).toContain('2 spot counts wait on this device; queued is never confirmed');
    expect(screen.queryByTestId('deliveries-to-name')).toBeNull();
    fireEvent.click(within(line).getByRole('button', { name: 'Name them' }));
    expect(screen.getByTestId('deliveries-to-name')).toBeTruthy();
  });
});

describe('chips', () => {
  it('counts Out apart from Below par and marks Price signals unread', () => {
    mock.data = data({
      rows: [
        row({ id: 'o', stock: 0, runway: null, standing: 'out' }),
        row({ id: 'b', stock: 3, standing: 'below' }),
        row({ id: 'a', stock: 6, standing: 'at' }),
      ],
    });
    renderPage();
    const chips = screen.getByTestId('inventory-chips');
    expect(within(chips).getByRole('button', { name: /^Out 1$/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /^Below par 1$/ })).toBeTruthy();
    const price = within(chips).getByRole('button', { name: /Price signals/ }) as HTMLButtonElement;
    expect(price.disabled).toBe(true);
    expect(price.textContent).toContain('—');
    fireEvent.click(within(chips).getByRole('button', { name: /^Below par 1$/ }));
    expect(screen.queryByTestId('inv-row-o')).toBeNull();
    expect(screen.getByTestId('inv-row-b')).toBeTruthy();
  });

  it('shows the house price editor only to owners and managers', () => {
    mock.data = data({ rows: [row()], canManage: true });
    const { unmount } = renderPage();
    expect(screen.getByTestId('house-price')).toBeTruthy();
    unmount();
    mock.data = data({ rows: [row()], canManage: false });
    renderPage();
    expect(screen.queryByTestId('house-price')).toBeNull();
    expect(screen.getByTestId('inv-row-i1').querySelector('td[data-label="Your price"]')!.textContent).toContain('€');
  });
});

describe('The table says what was read (INV-W13, W14, W15)', () => {
  it('tells one bottle a month from none: 0.03, and a true zero is 0', () => {
    expect(fmtPace(0)).toBe('0');
    expect(fmtPace(0.033)).toBe('0.03');
    expect(fmtPace(0.067)).toBe('0.07');
    expect(fmtPace(0.1)).toBe('0.1');
    expect(fmtPace(0.3)).toBe('0.3');
    expect(sold30(0.033)).toBe(1);
    expect(sold30(0.367)).toBe(11);

    mock.data = data({
      rows: [
        row({ id: 'once', name: 'Once', velocity: 0.033, runway: 330 }),
        row({ id: 'never', name: 'Never', velocity: 0, runway: null }),
      ],
    });
    renderPage();
    const vel = (id: string) => screen.getByTestId(`inv-row-${id}`).querySelector('td[data-label="Vel/day"]')!.textContent;
    expect(vel('once')).toBe('0.03');
    expect(vel('never')).toBe('0');
  });

  it('gives the manager price cell the house format: bare numbers with no currency, never $', () => {
    // 1234.5 is drawn "1,234.5" only through the page's formatter; without it
    // the cell would fall back to its own format.
    mock.data = data({ rows: [row({ bottle: 1234.5, glass: 12 })], canManage: true, currency: { state: 'not_recorded', code: null } });
    const { unmount } = renderPage();
    expect(screen.getByTestId('house-price').textContent).toBe('1,234.5');
    unmount();
    mock.data = data({ rows: [row({ bottle: null, glass: 12 })], canManage: true, currency: { state: 'not_recorded', code: null } });
    renderPage();
    expect(screen.getByTestId('house-price').textContent).toBe('—');
  });

  it('points Market at each title\'s details, not at the line', () => {
    mock.data = data({ rows: [row()] });
    renderPage();
    const footer = screen.getByTestId('inventory-footer').textContent ?? '';
    expect(footer).toContain("Market reads — in every title's details");
    expect(footer).not.toContain('on every line');
  });
});

describe('The Tools row offers only what this session can do (INV-W18)', () => {
  it('has no "Export all locations", even for a person in several houses', () => {
    mock.data = data({
      rows: [row({ id: 'a', name: 'Barolo' })],
      branches: [
        { id: 'h1', name: 'One' },
        { id: 'h2', name: 'Two' },
      ],
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'Export count sheet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export valuation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export all locations' })).toBeNull();
  });
});

describe('The Cellar map speaks the page\'s words (INV-W19)', () => {
  it('hands the map the table\'s tint rule and the chips\' words', () => {
    mock.mapProps = null;
    mock.data = data({ rows: [row({ id: 'a', name: 'Barolo' })] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Cellar map' }));
    expect(screen.getByTestId('cellar-map')).toBeTruthy();
    // Re-read through the declared type: the `= null` above narrows it for tsc.
    const props = mock.mapProps as Record<string, unknown> | null;
    expect(props?.toneOf).toBe(mapTone);
    expect(props?.toneWords).toBe(MAP_WORDS);
  });
});

describe('The footer says how the list is cut and ordered (INV-W23, INV-W25)', () => {
  it('names the sort even when nothing is filtered, and offers no clear button', () => {
    mock.data = data({ rows: [row({ id: 'a', name: 'Barolo' }), row({ id: 'b', name: 'Rioja' })] });
    renderPage();
    const footer = screen.getByTestId('inventory-footer');
    expect(footer.textContent).toContain('All 2 of 2 titles are listed, sorted Needs you first.');
    expect(within(footer).queryByRole('button', { name: 'Clear the filters' })).toBeNull();
  });

  it('names the filter in force and offers a way out while rows still show', () => {
    mock.data = data({
      rows: [
        row({ id: 'o', stock: 0, runway: null, standing: 'out' }),
        row({ id: 'b', stock: 3, standing: 'below' }),
        row({ id: 'a', stock: 6, standing: 'at' }),
      ],
    });
    renderPage();
    fireEvent.click(within(screen.getByTestId('inventory-chips')).getByRole('button', { name: /^Below par 1$/ }));
    const footer = screen.getByTestId('inventory-footer');
    expect(footer.textContent).toContain('1 of 3 titles are listed (Below par), sorted Needs you first.');
    fireEvent.click(within(footer).getByRole('button', { name: 'Clear the filters' }));
    expect(screen.getByTestId('inventory-footer').textContent).toContain('All 3 of 3 titles are listed, sorted Needs you first.');
    expect(screen.getByTestId('inv-row-o')).toBeTruthy();
  });

  it('names a chosen sort in the footer, and says why Value at cost did not reorder', () => {
    mock.data = data({ rows: [row({ id: 'a', name: 'Barolo', value: null }), row({ id: 'b', name: 'Rioja', value: null })] });
    renderPage();
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'value' } });
    expect(screen.getByTestId('inventory-footer').textContent).toContain(
      'All 2 of 2 titles are listed, sorted Value at cost, though no title listed has a cost yet, so they stay in Needs you first order.',
    );
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    expect(screen.getByTestId('inventory-footer').textContent).toContain('All 2 of 2 titles are listed, sorted Name.');
  });

  it('says the value sort has nothing to sort by when no listed title has a cost', () => {
    expect(sortWords('value', [row({ value: null }), row({ value: null })])).toBe(
      'sorted Value at cost, though no title listed has a cost yet, so they stay in Needs you first order',
    );
    expect(sortWords('value', [row({ value: null }), row({ value: 40 })])).toBe('sorted Value at cost');
    expect(sortWords('name', [row({ value: null })])).toBe('sorted Name');
    expect(sortWords('needs', [])).toBe('sorted Needs you first');
  });
});

describe('every drink, not only wine (INV-W30)', () => {
  it('reads the kind from the library: a wine by its style, any other drink by its kind', () => {
    expect(typeOf('Red', 'wine')).toEqual({ type: 'red', kind: 'wine' });
    expect(typeOf('Rosé', 'wine')).toEqual({ type: 'rose', kind: 'wine' });
    expect(typeOf('rose', 'wine')).toEqual({ type: 'rose', kind: 'wine' });
    expect(typeOf(' red (still) ', 'wine')).toEqual({ type: 'red (still)', kind: 'wine' });
    expect(typeOf('unknown', 'wine')).toEqual({ type: 'wine', kind: 'wine' });
    expect(typeOf(undefined, 'spirit')).toEqual({ type: 'spirit', kind: 'spirit' });
    expect(typeOf('red', 'Beer')).toEqual({ type: 'beer', kind: 'beer' });
    expect(typeOf(null, 'non_alcoholic')).toEqual({ type: 'non_alcoholic', kind: 'non_alcoholic' });
  });

  it('keeps "the classifier could not tell" apart from "nothing recorded"', () => {
    expect(typeOf(null, 'unknown')).toEqual({ type: 'unclassified', kind: 'unknown' });
    expect(typeOf('unknown', 'unknown')).toEqual({ type: 'unclassified', kind: 'unknown' });
    expect(typeOf(undefined, undefined)).toEqual({ type: null, kind: null });
    expect(typeOf('  ', '')).toEqual({ type: null, kind: null });
    // A library row that did not carry the kind: a recorded style is a wine's.
    expect(typeOf('White', undefined)).toEqual({ type: 'white', kind: 'wine' });
    expect(typeOf('sparkling', 'unknown')).toEqual({ type: 'sparkling', kind: 'wine' });
  });

  it('carries the library row\'s kind onto the stock row', () => {
    const spirit = toRow({ id: 'i1', wineId: 'w1', stockLive: 2 } as never, {
      id: 'w1',
      name: 'Lagavulin 16',
      category: 'unknown',
      beverageKind: 'spirit',
    } as never);
    expect([spirit.type, spirit.kind]).toEqual(['spirit', 'spirit']);
    const bare = toRow({ id: 'i2', wineId: null, stockLive: 1 } as never, null);
    expect([bare.type, bare.kind]).toEqual([null, null]);
  });

  it('says each kind in the house words, never the key', () => {
    expect(typeLabel('rose')).toBe('Rosé');
    expect(typeLabel('non_alcoholic')).toBe('Non-alcoholic');
    expect(typeLabel('unclassified')).toBe('not classified');
    expect(typeLabel('spirit')).toBe('Spirit');
    expect(typeLabel('red (still)')).toBe('Red (still)');
  });

  const mixed = () => [
    row({ id: 'r', name: 'Barolo', type: 'red', kind: 'wine' }),
    row({ id: 'p', name: 'Tavel', type: 'rose', kind: 'wine' }),
    row({ id: 's', name: 'Lagavulin 16', type: 'spirit', kind: 'spirit', producer: 'Lagavulin' }),
    row({ id: 'b', name: 'Efes Pilsen', type: 'beer', kind: 'beer', producer: 'Efes' }),
    row({ id: 'n', name: 'Seedlip', type: 'non_alcoholic', kind: 'non_alcoholic', producer: null }),
    row({ id: 'u', name: 'House punch', type: 'unclassified', kind: 'unknown', producer: null }),
  ];
  const optionWords = () =>
    [...(screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).options].map((o) => o.textContent);
  const shown = () =>
    [...screen.getByTestId('inventory-table').querySelectorAll('tbody tr[data-testid^="inv-row-"]')].map((tr) =>
      tr.getAttribute('data-testid'),
    );

  it('keeps plain style words in a house of wine alone', () => {
    mock.data = data({ rows: [row({ id: 'a', type: 'red', kind: 'wine' }), row({ id: 'b', type: 'rose', kind: 'wine' })] });
    renderPage();
    expect(optionWords()).toEqual(['All', 'Red', 'Rosé']);
  });

  it('groups wine first and names every other drink by its kind when the house holds more than wine', () => {
    mock.data = data({ rows: mixed() });
    renderPage();
    expect(optionWords()).toEqual([
      'All',
      'All wine',
      'Wine · Red',
      'Wine · Rosé',
      'Beer',
      'Non-alcoholic',
      'Spirit',
      'Not classified',
    ]);
    const cell = (id: string) => screen.getByTestId(`inv-row-${id}`).querySelector('td[data-label="Type"]')!;
    expect(cell('s').textContent).toBe('Spirit');
    expect(cell('n').textContent).toBe('Non-alcoholic');
    expect(cell('p').textContent).toBe('Rosé');
    expect(cell('u').textContent).toBe('not classified');
    expect(cell('u').className).toBe('iv-dim');
    expect(cell('s').className).toBe('');
  });

  it('filters all wine at once, or one kind', () => {
    mock.data = data({ rows: mixed() });
    renderPage();
    const type = screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement;
    fireEvent.change(type, { target: { value: 'kind:wine' } });
    expect(shown().sort()).toEqual(['inv-row-p', 'inv-row-r']);
    fireEvent.change(type, { target: { value: 'spirit' } });
    expect(shown()).toEqual(['inv-row-s']);
    fireEvent.change(type, { target: { value: 'unclassified' } });
    expect(shown()).toEqual(['inv-row-u']);
  });

  it('finds a drink by its kind in search, accents ignored', () => {
    const zn = () => 'a zone';
    const rows = mixed();
    expect(rows.filter((r) => matchesSearch(r, 'spirit', zn)).map((r) => r.id)).toEqual(['s']);
    expect(rows.filter((r) => matchesSearch(r, 'non-alcoholic', zn)).map((r) => r.id)).toEqual(['n']);
    expect(rows.filter((r) => matchesSearch(r, 'rose', zn)).map((r) => r.id)).toEqual(['p']);
    expect(rows.filter((r) => matchesSearch(r, 'wine', zn)).map((r) => r.id).sort()).toEqual(['p', 'r']);
  });

  it('offers a menu scan, and says the add path is the wine register', () => {
    mock.data = data({ rows: mixed() });
    renderPage();
    expect(screen.getByRole('button', { name: 'Scan a menu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a bottle' }).getAttribute('title')).toBe(
      'Opens the wine register, where a wine is brought into the cellar. Other drinks come in from a scanned menu.',
    );
  });

  it('a failed export shows only a sentence written for a person (INV-W31)', async () => {
    const said = vi.spyOn(toast, 'error').mockImplementation(() => '' as never);
    mock.data = data({ rows: mixed() });
    renderPage();
    exportSpy.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'map')"));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export valuation' }));
    });
    expect(said).toHaveBeenLastCalledWith('The export could not be made.');
    exportSpy.mockRejectedValueOnce(new Error('Popup blocked — allow popups to print.'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export valuation' }));
    });
    expect(said).toHaveBeenLastCalledWith('Popup blocked — allow popups to print.');
    said.mockRestore();
  });

  it('heads the exported files "Title", and writes each kind in words', async () => {
    exportSpy.mockClear();
    mock.data = data({ rows: mixed() });
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export valuation' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export count sheet' }));
    });
    expect(exportSpy).toHaveBeenCalledTimes(2);
    for (const [opts] of exportSpy.mock.calls) {
      const cols = (opts as { columns: { header: string }[] }).columns.map((c) => c.header);
      expect(cols).toContain('Title');
      expect(cols).not.toContain('Wine');
    }
    for (const [opts] of exportSpy.mock.calls) {
      const file = opts as { rows: InvRow[]; columns: { header: string; value: (r: InvRow) => unknown }[] };
      const typeCol = file.columns.find((c) => c.header === 'Type')!;
      expect(file.rows.map((r) => typeCol.value(r)).sort()).toEqual(
        ['Beer', 'Non-alcoholic', 'Red', 'Rosé', 'Spirit', 'not classified'],
      );
    }
  });
});

describe('a failed selling-pace read is never read as no dead stock (INV-W29)', () => {
  const rowsOf = () => [row({ id: 'a', name: 'Alpha', deadStock: true }), row({ id: 'b', name: 'Beta' })];
  const tbodyRows = () => [...screen.getByTestId('inventory-table').querySelectorAll('tbody tr:not(.iv-group)')].filter((tr) => !tr.classList.contains('iv-detail'));

  it('shows the dead-stock count as unread and offers no filter on it', () => {
    mock.data = data({ rows: rowsOf().map((r) => ({ ...r, deadStock: false, analyticsReadable: false })), paceUnread: true });
    renderPage();
    const chip = within(screen.getByTestId('inventory-chips')).getByRole('button', { name: /^Dead stock/ });
    expect(chip.textContent).toBe('Dead stock —');
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(chip.getAttribute('title')).toBe('Whether a title is dead stock could not be read: the selling pace did not answer');
  });

  it('counts dead stock when the pace was read', () => {
    mock.data = data({ rows: rowsOf() });
    renderPage();
    const chip = within(screen.getByTestId('inventory-chips')).getByRole('button', { name: /^Dead stock/ });
    expect(chip.textContent).toBe('Dead stock 1');
    expect((chip as HTMLButtonElement).disabled).toBe(false);
  });

  it('lets go of a dead-stock filter once the pace stops answering', () => {
    mock.data = data({ rows: rowsOf() });
    const { rerender } = renderPage();
    fireEvent.click(within(screen.getByTestId('inventory-chips')).getByRole('button', { name: /^Dead stock/ }));
    expect(tbodyRows()).toHaveLength(1);
    mock.data = data({ rows: rowsOf().map((r) => ({ ...r, deadStock: false, analyticsReadable: false })), paceUnread: true });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <InventoryNext />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(tbodyRows()).toHaveLength(2);
    expect(within(screen.getByTestId('inventory-chips')).getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a side read that did not answer is named, never read as health (INV-W28)', () => {
  it('names each failed read with what it leaves unread, and one control reads them all again', () => {
    const rereadUnread = vi.fn();
    mock.data = data({
      rows: [row()],
      unread: ['the wine library, so type shows —, the type filter is off, and grapes are left out of details and search', 'the price advice'],
      rereadUnread,
    });
    renderPage();
    const note = screen.getByTestId('inv-unread');
    expect(note.textContent).toBe(
      'Some reads did not answer: the wine library, so type shows —, the type filter is off, and grapes are left out of details and search; the price advice. Read again',
    );
    fireEvent.click(within(note).getByRole('button', { name: 'Read again' }));
    expect(rereadUnread).toHaveBeenCalledTimes(1);
    const footer = screen.getByTestId('inventory-footer').textContent ?? '';
    expect(footer).not.toContain('Every figure on this page was read.');
    expect(footer).toContain('Not every read answered; each one that did not is named above the table.');
  });

  it('says one read when only one did not answer', () => {
    mock.data = data({ rows: [row()], unread: ['the house’s currency'] });
    renderPage();
    expect(screen.getByTestId('inv-unread').textContent).toBe('One read did not answer: the house’s currency. Read again');
  });

  it('says every figure was read only when every read answered', () => {
    mock.data = data({ rows: [row()] });
    renderPage();
    expect(screen.queryByTestId('inv-unread')).toBeNull();
    expect(screen.getByTestId('inventory-footer').textContent).toContain('Every figure on this page was read.');
  });

  it('does not say every figure was read over rows kept from an earlier read', () => {
    mock.data = data({ rows: [row()], stale: true, error: 'timeout' });
    renderPage();
    expect(screen.getByTestId('inventory-footer').textContent).not.toContain('Every figure on this page was read.');
  });

  it('shows a missing type as unread, not "not recorded", when the library did not answer', () => {
    mock.data = data({ rows: [row({ type: null, producer: null })], libraryUnread: true, libraryAnswered: false });
    renderPage();
    const tr = screen.getByTestId('inventory-table').querySelector('tbody tr:not(.iv-group)') as HTMLElement;
    expect(tr.querySelector('td[data-label="Type"]')!.textContent).toBe('—');
    expect(screen.getByTestId('inventory-table').textContent).not.toContain('not recorded');
    const type = screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement;
    expect(type.disabled).toBe(true);
    expect([...type.options].map((o) => o.textContent)).not.toContain('Type not recorded');
  });

  it('treats a library still reading as unknown, and the footer names what is still reading', () => {
    mock.data = data({ rows: [row({ type: null })], libraryAnswered: false, pending: ['the wine library', 'the price advice'] });
    renderPage();
    const tr = screen.getByTestId('inventory-table').querySelector('tbody tr:not(.iv-group)') as HTMLElement;
    expect(tr.querySelector('td[data-label="Type"]')!.textContent).toBe('—');
    const type = screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement;
    expect(type.disabled).toBe(true);
    expect([...type.options].map((o) => o.textContent)).not.toContain('Type not recorded');
    expect(screen.queryByTestId('inv-unread')).toBeNull();
    const footer = screen.getByTestId('inventory-footer').textContent ?? '';
    expect(footer).toContain('Still reading: the wine library, the price advice.');
    expect(footer).not.toContain('Every figure on this page was read.');
  });

  it('does not call a zone "not on the list" before the list has been read', () => {
    mock.data = data({
      rows: [row()],
      locations: { list: [], loading: true, unavailable: false, setLocations: vi.fn() },
      pending: ['the storage locations'],
    });
    renderPage();
    const tr = screen.getByTestId('inventory-table').querySelector('tbody tr:not(.iv-group)') as HTMLElement;
    expect(tr.querySelector('td[data-label="Zone"]')!.textContent).toBe('a zone (names unread)');
  });

  it('names a failed read over one still reading', () => {
    mock.data = data({ rows: [row()], unread: ['the price advice'], pending: ['the wine library'] });
    renderPage();
    const footer = screen.getByTestId('inventory-footer').textContent ?? '';
    expect(footer).toContain('Not every read answered');
    expect(footer).not.toContain('Still reading');
  });

  it('still says "not recorded" when the library answered and the title has no type', () => {
    mock.data = data({ rows: [row({ type: null })] });
    renderPage();
    const tr = screen.getByTestId('inventory-table').querySelector('tbody tr:not(.iv-group)') as HTMLElement;
    expect(tr.querySelector('td[data-label="Type"]')!.textContent).toBe('not recorded');
  });

  it('says the page does not read a market price, never that the house has none', () => {
    const s = readSentence([row()], { state: 'recorded', code: 'EUR' }, true);
    expect(s).toContain('This page does not read a market price yet, so the market reads unknown, not zero.');
    expect(s).not.toContain('No title has a market price');
  });
});

describe('counts read with grouped digits, as money does (INV-W33)', () => {
  it('groups the invoices waiting in the quiet line, capped or not', () => {
    mock.data = data({
      rows: [],
      waiting: { invoices: { n: 1240, failed: false }, deliveries: { n: 0, failed: false }, outbox: { n: 0, failed: false } },
    });
    const { unmount } = renderPage();
    expect(screen.getByTestId('inventory-quiet-line').textContent).toContain('1,240 invoices wait for a match');
    unmount();
    mock.data = data({
      rows: [],
      waiting: { invoices: { n: 1000, capped: true, failed: false }, deliveries: { n: 0, failed: false }, outbox: { n: 0, failed: false } },
    });
    renderPage();
    expect(screen.getByTestId('inventory-quiet-line').textContent).toContain('1,000 or more invoices wait for a match');
  });

  it('groups every count in the read sentence', () => {
    const many = Array.from({ length: 1001 }, (_, i) => row({ id: `r${i}`, stock: i === 0 ? 1240 : 0, standing: 'below', value: 10, zones: null }));
    const s = readSentence(many, { state: 'recorded', code: 'EUR' }, true);
    expect(s).toContain('1,001 titles, 1,240 bottles.');
    expect(s).toContain('None is out; 1,001 are below par');
    expect(s).toContain('with 1,001 of 1,001 titles priced');
    const half = readSentence(
      [...many, ...Array.from({ length: 1200 }, (_, i) => row({ id: `u${i}`, stock: null, value: null }))],
      { state: 'recorded', code: 'EUR' },
      true,
    );
    expect(half).toContain('on the 1,001 whose stock was read (1,200 could not be read)');
    expect(half).toContain('the 1,200 without a cost');
  });

  it('groups the out, below-par and dry-tomorrow counts', () => {
    const cur = { state: 'recorded', code: 'EUR' } as const;
    const big = (id: string, over: Partial<InvRow>) => Array.from({ length: 1000 }, (_, i) => row({ id: `${id}${i}`, zones: null, ...over }));
    const s = readSentence([...big('o', { stock: 0, standing: 'out', runway: null }), ...big('b', { stock: 1, standing: 'below', runway: 1 })], cur, true);
    expect(s).toContain('1,000 are out, and 1,000 more are below par; 1,000 run dry tomorrow.');
    const calm = readSentence(big('d', { stock: 5, standing: 'at', runway: 1 }), cur, true);
    expect(calm).toContain('Nothing is out or below par, but 1,000 run dry tomorrow.');
  });

  it('groups the table\'s live, shadow, par and runway, but never the export', async () => {
    exportSpy.mockClear();
    mock.data = data({ rows: [row({ id: 'big', stock: 1240, shadow: 1250, par: 1200, runway: 1500, standing: 'at' }), row({ id: 'small' })] });
    renderPage();
    const cell = (label: string) => screen.getByTestId('inv-row-big').querySelector(`td[data-label="${label}"]`)!.textContent;
    expect(cell('Live / shadow · par')).toBe('1,240 / 1,250 · 1,200');
    expect(cell('Runway')).toBe('1,500d');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export valuation' }));
    });
    const file = exportSpy.mock.calls[0][0] as unknown as { rows: InvRow[]; columns: { header: string; value: (r: InvRow) => unknown }[] };
    const live = file.columns.find((c) => c.header === 'Live')!;
    expect(live.value(file.rows.find((r) => r.id === 'big')!)).toBe(1240);
  });

  it('groups the footer, the chips, the group heads, the export toast and the no-match line past 1,000 titles', async () => {
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => '' as never);
    mock.data = data({
      rows: [
        ...Array.from({ length: 1000 }, (_, i) => row({ id: `r${i}`, name: `T${i}`, stock: 0, runway: null, standing: 'out' })),
        row({ id: 'at', name: 'Rioja', stock: 6, standing: 'at' }),
      ],
    });
    renderPage();
    const chips = screen.getByTestId('inventory-chips');
    expect(screen.getByTestId('inventory-footer').textContent).toContain('All 1,001 of 1,001 titles are listed');
    expect(within(chips).getByRole('button', { name: /^All 1,001$/ })).toBeTruthy();
    expect(screen.getByTestId('inventory-table').textContent).toContain(' 1,000');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export valuation' }));
    });
    expect(ok).toHaveBeenLastCalledWith('Exported 1,001 rows');
    fireEvent.click(within(chips).getByRole('button', { name: /^Out 1,000$/ }));
    expect(screen.getByTestId('inventory-footer').textContent).toContain('1,000 of 1,001 titles are listed (Out)');
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: 'zzzz' } });
    expect(document.body.textContent).toContain('1,001 titles are on the books.');
    ok.mockRestore();
  }, 20000);
});

describe('a title no zone holds reads "none on hand" or "Unassigned" (INV-W34)', () => {
  const rowsOf = () => [
    row({ id: 'cave', name: 'Alpha', stock: 5, zones: [{ locationId: 'z1', qty: 5 }] }),
    row({ id: 'loose', name: 'Beta', stock: 2, zones: [{ locationId: null, qty: 2 }] }),
    row({ id: 'split', name: 'Gamma', stock: 5, zones: [{ locationId: 'z1', qty: 3 }, { locationId: null, qty: 2 }] }),
    row({ id: 'nolots', name: 'Delta', stock: 4, zones: [] }),
    row({ id: 'empty', name: 'Epsilon', stock: 0, standing: 'out', zones: [] }),
    row({ id: 'unread', name: 'Zeta', stock: null, standing: 'unknown', zones: [] }),
    row({ id: 'unreadloose', name: 'Eta', stock: null, standing: 'unknown', zones: [{ locationId: null, qty: 3 }] }),
  ];
  const zoneOf = (id: string) => screen.getByTestId(`inv-row-${id}`).querySelector('td[data-label="Zone"]')!.textContent;
  const shown = () =>
    [...screen.getByTestId('inventory-table').querySelectorAll('tbody tr[data-testid^="inv-row-"]')]
      .map((tr) => tr.getAttribute('data-testid')!.replace('inv-row-', ''))
      .sort();

  it('names nothing on hand as such, and bottles outside every zone as Unassigned', () => {
    mock.data = data({ rows: rowsOf() });
    renderPage();
    expect(zoneOf('cave')).toBe('Cave');
    expect(zoneOf('loose')).toBe('Unassigned');
    expect(zoneOf('nolots')).toBe('Unassigned');
    expect(zoneOf('empty')).toBe('none on hand');
    expect(zoneOf('unread')).toBe('—');
    expect(zoneOf('unreadloose')).toBe('Unassigned');
    expect(screen.getByTestId('inventory-table').textContent).not.toContain('in no zone');
  });

  it('filters Unassigned to titles with bottles outside a zone, never to empty ones', () => {
    mock.data = data({ rows: rowsOf() });
    renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Zone' }), { target: { value: 'none' } });
    expect(shown()).toEqual(['loose', 'nolots', 'split', 'unreadloose']);
  });

  it('writes the same words in the count sheet export', async () => {
    exportSpy.mockClear();
    mock.data = data({ rows: rowsOf() });
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export count sheet' }));
    });
    const file = exportSpy.mock.calls[0][0] as { rows: InvRow[]; columns: { header: string; value: (r: InvRow) => unknown }[] };
    const loc = file.columns.find((c) => c.header === 'Location')!;
    const byId = Object.fromEntries(file.rows.map((r) => [r.id, loc.value(r)]));
    expect(byId).toEqual({ cave: 'Cave', loose: 'Unassigned', split: 'Cave', nolots: 'Unassigned', empty: 'none on hand', unread: '', unreadloose: 'Unassigned' });
  });
});
