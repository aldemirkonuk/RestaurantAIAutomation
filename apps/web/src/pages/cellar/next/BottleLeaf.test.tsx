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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BottleLeaf from './BottleLeaf';
import { EM, setCellarCurrency } from './cellar-format';
import { setHouseLocale } from '../../../lib/houseCurrency';
import type { BottleVM, CellarRow, WineStructureVM } from './useCellarNextData';

// The house currency CellarNext reads from /settings/currency before any leaf
// draws. A dollar house here, so the `$` figures below are what it prints.
beforeEach(() => {
  setCellarCurrency('USD');
});

const bringInMutate = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: bringInMutate, isPending: false }),
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
// F-505: flipped by the ceremony-copy test below; every other test reads an unchosen ceremony.
let ceremony: { holdCeremony: 'hold' | 'auto'; holdCeremonyConfigured: boolean } = {
  holdCeremony: 'hold',
  holdCeremonyConfigured: false,
};
vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarSettings: () => ({
    data: {
      restaurantId: 'r1',
      ...ceremony,
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
    listCurrency: 'USD',
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
    // F-918: the figure was recorded in dollars and this is a dollar house,
    // so the two can sit side by side.
    expect(marketAvgDd).toHaveTextContent('$62.00');
  });

  it('a dollar figure is not shown in a lira house, and says why (F-918)', () => {
    setCellarCurrency('TRY');
    mount(bottle({ listPrice: 62, listCurrency: 'USD', cellar: cellarRow({ menuPriceBottle: 1850 }) }));
    const facts = screen.getByTestId('bottle-leaf-fact-set');
    const marketAvgDd = within(facts).getByText('Market average (bottle)').nextElementSibling!;
    expect(marketAvgDd).toHaveTextContent(`${EM} recorded in USD, not your currency`);
    expect(marketAvgDd).not.toHaveTextContent('62');
    const bottleDd = within(facts).getByText('Bottle price (this house)').nextElementSibling!;
    expect(bottleDd).toHaveTextContent('TRY 1,850.00');
  });

  it('a figure whose currency the library never recorded is not shown in any house (F-918)', () => {
    for (const house of ['TRY', 'USD']) {
      setCellarCurrency(house);
      const { unmount } = mount(bottle({ listPrice: 62, listCurrency: null }));
      const marketAvgDd = screen.getByText('Market average').nextElementSibling!;
      expect(marketAvgDd).toHaveTextContent(`${EM} its currency was not recorded`);
      expect(marketAvgDd).not.toHaveTextContent('62');
      unmount();
    }
  });

  it('shows the em dash, and the "set one in Inventory" note, when no bottle price is recorded', () => {
    mount(bottle({ cellar: cellarRow({ menuPriceBottle: null, menuPriceGlass: 15 }) }));
    const facts = screen.getByTestId('bottle-leaf-fact-set');
    const bottlePriceDd = within(facts).getByText('Bottle price (this house)').nextElementSibling!;
    expect(bottlePriceDd).toHaveTextContent(EM);
    expect(screen.getByText(/No by-the-bottle price recorded for this bottle/)).toBeInTheDocument();
    // The glass note is independent: set here, so it must NOT also claim no
    // glass price is recorded — the two facts are not fate-shared.
    expect(screen.queryByText(/No by-the-glass price recorded/)).not.toBeInTheDocument();
  });

  it('speaks to the bottle, never in the system\'s own words (F-509)', () => {
    mount(bottle({ cellar: cellarRow({ menuPriceBottle: null, menuPriceGlass: null, thresholdMin: null }) }));
    const text = document.body.textContent ?? '';
    for (const word of ['retail_price_avg', 'worker', 'column', 'on this row', 'analytics join', 'gateway']) {
      expect(text).not.toContain(word);
    }
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

  it('F-663: aromas with no notes are marked as reasoned, and "nothing invented" is not said above them', () => {
    mount(bottle({ structure: structure({ primaryAromas: ['plum', 'clove'] }) }));
    expect(screen.getByText(/The library holds no written notes for this bottle/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing has\s+been invented/)).not.toBeInTheDocument();
    expect(screen.getByTestId('bottle-leaf-aromas')).toHaveTextContent('plum · clove');
    expect(screen.getByTestId('bottle-leaf-aromas-provenance')).toHaveTextContent('reasoned');
  });

  it('F-663: body, acidity, tannin and ageing carry the same provenance mark as the notes', () => {
    mount(bottle({ structure: structure({ body: 'full' }) }));
    const section = screen.getByTestId('wine-structure');
    expect(within(section).getByTestId('wine-structure-provenance')).toHaveTextContent('reasoned');
    expect(section).toHaveTextContent(/typical profile for the grape and the region/);
  });

  it('F-664: Format says "not stated" when the house stated no size, never a default 750 ml', () => {
    mount(bottle({ bottleSizeMl: null }));
    expect(screen.getByTestId('bottle-leaf-format-unstated')).toHaveTextContent('not stated');
    expect(screen.queryByText('750ml')).not.toBeInTheDocument();
  });

  it('F-664: Format shows the size the house stated', () => {
    mount(bottle({ bottleSizeMl: 375 }));
    expect(screen.getByText('375ml')).toBeInTheDocument();
  });

  it('shows no aromas line at all when the library holds none', () => {
    mount(bottle({ structure: null }));
    expect(screen.queryByTestId('bottle-leaf-aromas')).not.toBeInTheDocument();
  });
});

describe('BottleLeaf — the hold-ceremony note names only the cellar (F-505)', () => {
  it.each(['hold', 'auto'] as const)(
    'says a chosen "%s" ceremony holds orders placed from the cellar, never "every order"',
    (chosen) => {
      ceremony = { holdCeremony: chosen, holdCeremonyConfigured: true };
      try {
        mount(bottle());
        const note = screen.getByTestId('order-ceremony-note').textContent ?? '';
        // Only this leaf reads the ceremony; /orders approvals keep their own.
        expect(note).toMatch(/holds every order placed from the cellar/);
      } finally {
        ceremony = { holdCeremony: 'hold', holdCeremonyConfigured: false };
      }
    },
  );
});

describe('BottleLeaf — the bottle counts keep what is typed (F-1070, rehit of F-866)', () => {
  beforeEach(() => bringInMutate.mockReset());

  it('a cleared bring-in field stays empty, so typing 6 books 6', () => {
    const { container } = mount(bottle());
    const field = container.querySelector('#cl-bring-qty') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    expect(field.value).toBe('');
    expect(screen.getByRole('button', { name: 'Bring into the cellar' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bring into the cellar' }));
    expect(bringInMutate).toHaveBeenCalledWith({ wineId: 'w1', stockLive: 6 }, expect.anything());
  });

  it('half a bottle is not booked (F-1068)', () => {
    const { container } = mount(bottle());
    fireEvent.change(container.querySelector('#cl-bring-qty')!, { target: { value: '2.5' } });
    expect(screen.getByRole('button', { name: 'Bring into the cellar' })).toBeDisabled();
    expect(screen.getByText('Write a whole number of bottles, 1 or more.')).toBeInTheDocument();
  });

  it('a cleared order field stays empty and the order waits for a number', () => {
    const { container } = mount(bottle({ cellar: cellarRow({ providerId: 'p1' }) }));
    const field = container.querySelector('#cl-order-qty') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    expect(field.value).toBe('');
    expect(screen.getByText('Write a whole number of bottles, 1 or more.')).toBeInTheDocument();
  });

  it('the selling pace uses the house decimal mark', () => {
    setHouseLocale('tr-TR');
    try {
      mount(bottle({ cellar: cellarRow({ velocityPerDay: 1.5 }) }));
      expect(screen.getByTestId('bottle-leaf-sold-line').textContent).toContain('Selling ~1,5/day');
    } finally {
      setHouseLocale('en-US');
    }
  });
});

describe('BottleLeaf — the last-counted day reads the house way (F-1100)', () => {
  it('a lira house reads the day it counted in its own date style, not a US one', () => {
    setHouseLocale('tr-TR');
    try {
      mount(bottle({ cellar: cellarRow({ lastCountedAt: '2026-03-02T12:00:00Z' }) }));
      const dd = screen.getByText('Last counted').nextElementSibling!;
      expect(dd).toHaveTextContent('2 Mar 2026');
      expect(dd).not.toHaveTextContent('Mar 2, 2026');
    } finally {
      setHouseLocale('en-US');
    }
  });
});
