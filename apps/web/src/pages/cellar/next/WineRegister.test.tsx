/**
 * WineRegister — sketch 121's beside-the-list layout (must_fix, cellar lane,
 * 2026-09-19). The founder's own words: "the register buttons open full-page
 * lists, and a bottle opens beside the list." This file is the "tests for
 * opening, closing and focus" the fix was required to carry, plus keyboard
 * (Space/Enter to open, Esc to close) — MOTIONS.md's fifth pass documents the
 * same contract in prose; this is its proof.
 *
 * Scope: the split layout itself (`.cl-split`) — which register/table cell
 * content renders is `CellarNext.test.tsx`'s territory (it draws the whole
 * page and already covers "everything about a bottle on one row", search,
 * the failed-book-read state, etc.), and BottleLeaf's own content rendering
 * is `BottleLeaf.test.tsx`'s. This file only asks: where does the record
 * appear, does the full table/shelf give way to it, and does focus go where
 * a keyboard reader needs it to.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import WineRegister, { outcomeSentence } from './WineRegister';
import type { BottleVM, CellarData } from './useCellarNextData';

// F-665: the gateway, as the menu-read tally meets it. A confirm queues the
// wine (POST) and the outcome is read back per submission (GET).
const api = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../../../services/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => api.post(...a), get: (...a: unknown[]) => api.get(...a) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));
// The scanner hands back one readable title the moment it opens.
vi.mock('../../../components/wines/MenuScannerModal', () => ({
  MenuScannerModal: ({ onWinesDetected }: { onWinesDetected: (d: unknown[]) => void }) => (
    <button
      type="button"
      onClick={() => onWinesDetected([{ name: 'Yakut', producer: 'Kavaklıdere', type: 'red' }])}
    >
      fake scan done
    </button>
  ),
}));

vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));
// BottleLeaf reads cellar settings for the order-hold ceremony; only that one
// export is faked, everything else in the module (including WineRegister's
// own imports from it) stays real — same idiom as BottleLeaf.test.tsx.
vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarSettings: () => ({
    data: {
      restaurantId: 'r1',
      holdCeremony: 'hold',
      holdCeremonyConfigured: false,
      gazetteerMeasures: ['bottles'],
      gazetteerMeasuresConfigured: false,
      setBy: null,
      setAt: null,
      readable: true,
      readError: null,
    },
    loading: false,
    save: { mutateAsync: vi.fn(), isPending: false, isError: false, error: null },
  }),
}));

function bottle(over: Partial<BottleVM> = {}): BottleVM {
  return {
    id: 'w1',
    name: 'Boğazkere 2021',
    producer: 'Kavaklıdere',
    grape: 'Boğazkere',
    country: 'Türkiye',
    region: 'Diyarbakır',
    appellation: null,
    style: 'Red',
    vintage: 2021,
    listPrice: 62,
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
    structure: null,
    ...over,
  };
}

/** `extra` is the vendor list (an array) or fields to override (an object). */
function mkData(bottles: BottleVM[], extra: { id: string; name: string }[] | Partial<Record<keyof CellarData, unknown>> = []): CellarData {
  const providers = Array.isArray(extra) ? extra : [];
  const over = Array.isArray(extra) ? {} : extra;
  return {
    activeRestaurantId: 'r1',
    authLoading: false,
    bottles,
    building: { titles: bottles.length, bottles: 0, belowPar: 0, offBook: 0, parUnset: 0 },
    providers,
    bookTruncated: false,
    bookLimit: 500,
    loadingMoreBook: false,
    loadMoreBook: vi.fn(),
    searchBook: vi.fn(),
    bookSearch: null,
    booking: false,
    bookError: null,
    cellarKnown: true,
    cellarError: null,
    vendorsError: null,
    registers: null,
    registersLoading: false,
    registersError: null,
    saveRegisters: { mutateAsync: vi.fn(), isPending: false, error: null },
    libraryByKind: null,
    live: { touched: {}, lastApplyMs: null },
    refetch: vi.fn(),
    ...over,
    // A deliberately thin fixture: WineRegister never reads `saveRegisters`
    // (that control belongs to `Registers`/`CellarRegistersControl`), so the
    // real `UseMutationResult` shape is not worth reproducing here — same
    // "loosely typed mock" idiom `CellarNext.test.tsx`'s own `base` uses.
  } as unknown as CellarData;
}

