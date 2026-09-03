/**
 * CellarNext render contract.
 *
 * The founder's named requirements, asserted rather than described:
 *  - the IA: `/cellar` is a parent surface with four registers, `/wines` is a
 *    child that shows EVERYTHING (the breadth that was liked);
 *  - the rejection: depth is off the row — the learned detail only appears on
 *    the reading stand, one bottle at a time;
 *  - market price is the em dash until enrichment exists;
 *  - stock and body are never fabricated: a catalogue-only bottle says it is
 *    not in the cellar rather than showing 0 of a par of 6, and no Body filter
 *    exists at all;
 *  - a register with no source says so, never rows.
 *
 * SECOND PASS, 2026-09-03 — the founder's adaptation review. The registers are
 * no longer a global constant: only the ones this house carries are drawn, and
 * the four states behind that (confirmed / manual / inferred / unknown, plus
 * unread) are each asserted below, because collapsing any two of them is
 * exactly the fault the review named.
 *
 * The data hook is mocked; every other honesty branch is exercised through it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  BottleVM,
  CellarRegistersVM,
  RegisterReadoutVM,
} from './useCellarNextData';
import { registerHref } from './cellar-format';
import type { RegisterId } from './cellar-format';

const mock = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  beverages: { data: null, loading: false, error: null } as Record<string, unknown>,
  cocktails: { data: null, loading: false, error: null } as Record<string, unknown>,
  register: { data: null, loading: false, error: null, refetch: () => {} } as Record<string, unknown>,
  recipe: { data: null, loading: false, error: null } as Record<string, unknown>,
  writes: {} as Record<string, unknown>,
}));

vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarNextData: () => mock.current,
  useBeverageRegister: () => mock.beverages,
  useCocktailRegister: () => mock.cocktails,
  useRegister: () => mock.register,
  useCocktailRecipe: () => mock.recipe,
  useCocktailWrites: () => mock.writes,
}));

vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));

import CellarNext from './CellarNext';
import type { CellarNextProps } from './CellarNext';

function bottle(over: Partial<BottleVM> = {}): BottleVM {
  return {
    id: 'w1',
    name: '2016 Gravner Ribolla',
    producer: 'Gravner',
    grape: 'Ribolla Gialla',
    country: 'Italy',
    region: 'Friuli',
    appellation: 'Venezia Giulia',
    style: 'orange',
    vintage: 2016,
    listPrice: 92,
    marketPrice: null,
    bottleSizeMl: 750,
    description: null,
    tastingNotes: null,
    pairingNotes: null,
    imageUrl: null,
    knowledge: null,
    observedAt: null,
    cellar: null,
    beverageKind: 'wine',
    ...over,
  };
}

/** One register readout row, as the gateway returns it. */
function reg(
  id: RegisterId,
  over: Partial<RegisterReadoutVM> = {},
): RegisterReadoutVM {
  return {
    id,
    carried: false,
    decidedBy: 'inferred',
    confidence: 'none',
    basis: `Nothing in this cellar and nothing on this menu names ${id}.`,
    evidence: { inventoryRows: 0, menuRows: 0, catalogueRows: 0, nameOnly: false },
    needsEvidence: false,
    strandedItems: 0,
    ...over,
  };
}

const SOURCE_OK = { readable: true, reason: null, rows: 0 };

/** A whole readout, defaulting to "wines only, confirmed by the house". */
function readout(over: Partial<CellarRegistersVM> = {}): CellarRegistersVM {
  const registers =
    over.registers ??
    ([
      reg('wines', { carried: true, decidedBy: 'confirmed', confidence: 'certain' }),
      reg('beer'),
      reg('whiskey'),
      reg('cocktails'),
      reg('spirits'),
      reg('non_alcoholic'),
      reg('soft_drinks'),
    ] as RegisterReadoutVM[]);
  return {
    restaurantId: 'r1',
    registers,
    carried: registers.filter((r) => r.carried === true).map((r) => r.id),
    decidedBy: 'confirmed',
    awaitingConfirmation: false,
    needsEvidence: registers.filter((r) => r.needsEvidence).map((r) => r.id),
    stranded: registers
      .filter((r) => r.carried === false && (r.strandedItems ?? 0) > 0)
      .map((r) => r.id),
    sources: {
      answers: SOURCE_OK,
      inventory: SOURCE_OK,
      menu: SOURCE_OK,
      cocktails: SOURCE_OK,
      catalogue: SOURCE_OK,
    },
    unmappedKinds: {},
    unmappedCatalogueTypes: {},
    ...over,
  };
}

