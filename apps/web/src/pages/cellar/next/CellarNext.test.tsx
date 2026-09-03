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
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  BottleVM,
  CellarRegistersVM,
  RegisterReadoutVM,
} from './useCellarNextData';
import type { RegisterId } from './cellar-format';

const mock = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  beverages: { data: null, loading: false, error: null } as Record<string, unknown>,
  cocktails: { data: null, loading: false, error: null } as Record<string, unknown>,
}));

vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarNextData: () => mock.current,
  useBeverageRegister: () => mock.beverages,
  useCocktailRegister: () => mock.cocktails,
}));

vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));

import CellarNext from './CellarNext';

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

function draw(
  props: { category?: 'wines' | 'beer' | 'whiskey' | 'cocktails' } = {},
  route = '/cellar',
) {
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

describe('CellarNext — the catalogue registers', () => {
  it('lists real beer rows, and refuses to call the shared catalogue this house’s stock', () => {
    mock.current = { ...base, registers: readout() };
    mock.beverages = {
      loading: false,
      error: null,
      data: {
        rows: [
          {
            id: 'b1',
            beverage_type: 'beer',
            name: 'Efes Pilsen',
            display_name: null,
            producer: 'Anadolu Efes',
            brand: null,
            country: 'Türkiye',
            region: null,
            abv_pct: 5,
            volume_ml: 500,
            package_format: null,
            price_reference: null,
          },
        ],
        count: 1,
        truncated: false,
        limit: 300,
        register: 'beer',
        matchedTypes: ['beer'],
        servedByThisTable: true,
        scope: 'global-reference',
        scopeNote:
          'public.beverages carries no restaurant_id — this is the shared reference catalogue, not what this house holds. Nothing here is stock.',
      },
    };
    draw({ category: 'beer' });
    expect(screen.getByText('Efes Pilsen')).toBeInTheDocument();
    expect(screen.getByTestId('register-scope')).toHaveTextContent(
      /no restaurant_id.*not what this house holds/s,
    );
    // no "on hand" column: this house cannot hold stock of this kind yet
    expect(screen.queryByText('On hand')).not.toBeInTheDocument();
    expect(screen.getByText(/keyed on the wine library/)).toBeInTheDocument();
    // the reference price with no value is the dash, never $0.00
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('separates an empty catalogue from a failed read', () => {
    mock.current = { ...base, registers: readout() };
    mock.beverages = { loading: false, error: 'HTTP 500', data: null };
    draw({ category: 'whiskey' });
    expect(screen.getByRole('alert')).toHaveTextContent(/unread, not empty/);
    expect(screen.queryByTestId('beverages-empty-whiskey')).not.toBeInTheDocument();
  });

  it('cocktails list names and never a recipe, and count reference rows apart', () => {
    mock.current = { ...base, registers: readout() };
    mock.cocktails = {
      loading: false,
      error: null,
      data: {
        rows: [
          {
            id: 'c1',
            name: 'Negroni',
            display_name: null,
            menu_section: 'Aperitivo',
            method: 'stirred',
            glass: 'rocks',
            garnish: null,
            price: 18,
            description: null,
          },
        ],
        count: 1,
        truncated: false,
        referenceRows: 55,
        recipesAvailable: false,
        scopeNote: 'Only cocktails this restaurant owns.',
      },
    };
    draw({ category: 'cocktails' });
    expect(screen.getByText('Negroni')).toBeInTheDocument();
    expect(screen.getByText(/Recipes were never extracted/)).toBeInTheDocument();
    expect(screen.getByText(/55 unattributed reference cocktails/)).toBeInTheDocument();
    // the table has no ingredients column, because there are no ingredients
    expect(
      screen.queryByRole('columnheader', { name: /ingredient/i }),
    ).not.toBeInTheDocument();
  });

  it('soft drinks say there is nothing to ask for, not that there are none', () => {
    mock.current = { ...base, registers: readout() };
    draw({}, '/cellar?register=soft_drinks');
    const panel = screen.getByTestId('no-source-soft_drinks');
    expect(panel).toHaveTextContent(/No value of .*beverage_type.* distinguishes a soft drink/);
    expect(panel).toHaveTextContent(/nothing to ask/);
    expect(within(panel).queryByText('0')).not.toBeInTheDocument();
  });

  it('an unknown ?register value opens the overview rather than an invented register', () => {
    mock.current = { ...base, bottles: [bottle()], registers: readout() };
    draw({}, '/cellar?register=kombucha');
    expect(screen.getByTestId('register-wines')).toBeInTheDocument();
  });
});
