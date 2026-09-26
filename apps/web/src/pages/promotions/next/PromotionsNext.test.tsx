/**
 * PromotionsNext render contract:
 *  - loading never renders a zero or an empty table, only a skeleton;
 *  - a failed read is a named sentence (401/403/other), never an empty docket;
 *  - a real empty table says so, with the ledger window behind it;
 *  - a graded offer draws the standing line, the docket and (when present)
 *    the "cannot be graded" and "put away" folds, without double-counting an
 *    offer into more than one of those;
 *  - the page holds OFFERS ONLY (ADR 0160 §113, Open item 3): no tab strip, no
 *    sender or prospect section, and a hand-off link to `/communications`,
 *    where Trusted senders and Strangers (with hold-to-trust and add-vendor) live.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OfferDto } from './promotions-format';

const mockRead = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown } }));
const mutateFns = vi.hoisted(() => ({ dismiss: vi.fn(), restore: vi.fn() }));

vi.mock('./usePromotionsNextData', () => ({
  usePromotionsRead: () => mockRead.current,
  useDismissOffer: () => ({ mutate: mutateFns.dismiss, isPending: false }),
  useRestoreOffer: () => ({ mutate: mutateFns.restore, isPending: false }),
}));

vi.mock('../../../components/mudavym', async (orig) => ({
  ...(await orig<typeof import('../../../components/mudavym')>()),
  HouseHeader: () => null,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ availableRestaurants: [], activeRestaurantId: null, setActiveRestaurantId: vi.fn() }),
}));

import PromotionsNext from './PromotionsNext';

function wine(over: Partial<OfferDto['grade']['wines'][number]> = {}) {
  return {
    wine: 'Ch. de Sours Rosé 2024',
    matchedAs: 'Ch. de Sours Rosé 2024',
    baseline: { kind: 'paid' as const, ref: 'r1', providerId: 'v1', providerName: 'Empire', productKey: null, identityId: null, productName: 'Ch. de Sours Rosé 2024', price: 14.2, unit: 'bottle', currency: 'USD', date: '2026-06-02', source: 'receipt_verified', scope: 'house' as const, quantity: 12, note: null },
    offered: { price: 12.5, unit: 'bottle', currency: 'USD', derivation: '12% off 14.20 per bottle, this vendor’s last landed price to you' },
    bestElsewhere: { kind: 'paid' as const, ref: 'r2', providerId: 'v2', providerName: 'Winebow', productKey: null, identityId: null, productName: 'Ch. de Sours Rosé 2024', price: 13.1, unit: 'bottle', currency: 'USD', date: '2026-06-02', source: 'receipt_verified', scope: 'house' as const, quantity: 52, note: null },
    market: null,
    reference: null,
    deltaPct: -4.6,
    verdict: 'beats' as const,
    worth: { amount: 31, currency: 'USD', quantity: 52, invoiceLines: 8, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 },
    worthWithheld: null,
    skipped: [],
    ...over,
  };
}

function offer(over: Partial<OfferDto> = {}): OfferDto {
  return {
    id: 'o1',
    provider_id: 'v1',
    provider_name: 'Empire',
    name: 'Sept rosé close-out',
    promo_type: 'seasonal',
    description: null,
    conditions: { code: 'ROSE12' },
    discount_value: { percent: 12 },
    applicable_wines: ['Ch. de Sours Rosé 2024'],
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    confidence: 0.8,
    created_at: '2026-09-01T00:00:00.000Z',
    dismissed_at: null,
    dismissed_by: null,
    state: 'open',
    grade: { status: 'graded', wines: [wine()], qualification: null, tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: '2026-06-02', paidLines: 8 } },
    bundle: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PromotionsNext />
    </MemoryRouter>,
  );
}

describe('PromotionsNext — loading / failed / empty', () => {
  it('loading renders a skeleton, never a zero or a claimed count', () => {
    mockRead.current = { data: undefined, isLoading: true, isError: false, error: null };
    renderPage();
    expect(screen.queryByText(/offers from/)).not.toBeInTheDocument();
  });

  it('a 403 is named as role-withheld, never an empty docket', () => {
    mockRead.current = { data: undefined, isLoading: false, isError: true, error: { response: { status: 403 } } };
    renderPage();
    expect(screen.getByText(/The offers could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/owner or manager/)).toBeInTheDocument();
  });

  it('a real empty table says so, with the ledger window behind it', () => {
    mockRead.current = {
      data: { read_at: '2026-09-18T12:00:00Z', offers: [], ledger: { window_days: 540, since: '2025-03-12', paid_lines: 0, house_sightings: 0, market_sightings: 0, skipped_sightings: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    };
    renderPage();
    expect(screen.getByText(/No offers on the table/)).toBeInTheDocument();
    expect(screen.getAllByText(/540 days/).length).toBeGreaterThan(0);
  });
});

describe('PromotionsNext — a graded offer', () => {
  function loadOne(o: OfferDto) {
    mockRead.current = {
      data: { read_at: '2026-09-18T12:00:00Z', offers: [o], ledger: { window_days: 540, since: '2025-03-12', paid_lines: 10, house_sightings: 2, market_sightings: 1, skipped_sightings: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    };
  }

  it('draws the standing line and the offer card, the number against the OTHER vendor', () => {
    loadOne(offer());
    renderPage();
    expect(screen.getByText(/1 offer from 1 vendor/)).toBeInTheDocument();
    expect(screen.getByText('-4.6%')).toBeInTheDocument();
    expect(screen.getByText(/Winebow, \$13\.10/)).toBeInTheDocument();
  });

  it('never prints the vendor\'s own percentage as the grade — it is labelled "their claim"', () => {
    loadOne(offer());
    renderPage();
    expect(screen.getByText(/Their claim:/)).toBeInTheDocument();
  });

  it('a not_a_price offer is drawn in "cannot be graded", never in the main docket', () => {
    loadOne(
      offer({
        id: 'np',
        discount_value: {},
        grade: { status: 'not_a_price', wines: [], qualification: null, tally: { beats: 0, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 0 } },
      }),
    );
    renderPage();
    expect(screen.getByText('Cannot be graded')).toBeInTheDocument();
    expect(screen.getByText('not a price')).toBeInTheDocument();
    // Not drawn twice: no percent figure anywhere for this offer.
    expect(screen.queryByText(/beats|above/)).not.toBeInTheDocument();
  });

  it('a dismissed offer is folded under "put away for the house", collapsed by default', () => {
    loadOne(offer({ state: 'dismissed', dismissed_at: '2026-09-10T00:00:00.000Z' }));
    renderPage();
    expect(screen.getByText('1 put away for the house')).toBeInTheDocument();
    expect(screen.queryByText('Restore')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('show'));
    expect(screen.getByText('Restore')).toBeInTheDocument();
  });

  it('putting an offer away calls the mutation with its id, not the whole row', () => {
    loadOne(offer());
    renderPage();
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Put away'));
    expect(mutateFns.dismiss).toHaveBeenCalledWith('o1');
  });

  it('opening Details shows the offer sheet with the full per-wine breakdown', () => {
    loadOne(offer());
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /^Details/ })[0]);
    expect(screen.getByText('Every named bottle')).toBeInTheDocument();
  });
});

describe('PromotionsNext — the band and the tray (sketch 124 direction A, founder 2026-09-25, round 5)', () => {
  function load(offers: OfferDto[]) {
    mockRead.current = {
      data: { read_at: '2026-09-18T12:00:00Z', offers, ledger: { window_days: 540, since: '2025-03-12', paid_lines: 10, house_sightings: 2, market_sightings: 1, skipped_sightings: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    };
  }
  const worthOf = (amount: number) => ({ ...wine().worth!, amount });
  const single = (id: string, amount: number, over: Partial<OfferDto> = {}) =>
    offer({ id, name: `offer ${id}`, grade: { ...offer().grade, wines: [wine({ worth: worthOf(amount) })] }, ...over });
  const bundleOffer = (id: string, total: number | null, bottles: Array<number | null>, over: Partial<OfferDto> = {}) =>
    offer({
      id,
      name: `bundle ${id}`,
      promo_type: 'bundle',
      applicable_wines: bottles.map((_, i) => `Bottle ${i + 1}`),
      grade: {
        ...offer().grade,
        wines: bottles.map((b, i) => wine({ wine: `Bottle ${i + 1}`, matchedAs: `Bottle ${i + 1}`, worth: b == null ? null : worthOf(b) })),
      },
      bundle: total == null ? null : { amount: total, currency: 'USD', linesCounted: bottles.length },
      ...over,
    });
  const cardsIn = (root: ParentNode) => [...root.querySelectorAll('article[data-testid^="offer-card-"]')];

  it('draws a row per tier — hero band, three large, compact tiles — and the tier is the size class', () => {
    load([10, 90, 30, 70, 50].map((w, i) => single(`o${i}`, w)));
    const { container } = renderPage();
    const hero = container.querySelector('.pn-row-hero')!;
    const large = container.querySelector('.pn-row-large')!;
    const compact = container.querySelector('.pn-row-compact')!;
    expect(cardsIn(hero).map((c) => c.getAttribute('data-testid'))).toEqual(['offer-card-o1']);
    expect(cardsIn(large).map((c) => c.getAttribute('data-testid'))).toEqual(['offer-card-o3', 'offer-card-o4', 'offer-card-o2']);
    expect(cardsIn(compact).map((c) => c.getAttribute('data-testid'))).toEqual(['offer-card-o0']);
    expect(cardsIn(hero)[0].className).toBe('pn-card pn-card--hero');
    expect(cardsIn(large)[0].className).toBe('pn-card pn-card--large');
    expect(cardsIn(compact)[0].className).toBe('pn-card pn-card--compact');
  });

  it('rank order is strict top to bottom: document order is worth order, band after band', () => {
    const worths = [5, 120, 44, 81, 17, 63, 29, 98, 11, 72, 36, 58];
    load(worths.map((w, i) => single(`o${i}`, w)));
    const { container } = renderPage();
    const cards = cardsIn(container.querySelector('[data-testid="pn-band"]')!);
    // ten or more offers read at once: every one of the twelve is drawn
    expect(cards).toHaveLength(12);
    const order = cards.map((c) => worths[Number(c.getAttribute('data-testid')!.replace('offer-card-o', ''))]);
    expect(order).toEqual([...worths].sort((a, b) => b - a));
    expect(cards.map((c) => c.getAttribute('data-tier'))).toEqual(['hero', 'large', 'large', 'large', ...Array(8).fill('compact')]);
  });

  it('a bundle is a tray in the same bands, ranked by its rolled-up total, its bottles as a table', () => {
    load([single('big', 120), single('small', 50), bundleOffer('b1', 93, [40, 30, 23])]);
    const { container } = renderPage();
    const cards = cardsIn(container.querySelector('[data-testid="pn-band"]')!);
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['offer-card-big', 'offer-card-b1', 'offer-card-small']);
    const tray = screen.getByTestId('offer-card-b1');
    expect(tray.className).toBe('pn-card pn-card--large pn-tray');
    expect(tray).toHaveAttribute('data-bundle', 'true');
    expect(within(tray).getByText('bundle · 3 bottles')).toBeInTheDocument();
    expect(tray.querySelector('.pn-num')!.textContent).toBe('about $93');
    const table = within(tray).getByRole('table');
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Bottle 1', 'Bottle 2', 'Bottle 3']);
    expect(within(table).getByText('-4.6% · about $40')).toBeInTheDocument();
    expect(within(table).getByText('-4.6% · about $23')).toBeInTheDocument();
    expect(within(tray).getByText(/Estimate at your rate/)).toBeInTheDocument();
    // no separate bundle fold any more
    expect(screen.queryByTestId('pn-bundles')).toBeNull();
  });

  it('a bundle whose total is withheld is a COMPACT tray, never sized by its best bottle', () => {
    // one bottle has no worth, so the rollup is withheld — its other bottle's 500 would have made it the hero
    load([single('a', 60), single('b', 40), bundleOffer('w', null, [500, null], { end_date: null, state: 'undated' })]);
    renderPage();
    const tray = screen.getByTestId('offer-card-w');
    expect(tray).toHaveAttribute('data-tier', 'compact');
    expect(tray.closest('.pn-row-compact')).not.toBeNull();
    expect(screen.getByTestId('offer-card-a')).toHaveAttribute('data-tier', 'hero');
    expect(within(tray).getByText('worth withheld')).toBeInTheDocument();
    expect(within(tray).getByText(/1 of 2 bottles in this bundle has no worth of its own/)).toBeInTheDocument();
    // the bottle keeps its own figure in the table; the tray's headline is never that bottle's worth
    expect(tray.querySelector('.pn-num')!.textContent).toBe('worth withheld');
    expect(within(within(tray).getByRole('table')).getByText('-4.6% · about $500')).toBeInTheDocument();
  });

  it("a bundle whose minimum has no unit is compact and says why (ADR 0165 rule 1)", () => {
    const reason = 'the offer states a minimum of 12 without saying bottles or cases';
    const b = bundleOffer('u', null, [null, null]);
    b.grade = {
      ...b.grade,
      qualification: { state: 'unit_unknown', minimum: { quantity: 12, unit: null }, largestOrder: null, reason },
      wines: b.grade.wines.map((w) => ({ ...w, worthWithheld: reason })),
    };
    load([single('a', 60), b]);
    renderPage();
    const tray = screen.getByTestId('offer-card-u');
    expect(tray).toHaveAttribute('data-tier', 'compact');
    expect(within(tray).getByText(reason)).toBeInTheDocument();
  });

  it("an undated offer stays on the table, labelled 'no end date' (sketch 113 Q6)", () => {
    load([single('d', 40, { end_date: null, state: 'undated' })]);
    renderPage();
    const card = screen.getByTestId('offer-card-d');
    expect(within(card).getByText('no end date')).toBeInTheDocument();
    expect(screen.getByText(/1 offer from 1 vendor/)).toBeInTheDocument();
  });

  it("a tray's Details opens the sheet with the bundle's total above its bottles", () => {
    load([bundleOffer('b1', 93, [40, 30, 23])]);
    renderPage();
    fireEvent.click(within(screen.getByTestId('offer-card-b1')).getByRole('button', { name: /^Details/ }));
    const block = screen.getByTestId('pn-sheet-bundle');
    expect(block).toHaveTextContent('about $93');
    expect(screen.getByText('Every named bottle')).toBeInTheDocument();
  });

  it("declares no ground of its own by default, so the person's choice applies (ADR 0169)", () => {
    load([offer()]);
    const { container } = renderPage();
    const root = container.querySelector('.mudavym.pn-page');
    expect(root).not.toBeNull();
    expect(root!.hasAttribute('data-ground')).toBe(false);
  });
});

describe('PromotionsNext — offers only (ADR 0160 §113, Open item 3)', () => {
  const emptyRead = () => {
    mockRead.current = {
      data: { read_at: '2026-09-18T12:00:00Z', offers: [], ledger: { window_days: 540, since: '2025-03-12', paid_lines: 0, house_sightings: 0, market_sightings: 0, skipped_sightings: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    };
  };

  it('has no tab strip and no sender or prospect section', () => {
    emptyRead();
    renderPage();
    expect(screen.queryByRole('navigation', { name: 'Promotions sections' })).toBeNull();
    expect(screen.queryByText('Trusted senders')).toBeNull();
    expect(screen.queryByLabelText('Trusted senders')).toBeNull();
    expect(screen.queryByLabelText('Prospects')).toBeNull();
    expect(screen.queryByText(/Hold to trust|Add as vendor|Add as a vendor/)).toBeNull();
    expect(screen.getByLabelText('Offers')).toBeInTheDocument();
  });

  it('hands off to /communications, where the senders and strangers live', () => {
    emptyRead();
    renderPage();
    const link = screen.getByRole('link', { name: /Open in Communications/ });
    expect(link).toHaveAttribute('href', '/communications');
  });

  /**
   * The move as a RULE, not a habit. The interim panels read the un-keyed
   * shared sender/prospect hooks; a copy sneaking back into this directory would
   * quietly un-move the acts and split the register across two pages.
   */
  it('nothing in this directory imports the sender or prospect hooks or panel', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src', 'pages', 'promotions', 'next');
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      if (/from\s*['"][^'"]*(usePromotionsQueries|SendersProspectsPanel)['"]/.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
