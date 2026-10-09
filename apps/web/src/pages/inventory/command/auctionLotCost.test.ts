/**
 * The founder's answer (10), 2026-09-21: a typed house cost wins, a stated
 * rate is used as stated, nothing is inferred. The gateway holds the same rule
 * (`inventory/auction-lot-cost.ts`) and refuses a record whose booked cost
 * disagrees, so these cases are the same cases its spec pins.
 */
import { describe, expect, it } from 'vitest';
import { lotBookedCost } from './auctionLotCost';
import { lotCost } from './AuctionLotStart';

const base = { lotPerBottle: 208.33, currency: 'GBP', exchangeRate: '', houseCost: '' };

describe('lotBookedCost', () => {
  it('a same-currency lot books its own per-bottle cost', () => {
    expect(lotBookedCost({ ...base, houseCurrency: 'GBP' })).toEqual({ ok: true, booked: 208.33, basis: 'same_currency', lotPerBottle: 208.33 });
  });
  it('a foreign lot at a stated rate, rounded to cents once', () => {
    expect(lotBookedCost({ ...base, houseCurrency: 'EUR', exchangeRate: '1.17' })).toMatchObject({ ok: true, booked: 243.75, basis: 'stated_rate' });
  });
  it('a typed house cost wins over the rate', () => {
    expect(lotBookedCost({ ...base, houseCurrency: 'EUR', exchangeRate: '1.17', houseCost: '245' })).toMatchObject({ booked: 245, basis: 'typed_house_cost' });
  });
  it('a foreign lot with neither is refused, naming what to state', () => {
    const out = lotBookedCost({ ...base, houseCurrency: 'EUR' });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.why).toMatch(/state the exchange rate you used, or type what each bottle cost in EUR/);
  });
  it('nothing is inferred for a house that states no currency', () => {
    expect(lotBookedCost({ ...base, houseCurrency: null, exchangeRate: '1.2' }).ok).toBe(false);
  });
  it.each(['0', '-1', 'abc'])('a rate of %s is refused', (rate) => {
    expect(lotBookedCost({ ...base, houseCurrency: 'EUR', exchangeRate: rate }).ok).toBe(false);
  });
});

describe('the lot working (F-342)', () => {
  it('adds hammer and premium in whole cents, with no float noise', () => {
    const out = lotCost({ hammer: '100.10', premium: '20.02', bottles: '1' } as Parameters<typeof lotCost>[0]);
    expect(out.ok && out.working).toBe('100.1 hammer + 20.02 premium = 120.12, over 1 bottle = 120.12 each.');
  });
  it('a stated rate scales the exact per-bottle cost, rounding once', () => {
    const out = lotCost({ hammer: '90', premium: '10', bottles: '3' } as Parameters<typeof lotCost>[0]);
    if (!out.ok) throw new Error('unreachable');
    expect(out.perBottle).toBe(33.33);
    expect(
      lotBookedCost({
        lotPerBottle: out.perBottle,
        lotPerBottleExact: out.perBottleExact,
        currency: 'GBP',
        houseCurrency: 'TRY',
        exchangeRate: '35',
        houseCost: '',
      }),
    ).toMatchObject({ ok: true, booked: 1166.67, lotPerBottle: 33.33 });
  });
});
