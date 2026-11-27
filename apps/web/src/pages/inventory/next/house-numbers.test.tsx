/**
 * r103 need 3 (DD-r102-25): a quantity on the inventory drawer is written in the house's number form, not
 * a fixed en-GB. A lira house reads "1,755 kg" and "1.240,5"; a pound house keeps "1.755 kg" and "1,240.5";
 * a house whose money could not be read is not guessed at (the reader's own form).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ItemCards, { fmtQty } from './ItemCards';
import { amountUnit } from './iv-amount';
import { cellMoney, fmtCount, sayHouseNumbers, type HouseCurrency, type InvRow } from './useInventoryNextData';

const TRY: HouseCurrency = { state: 'recorded', code: 'TRY' };
const GBP: HouseCurrency = { state: 'recorded', code: 'GBP' };
const row = { id: 'i1', kind: 'supply', stock: 1755, wac: null, value: null, analyticsReadable: true, velocity: 1, runway: 12, usageSource: null, openMl: null, costProvenance: null } as unknown as InvRow;
const reading = { status: 'reading' } as const;

function drawn(currency: HouseCurrency) {
  cleanup();
  render(<ItemCards row={row} uom="g" kind="supply" canManage={false} currency={currency} figures={reading as never} inside={reading as never} open={null} onOpen={() => {}} />);
  return screen.getByTestId('ivd-card-onhand').textContent ?? '';
}

afterEach(() => {
  cleanup();
  sayHouseNumbers({ state: 'reading', code: null });
});

describe('the drawer writes a quantity in the house form', () => {
  it('a lira house reads 1,755 kg on its On hand card; a pound house reads 1.755 kg', () => {
    expect(drawn(TRY)).toContain('1,755 kg');
    expect(drawn(TRY)).not.toContain('1.755 kg');
    expect(drawn(GBP)).toContain('1.755 kg');
  });

  it('the page helpers follow the house the page has read', () => {
    sayHouseNumbers(TRY);
    expect(fmtQty(12400, 'g')).toBe('12,4 kg');
    expect(fmtCount(1240.5)).toBe('1.240,5');
    expect(amountUnit('g').words(11750)).toBe('11,75 kg');
    expect(cellMoney(1240.5, { state: 'not_recorded', code: null })).toBe('1.240,5');
    sayHouseNumbers(GBP);
    expect(fmtQty(12400, 'g')).toBe('12.4 kg');
    expect(fmtCount(1240.5)).toBe('1,240.5');
    expect(amountUnit('g').words(11750)).toBe('11.75 kg');
  });

  it('a house whose money could not be read is not given a pound house\'s form', () => {
    sayHouseNumbers(TRY);
    sayHouseNumbers({ state: 'unreadable', code: null });
    expect(fmtCount(1240.5)).toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(1240.5));
  });
});
