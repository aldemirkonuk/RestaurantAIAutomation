/**
 * An order's money line. Staff see counts, never amounts (DASH-W22), so a
 * total the gateway kept from this role must say so, not "not stated".
 */

import { describe, expect, it } from 'vitest';
import type { HouseCounterRead } from './counterRead';
import { orderMoney } from './counterRows';

function read(over: Partial<HouseCounterRead> = {}): HouseCounterRead {
  return {
    readAt: '2026-10-08T12:00:00Z',
    house: { id: 'h', currency: { state: 'recorded', code: 'USD' } },
    role: 'owner',
    registers: [],
    ...over,
  };
}

describe('orderMoney', () => {
  it('says the amount is withheld when the gateway kept it from this role', () => {
    expect(orderMoney(null, read({ role: 'staff', amounts: 'withheld' }))).toBe('amount withheld');
  });
  it('a missing total for a role that sees amounts is "not stated"', () => {
    expect(orderMoney(null, read({ amounts: 'shown' }))).toBe('total not stated');
  });
  it('prints the total for a role that sees amounts', () => {
    expect(orderMoney(120, read({ amounts: 'shown' }))).not.toMatch(/withheld|not stated/);
  });
});
