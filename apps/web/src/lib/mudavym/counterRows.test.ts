import { describe, expect, it } from 'vitest';
import { actLine } from './counterRows';
import type { CounterDeliveryRow } from './counterRead';

const door = (over: Partial<CounterDeliveryRow>): CounterDeliveryRow => ({
  orderId: 'o1',
  orderNumber: 'PO-1',
  countedQtyBottles: 12,
  countedAt: '2026-01-01T00:00:00Z',
  ageHours: 5,
  severity: 'fresh',
  ...over,
});

describe('the counter says how old a door count is', () => {
  it('says hours while it is under two days old', () => {
    expect(actLine('deliveries', door({ ageHours: 5 }), null).detail).toBe('not counted one by one · 5h ago');
  });
  it('says days, and overdue, for a count that has waited for months', () => {
    const detail = actLine('deliveries', door({ ageHours: 7199, severity: 'overdue' }), null).detail;
    expect(detail).toBe('not counted one by one · 299 days ago, overdue');
    expect(detail).not.toContain('7199');
  });
  it('names no bottle, so a house of foods reads the same row', () => {
    const line = actLine('deliveries', door({ countedQtyBottles: 12 }), null);
    expect(line.what).toBe('Order PO-1 · 12 counted by case');
    expect(`${line.what} ${line.detail}`).not.toMatch(/bottle/i);
  });
});
