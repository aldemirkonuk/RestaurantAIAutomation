import { describe, expect, it } from 'vitest';
import type { Order } from '@/services/api/types';
import { matchLine, normalizeDoorOrder } from './DoorModel';

/** r24: the r23 walk read "The order says 5 bottles" at the door of a 5-liter order. */
const order = (quantity: number, unitType: string) =>
  normalizeDoorOrder({ quantity, unitType, bottlesTotal: quantity } as unknown as Order);

describe('a measured order at the box door (r24)', () => {
  it.each([
    [5, 'liter', 'The order says 5 liters', 'by volume'],
    [1, 'liters', 'The order says 1 liter', 'by volume'],
    [3, 'kg', 'The order says 3 kg', 'by weight'],
    [2, 'kegs', 'The order says 2 kegs', 'by volume'],
  ])('%d %s is said as an amount, never as bottles', (q, unit, says, by) => {
    const vm = order(q, unit);
    expect(vm?.expectedBottles).toBeNull();
    const m = matchLine(4, vm);
    expect(m?.text).toContain(says);
    expect(m?.text).toContain(`on the shelf ${by}`);
    expect(m?.text).not.toMatch(/bottles/);
    expect(m?.tone).toBe('incomparable');
  });

  it('a bottle order is still said in bottles', () => {
    expect(matchLine(4, order(5, 'bottles'))?.text).toContain('The order says 5 bottles');
  });
});