function mount(bottles: BottleVM[], extra: { id: string; name: string }[] | Partial<Record<keyof CellarData, unknown>> = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <WineRegister data={mkData(bottles, extra)} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('WineRegister — sketch 121, the record opens beside a narrowed index', () => {
  it('shows the full table, and no split, until a bottle is chosen', () => {
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('wine-split')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bottle-leaf')).not.toBeInTheDocument();
  });

  it('opens beside a narrowed index on click — the full table gives way, it does not gain a stand above it', async () => {
    const user = userEvent.setup();
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    await user.click(screen.getByText('Boğazkere 2021'));

    const split = screen.getByTestId('wine-split');
    expect(within(split).getByTestId('bottle-leaf')).toBeInTheDocument();
    // The full table is gone — replaced, not merely covered — and the OTHER
    // bottle is still reachable from the narrowed index beside the leaf.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(within(split).getByText('Barolo Riserva')).toBeInTheDocument();
  });

  it('opens a row with Enter, and with Space too — the table row is not a native button', async () => {
    const user = userEvent.setup();
    mount([bottle()]);
    screen.getByText('Boğazkere 2021').closest('tr')!.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('bottle-leaf')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('bottle-leaf')).not.toBeInTheDocument();

    // Re-query: the table (and its rows) fully remounts on close — the split
    // replaced it rather than merely covering it — so the row focused above
    // is a now-detached node, not the one on screen again.
    screen.getByText('Boğazkere 2021').closest('tr')!.focus();
    await user.keyboard(' ');
    expect(screen.getByTestId('bottle-leaf')).toBeInTheDocument();
  });

  it('switches to a different bottle from the narrowed index — by click, and by keyboard', async () => {
    const user = userEvent.setup();
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    await user.click(screen.getByText('Boğazkere 2021'));

    const split = screen.getByTestId('wine-split');
    const otherRow = within(split).getByText('Barolo Riserva').closest('button')!;
    await user.click(otherRow);
    expect(within(screen.getByTestId('bottle-leaf')).getByRole('heading', { name: 'Barolo Riserva' })).toBeInTheDocument();

    // Switch back with the keyboard alone — the index row is a native
    // <button>, so Enter/Space need no handler of this component's own.
    const firstRow = within(screen.getByTestId('wine-split')).getByText('Boğazkere 2021').closest('button')!;
    firstRow.focus();
    await user.keyboard('{Enter}');
    expect(within(screen.getByTestId('bottle-leaf')).getByRole('heading', { name: 'Boğazkere 2021' })).toBeInTheDocument();
  });

  // sim wave 8 (F-409): switching bottles from the narrowed index used to
  // keep the previous bottle's leaf state — its vendor, its status line and
  // its "Order sent" — because the leaf was reused, not remounted.
  it('opens the next bottle with its own vendor, not the previous bottle\'s', async () => {
    const user = userEvent.setup();
    const cellarRow = {
      inventoryId: 'inv-b', stockLive: 4, thresholdMin: 2, providerId: 'pY', providerName: 'Vendor Y',
      lastCountedAt: null, glassesPerBottle: null, menuPriceGlass: null, menuPriceBottle: null,
      velocityPerDay: null, daysSinceSale: null, analyticsReadable: true,
    } as unknown as BottleVM['cellar'];
    mount(
      [bottle(), bottle({ id: 'w2', name: 'Barolo Riserva', cellar: cellarRow })],
      [{ id: 'pX', name: 'Vendor X' }, { id: 'pY', name: 'Vendor Y' }],
    );
    await user.click(screen.getByText('Boğazkere 2021'));
    const otherRow = within(screen.getByTestId('wine-split')).getByText('Barolo Riserva').closest('button')!;
    await user.click(otherRow);
    const leaf = screen.getByTestId('bottle-leaf');
    expect((within(leaf).getByLabelText('Vendor') as HTMLSelectElement).value).toBe('pY');
  });

  it('marks the open bottle in the narrowed index, and only that one', async () => {
    const user = userEvent.setup();
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    await user.click(screen.getByText('Boğazkere 2021'));
    // Scoped to the index, not the whole split: the leaf ALSO says
    // "Boğazkere 2021" (its own heading) once that bottle is open, which
    // would otherwise make this an ambiguous query.
    const index = screen.getByTestId('wine-split-index');
    const open = within(index).getByText('Boğazkere 2021').closest('button')!;
    const other = within(index).getByText('Barolo Riserva').closest('button')!;
    expect(open).toHaveAttribute('data-selected', 'true');
    expect(other).toHaveAttribute('data-selected', 'false');
  });

  it('closes on the leaf\'s own Close button and returns to the full table', async () => {
    const user = userEvent.setup();
    mount([bottle()]);
    await user.click(screen.getByText('Boğazkere 2021'));
    await user.click(within(screen.getByTestId('bottle-leaf')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('wine-split')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('closes on Escape from inside the leaf', async () => {
    const user = userEvent.setup();
    mount([bottle()]);
    await user.click(screen.getByText('Boğazkere 2021'));
    expect(screen.getByTestId('bottle-leaf')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('bottle-leaf')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('moves focus into the leaf when it opens fresh from closed', async () => {
    const user = userEvent.setup();
    mount([bottle()]);
    await user.click(screen.getByText('Boğazkere 2021'));
    const leaf = screen.getByTestId('bottle-leaf').closest('[tabindex="-1"]');
    expect(leaf).not.toBeNull();
    expect(document.activeElement).toBe(leaf);
  });

  it('does not steal focus back to the leaf on a bottle-to-bottle switch — cl-leaf-turn already shows the change', async () => {
    const user = userEvent.setup();
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    await user.click(screen.getByText('Boğazkere 2021'));
    const split = screen.getByTestId('wine-split');
    const otherRow = within(split).getByText('Barolo Riserva').closest('button')!;
    await user.click(otherRow);
    // Focus stayed on the control the reader just clicked, not wrenched onto
    // the leaf container a second time.
    expect(document.activeElement).toBe(otherRow);
  });

  it('returns focus to the table row that opened it once the leaf is dismissed', async () => {
    const user = userEvent.setup();
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    screen.getByText('Boğazkere 2021').closest('tr')!.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    // Re-query rather than reuse the pre-open reference: the table remounts
    // (a fresh set of <tr>s, same ids and text) when the split closes, so
    // asserting `toBe` against a node captured before open/close would
    // compare against a node that is no longer in the document at all.
    const rowAfterClose = screen.getByText('Boğazkere 2021').closest('tr')!;
    expect(document.activeElement).toBe(rowAfterClose);
  });

  it('returns focus to the narrowed-index row that opened it when a different bottle was chosen from there', async () => {
    const user = userEvent.setup();
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva' })]);
    await user.click(screen.getByText('Boğazkere 2021'));
    const split = screen.getByTestId('wine-split');
    const otherRow = within(split).getByText('Barolo Riserva').closest('button')!;
    await user.click(otherRow);
    await user.keyboard('{Escape}');
    // Closing returns to the full TABLE (the split, index included, is gone),
    // so the focus target is that bottle's table row now, not the index
    // button — which no longer exists — even though both ever carried the
    // same `wr-row-w2` id at different times.
    const rowAfterClose = screen.getByText('Barolo Riserva').closest('tr')!;
    expect(document.activeElement).toBe(rowAfterClose);
  });
});

describe('WineRegister — search folds Turkish letters', () => {
  it('finds Kavaklıdere and İzmir when typed without Turkish letters', async () => {
    const user = userEvent.setup();
    mount([
      bottle(),
      bottle({ id: 'w2', name: 'Sevilen İzmir Merlot', producer: 'Sevilen', grape: 'Merlot', region: 'Ege' }),
      bottle({ id: 'w3', name: 'Barolo Riserva', producer: 'Borgogno', grape: 'Nebbiolo', country: 'Italy', region: 'Piemonte' }),
    ]);
    const search = screen.getByLabelText('Search the register');

    await user.type(search, 'kavaklidere');
    expect(screen.getByText('Boğazkere 2021')).toBeInTheDocument();
    expect(screen.queryByText('Barolo Riserva')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'izmir');
    expect(screen.getByText('Sevilen İzmir Merlot')).toBeInTheDocument();
    expect(screen.queryByText('Boğazkere 2021')).not.toBeInTheDocument();
  });
});

describe('WineRegister — searching a book that is not whole (F-592)', () => {
  const yakut = bottle({ id: 'w-yakut', name: 'Yakut', producer: 'Kavaklıdere', grape: 'Öküzgözü' });

  it('asks the whole library for the typed text', async () => {
    const searchBook = vi.fn();
    mount([bottle()], { bookTruncated: true, searchBook });
    await userEvent.type(screen.getByRole('searchbox'), 'Yakut');
    await vi.waitFor(() => expect(searchBook).toHaveBeenLastCalledWith('Yakut'));
  });

  it('does not say "no match" while the library has not answered', async () => {
    mount([bottle()], {
      bookTruncated: true,
      bookSearch: { term: 'Yakut', hits: null, loading: true, error: null },
    });
    await userEvent.type(screen.getByRole('searchbox'), 'Yakut');
    expect(screen.getByTestId('wine-register-empty')).toHaveTextContent('Looking through the whole library');
    expect(screen.queryByText(/No title in the book matches/)).toBeNull();
  });

  it('lists a title the library found past the rows read so far', async () => {
    mount([bottle()], {
      bookTruncated: true,
      bookSearch: { term: 'Yakut', hits: [yakut], loading: false, error: null },
    });
    await userEvent.type(screen.getByRole('searchbox'), 'Yakut');
    expect(await screen.findByText('Yakut')).toBeInTheDocument();
  });

  it('says "nothing in the library" only once the library said so', async () => {
    mount([bottle()], {
      bookTruncated: true,
      bookSearch: { term: 'Yakut', hits: [], loading: false, error: null },
    });
    await userEvent.type(screen.getByRole('searchbox'), 'Yakut');
    await vi.waitFor(() =>
      expect(screen.getByTestId('wine-register-empty')).toHaveTextContent(
        'Nothing in the library has “Yakut” in its name or producer',
      ),
    );
  });
});

describe("WineRegister — the house's own price, and the catalogue's named for what it is (F-617)", () => {
  const cellar = (over: Record<string, unknown> = {}) =>
    ({
      inventoryId: 'inv-1',
      stockLive: 6,
      thresholdMin: null,
      providerId: null,
      providerName: null,
      lastCountedAt: null,
      glassesPerBottle: 5,
      menuPriceGlass: null,
      menuPriceBottle: 95,
      velocityPerDay: null,
      daysSinceSale: null,
      analyticsReadable: true,
      ...over,
    }) as BottleVM['cellar'];

  it('heads the library figure "Market average", never "List", and shows the house price under "Your price"', () => {
    mount([bottle({ listPrice: 38, cellar: cellar() }), bottle({ id: 'w2', name: 'Barolo Riserva', listPrice: 62 })]);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toContain('Your price');
    expect(heads).toContain('Market average');
    expect(heads).not.toContain('List');
    const priceOf = (name: string) =>
      within(screen.getByText(name).closest('tr')!).getByTestId('wine-house-price');
    const stocked = priceOf('Boğazkere 2021');
    const notStocked = priceOf('Barolo Riserva');
    expect(stocked).toHaveTextContent('$95.00');
    expect(stocked).not.toHaveTextContent('38');
    expect(notStocked).toHaveTextContent('—');
  });

  it('sorts by the house price when "Your price" is chosen, not by the catalogue figure', async () => {
    const user = userEvent.setup();
    // By name, and by the catalogue figure, the dear wine comes first; by the
    // house's own price the cheap one does.
    mount([
      bottle({ id: 'a', name: 'A dear here', listPrice: 10, cellar: cellar({ inventoryId: 'i-a', menuPriceBottle: 120 }) }),
      bottle({ id: 'b', name: 'B cheap here', listPrice: 90, cellar: cellar({ inventoryId: 'i-b', menuPriceBottle: 40 }) }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Sort by Your price' }));
    expect(screen.getAllByTestId('wine-house-price').map((c) => c.textContent)).toEqual(['$40.00', '$120.00']);
  });
});

describe('F-665: the menu-read tally says queued, and what became of it', () => {
  it('never says "added" for a wine that was only queued, and names the outcome once it is known', async () => {
    api.post.mockReset().mockResolvedValue({ data: { id: 'sub-1' } });
    api.get.mockReset().mockResolvedValue({ data: { id: 'sub-1', status: 'pending' } });
    const user = userEvent.setup();
    const { unmount } = mount([bottle()]);
    await user.click(screen.getByRole('button', { name: 'Read a menu' }));
    await user.click(await screen.findByRole('button', { name: 'fake scan done' }));
    await user.click(screen.getByTestId('bottle-confirm'));

    const tally = await screen.findByTestId('cl-reading-tally');
    expect(tally).toHaveTextContent('1 queued for the library, 0 turned away');
    expect(tally).not.toHaveTextContent('added to the library');
    await waitFor(() => expect(tally).toHaveTextContent('1 still being checked against the library'));
    expect(api.get).toHaveBeenCalledWith('/wines/submissions/sub-1');
    unmount();
  });

  it('says a near match waits for a person, and a match kept the library’s details', () => {
    expect(outcomeSentence(['pending_review', 'merged', 'accepted', null], 5)).toBe(
      'So far: 1 added as new; 1 matched a wine the library already holds (the library kept its own details); ' +
        '1 looked close to a wine already there and wait for a person to check; 2 still being checked against the library.',
    );
  });
});

describe('WineRegister -- an 86 shows on the list row (F-1434)', () => {
  it('marks a sold-out bottle in the table without opening it, and only that one', () => {
    const cellarRow = {
      inventoryId: 'inv-b', stockLive: 4, thresholdMin: 2, providerId: null, providerName: null,
      lastCountedAt: null, glassesPerBottle: null, menuPriceGlass: null, menuPriceBottle: null,
      velocityPerDay: null, daysSinceSale: null, analyticsReadable: true,
      soldOut: { cause: 'ran_out', startedAt: '2026-10-10T21:00:00Z' }, soldOutReadable: true,
    } as unknown as BottleVM['cellar'];
    mount([bottle(), bottle({ id: 'w2', name: 'Barolo Riserva', cellar: cellarRow })]);
    const chips = within(screen.getByRole('table')).getAllByTestId('sold-out-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].closest('tr')).toHaveTextContent('Barolo Riserva');
  });
});

