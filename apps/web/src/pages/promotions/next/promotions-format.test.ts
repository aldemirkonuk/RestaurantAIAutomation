import { describe, expect, it } from 'vitest';
import {
  bandsOf,
  bundleWorthReason,
  claimSentence,
  conditionsOf,
  discountOf,
  failureOf,
  failureSentence,
  fmtEstimate,
  fmtEstimateFigure,
  fmtPrice,
  fmtSignedPercent,
  headlineWineOf,
  offerStateWord,
  onTheTable,
  putAwayOffers,
  rankOffers,
  rankWorthOf,
  roundEstimate,
  standingLine,
  ungradableOffers,
  verdictTone,
  verdictWord,
  worthReasonFor,
  type OfferDto,
  type PromotionsReadDto,
  type WineGrade,
} from './promotions-format';

function wine(over: Partial<WineGrade> = {}): WineGrade {
  return {
    wine: 'Ch. de Sours Rosé 2024',
    matchedAs: 'Ch. de Sours Rosé 2024',
    baseline: null,
    offered: null,
    bestElsewhere: null,
    market: null,
    reference: null,
    deltaPct: null,
    verdict: 'no_elsewhere',
    worth: null,
    worthWithheld: null,
    skipped: [],
    ...over,
  };
}

function offer(over: Partial<OfferDto> = {}): OfferDto {
  return {
    id: '1',
    provider_id: 'v-empire',
    provider_name: 'Empire',
    name: 'Sept rosé close-out',
    promo_type: 'seasonal',
    description: null,
    conditions: {},
    discount_value: { percent: 12 },
    applicable_wines: ['Ch. de Sours Rosé 2024'],
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    confidence: 0.8,
    created_at: '2026-09-01T00:00:00.000Z',
    dismissed_at: null,
    dismissed_by: null,
    state: 'open',
    grade: { status: 'graded', wines: [wine()], qualification: null, tally: { beats: 0, matches: 0, above: 0, ungraded: 1 }, vendor: { lastPurchaseDate: null, paidLines: 0 } },
    bundle: null,
    ...over,
  };
}

describe('failureOf / failureSentence', () => {
  it('reads a 401 as expired, never as an empty list', () => {
    const f = failureOf({ response: { status: 401 } });
    expect(f.expired).toBe(true);
    expect(failureSentence(f)).toMatch(/session has expired/);
  });

  it('reads a 403 as role-withheld, naming owner/manager', () => {
    const f = failureOf({ response: { status: 403 } });
    expect(f.forbidden).toBe(true);
    expect(failureSentence(f)).toMatch(/owner or manager/);
  });

  it('any other failure names the message and denies it is an empty table', () => {
    const f = failureOf(new Error('502 after 8s'));
    expect(f.status).toBeNull();
    expect(failureSentence(f)).toMatch(/502 after 8s/);
    expect(failureSentence(f)).toMatch(/not an empty table/);
  });
});

describe('money / percent formatting', () => {
  it('formats USD and TRY in their own convention', () => {
    expect(fmtPrice(14.2, 'USD')).toBe('$14.20');
    expect(fmtPrice(13440, 'TRY')).toContain('13.440');
  });

  it('states plainly when currency was not recorded, never guesses one', () => {
    expect(fmtPrice(10, null)).toMatch(/currency not recorded/);
  });

  it('a tray headline is the rounded estimate in whole units, with no "about" of its own', () => {
    expect(fmtEstimateFigure(63.7, 'USD')).toBe('$64');
    expect(fmtEstimateFigure(163.7, 'USD')).toBe('$160');
    expect(fmtEstimateFigure(1234, 'USD')).toBe('$1,200');
    expect(fmtEstimateFigure(-42.4, 'USD')).toBe('-$42');
  });

  it('rounds a projection coarser as it grows, and labels it "about"', () => {
    expect(roundEstimate(31.42)).toBe(31);
    expect(roundEstimate(153)).toBe(150);
    expect(roundEstimate(2137)).toBe(2100);
    expect(fmtEstimate(31.42, 'USD')).toBe('about $31.00');
  });

  it('signs a percent explicitly, beats is never bare', () => {
    expect(fmtSignedPercent(-4.6)).toBe('-4.6%');
    expect(fmtSignedPercent(4.2)).toBe('+4.2%');
  });
});

