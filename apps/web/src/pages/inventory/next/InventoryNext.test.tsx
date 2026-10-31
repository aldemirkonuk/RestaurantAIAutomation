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
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
vi.mock('../../../components/inventory/StorageLocationManager', () => ({
  StorageLocationManager: (p: Record<string, unknown>) => {
    ported.slm = p;
    return <div data-testid="storage-manager" />;
  },
}));
// The four ported acts' own components are stubbed to capture what the page
// hands them; each owns its own tests.
const ported = vi.hoisted(() => ({
  slm: null as Record<string, unknown> | null,
  receipt: null as Record<string, unknown> | null,
  auction: null as Record<string, unknown> | null,
  preview: null as Record<string, unknown> | null,
  create: vi.fn(),
}));
vi.mock('../../../components/inventory/ManualReceiptWorkspace', () => ({
  ManualReceiptWorkspace: (p: Record<string, unknown>) => {
    ported.receipt = p;
    return <div data-testid="manual-receipt" />;
  },
}));
vi.mock('../command/AuctionLotStart', () => ({
  AuctionLotStart: (p: Record<string, unknown>) => {
    ported.auction = p;
    return <div data-testid="auction-start" />;
  },
}));
vi.mock('../../../components/inventory/AutoLocatePreviewModal', () => ({
  AutoLocatePreviewModal: (p: Record<string, unknown>) => {
    ported.preview = p;
    return <div data-testid="auto-locate-preview" />;
  },
}));
// The ADR 0192 research list (NameThisWine.tsx) and the insights rail.
const research = vi.hoisted(() => ({ fetch: vi.fn(async (): Promise<unknown[]> => []) }));
const insights = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
const pos = vi.hoisted(() => ({ lines: vi.fn(async (): Promise<unknown> => ({ summary: { open_lines: 0 } })) }));
vi.mock('../../../services/api/posHub', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUnresolvedLines: pos.lines,
}));
vi.mock('@/components/insights/ContextualInsights', () => ({
  ContextualInsights: (p: Record<string, unknown>) => {
    insights.props.push(p);
    return <div data-testid="contextual-insights" />;
  },
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createInventoryItem: ported.create,
  fetchHouseItemResearch: research.fetch,
}));
vi.mock('./RowDropdown', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  default: () => <tr data-testid="row-dropdown" />,
}));
// The shared remove modal owns its own tests; here only what the page hands it.
const removeModal = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('../../../components/inventory/RemoveFromInventoryModal', () => ({
  RemoveFromInventoryModal: (p: Record<string, unknown>) => {
    removeModal.props = p;
    return <div data-testid="remove-modal" />;
  },
}));
vi.mock('../../../components/scanner/MenuScannerFlow', () => ({ MenuScannerFlow: () => null }));
vi.mock('@/components/mudavym/DeliveriesToName', () => ({
  DELIVERIES_TO_NAME_KEY: ['deliveries-to-name'],
  DeliveriesToName: () => <div data-testid="deliveries-to-name" />,
}));

import { toast } from 'sonner';
import InventoryNext from './InventoryNext';
import { IV_DEFAULT, readView, writeView } from './iv-url';
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
    active: true,
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
    locations: {
      list: [{ id: 'z1', name: 'Cave' }],
      loading: false,
      unavailable: false,
      setLocations: vi.fn(),
      mappings: [],
      mappingsUnavailable: false,
      mappingsLoading: false,
      assignMany: vi.fn(async () => ({ assigned: 0, failed: 0 })),
    },
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