const base = {
  activeRestaurantId: 'r1',
  authLoading: false,
  bottles: [] as BottleVM[] | null,
  building: { titles: 0, bottles: 0, belowPar: 0, offBook: 0 },
  providers: [],
  bookTruncated: false,
  booking: false,
  bookError: null as string | null,
  cellarKnown: true,
  cellarError: null as string | null,
  vendorsError: null as string | null,
  registers: null as CellarRegistersVM | null,
  registersLoading: false,
  registersError: null as string | null,
  saveRegisters: { mutateAsync: vi.fn(), isPending: false, error: null },
  libraryByKind: null as Map<string, number> | null,
  refetch: vi.fn(),
};

/**
 * `props` is typed from the COMPONENT, never restated. The literal union that
 * used to sit here was written when only four registers had routes, and it
 * silently went stale the moment `CellarNextProps['category']` widened to all
 * seven — `tsc` caught it the first time a test passed `'spirits'`, which is
 * three months of drift this file would otherwise have carried unnoticed.
 */
function draw(props: Partial<CellarNextProps> = {}, route = '/cellar') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <CellarNext {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mock.current = { ...base };
  mock.beverages = { data: null, loading: false, error: null };
  mock.cocktails = { data: null, loading: false, error: null };
});

describe('CellarNext — the parent surface', () => {
  it('draws ONLY the registers this house carries, and says how that was decided', () => {
    // The founder's review: a wine house must not be shown an empty whiskey
    // programme. Four confirmed registers, three absent from the page entirely.
    mock.current = {
      ...base,
      bottles: [bottle()],
      registers: readout(),
    };
    draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Cellar');
    expect(screen.getByTestId('register-wines')).toBeInTheDocument();
    for (const id of ['beer', 'whiskey', 'cocktails', 'spirits', 'non_alcoholic', 'soft_drinks']) {
      expect(screen.queryByTestId(`register-${id}`)).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('registers-decided')).toHaveTextContent(
      /the house confirmed.*Change them in Settings/i,
    );
  });

  it('the non-alcoholic house: soft drinks and nothing else, no wine register at all', () => {
    const registers = [
      reg('wines'),
      reg('beer'),
      reg('whiskey'),
      reg('cocktails'),
      reg('spirits'),
      reg('non_alcoholic', { carried: true, decidedBy: 'confirmed', confidence: 'certain' }),
      reg('soft_drinks', { carried: true, decidedBy: 'confirmed', confidence: 'likely' }),
    ];
    mock.current = { ...base, bottles: [bottle()], registers: readout({ registers }) };
    draw();
    expect(screen.getByTestId('register-non_alcoholic')).toBeInTheDocument();
    expect(screen.getByTestId('register-soft_drinks')).toBeInTheDocument();
    expect(screen.queryByTestId('register-wines')).not.toBeInTheDocument();
    expect(screen.getByTestId('registers-hidden-note')).toHaveTextContent(
      /5 of the seven registers are not drawn/,
    );
  });

  it('a house with nothing in its books is shown ALL SEVEN, and none is claimed', () => {
    // Hiding six registers from a house nobody has asked is the same lie in
    // reverse. Unknown is not "no".
    const registers = ([
      'wines', 'beer', 'whiskey', 'cocktails', 'spirits', 'non_alcoholic', 'soft_drinks',
    ] as RegisterId[]).map((id) =>
      reg(id, { carried: null, decidedBy: 'unknown', confidence: 'unknown' }),
    );
    mock.current = {
      ...base,
      bottles: [bottle()],
      registers: readout({ registers, decidedBy: 'unknown', carried: [] }),
    };
    draw();
    for (const id of ['wines', 'beer', 'soft_drinks']) {
      expect(screen.getByTestId(`register-${id}`)).toHaveAttribute('data-muted', 'true');
    }
    expect(screen.getByTestId('registers-decided')).toHaveTextContent(
      /unknown — not empty/,
    );
  });

  it('reports the library’s own classification as the LIBRARY’s, never as stock', () => {
    // `beverage_kind` reaching the browser is what makes this line possible at
    // all; the sentence exists so the figure is never read as this cellar's.
    mock.current = {
      ...base,
      bottles: [bottle()],
      registers: readout(),
      libraryByKind: new Map([['wine', 442], ['beer', 12], ['unknown', 3]]),
    };
    draw();
    const line = screen.getByTestId('library-by-kind');
    expect(line).toHaveTextContent(/442 wine, 12 beer, 3 unknown/);
    expect(line).toHaveTextContent(/That is the library, not this cellar/);
  });

  it('an unreadable register answer shows the wine register alone, in words', () => {
    mock.current = {
      ...base,
      bottles: [bottle()],
      registers: null,
      registersError: 'HTTP 500',
    };
    draw();
    expect(screen.getByTestId('registers-unread')).toHaveTextContent(
      /could not be read \(HTTP 500\).*unread, not absent/s,
    );
    expect(screen.getByTestId('register-wines')).toBeInTheDocument();
    expect(screen.queryByTestId('register-beer')).not.toBeInTheDocument();
  });

  it('asks for the rows when a register is switched on with nothing behind it', () => {
    // The founder's change-over-time case, and premortem M1: an inline,
    // dismissible notice — never a modal, and never a doubt cast on the house.
    const registers = [
      reg('wines', { carried: true, decidedBy: 'confirmed', confidence: 'certain' }),
      reg('whiskey', {
        carried: true,
        decidedBy: 'manual',
        confidence: 'certain',
        needsEvidence: true,
        basis: 'The house switched this register on itself. The books show nothing of the kind yet.',
      }),
      reg('beer'), reg('cocktails'), reg('spirits'), reg('non_alcoholic'), reg('soft_drinks'),
    ];
    mock.current = { ...base, bottles: [bottle()], registers: readout({ registers, decidedBy: 'mixed' }) };
    draw();
    const notice = screen.getByTestId('needs-items-whiskey');
    // Register-aware, and honest about what is actionable: /inventory cannot
    // hold a bottle of rye, so it does not ask for one.
    expect(notice).toHaveTextContent(/Put your whiskies on the menu/);
    expect(notice).toHaveTextContent(/keyed on the wine library/);
    expect(notice).toHaveAttribute('data-needs-items', 'inline');
    // dismissible, and dismissing it does not remove the register
    fireEvent.click(within(notice).getByRole('button', { name: /Dismiss/ }));
    expect(screen.queryByTestId('needs-items-whiskey')).not.toBeInTheDocument();
    expect(screen.getByTestId('register-whiskey')).toBeInTheDocument();
  });

  it('says "titles read (capped)" when the catalogue read came back full', () => {
    // Live 2026-09-02: /wines?limit=500 returns exactly 500 rows, so the card
    // must not claim to be counting the library.
    mock.current = { ...base, bottles: [bottle()], bookTruncated: true, registers: readout() };
    draw();
    const wines = screen.getByTestId('register-wines');
    expect(within(wines).getByText('Titles read (capped)')).toBeInTheDocument();
    expect(within(wines).queryByText('Titles in the book')).not.toBeInTheDocument();
    expect(screen.getByText(/is a floor, not the size of the library/)).toBeInTheDocument();
  });

  it('says a failed cellar read in words and leaves the figures unknown, not zero', () => {
    mock.current = {
      ...base,
      bottles: [bottle()],
      cellarKnown: false,
      cellarError: 'ECONNREFUSED',
      registers: readout(),
      building: { titles: null, bottles: null, belowPar: null, offBook: null },
    };
    draw();
    expect(screen.getByText(/could not be read \(ECONNREFUSED\)/)).toBeInTheDocument();
    // the four building figures render the dash, never a 0
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('refuses to open a cellar for an account with no active branch', () => {
    mock.current = { ...base, activeRestaurantId: null };
    draw();
    expect(screen.getByTestId('cellar-no-tenant')).toHaveTextContent(/No restaurant is active/);
    expect(screen.queryByTestId('register-wines')).not.toBeInTheDocument();
  });

  it('does not call a resolving session a denied one', () => {
    // Measured live 2026-09-02: on a cold load AuthContext reports
    // activeRestaurantId === null for a beat even when the account HAS a
    // branch, so the denied copy flashed on every page open. Loading first.
    mock.current = { ...base, authLoading: true, activeRestaurantId: null };
    draw();
    expect(screen.getByTestId('cellar-opening')).toBeInTheDocument();
    expect(screen.queryByTestId('cellar-no-tenant')).not.toBeInTheDocument();
  });
});

describe('CellarNext — the wine register', () => {
  it('shows everything about a bottle on one row, with market price as a dash', () => {
    mock.current = { ...base, bottles: [bottle()] };
    draw({ category: 'wines' });
    const row = screen.getByText('2016 Gravner Ribolla').closest('tr')!;
    const cells = within(row);
    expect(cells.getByText('Gravner · Ribolla Gialla')).toBeInTheDocument();
    expect(cells.getByText('orange')).toBeInTheDocument();
    expect(cells.getByText('2016')).toBeInTheDocument();
    expect(cells.getByText('Friuli, Italy')).toBeInTheDocument();
    expect(cells.getByText('750ml')).toBeInTheDocument();
    expect(cells.getByText('$92.00')).toBeInTheDocument();
    // market price has no producer — a dash, never a number, never a zero
    expect(cells.getByText('—')).toBeInTheDocument();
    // and a catalogue-only bottle is not given a fabricated stock of 0
    expect(cells.getByText('not in the cellar')).toBeInTheDocument();
    expect(cells.queryByText('0')).not.toBeInTheDocument();
  });

  it('has no Body filter — the field it filtered on was a constant', () => {
    mock.current = { ...base, bottles: [bottle()] };
    draw({ category: 'wines' });
    expect(screen.queryByLabelText(/body/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Style')).toBeInTheDocument();
    expect(screen.getByLabelText('Cellar')).toBeInTheDocument();
  });

  it('keeps depth off the row: the stand opens only when a bottle is chosen', () => {
    mock.current = {
      ...base,
      bottles: [
        bottle({
          tastingNotes: 'Amber, dried apricot, a long oxidative finish.',
          knowledge: 'inferred',
        }),
      ],
    };
    draw({ category: 'wines' });
    expect(screen.queryByTestId('bottle-leaf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('2016 Gravner Ribolla'));
    const leaf = screen.getByTestId('bottle-leaf');
    // the enrichment the legacy page dropped on the floor
    expect(within(leaf).getByText(/dried apricot/)).toBeInTheDocument();
    // ...marked as reasoned, not recalled
    expect(within(leaf).getByText('reasoned')).toBeInTheDocument();
    expect(within(leaf).getByText(/typical profile, not a tasting of this bottle/)).toBeInTheDocument();
  });

  it('will not offer an order it cannot place, and says why', () => {
    mock.current = { ...base, bottles: [bottle()], providers: [] };
    draw({ category: 'wines' });
    fireEvent.click(screen.getByText('2016 Gravner Ribolla'));
    const leaf = screen.getByTestId('bottle-leaf');
    expect(within(leaf).getByRole('button', { name: /Order 6/ })).toBeDisabled();
    expect(within(leaf).getByText(/not in the cellar yet/i)).toBeInTheDocument();
    // the real write that IS available for a catalogue-only bottle
    expect(within(leaf).getByRole('button', { name: /Bring into the cellar/ })).toBeEnabled();
  });

  it('offers the hold-to-approve order once the bottle and the vendor are both real', () => {
    mock.current = {
      ...base,
      bottles: [
        bottle({
          cellar: {
            inventoryId: 'i1',
            stockLive: 3,
            thresholdMin: 6,
            providerId: 'p1',
            providerName: 'Bodega Álvaro',
            lastCountedAt: null,
          },
        }),
      ],
      providers: [{ id: 'p1', name: 'Bodega Álvaro' }],
    };
    draw({ category: 'wines' });
    fireEvent.click(screen.getByText('2016 Gravner Ribolla'));
    const leaf = screen.getByTestId('bottle-leaf');
    expect(within(leaf).getByText(/Hold to order 6 from Bodega Álvaro/)).toBeInTheDocument();
    expect(within(leaf).getByText('never counted')).toBeInTheDocument();
  });

  it('narrows on search and admits when nothing matches', () => {
    mock.current = { ...base, bottles: [bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })] };
    draw({ category: 'wines' });
    expect(screen.getByText(/2 of 2 titles/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search the register'), { target: { value: 'barolo' } });
    expect(screen.getByText(/1 of 2 titles/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search the register'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No title in the book matches/)).toBeInTheDocument();
  });

  it('says a failed book read in words with a retry, and shows no empty register', () => {
    mock.current = { ...base, bottles: null, bookError: 'HTTP 500' };
    draw({ category: 'wines' });
    expect(screen.getByRole('alert')).toHaveTextContent('The book could not be read (HTTP 500)');
    expect(screen.getByText('The register is unread.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(base.refetch).toHaveBeenCalled();
  });

  it('renders on-hand as a dash while the cellar is unanswered', () => {
    mock.current = { ...base, bottles: [bottle()], cellarKnown: false };
    draw({ category: 'wines' });
    expect(screen.getByText(/cellar has not answered yet/)).toBeInTheDocument();
    const row = screen.getByText('2016 Gravner Ribolla').closest('tr')!;
    expect(within(row).queryByText('not in the cellar')).not.toBeInTheDocument();
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('admits an empty book plainly', () => {
    mock.current = { ...base, bottles: [] };
    draw({ category: 'wines' });
    expect(screen.getByText(/open and empty/)).toBeInTheDocument();
  });
});

/* ── the registers that are not wines ──────────────────────────────────────
   THIRD PASS, 2026-09-03. What changed is the spine: these registers used to
   list `public.beverages` — a table with no `restaurant_id` — and truthfully
   report that none of it was this house's. DESIGN-FOUNDATION §6 marks the
   opposite as this page's exponential idea, "the house's own record on every
   bottle", so the house's five books come first and the catalogue is laid over
   them. These tests pin the three kinds of row that follow, plus the two
   things that must never regress: an unknown is an em dash, and stocking is
   withheld with its reason.                                               */

function houseRow(over: Record<string, unknown> = {}) {
  return {
    key: 'b1',
    name: 'Efes Pilsen',
    producer: 'Anadolu Efes',
    catalogue: {
      id: 'b1',
      beverageType: 'beer',
      country: 'Türkiye',
      region: null,
      abvPct: 5,
      volumeMl: 500,
      packageFormat: null,
      priceReference: null,
      matchedBy: 'exact',
    },
    house: {
      books: ['invoice', 'pos'],
      firstSeen: '2026-03-02T00:00:00Z',
      onMenu: null,
      bought: {
        lines: 3,
        first: '2026-03-02',
        last: '2026-08-19',
        bottles: 72,
        paidTotal: 618.4,
        lastUnitPrice: 8.6,
        lastFrom: 'Anadolu İçecek',
      },
      ordered: null,
      quoted: null,
      poured: { lines: 41, qty: 58, revenue: 464, firstAt: null, lastAt: null },
    },
    ...over,
  };
}

function registerVM(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    register: 'beer',
    rows: [houseRow()],
    counts: { total: 1, houseRows: 1, matched: 1, matchedLoosely: 0, catalogueOnly: 0 },
    catalogue: {
      readable: true, reason: null, rows: 1, truncated: false, limit: 400,
      matchedTypes: ['beer'], servedByThisTable: true,
    },
    house: { readable: true, reason: null, rows: 1, truncated: false, limit: 600 },
    stocking: {
      available: false,
      decision: 'OD-113',
      reason:
        'Nothing in this register can be counted into the cellar yet. restaurant_inventory is keyed on master_wine_id.',
    },
    scopeNote:
      "Rows with a record are this house's own. Rows without one are the shared reference catalogue and belong to nobody.",
    unregistered: [],
    ...over,
  };
}

describe('CellarNext — the registers that are not wines', () => {
  beforeEach(() => {
    mock.register = { data: null, loading: false, error: null, refetch: () => {} };
    mock.recipe = { data: null, loading: false, error: null };
    mock.writes = {};
  });

  it('puts this house’s own record on the row — first bought, paid, poured', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = { data: registerVM(), loading: false, error: null, refetch: () => {} };
    draw({ category: 'beer' });

    expect(screen.getByText('Efes Pilsen')).toBeInTheDocument();
    const row = screen.getByText('Efes Pilsen').closest('tr')!;
    expect(within(row).getByText('2 Mar 2026')).toBeInTheDocument();
    expect(within(row).getByText('$618.40')).toBeInTheDocument();
    expect(within(row).getByText('58')).toBeInTheDocument();
    // A book that names it nowhere is the dash, never a zero.
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(within(row).queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('opens the whole record on the stand, naming the table each fact came from', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = { data: registerVM(), loading: false, error: null, refetch: () => {} };
    draw({ category: 'beer' });
    fireEvent.click(screen.getByText('Efes Pilsen'));

    const leaf = screen.getByTestId('house-leaf');
    expect(within(leaf).getByText('Anadolu İçecek')).toBeInTheDocument();
    expect(leaf).toHaveTextContent(/procurement_document_lines/);
    expect(leaf).toHaveTextContent(/pos_unresolved_lines/);
    // The books that name it nowhere are absent, not zeroed.
    expect(leaf).not.toHaveTextContent(/quoted/i);
  });

  it('renders add-to-inventory disabled, with the OD-113 sentence beside it', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = { data: registerVM(), loading: false, error: null, refetch: () => {} };
    draw({ category: 'beer' });
    fireEvent.click(screen.getByText('Efes Pilsen'));

    const gate = screen.getByTestId('stock-gate');
    expect(gate).toBeDisabled();
    expect(screen.getByTestId('house-leaf')).toHaveTextContent(/keyed on master_wine_id/);
  });

  it('keeps a bottle the house bought that no catalogue row carries', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = {
      data: registerVM({
        rows: [houseRow({ key: 'k1', name: 'Bomonti Filtresiz', catalogue: null, producer: null })],
        counts: { total: 1, houseRows: 1, matched: 0, matchedLoosely: 0, catalogueOnly: 0 },
      }),
      loading: false, error: null, refetch: () => {},
    };
    draw({ category: 'beer' });
    fireEvent.click(screen.getByText('Bomonti Filtresiz'));
    expect(screen.getByTestId('leaf-uncatalogued')).toHaveTextContent(
      /not a bottle nobody bought/,
    );
  });

  it('marks a loose match as loose, in the row and on the stand', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = {
      data: registerVM({
        rows: [
          houseRow({
            name: 'LAGUNITAS IPA 6/12OZ NR',
            catalogue: { ...houseRow().catalogue, matchedBy: 'contains' },
          }),
        ],
        counts: { total: 1, houseRows: 1, matched: 0, matchedLoosely: 1, catalogueOnly: 0 },
      }),
      loading: false, error: null, refetch: () => {},
    };
    draw({ category: 'beer' });
    expect(screen.getByText(/matched loosely/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('LAGUNITAS IPA 6/12OZ NR'));
    expect(screen.getByTestId('match-contains')).toHaveTextContent(
      /A different bottle with the same words would match too/,
    );
  });

  it('labels a row nobody here has touched as belonging to nobody', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = {
      data: registerVM({
        rows: [houseRow({ key: 'b9', name: 'Some Stranger Stout', house: null })],
        counts: { total: 1, houseRows: 0, matched: 0, matchedLoosely: 0, catalogueOnly: 1 },
      }),
      loading: false, error: null, refetch: () => {},
    };
    draw({ category: 'beer' });
    fireEvent.click(screen.getByText('Some Stranger Stout'));
    expect(screen.getByTestId('leaf-no-record')).toHaveTextContent(
      /complete answer, not a missing one/,
    );
  });

  it('an unreadable ledger is words, and the catalogue still renders', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = {
      data: registerVM({
        rows: [houseRow({ house: null })],
        counts: { total: 1, houseRows: 0, matched: 0, matchedLoosely: 0, catalogueOnly: 1 },
        house: {
          readable: false,
          reason:
            'public.house_beverage_ledger is not on this database yet — migration 20260903120000 has not been applied here.',
          rows: null, truncated: false, limit: 600,
        },
      }),
      loading: false, error: null, refetch: () => {},
    };
    draw({ category: 'beer' });
    expect(screen.getByTestId('house-unread')).toHaveTextContent(/unknown, not empty/);
    expect(screen.getByTestId('house-unread')).toHaveTextContent(/20260903120000/);
    expect(screen.getByText('Efes Pilsen')).toBeInTheDocument();
  });

  it('separates a failed register read from an empty one', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = { data: null, loading: false, error: 'HTTP 500', refetch: () => {} };
    draw({ category: 'whiskey' });
    expect(screen.getByTestId('register-error')).toHaveTextContent(/unread, not empty/);
    expect(screen.queryByTestId('register-empty')).not.toBeInTheDocument();
  });

  it('serves soft drinks from this house’s own books, which no catalogue can', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = {
      data: registerVM({
        register: 'soft_drinks',
        rows: [
          houseRow({
            key: 'k-cola',
            name: 'Coca-Cola 330ml',
            producer: null,
            catalogue: null,
            house: {
              books: ['menu', 'pos'],
              firstSeen: '2026-01-04T00:00:00Z',
              onMenu: { lines: 1, bottlePrice: 4, glassPrice: null, sections: ['Soft Drinks'] },
              bought: null, ordered: null, quoted: null,
              poured: { lines: 220, qty: 231, revenue: 924, firstAt: null, lastAt: null },
            },
          }),
        ],
        counts: { total: 1, houseRows: 1, matched: 0, matchedLoosely: 0, catalogueOnly: 0 },
        catalogue: {
          readable: true,
          reason:
            'No value of beverages.beverage_type identifies soft_drinks, so the shared catalogue cannot answer for it.',
          rows: 0, truncated: false, limit: 400, matchedTypes: [], servedByThisTable: false,
        },
      }),
      loading: false, error: null, refetch: () => {},
    };
    draw({}, '/cellar?register=soft_drinks');
    expect(screen.getByText('Coca-Cola 330ml')).toBeInTheDocument();
    expect(screen.getByText(/cannot answer for it/)).toBeInTheDocument();
    // The register is NOT empty just because the catalogue cannot serve it.
    expect(screen.queryByTestId('register-empty')).not.toBeInTheDocument();
  });

  /**
   * THE THREE ROUTES ADDED 2026-09-03, through the prop they actually pass.
   *
   * `App.tsx:321-323` mounts `<CellarNext category="spirits" | "non_alcoholic"
   * | "soft_drinks" />`. Until this test existed those three ids were exercised
   * only as register CARDS on the overview and (for soft drinks) through the
   * `?register=` query path — `open = category ?? fromQuery` made that
   * *probably* equivalent, and "probably equivalent" is not a test. Each case
   * asserts the register's own content rendered, not merely that nothing threw.
   */
  it.each([
    ['spirits', 'Spirits', 'Rittenhouse Rye'],
    ['non_alcoholic', 'Non-alcoholic', 'Seedlip Garden 108'],
    ['soft_drinks', 'Soft drinks', 'Coca-Cola 330ml'],
  ] as const)(
    'renders the %s register through the category prop the route passes',
    (category, heading, bottle) => {
      mock.current = { ...base, registers: readout() };
      mock.register = {
        data: registerVM({
          register: category,
          rows: [houseRow({ key: `k-${category}`, name: bottle, producer: null })],
          counts: { total: 1, houseRows: 1, matched: 0, matchedLoosely: 0, catalogueOnly: 0 },
        }),
        loading: false, error: null, refetch: () => {},
      };
      draw({ category });

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
      expect(screen.getByTestId(`catalogue-${category}`)).toBeInTheDocument();
      expect(screen.getByText(bottle)).toBeInTheDocument();
      // The record is the point of the register, not just that it mounted.
      expect(screen.getByText('$618.40')).toBeInTheDocument();
      // And stocking is withheld here exactly as on every other register.
      expect(screen.queryByTestId('register-empty')).not.toBeInTheDocument();
    },
  );

  it('the route and the in-page link for the three new registers agree', () => {
    // A `<Link to>` this page renders must be a route `App.tsx` mounts, or the
    // spine sends the reader to the query-string fallback while the URL bar
    // shows a real route. The two were added in the same session and this is
    // the assertion that keeps them together.
    expect(registerHref('spirits')).toBe('/spirits');
    expect(registerHref('non_alcoholic')).toBe('/non-alcoholic');
    expect(registerHref('soft_drinks')).toBe('/soft-drinks');
  });

  it('reports the house lines no register can hold rather than dropping them', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = {
      data: registerVM({ unregistered: [{ label: 'Bread basket', books: ['invoice'] }] }),
      loading: false, error: null, refetch: () => {},
    };
    draw({ category: 'beer' });
    expect(screen.getByTestId('unregistered')).toHaveTextContent(/Bread basket/);
    expect(screen.getByTestId('unregistered')).toHaveTextContent(
      /counted nowhere rather than folded/,
    );
  });

  it('cocktails are the one register a house can write, and the recipe is writable', () => {
    mock.current = { ...base, registers: readout() };
    mock.register = { data: registerVM({ register: 'cocktails', rows: [], counts: { total: 0, houseRows: 0, matched: 0, matchedLoosely: 0, catalogueOnly: 0 } }), loading: false, error: null, refetch: () => {} };
    mock.recipe = { data: { cocktailId: 'c1', rows: [], count: 0, writable: true }, loading: false, error: null };
    mock.writes = {
      create: { mutateAsync: vi.fn(), isPending: false },
      amend: { mutateAsync: vi.fn(), isPending: false },
      retire: { mutateAsync: vi.fn(), isPending: false },
      setRecipe: { mutateAsync: vi.fn(), isPending: false },
    };
    mock.cocktails = {
      loading: false, error: null,
      data: {
        rows: [{
          id: 'c1', name: 'Negroni', display_name: null, menu_section: 'Aperitivo',
          method: 'stirred', glass: 'rocks', garnish: null, price: 18, description: null,
        }],
        count: 1, truncated: false, referenceRows: 55, recipesAvailable: false,
        scopeNote: 'Only cocktails this restaurant owns.',
      },
    };
    draw({ category: 'cocktails' });

    expect(screen.getByText('Negroni')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a cocktail/ })).toBeEnabled();
    expect(screen.getByText(/55 unattributed reference cocktails/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Negroni'));
    // The recipe half is no longer "never" — it is unwritten, and writable.
    expect(screen.getByTestId('recipe-empty')).toHaveTextContent(
      /empty because the extraction pass over the scanned menus never ran/,
    );
    expect(screen.getByRole('button', { name: /Write the recipe/ })).toBeEnabled();
  });

  it('retiring a cocktail takes two presses and never carries the seal', async () => {
    mock.current = { ...base, registers: readout() };
    mock.register = { data: registerVM({ register: 'cocktails', rows: [], counts: { total: 0, houseRows: 0, matched: 0, matchedLoosely: 0, catalogueOnly: 0 } }), loading: false, error: null, refetch: () => {} };
    mock.recipe = { data: { cocktailId: 'c1', rows: [], count: 0, writable: true }, loading: false, error: null };
    const retire = vi.fn().mockResolvedValue({ id: 'c1', retired: true });
    mock.writes = {
      create: { mutateAsync: vi.fn(), isPending: false },
      amend: { mutateAsync: vi.fn(), isPending: false },
      retire: { mutateAsync: retire, isPending: false },
      setRecipe: { mutateAsync: vi.fn(), isPending: false },
    };
    mock.cocktails = {
      loading: false, error: null,
      data: {
        rows: [{
          id: 'c1', name: 'Negroni', display_name: null, menu_section: null,
          method: null, glass: null, garnish: null, price: null, description: null,
        }],
        count: 1, truncated: false, referenceRows: null, recipesAvailable: false,
        scopeNote: 'Only cocktails this restaurant owns.',
      },
    };
    draw({ category: 'cocktails' });
    fireEvent.click(screen.getByText('Negroni'));

    const off = screen.getByRole('button', { name: /Take it off the list/ });
    fireEvent.click(off);
    // First press asks; it does not write.
    expect(retire).not.toHaveBeenCalled();

    // Awaited, not fire-and-forget: `doRetire` sets `said` and clears
    // `confirmRetire` AFTER the mutation resolves, so an unawaited click
    // updates state outside `act()` and React logs a warning that would
    // otherwise sit in this suite's output forever.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm/ }));
    });
    expect(retire).toHaveBeenCalledWith('c1');
    // And the outcome is reported to the operator, not swallowed.
    expect(screen.getByTestId('cocktail-said')).toHaveTextContent(
      /dated, not deleted/,
    );
  });

  it('an unknown ?register value opens the overview rather than an invented register', () => {
    mock.current = { ...base, bottles: [bottle()], registers: readout() };
    draw({}, '/cellar?register=kombucha');
    expect(screen.getByTestId('register-wines')).toBeInTheDocument();
  });
});