describe('verdict words', () => {
  it('never prints the raw enum token', () => {
    expect(verdictWord('no_elsewhere')).toBe('no other vendor');
    expect(verdictWord('no_baseline')).toBe('never bought from this vendor');
  });

  it('only beats/matches and above carry a tone, everything else is neutral', () => {
    expect(verdictTone('beats')).toBe('beats');
    expect(verdictTone('matches')).toBe('beats');
    expect(verdictTone('above')).toBe('above');
    expect(verdictTone('no_elsewhere')).toBeNull();
    expect(verdictTone('unknown_wine')).toBeNull();
  });
});

describe('the claim vs the grade', () => {
  it('states the mail\'s claim as a percentage off, never as a grade', () => {
    expect(claimSentence(discountOf({ percent: 12 }))).toBe('12% off');
    expect(claimSentence(discountOf({ amount: 20, currency: 'USD' }))).toBe('20 USD off');
    expect(claimSentence(discountOf({}))).toBe('not a price');
  });

  it('reads the code and thresholds out of conditions without inventing fields', () => {
    const c = conditionsOf({ code: 'ROSE12', min_qty: 6, valid_text: 'through Sept' });
    expect(c).toEqual({ code: 'ROSE12', minQty: 6, minAmount: null, validText: 'through Sept' });
  });
});

describe('offer state word', () => {
  const today = '2026-09-18';
  it('flags an ending-within-a-week offer as soon', () => {
    const o = offer({ end_date: '2026-09-20', state: 'open' });
    const w = offerStateWord(o, today);
    expect(w.soon).toBe(true);
  });
  it('a dismissed offer says put away, regardless of its date', () => {
    const o = offer({ state: 'dismissed', dismissed_at: '2026-09-10T00:00:00.000Z' });
    expect(offerStateWord(o, today).word).toBe('put away');
  });
  it('an undated offer says so rather than a stale end date', () => {
    const o = offer({ state: 'undated', end_date: null });
    expect(offerStateWord(o, today).word).toBe('no end date');
  });
});

