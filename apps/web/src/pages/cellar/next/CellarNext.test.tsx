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
 *  - a register with no endpoint says so and shows its shape, never rows.
 *
 * The data hook is mocked; every other honesty branch is exercised through it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BottleVM } from './useCellarNextData';

const mock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarNextData: () => mock.current,
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
  refetch: vi.fn(),
};

function draw(props: { category?: 'wines' | 'beer' | 'whiskey' | 'cocktails' } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CellarNext {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock.current = { ...base };
});

describe('CellarNext — the parent surface', () => {
  it('opens as the cellar book with all four registers named', () => {
    mock.current = { ...base, bottles: [bottle()] };
    draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Cellar');
    for (const id of ['wines', 'beer', 'whiskey', 'cocktails']) {
      expect(screen.getByTestId(`register-${id}`)).toBeInTheDocument();
    }
    // Only the wine register is written in; the other three are ruled and empty.
    expect(within(screen.getByTestId('register-wines')).getByText('open')).toBeInTheDocument();
    expect(within(screen.getByTestId('register-beer')).getByText('unruled')).toBeInTheDocument();
  });

  it('never puts a count on a register nothing serves', () => {
    mock.current = { ...base, bottles: [bottle(), bottle({ id: 'w2' })] };
    draw();
    const beer = screen.getByTestId('register-beer');
    expect(beer.textContent).toMatch(/no endpoint serves beer|cannot even report how many/i);
    expect(beer.textContent).not.toMatch(/\d/);
  });

  it('says "titles read (capped)" when the catalogue read came back full', () => {
    // Live 2026-09-02: /wines?limit=500 returns exactly 500 rows, so the card
    // must not claim to be counting the library.
    mock.current = { ...base, bottles: [bottle()], bookTruncated: true };
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
      building: { titles: null, bottles: null, belowPar: null, offBook: null },
    };
    draw();
    expect(screen.getByText(/could not be read \(ECONNREFUSED\)/)).toBeInTheDocument();
    // four building figures + two register figures render the dash, never a 0
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

describe('CellarNext — the registers nothing serves', () => {
  it.each(['beer', 'whiskey', 'cocktails'] as const)(
    '%s says it is unwired and shows the shape, never rows',
    (id) => {
      draw({ category: id });
      const panel = screen.getByTestId(`unwired-${id}`);
      expect(panel).toHaveTextContent('This register is not wired yet');
      expect(panel).toHaveTextContent('No gateway controller serves');
      expect(panel).toHaveTextContent('The shape it would carry');
      expect(panel).toHaveTextContent('unread — no endpoint to ask');
      // no table of bottles, and no count of zero anywhere
      expect(screen.queryByTestId('wine-register')).not.toBeInTheDocument();
      expect(within(panel).queryByText('0')).not.toBeInTheDocument();
    },
  );
});
