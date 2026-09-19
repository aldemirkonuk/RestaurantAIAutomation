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
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('draws the standing line and the offer as a hero card, the number against the OTHER vendor', () => {
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
    fireEvent.click(screen.getAllByText('Details')[0]);
    expect(screen.getByText('Every named bottle')).toBeInTheDocument();
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
