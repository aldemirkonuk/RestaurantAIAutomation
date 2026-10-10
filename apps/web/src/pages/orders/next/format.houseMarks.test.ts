/**
 * F-942: /orders printed every figure en-US, so a lira house read "1,250.00"
 * on the ledger and on the approve seal while the order sheet beside it reads
 * what it types the house's way ("1.250,00"). The figure now takes the house's
 * grouping mark (`useHouseGroupMark`) and keeps the symbol where it was.
 */
import { describe, expect, it } from 'vitest';
import { inHouseMarks } from '@/lib/currency';
import { fmtMoney, fmtMoneyWhole } from './format';

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
