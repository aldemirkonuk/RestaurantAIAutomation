/**
 * F-942: /orders printed every figure en-US, so a lira house read "1,250.00"
 * on the ledger and on the approve seal while the order sheet beside it reads
 * what it types the house's way ("1.250,00"). The figure now takes the house's
 * grouping mark (`useHouseGroupMark`) and keeps the symbol where it was.
 */
import { describe, expect, it } from 'vitest';
import { inHouseMarks } from '@/lib/currency';
import { fmtMoney, fmtMoneyWhole, fmtWorking } from './format';
import { agreementTotal, describeFees, describeStatedPrice } from './price-unit';

describe('/orders figures in the house marks (F-942)', () => {
  it('[REVERT-FAILS] groups a lira total the Turkish way, symbol unmoved', () => {
    const printed = fmtMoney(1250, 'TRY', '.');
    expect(printed).toMatch(/1\.250,00/);
    expect(printed).not.toMatch(/1,250\.00/);
    // Whatever the runtime prints for lira, it still leads the figure.
    expect(printed.indexOf('1')).toBeGreaterThan(0);
  });

  it('[REVERT-FAILS] groups the whole-unit month figure the same way', () => {
    expect(fmtMoneyWhole(12480, 'TRY', '.')).toMatch(/12\.480$/);
  });

  it('[REVERT-FAILS] keeps the "currency not recorded" words while re-marking the number', () => {
    expect(fmtMoney(1250, null, '.')).toBe('1.250,00 (currency not recorded)');
  });

  it('prints as before when the house uses a comma, or its mark is not known yet', () => {
    expect(fmtMoney(1250, 'USD', ',')).toBe('$1,250.00');
    expect(fmtMoney(1250, 'USD')).toBe('$1,250.00');
    expect(fmtMoney(null, 'TRY', '.')).toBe('—');
  });
});

describe('inHouseMarks', () => {
  it('trades the two marks only inside a run of digits', () => {
    expect(inHouseMarks('€1,234,567.89 · 2 lines.', ',', '.')).toBe('€1.234.567,89 · 2 lines.');
  });

  it('changes nothing when either mark is unknown or they agree', () => {
    expect(inHouseMarks('€1,250.00', null, '.')).toBe('€1,250.00');
    expect(inHouseMarks('€1,250.00', ',', null)).toBe('€1,250.00');
    expect(inHouseMarks('€1,250.00', ',', ',')).toBe('€1,250.00');
  });
});

describe('the working and the fees in the house marks (F-942)', () => {
  const fees = { allowance: 25, deposit: 1250.5, freight: null };

  it('[REVERT-FAILS] says the working figure with the house decimal mark', () => {
    expect(fmtWorking(1250, null, '.')).toBe('1250,00 (currency not recorded)');
    expect(fmtWorking(420, 'TRY', '.')).toMatch(/420,00/);
  });

  it('[REVERT-FAILS] says the fees with the house decimal mark', () => {
    expect(describeFees(fees, null, '.')).toBe(
      'an allowance of 25,00 (currency not recorded), a deposit of 1250,50 (currency not recorded)',
    );
  });

  it('[REVERT-FAILS] says a whole working, its count and its fees the house way', () => {
    const r = agreementTotal({
      price: 60,
      stated: { priceUom: 'case', pricePackSize: 6 },
      quantity: 10,
      unitType: 'bottle',
      bottlesPerUnit: 1,
      fees,
      currency: null,
      group: '.',
    });
    expect(r?.ok && r.working).toBe(
      '10 bottles ÷ 6 = about 1,67 cases × 60,00 (currency not recorded). ' +
        'Goods 100,00 (currency not recorded), less allowance 25,00 (currency not recorded), ' +
        'plus deposit 1250,50 (currency not recorded).',
    );
  });

  it('[REVERT-FAILS] groups a stated price the house way', () => {
    expect(describeStatedPrice(1090, { priceUom: 'case', pricePackSize: 12 }, null, '.')).toBe(
      '1.090,00 (currency not recorded) per case (12 bottles)',
    );
  });

  it('prints as before when the house mark is a comma or not known yet', () => {
    expect(fmtWorking(1250, 'USD')).toBe('$1250.00');
    expect(fmtWorking(1250, 'USD', ',')).toBe('$1250.00');
    expect(describeFees(fees, 'USD')).toBe('an allowance of $25.00, a deposit of $1250.50');
  });
});