describe('INV-W38 — the view is the URL', () => {
  function renderAt(url: string) {
    const seen: { path: string; search: string } = { path: '', search: '' };
    function Probe() {
      const loc = useLocation();
      seen.path = loc.pathname;
      seen.search = loc.search;
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/inventory" element={<InventoryNext />} />
            <Route path="/receiving" element={<div data-testid="receiving" />} />
          </Routes>
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return seen;
  }
  const two = () => [row({ id: 'a', wineId: 'wa', name: 'Ankara Red', producer: 'A', grape: 'Kalecik' }), row({ id: 'b', wineId: 'wb', name: 'Istanbul White', producer: 'B', grape: 'Narince' })];

  it('reads and writes only what differs from the default', () => {
    expect(readView(new URLSearchParams(''))).toEqual(IV_DEFAULT);
    const v = readView(new URLSearchParams('chip=bogus&sort=bogus&view=bogus'));
    expect([v.chip, v.sort, v.view]).toEqual([IV_DEFAULT.chip, IV_DEFAULT.sort, IV_DEFAULT.view]);
    expect(writeView(new URLSearchParams('from=bell'), IV_DEFAULT).toString()).toBe('from=bell');
    expect(writeView(new URLSearchParams('wine=x&highlight=y'), { ...IV_DEFAULT, q: 'x', open: 'r1' }).toString()).toBe('q=x&open=r1');
  });

  it('lands a ?wine= link on that search, and folds it into q on the next change', () => {
    mock.data = data({ rows: two() });
    const seen = renderAt('/inventory?wine=istanbul');
    expect(screen.queryByTestId('inv-row-a')).toBeNull();
    expect(screen.getByTestId('inv-row-b')).toBeTruthy();
    expect((screen.getByPlaceholderText('Search titles, producers, grapes') as HTMLInputElement).value).toBe('istanbul');
    fireEvent.click(screen.getByTestId('inv-row-b').querySelector('button[aria-expanded]')!);
    expect(new URLSearchParams(seen.search).get('q')).toBe('istanbul');
    expect(new URLSearchParams(seen.search).has('wine')).toBe(false);
    expect(new URLSearchParams(seen.search).get('open')).toBe('b');
  });

  it('opens the title a ?highlight= link names, by row id or by wine id', () => {
    mock.data = data({ rows: two() });
    renderAt('/inventory?highlight=wb');
    expect(screen.getByTestId('inv-row-b').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('inv-row-a').getAttribute('aria-selected')).toBe('false');
  });

  it('keeps what a person narrowed to in the URL, and drops it again at the default', () => {
    mock.data = data({ rows: two() });
    const seen = renderAt('/inventory');
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: 'ankara' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cellar map' }));
    expect(Object.fromEntries(new URLSearchParams(seen.search))).toEqual({ q: 'ankara', view: 'map' });
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: '' } });
    expect(seen.search).toBe('');
  });

  it('opens the naming card for a ?name-delivery= link', () => {
    mock.data = data({ rows: two(), waiting: { invoices: { n: 0, failed: false }, deliveries: { n: 1, failed: false }, outbox: { n: 0, failed: false } } });
    renderAt('/inventory?name-delivery=o1');
    expect(screen.getByTestId('deliveries-to-name')).toBeTruthy();
  });

  it('sends the older ?verify= link to Receiving, on that order', () => {
    mock.data = data({ rows: two() });
    const seen = renderAt('/inventory?verify=o%2F7');
    expect(screen.getByTestId('receiving')).toBeTruthy();
    expect(seen.path).toBe('/receiving');
    expect(new URLSearchParams(seen.search).get('order')).toBe('o/7');
  });
});

describe('INV-W39 — the book has a name', () => {
  it('names the table for a screen reader', () => {
    mock.data = data({ rows: [row()] });
    renderPage();
    expect(screen.getByRole('table', { name: 'The book: every title on hand' })).toBeTruthy();
  });
});

