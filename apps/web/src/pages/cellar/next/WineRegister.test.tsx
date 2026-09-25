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
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import WineRegister from './WineRegister';
import type { BottleVM, CellarData } from './useCellarNextData';

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

function mkData(bottles: BottleVM[]): CellarData {
  return {
    activeRestaurantId: 'r1',
    authLoading: false,
    bottles,
    building: { titles: bottles.length, bottles: 0, belowPar: 0, offBook: 0, parUnset: 0 },
    providers: [],
    bookTruncated: false,
    bookLimit: 500,
    loadingMoreBook: false,
    loadMoreBook: vi.fn(),
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
    // A deliberately thin fixture: WineRegister never reads `saveRegisters`
    // (that control belongs to `Registers`/`CellarRegistersControl`), so the
    // real `UseMutationResult` shape is not worth reproducing here — same
    // "loosely typed mock" idiom `CellarNext.test.tsx`'s own `base` uses.
  } as unknown as CellarData;
}

function mount(bottles: BottleVM[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <WineRegister data={mkData(bottles)} />
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
