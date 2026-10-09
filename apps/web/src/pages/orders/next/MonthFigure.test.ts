/**
 * F-230: "<Month> so far" counted drafts and pending orders as spend, and filed
 * them by the browser's clock. It now sums committed orders only (approved,
 * ordered, delivered) and files them by the house's month.
 */
import { describe, expect, it } from 'vitest';
import { houseMonthOf, monthFigureOf, type OrderRowVM } from './useOrdersNextData';

const row = (
  stage: OrderRowVM['stage'],
  total: number | null,
  requestedAt: string,
  currency = 'USD',
): OrderRowVM => ({ stage, total, requestedAt, currency }) as unknown as OrderRowVM;

const LA = 'America/Los_Angeles';
// 20:00 on 30 September in Los Angeles; already 1 October in UTC.
const SEPT_30_EVENING_LA = new Date('2026-10-01T03:00:00Z');

describe('/orders month figure (F-230)', () => {
  it('sums committed orders only — never a draft, pending or cancelled one', () => {
    const rows = [
      row('approved', 100, '2026-09-10T18:00:00Z'),
      row('ordered', 200, '2026-09-11T18:00:00Z'),
      row('delivered', 300, '2026-09-12T18:00:00Z'),
      row('pending', 5000, '2026-09-13T18:00:00Z'),
      row('cancelled', 7000, '2026-09-14T18:00:00Z'),
    ];
    const m = monthFigureOf(rows, LA, SEPT_30_EVENING_LA);
    expect(m.thisMonth).toBe(600);
    expect(m.thisMonthByCurrency).toEqual([{ amount: 600, currency: 'USD' }]);
  });

  it('files by the house month, not the UTC or browser month', () => {
    const rows = [
      // 19:00 PDT on 30 September — September for the house, October in UTC.
      row('approved', 40, '2026-10-01T02:00:00Z'),
      // 31 August 18:00 PDT — last month for the house.
      row('delivered', 9, '2026-09-01T01:00:00Z'),
    ];
    const m = monthFigureOf(rows, LA, SEPT_30_EVENING_LA);
    expect(m.label).toBe('September');
    expect(m.thisMonth).toBe(40);
    expect(m.lastMonth).toBe(9);
  });

  it('keeps one line per currency and counts an unpriced committed order', () => {
    const rows = [
      row('approved', 100, '2026-09-10T18:00:00Z', 'USD'),
      row('ordered', 50, '2026-09-10T18:00:00Z', 'EUR'),
      row('ordered', null, '2026-09-10T18:00:00Z', 'USD'),
      row('pending', null, '2026-09-10T18:00:00Z', 'USD'),
    ];
    const m = monthFigureOf(rows, LA, SEPT_30_EVENING_LA);
    expect(m.thisMonth).toBeNull();
    expect(m.thisMonthByCurrency).toHaveLength(2);
    expect(m.unpricedThisMonth).toBe(1);
  });

  it('rolls January back to December of the year before', () => {
    const m = monthFigureOf(
      [row('delivered', 12, '2026-12-31T20:00:00Z')],
      'Europe/Istanbul',
      new Date('2027-01-05T12:00:00Z'),
    );
    expect(m.label).toBe('January');
    expect(m.lastMonth).toBe(12);
  });

  it('reads an unreadable zone name on the browser clock instead of throwing', () => {
    expect(houseMonthOf('2026-09-15T12:00:00Z', 'Not/AZone')).toEqual({ year: 2026, month: 9 });
    expect(houseMonthOf(null, LA)).toBeNull();
  });
});