describe('the acts ported from the legacy page (founder 2026-10-31: port all 5, then flip)', () => {
  const cave = { id: 'z1', name: 'Cave', type: 'cellar', capacity: 100, currentCount: 0, temperature: '55°F', color: '#000' };

  it('A delivery without an order opens the shared workspace from the empty house and from Tools, and refreshes the book when saved', () => {
    mock.data = data({ rows: [] });
    const first = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'A delivery without an order' }));
    expect(screen.getByTestId('manual-receipt')).toBeTruthy();
    first.unmount();

    ported.receipt = null;
    mock.data = data({ rows: [row()] });
    renderPage();
    fireEvent.click(within(document.getElementById('iv-tools')!).getByRole('button', { name: 'A delivery without an order' }));
    expect(ported.receipt).not.toBeNull();
    expect(ported.receipt!.isOpen).toBe(true);
    expect(typeof ported.receipt!.onSaved).toBe('function');
  });

  it('the auction start carries the lot with legacy\'s POST body and hands back the row it made', async () => {
    ported.create.mockReset().mockResolvedValue({ id: 'inv-new' });
    mock.data = data({ rows: [row()] });
    renderPage();
    fireEvent.click(within(document.getElementById('iv-tools')!).getByRole('button', { name: 'Start an auction lot' }));
    expect(screen.getByTestId('auction-start')).toBeTruthy();
    const onCarry = ported.auction!.onCarry as (i: unknown) => Promise<{ inventoryId: string }>;
    const out = await onCarry({ wine: { id: 'w9' }, quantity: 6, costPerBottle: 42 });
    expect(ported.create).toHaveBeenCalledWith(
      { wineId: 'w9', stockLive: 6, thresholdMin: 0, costPerBottle: 42, costProvenance: 'manual' },
      'r1',
    );
    expect(out).toEqual({ inventoryId: 'inv-new' });
  });

  it('the auction start is reachable from the empty house too', () => {
    mock.data = data({ rows: [] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Start an auction lot' }));
    expect(screen.getByTestId('auction-start')).toBeTruthy();
  });

  it('Auto-Locate is handed to Storage locations, plans by wine id, and assigns what the manager confirms', async () => {
    const assignMany = vi.fn(async () => ({ assigned: 1, failed: 0 }));
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => '' as never);
    mock.data = data({
      rows: [row({ id: 'i1', wineId: 'w1', type: 'red', stock: 3, shadow: 0 })],
      locations: { ...(data().locations as object), list: [cave], assignMany },
    });
    renderPage();
    fireEvent.click(within(document.getElementById('iv-tools')!).getByRole('button', { name: 'Storage locations' }));
    expect(typeof ported.slm!.onAutoLocate).toBe('function');
    act(() => (ported.slm!.onAutoLocate as () => void)());
    expect(screen.getByTestId('auto-locate-preview')).toBeTruthy();
    const plan = ported.preview!.result as { assignments: { wineId: string; locationId: string; quantity: number }[] };
    expect(plan.assignments).toEqual([expect.objectContaining({ wineId: 'w1', locationId: 'z1', quantity: 3 })]);
    await act(async () => {
      (ported.preview!.onConfirm as (s: unknown) => void)(plan.assignments);
    });
    expect(assignMany).toHaveBeenCalledWith([{ wineId: 'w1', locationId: 'z1', quantity: 3 }]);
    expect(ok).toHaveBeenCalledWith('1 wine assigned to locations');
    ok.mockRestore();
  });

  it('Auto-Locate waits, and says so, when what is already placed could not be read', () => {
    const said = vi.spyOn(toast, 'error').mockImplementation(() => '' as never);
    ported.preview = null;
    mock.data = data({
      rows: [row({ wineId: 'w1', stock: 3, shadow: 0 })],
      locations: { ...(data().locations as object), list: [cave], mappingsUnavailable: true },
    });
    renderPage();
    fireEvent.click(within(document.getElementById('iv-tools')!).getByRole('button', { name: 'Storage locations' }));
    act(() => (ported.slm!.onAutoLocate as () => void)());
    expect(screen.queryByTestId('auto-locate-preview')).toBeNull();
    expect(said.mock.calls[0][0]).toMatch(/^Auto-Locate waits/);
    said.mockRestore();
  });

  it('Auto-Locate leaves out a title whose count was not read rather than planning it as one bottle', () => {
    const note = vi.spyOn(toast, 'message').mockImplementation(() => '' as never);
    mock.data = data({
      rows: [row({ id: 'a', wineId: 'w1', type: 'red', stock: 3, shadow: 0 }), row({ id: 'b', wineId: 'w2', stock: null })],
      locations: { ...(data().locations as object), list: [cave] },
    });
    renderPage();
    fireEvent.click(within(document.getElementById('iv-tools')!).getByRole('button', { name: 'Storage locations' }));
    act(() => (ported.slm!.onAutoLocate as () => void)());
    const plan = ported.preview!.result as { assignments: { wineId: string }[] };
    expect(plan.assignments.map((x) => x.wineId)).toEqual(['w1']);
    expect(note.mock.calls[0][0]).toMatch(/^1 title is left out of the plan/);
    note.mockRestore();
  });
});