describe('rankWorthOf', () => {
  it('a bundle ranks by its own rollup, not a per-line max', () => {
    const o = offer({
      promo_type: 'bundle',
      bundle: { amount: 53, currency: 'USD', linesCounted: 2 },
      grade: {
        status: 'graded',
        wines: [wine({ worth: { amount: 5, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })],
        qualification: null, tally: { beats: 1, matches: 0, above: 0, ungraded: 0 },
        vendor: { lastPurchaseDate: null, paidLines: 1 },
      },
    });
    expect(rankWorthOf(o)).toBe(53);
  });

  it('a non-bundle multi-wine offer ranks by its single best line', () => {
    const o = offer({
      grade: {
        status: 'graded',
        wines: [
          wine({ worth: { amount: 10, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } }),
          wine({ worth: { amount: 31, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } }),
        ],
        qualification: null, tally: { beats: 2, matches: 0, above: 0, ungraded: 0 },
        vendor: { lastPurchaseDate: null, paidLines: 2 },
      },
    });
    expect(rankWorthOf(o)).toBe(31);
  });

  it('no line has a worth ⇒ null, never zero', () => {
    expect(rankWorthOf(offer())).toBeNull();
  });

  it('a bundle whose total is withheld has NO rank worth — never the best of its own bottles (founder 2026-09-25, round 5)', () => {
    const o = offer({
      promo_type: 'bundle',
      bundle: null,
      grade: {
        status: 'graded',
        wines: [
          wine({ worth: { amount: 500, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } }),
          wine({ wine: 'B', worth: null }),
        ],
        qualification: null, tally: { beats: 1, matches: 0, above: 0, ungraded: 1 },
        vendor: { lastPurchaseDate: null, paidLines: 1 },
      },
    });
    expect(rankWorthOf(o)).toBeNull();
    expect(rankOffers([o])[0].tier).toBe('compact');
  });
});

describe('rankOffers', () => {
  it('orders by worth descending, sizes only the top one as hero', () => {
    const a = offer({ id: 'a', bundle: null, grade: { status: 'graded', wines: [wine({ worth: { amount: 10, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], qualification: null, tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const b = offer({ id: 'b', grade: { status: 'graded', wines: [wine({ worth: { amount: 53, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], qualification: null, tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const ranked = rankOffers([a, b]);
    expect(ranked.map((r) => r.offer.id)).toEqual(['b', 'a']);
    expect(ranked[0].tier).toBe('hero');
    expect(ranked[1].tier).toBe('large');
  });

  it('sizes in the founder\'s band: one hero, up to three larger, then compact — however many have a worth', () => {
    const worthy = (id: string, amount: number) =>
      offer({ id, grade: { status: 'graded', qualification: null, wines: [wine({ worth: { amount, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const ranked = rankOffers([10, 90, 50, 70, 30, 20, 60].map((n) => worthy(`w${n}`, n)));
    expect(ranked.map((r) => r.offer.id)).toEqual(['w90', 'w70', 'w60', 'w50', 'w30', 'w20', 'w10']);
    expect(ranked.map((r) => r.tier)).toEqual(['hero', 'large', 'large', 'large', 'compact', 'compact', 'compact']);
  });

  it('a worth at or below zero never sizes a box: it is compact, even when it ranks second', () => {
    const w = (id: string, amount: number) =>
      offer({ id, grade: { status: 'graded', qualification: null, wines: [wine({ worth: { amount, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], tally: { beats: 0, matches: 0, above: 1, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const ranked = rankOffers([w('loss', -5), w('win', 12), w('flat', 0)]);
    expect(ranked.map((r) => [r.offer.id, r.tier])).toEqual([['win', 'hero'], ['flat', 'compact'], ['loss', 'compact']]);
  });

  it('an offer whose worth the gateway withheld is never sized, and ranks with the worth-less by ends-soonest', () => {
    const withheld = offer({
      id: 'withheld',
      end_date: '2026-09-25',
      grade: { status: 'graded', qualification: { state: 'unit_unknown', minimum: { quantity: 12, unit: null }, largestOrder: null, reason: 'no unit' }, wines: [wine({ worth: null, worthWithheld: 'no unit' })], tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } },
    });
    const ranked = rankOffers([withheld]);
    expect(ranked[0].tier).toBe('compact');
    expect(ranked[0].rankWorth).toBeNull();
  });

  it('worth-less offers fall to the end, ordered by ends-soonest', () => {
    const soon = offer({ id: 'soon', end_date: '2026-09-19' });
    const later = offer({ id: 'later', end_date: '2026-10-01' });
    const worthy = offer({ id: 'worthy', end_date: '2026-12-01', grade: { status: 'graded', wines: [wine({ worth: { amount: 5, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], qualification: null, tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const ranked = rankOffers([later, soon, worthy]);
    expect(ranked.map((r) => r.offer.id)).toEqual(['worthy', 'soon', 'later']);
    expect(ranked[1].tier).toBe('compact');
    expect(ranked[2].tier).toBe('compact');
  });

  it('a dismissed or passed offer is never ranked as a card', () => {
    const dismissed = offer({ id: 'd', state: 'dismissed' });
    const passed = offer({ id: 'p', state: 'passed', end_date: '2020-01-01' });
    expect(rankOffers([dismissed, passed])).toEqual([]);
  });

  it('a bundle ranks WITH the single offers, at the tier its rolled-up total earns', () => {
    const worthy = (id: string, amount: number) =>
      offer({ id, grade: { status: 'graded', qualification: null, wines: [wine({ worth: { amount, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const bundle = offer({ id: 'bundle', promo_type: 'bundle', bundle: { amount: 150, currency: 'USD', linesCounted: 2 } });
    bundle.grade = worthy('x', 40).grade;
    const ranked = rankOffers([worthy('a', 100), bundle, worthy('b', 60)]);
    expect(ranked.map((r) => [r.offer.id, r.tier])).toEqual([['bundle', 'hero'], ['a', 'large'], ['b', 'large']]);
  });

  it('a non-graded offer never appears here — it belongs to ungradableOffers only, never both', () => {
    const notAPrice = offer({
      id: 'np',
      grade: { status: 'not_a_price', wines: [], qualification: null, tally: { beats: 0, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 0 } },
    });
    expect(rankOffers([notAPrice])).toEqual([]);
    expect(ungradableOffers([notAPrice])).toEqual([notAPrice]);
  });
});

describe('headlineWineOf', () => {
  it('leads with the largest |worth| even when it is a loss', () => {
    const win = wine({ wine: 'A', worth: { amount: 10, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } });
    const loss = wine({ wine: 'B', worth: { amount: -28, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } });
    expect(headlineWineOf([win, loss])?.wine).toBe('B');
  });

  it('falls back to a line with a deltaPct, then to the first line', () => {
    const noDelta = wine({ wine: 'A' });
    const withDelta = wine({ wine: 'B', deltaPct: 4.2 });
    expect(headlineWineOf([noDelta, withDelta])?.wine).toBe('B');
    expect(headlineWineOf([noDelta])?.wine).toBe('A');
    expect(headlineWineOf([])).toBeNull();
  });
});

describe('bundleWorthReason — a refused worth', () => {
  it('states the gateway\'s sentence for the offer, not a count of lines "with no worth of their own"', () => {
    const a = wine({ wine: 'A', verdict: 'beats', worthWithheld: 'the offer states a minimum of 12 without saying bottles or cases' });
    const b = wine({ wine: 'B', verdict: 'beats', worthWithheld: 'the offer states a minimum of 12 without saying bottles or cases' });
    expect(bundleWorthReason([a, b])).toBe('the offer states a minimum of 12 without saying bottles or cases');
  });
});

describe('worthReasonFor', () => {
  it('states the ledger-shaped reasons for each verdict', () => {
    expect(worthReasonFor(wine({ verdict: 'no_elsewhere' }))).toMatch(/no other vendor/);
    expect(worthReasonFor(wine({ verdict: 'no_baseline' }))).toMatch(/never bought/);
    expect(worthReasonFor(wine({ verdict: 'unknown_wine' }))).toMatch(/not on the house/);
    expect(worthReasonFor(wine({ verdict: 'not_a_price' }))).toMatch(/neither a percentage/);
  });

  it('the gateway\'s own withheld sentence wins over the generic ledger reasons (it is the more specific one)', () => {
    const w = wine({ verdict: 'beats', worthWithheld: "Kavaklidere's price is 200 days old (2026-03-01); a worth is shown only against a price at most 180 days old" });
    expect(worthReasonFor(w)).toMatch(/200 days old/);
  });

  it('names a currency mismatch when bestElsewhere and offered disagree', () => {
    const line = { kind: 'paid' as const, ref: 'r', providerId: null, providerName: 'Villa', productKey: null, identityId: null, productName: 'X', price: 10, unit: 'bottle', currency: 'EUR', date: null, source: 'receipt_verified', scope: 'house' as const, quantity: 1, note: null };
    const w = wine({ verdict: 'beats', bestElsewhere: line, offered: { price: 9, unit: 'bottle', currency: 'USD', derivation: '' } });
    expect(worthReasonFor(w)).toMatch(/not the same money/);
  });

  it('a graded line with no currency conflict falls back to "no purchase in the window"', () => {
    const line = { kind: 'paid' as const, ref: 'r', providerId: null, providerName: 'Villa', productKey: null, identityId: null, productName: 'X', price: 10, unit: 'bottle', currency: 'USD', date: null, source: 'receipt_verified', scope: 'house' as const, quantity: 1, note: null };
    const w = wine({ verdict: 'beats', bestElsewhere: line, offered: { price: 9, unit: 'bottle', currency: 'USD', derivation: '' } });
    expect(worthReasonFor(w)).toMatch(/no purchase of this bottle/);
  });

  it('a line that already has a worth needs no reason', () => {
    expect(worthReasonFor(wine({ worth: { amount: 1, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } }))).toBe('');
  });
});

describe('bundleWorthReason', () => {
  it('names exactly which lines lack a worth, never a vague "some"', () => {
    const ok = wine({ wine: 'A', worth: { amount: 1, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } });
    const missing = wine({ wine: 'B', verdict: 'no_elsewhere' });
    expect(bundleWorthReason([ok, missing])).toMatch(/1 of 2 bottles.*\(B\)/);
  });

  it('all lines unmatched names the whole bundle as unmatched', () => {
    expect(bundleWorthReason([wine({ verdict: 'unknown_wine' })])).toMatch(/none of the bundle/);
  });
});

describe('onTheTable / ungradableOffers / putAwayOffers', () => {
  it('splits offers by state without double counting', () => {
    const open = offer({ id: 'o' });
    const dismissed = offer({ id: 'd', state: 'dismissed', dismissed_at: '2026-09-01T00:00:00.000Z' });
    const noWines = offer({ id: 'n', grade: { status: 'no_wines', wines: [], qualification: null, tally: { beats: 0, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 0 } } });
    expect(onTheTable(open)).toBe(true);
    expect(onTheTable(dismissed)).toBe(false);
    expect(ungradableOffers([open, dismissed, noWines])).toEqual([noWines]);
    expect(putAwayOffers([open, dismissed, noWines])).toEqual([dismissed]);
  });
});

describe('standingLine', () => {
  function read(offers: OfferDto[]): PromotionsReadDto {
    return {
      read_at: '2026-09-18T12:00:00.000Z',
      offers,
      ledger: { window_days: 540, since: '2025-03-12', paid_lines: 10, house_sightings: 0, market_sightings: 0, skipped_sightings: 0 },
    };
  }

  it('an empty table states it is empty, with the window behind it — never a zero standing in for "not read"', () => {
    const s = standingLine(read([]));
    expect(s).toMatch(/No offers on the table/);
    expect(s).toMatch(/540 days/);
  });

  it('counts offers, vendors and bottle lines separately, and only what is on the table', () => {
    const a = offer({ id: 'a', provider_id: 'v1', applicable_wines: ['A', 'B'] });
    const b = offer({ id: 'b', provider_id: 'v2', applicable_wines: ['C'], state: 'dismissed', dismissed_at: '2026-09-01T00:00:00.000Z' });
    const s = standingLine(read([a, b]));
    expect(s).toBe('1 offer from 1 vendor · 2 bottle lines.');
  });
});

describe('bandsOf — direction A, a row per tier in strict rank order', () => {
  it('splits the ranked list by tier without reordering it', () => {
    const worthy = (id: string, amount: number) =>
      offer({ id, grade: { status: 'graded', qualification: null, wines: [wine({ worth: { amount, currency: 'USD', quantity: 1, invoiceLines: 1, windowDays: 540, comparisonDate: '2026-09-01', comparisonAgeDays: 10, maxAgeDays: 180 } })], tally: { beats: 1, matches: 0, above: 0, ungraded: 0 }, vendor: { lastPurchaseDate: null, paidLines: 1 } } });
    const ranked = rankOffers([3, 9, 1, 7, 5, 8, 2].map((n) => worthy(`w${n}`, n)));
    const bands = bandsOf(ranked);
    expect(bands.hero?.offer.id).toBe('w9');
    expect(bands.large.map((r) => r.offer.id)).toEqual(['w8', 'w7', 'w5']);
    expect(bands.compact.map((r) => r.offer.id)).toEqual(['w3', 'w2', 'w1']);
    // concatenating the bands IS the rank order
    expect([bands.hero!, ...bands.large, ...bands.compact]).toEqual(ranked);
  });

  it('no positive worth anywhere ⇒ no hero and no large row, every offer a compact tile', () => {
    const bands = bandsOf(rankOffers([offer({ id: 'a' }), offer({ id: 'b', end_date: '2026-09-20' })]));
    expect(bands.hero).toBeNull();
    expect(bands.large).toEqual([]);
    expect(bands.compact.map((r) => r.offer.id)).toEqual(['b', 'a']);
  });
});
