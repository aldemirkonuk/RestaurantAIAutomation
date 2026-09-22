/**
 * BottleLeaf — "the wine's own detail" and "what the library knows"
 * (ADR 0160 sec110 Owed #4/#11, sketch 121's `.band`). New file: this build
 * replaced the previous placeholder ("genuinely undesigned ... a named
 * placeholder rather than an invented layout") with the real band sketch 121
 * draws, once the founder answered its own questions 2026-09-18 ("show,
 * labelled honestly"; the wine sentence "either compose it from the profile
 * or ... extract ... from the master data set").
 *
 * Scope: pure rendering off `BottleVM.structure` and the notes fields. The
 * order/inventory mutation paths are `OrderCeremony.test.tsx`'s own file.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BottleLeaf from './BottleLeaf';
import { EM } from './cellar-format';
import type { BottleVM, CellarRow, WineStructureVM } from './useCellarNextData';

vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));
// The lock list (ADR 0193 round 3, L8): read, and empty unless a test says otherwise.
const listPriceLocks = vi.fn(async () => ({
  restaurantId: 'r1',
  generatedAt: '2026-09-21T12:00:00Z',
  readable: true,
  reason: null,
  scope: 'this house' as const,
  currentMenus: [],
  locks: [] as unknown[],
  counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 },
  namesReadable: true,
  namesReason: null,
  markersReadable: true,
  markersReason: null,
}));
vi.mock('../../../services/api/pricing', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listPriceLocks: () => listPriceLocks(),
}));
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

const NO_HANDLING = {
  servingTempCelsius: null,
  glassType: null,
  decantingRecommended: null,
  agingPotentialYears: null,
};

function structure(over: Partial<WineStructureVM> = {}): WineStructureVM {
  return {
    body: null,
    acidity: null,
    tannins: null,
    sweetness: null,
    primaryAromas: [],
    handling: NO_HANDLING,
    ...over,
  };
}

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
    knowledge: 'inferred',
    observedAt: null,
    cellar: null,
    beverageKind: 'wine',
    structure: null,
    ...over,
  };
}

function mount(b: BottleVM) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BottleLeaf bottle={b} providers={[]} vendorsError={null} restaurantId="r1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function cellarRow(over: Partial<CellarRow> = {}): CellarRow {
  return {
    inventoryId: 'inv-1',
    stockLive: 9,
    thresholdMin: 12,
    providerId: null,
    providerName: null,
    lastCountedAt: null,
    glassesPerBottle: null,
    menuPriceGlass: null,
    menuPriceBottle: null,
    velocityPerDay: null,
    daysSinceSale: null,
    analyticsReadable: true,
    ...over,
  };
}

// Cellar lane, 2026-09-19 (the house price is menu_price_current since ADR
// 0193, 2026-09-21). The founder: "we're
// going to add a per house bottle price ... our library price will be just
// the average price." Two changes, one section: a new house-typed fact
// (`menuPriceBottle`, mirroring the existing `menuPriceGlass`), and the
// existing library figure relabelled from "List price" to "Market average"
// so a reader cannot mistake one for the other.
describe('BottleLeaf — bottle price vs. the library\'s market average', () => {
  it('labels the library figure "Market average", never "List price"', () => {
    mount(bottle());
    expect(screen.getByText('Market average')).toBeInTheDocument();
    expect(screen.queryByText('List price')).not.toBeInTheDocument();
  });

  it('shows this house\'s own bottle price once it is in the cellar and set — a DIFFERENT figure from the library\'s market average', () => {
    // Deliberately not 62 (the fixture's default listPrice): if the bottle
    // price fact ever fell back to the library figure, a coincidentally
    // equal value would hide it.
    mount(bottle({ listPrice: 62, cellar: cellarRow({ menuPriceBottle: 65 }) }));
    const facts = screen.getByTestId('bottle-leaf-fact-set');
    expect(within(facts).getByText('Bottle price (this house)')).toBeInTheDocument();
    expect(within(facts).getByText('$65.00')).toBeInTheDocument();
    // The library figure is still shown too, under its own, different label —
    // this house's price never replaces it, and the two numbers differ.
    const marketAvgDd = within(facts).getByText('Market average (bottle)').nextElementSibling!;
    expect(marketAvgDd).toHaveTextContent('$62.00');
  });

  it('shows the em dash, and the "set one in Inventory" note, when no bottle price is recorded', () => {
    mount(bottle({ cellar: cellarRow({ menuPriceBottle: null, menuPriceGlass: 15 }) }));
    const facts = screen.getByTestId('bottle-leaf-fact-set');
    const bottlePriceDd = within(facts).getByText('Bottle price (this house)').nextElementSibling!;
    expect(bottlePriceDd).toHaveTextContent(EM);
    expect(screen.getByText(/No by-the-bottle price recorded on this row/)).toBeInTheDocument();
    // The glass note is independent: set here, so it must NOT also claim no
    // glass price is recorded — the two facts are not fate-shared.
    expect(screen.queryByText(/No by-the-glass price recorded/)).not.toBeInTheDocument();
  });

  it('never uses the library\'s market average as a fallback for an unset house bottle price', () => {
    // bottle.listPrice (the library figure) is a real, non-null number here —
    // if the bottle-price fact ever fell back to it, this test would not
    // catch a `?? bottle.listPrice`-shaped regression by accident.
    mount(bottle({ listPrice: 92, cellar: cellarRow({ menuPriceBottle: null }) }));
    const facts = screen.getByTestId('bottle-leaf-fact-set');
    const bottlePriceDd = within(facts).getByText('Bottle price (this house)').nextElementSibling!;
    expect(bottlePriceDd).not.toHaveTextContent('92');
  });
});

describe('BottleLeaf — a locked house price is said beside the price (ADR 0193 round 3, L8)', () => {
  it('says the lock on this row, read from the lock list', async () => {
    listPriceLocks.mockResolvedValueOnce({
      ...(await listPriceLocks()),
      locks: [
        {
          lockId: 'lk-1',
          inventoryId: 'inv-1',
          kind: 'bottle',
          lockedPrice: 65,
          lockedAt: '2026-09-21T10:00:00Z',
          ageDays: 0,
          note: null,
          movedFromLockId: null,
          lockedBy: { userId: 'u-1', name: 'Ayse' },
          wine: { name: 'Boğazkere', vintage: 2021, masterWineId: 'w1', active: true, housePrice: 65 },
          dormant: false,
          menuPrice: null,
          markers: [],
          advice: null,
          adviceUnknownReason: null,
        },
      ],
    });
    mount(bottle({ cellar: cellarRow({ inventoryId: 'inv-1', menuPriceBottle: 65 }) }));
    expect(await screen.findByTestId('bottle-leaf-lock-bottle')).toHaveTextContent(
      'The bottle price is locked at $65.00 at this house, by Ayse since 2026-09-21.',
    );
  });
});

describe('BottleLeaf — "the wine\'s own detail"', () => {
  it('says structure is not recorded when the wire carried none — never a guess', () => {
    mount(bottle({ structure: null }));
    expect(screen.getByTestId('wine-structure-none')).toHaveTextContent(
      /no body, acidity, tannin or sweetness/,
    );
  });

  it('shows body, acidity and tannin as a word (each with its own tick bar) and sweetness as a word alone', () => {
    mount(
      bottle({
        structure: structure({ body: 'full', acidity: 'medium-high', tannins: 'high', sweetness: 'dry' }),
      }),
    );
    const section = screen.getByTestId('wine-structure');
    expect(section).toHaveTextContent('full');
    expect(section).toHaveTextContent('medium-high');
    expect(section).toHaveTextContent('high');
    expect(section).toHaveTextContent('dry');
  });

  it('shows a word this page cannot rank (13 production rows: firm/soft/grippy) without a tick bar, never a guessed position', () => {
    mount(bottle({ structure: structure({ tannins: 'grippy' }) }));
    const section = screen.getByTestId('wine-structure');
    expect(section).toHaveTextContent('grippy');
    // No filled tick — `data-on="true"` — anywhere in the rendered section.
    expect(section.querySelector('[data-on="true"]')).toBeNull();
  });

  it('shows the em dash for each unrecorded structure word', () => {
    mount(bottle({ structure: structure({ body: 'full' }) }));
    const section = screen.getByTestId('wine-structure');
    expect(section.textContent).toContain('—');
  });

  it('composes the handling sentence, in sketch 121\'s own order, only when all four fields are recorded', () => {
    mount(
      bottle({
        structure: structure({
          handling: { servingTempCelsius: 17, glassType: 'Bordeaux', decantingRecommended: true, agingPotentialYears: 8 },
        }),
      }),
    );
    expect(screen.getByTestId('wine-structure-handling')).toHaveTextContent(
      '17 °C · Bordeaux glass · decant · ageing potential 8 years',
    );
  });

  it('says handling is not recorded — never three of four — when exactly one of the four is missing', () => {
    mount(
      bottle({
        structure: structure({
          handling: { servingTempCelsius: 17, glassType: 'Bordeaux', decantingRecommended: true, agingPotentialYears: null },
        }),
      }),
    );
    expect(screen.getByTestId('wine-structure-handling')).toHaveTextContent('How to serve it is not recorded.');
  });
});

describe('BottleLeaf — "what the library knows"', () => {
  it('shows a written note exactly as before when the library has one', () => {
    mount(bottle({ tastingNotes: 'Dark fruit, firm tannin.', structure: structure({ body: 'full' }) }));
    expect(screen.getByText('Dark fruit, firm tannin.')).toBeInTheDocument();
    // A written note is never displaced by a composed one, even when both are available.
    expect(screen.queryByText(/Composed from this wine/)).not.toBeInTheDocument();
  });

  it('composes a sentence from the structure, labelled as composed, when the library holds no written note', () => {
    mount(bottle({ structure: structure({ body: 'full', acidity: 'high', sweetness: 'dry' }) }));
    expect(screen.getByText('A full-bodied wine with high acidity and a dry character.')).toBeInTheDocument();
    expect(screen.getByText(/Composed from this wine.s recorded structure/)).toBeInTheDocument();
  });

  it('does not compose from an incomplete structure (two of three) — falls back to "no notes"', () => {
    mount(bottle({ structure: structure({ body: 'full', acidity: 'high' /* sweetness missing */ }) }));
    expect(screen.queryByText(/A full-bodied wine/)).not.toBeInTheDocument();
    expect(screen.getByText(/The library holds no notes for this bottle/)).toBeInTheDocument();
  });

  it('shows the plain "no notes" message when there is neither a written note nor a composable structure', () => {
    mount(bottle({ structure: null }));
    expect(screen.getByText(/The library holds no notes for this bottle/)).toBeInTheDocument();
  });

  it('shows typical aromas whenever the library holds any — alongside a composed sentence', () => {
    mount(
      bottle({
        structure: structure({ body: 'full', acidity: 'high', sweetness: 'dry', primaryAromas: ['plum', 'clove'] }),
      }),
    );
    expect(screen.getByTestId('bottle-leaf-aromas')).toHaveTextContent('plum · clove');
  });

  it('shows typical aromas alongside the plain "no notes" message too — the two facts are independent', () => {
    mount(bottle({ structure: structure({ primaryAromas: ['plum', 'clove'] }) }));
    expect(screen.getByText(/The library holds no notes for this bottle/)).toBeInTheDocument();
    expect(screen.getByTestId('bottle-leaf-aromas')).toHaveTextContent('plum · clove');
  });

  it('shows no aromas line at all when the library holds none', () => {
    mount(bottle({ structure: null }));
    expect(screen.queryByTestId('bottle-leaf-aromas')).not.toBeInTheDocument();
  });
});