describe('row selection, ported from the legacy table (re-gate 2026-10-31)', () => {
  // openMl 0: the gateway always sends it; null would mean the open bottle was not read.
  const three = () => [
    row({ id: 'a', wineId: 'wa', name: 'Alpha', openMl: 0 }),
    row({ id: 'b', wineId: 'wb', name: 'Beta', openMl: 0 }),
    row({ id: 'c', wineId: 'wc', name: 'Gamma', openMl: 0 }),
  ];
  function tree() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <InventoryNext />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));

  it('shows no selection bar until a title is ticked, then counts it', () => {
    mock.data = data({ rows: three() });
    renderPage();
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
    tick('Alpha');
    expect(screen.getByTestId('inventory-selbar').textContent).toContain('1 selected');
    tick('Beta');
    expect(screen.getByTestId('inventory-selbar').textContent).toContain('2 selected');
    tick('Alpha');
    expect(screen.getByTestId('inventory-selbar').textContent).toContain('1 selected');
  });

  it('select-all ticks only the titles listed now, and a second press clears them', () => {
    mock.data = data({ rows: three() });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: 'gamma' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every listed title' }));
    expect(screen.getByTestId('inventory-selbar').textContent).toContain('1 selected');
    expect((screen.getByRole('checkbox', { name: 'Select Gamma' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clear the selection' }));
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
  });

  it('Export selected writes the valuation columns for the selected rows only, as one CSV', async () => {
    exportSpy.mockClear();
    mock.data = data({ rows: three() });
    renderPage();
    tick('Alpha');
    tick('Gamma');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export selected' }));
    });
    expect(exportSpy).toHaveBeenCalledTimes(1);
    const opts = exportSpy.mock.calls[0][0] as { format: string; filename: string; title: string; rows: InvRow[]; columns: { header: string }[] };
    expect(opts.format).toBe('csv');
    expect(opts.filename).toMatch(/^inventory-selected-\d{4}-\d{2}-\d{2}$/);
    expect(opts.title).toBe('Inventory selection');
    expect(opts.rows.map((r) => r.id).sort()).toEqual(['a', 'c']);
    expect(opts.columns.map((c) => c.header)).toContain('Value at cost');
  });

  it('Copy names puts one name per line on the clipboard and says how many', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const ok = vi.spyOn(toast, 'success').mockImplementation(() => '' as never);
    mock.data = data({ rows: three() });
    renderPage();
    tick('Alpha');
    tick('Beta');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy names' }));
    });
    expect(writeText).toHaveBeenCalledWith('Alpha\nBeta');
    expect(ok).toHaveBeenCalledWith('Copied 2 names');
    ok.mockRestore();
  });

  it('Copy names says so when the device will not copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      configurable: true,
    });
    const said = vi.spyOn(toast, 'error').mockImplementation(() => '' as never);
    mock.data = data({ rows: three() });
    renderPage();
    tick('Alpha');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy names' }));
    });
    expect(said).toHaveBeenCalledWith('The names could not be copied on this device.');
    said.mockRestore();
  });

  it('Remove selected opens the shared remove modal with every selected row, and clears the selection once removed', async () => {
    removeModal.props = null;
    mock.data = data({ rows: three() });
    renderPage();
    tick('Alpha');
    tick('Beta');
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
    expect(screen.getByTestId('remove-modal')).toBeTruthy();
    const items = removeModal.props!.items as { id: string; inventoryId: string; name: string }[];
    expect(items.map((i) => [i.id, i.inventoryId, i.name])).toEqual([
      ['wa', 'a', 'Alpha'],
      ['wb', 'b', 'Beta'],
    ]);
    act(() => (removeModal.props!.onRemoved as () => void)());
    expect(screen.queryByTestId('remove-modal')).toBeNull();
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
  });

  it('Remove selected waits, and says why, when a selected title cannot be zeroed first', () => {
    mock.data = data({ rows: [...three().slice(0, 2), row({ id: 'c', wineId: 'wc', name: 'Gamma', openMl: 0, stock: null })] });
    renderPage();
    tick('Alpha');
    tick('Gamma');
    expect((screen.getByRole('button', { name: 'Remove selected' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('selbar-remove-blocked').textContent).toMatch(/^Remove waits: 1 selected title cannot be zeroed first/);
    // Export and copy still work over the same selection.
    expect((screen.getByRole('button', { name: 'Export selected' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Clear selection empties it', () => {
    mock.data = data({ rows: three() });
    renderPage();
    tick('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
  });

  it('a house switch clears the selection, so nothing ticked in one house is acted on in another', () => {
    mock.data = data({ rows: three() });
    const r = render(tree());
    tick('Alpha');
    expect(screen.getByTestId('inventory-selbar')).toBeTruthy();
    mock.data = data({ rid: 'r2', rows: three() });
    r.rerender(tree());
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Select Alpha' }) as HTMLInputElement).checked).toBe(false);
  });

  it('a filter change clears the selection too', () => {
    mock.data = data({ rows: three() });
    renderPage();
    tick('Alpha');
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: 'alpha' } });
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
  });
});

describe('live legacy features the overturn named (round 4, 2026-10-31)', () => {
  afterEach(() => {
    insights.props = [];
    research.fetch.mockReset();
    research.fetch.mockImplementation(async () => []);
  });

  it('mounts the insights rail with the legacy props: host inventory, closed by default', () => {
    mock.data = data({ rows: [row({ id: 'a', name: 'Alpha' })] });
    renderPage();
    expect(screen.getByTestId('contextual-insights')).toBeTruthy();
    const last = insights.props[insights.props.length - 1];
    expect(last.host).toBe('inventory');
    expect(last.defaultOpen).toBe(false);
  });

  it('flags a placeholder-named title in its row with the gateway\'s words', async () => {
    research.fetch.mockImplementation(async () => [
      { inventoryId: 'a', status: 'not_findable', reason: 'placeholder', flag: 'Name this wine to get menu help.', updatedAt: '' },
      { inventoryId: 'b', status: 'matched', reason: 'ok', flag: null, updatedAt: '' },
    ]);
    mock.data = data({ rows: [row({ id: 'a', name: 'house red' }), row({ id: 'b', name: 'Musar' })] });
    renderPage();
    const hint = await screen.findByTestId('name-this-wine-hint');
    expect(hint.textContent).toBe('Name this wine to get menu help.');
    expect(within(screen.getByTestId('inv-row-a')).getByTestId('name-this-wine-hint')).toBeTruthy();
    expect(within(screen.getByTestId('inv-row-b')).queryByTestId('name-this-wine-hint')).toBeNull();
  });

  it('says a failed research read once, never as nothing to name', async () => {
    research.fetch.mockImplementation(async () => {
      throw new Error('boom');
    });
    mock.data = data({ rows: [row({ id: 'a', name: 'Alpha' })] });
    renderPage();
    const said = await screen.findByTestId('house-item-research-unread');
    expect(said.textContent).toContain('could not be read');
    expect(said.textContent).toContain('not “nothing to name”');
    expect(screen.queryByTestId('name-this-wine-hint')).toBeNull();
  });
});

describe('the rest of the census: keys, realtime, POS queue, count-sheet notes (round 4)', () => {
  afterEach(() => {
    pos.lines.mockReset();
    pos.lines.mockImplementation(async () => ({ summary: { open_lines: 0 } }));
  });
  const three = () => [
    row({ id: 'a', wineId: 'wa', name: 'Alpha', openMl: 0 }),
    row({ id: 'b', wineId: 'wb', name: 'Beta', openMl: 0 }),
  ];

  it('Cmd/Ctrl+A selects every listed title and Escape clears them, never while typing', () => {
    mock.data = data({ rows: three() });
    renderPage();
    fireEvent.keyDown(screen.getByPlaceholderText('Search titles, producers, grapes'), { key: 'a', metaKey: true });
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('inventory-selbar').textContent).toContain('2 selected');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('inventory-selbar')).toBeNull();
  });

  it('the arrows step between titles and Space on a title ticks it', () => {
    mock.data = data({ rows: three() });
    renderPage();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    const first = within(screen.getByTestId('inv-row-a')).getByRole('button', { expanded: false });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = within(screen.getByTestId('inv-row-b')).getByRole('button', { expanded: false });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: ' ' });
    expect(screen.getByTestId('inventory-selbar').textContent).toContain('1 selected');
  });

  it('re-reads the stock on a cross-page inventory event', () => {
    mock.data = data({ rows: three() });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <InventoryNext />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    spy.mockClear();
    act(() => {
      window.dispatchEvent(new CustomEvent('inventory_change', { detail: { new: { id: 'a' } } }));
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['inventory'] });
  });

  it('names POS lines that moved no stock, and says an unread queue is unread', async () => {
    pos.lines.mockImplementation(async () => ({ summary: { open_lines: 4 } }));
    mock.data = data({ rows: three() });
    const { unmount } = renderPage();
    expect((await screen.findByTestId('inv-pos-queue')).textContent).toContain('4 POS lines rang up and moved no stock');
    unmount();
    pos.lines.mockImplementation(async () => {
      throw new Error('down');
    });
    renderPage();
    expect((await screen.findByTestId('inv-pos-queue')).textContent).toContain('could not be read');
  });

  it('says nothing about POS when the queue is read empty', async () => {
    mock.data = data({ rows: three() });
    renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('inv-pos-queue')).toBeNull();
  });

  it('writes the legacy Observation column from what was read, never from an unread figure', async () => {
    exportSpy.mockClear();
    mock.data = data({
      rows: [
        row({ id: 'a', name: 'Alpha', runway: 2, shadow: 3, lastCountedAt: null }),
        row({ id: 'b', name: 'Beta', runway: null, shadow: null, lastCountedAt: new Date().toISOString() }),
      ],
    });
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export count sheet' }));
    });
    const file = exportSpy.mock.calls[0][0] as { rows: InvRow[]; columns: { header: string; value: (r: InvRow) => unknown }[] };
    const obs = file.columns.find((c) => c.header === 'Observation')!;
    const byName = new Map(file.rows.map((r) => [r.name, String(obs.value(r))]));
    expect(byName.get('Alpha')).toContain('Stock-out risk, 2d runway');
    expect(byName.get('Alpha')).toContain('Shadow 3; reconcile after this count');
    expect(byName.get('Alpha')).toContain('Never counted');
    expect(byName.get('Beta')).toBe('');
  });

  it('shows the ABC class the server sent, and nothing when it sent none', () => {
    mock.data = data({ rows: [row({ id: 'a', name: 'Alpha', abc: 'A' }), row({ id: 'b', name: 'Beta', abc: null })] });
    renderPage();
    expect(within(screen.getByTestId('inv-row-a')).getByTestId('inv-abc').textContent).toBe('A');
    expect(within(screen.getByTestId('inv-row-b')).queryByTestId('inv-abc')).toBeNull();
  });
});

describe('the legacy velocity sort and column-header sort (round 4)', () => {
  it('sorts fastest first, an unread pace last, and says so when no pace was read', () => {
    const rs = [row({ id: 'a', name: 'A', velocity: 0.5 }), row({ id: 'b', name: 'B', velocity: null }), row({ id: 'c', name: 'C', velocity: 2 })];
    expect(sortRows(rs, 'pace').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortWords('pace', [row({ velocity: null })])).toMatch(/no pace was read/);
  });

  it('a sortable header sets its sort, and clicking it again goes back to Needs you first', () => {
    mock.data = data({ rows: [row({ id: 'a', name: 'Beta', velocity: 0.1 }), row({ id: 'b', name: 'Alpha', velocity: 3 })] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Vel/day' }));
    expect(screen.getByTestId('inventory-footer').textContent).toContain('sorted Fastest moving');
    expect(screen.getByRole('columnheader', { name: 'Vel/day' }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(screen.getByTestId('inventory-footer').textContent).toContain('sorted Name');
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(screen.getByTestId('inventory-footer').textContent).toContain('sorted Needs you first');
  });
});
