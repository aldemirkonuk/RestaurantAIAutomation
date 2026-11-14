/**
 * r36 invoices R3, web half: the two "Paid to vendors" tiles read the scanned
 * deliveries the gateway now counts into the spend (#1604). A figure they
 * hold back says why, and a stated one says it is not orders alone.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KpiRow } from './KpiRow';
import { scannedHeldSaid, spendMadeOf, spendWithheldSaid } from './format';
import type { DashboardStats } from '@/services/api/types';

const none = { counted: 0, uncosted: 0, notInHouseCurrency: {} };

function stats(over: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalWines: 3,
    totalBottles: 10,
    totalVolumeMl: 7500,
    totalVolumeOz: 253.6,
    lowStockItems: 0,
    pendingOrders: 0,
    todayProcurementSpend: 0,
    weekProcurementSpend: 0,
    monthProcurementSpend: 0,
    uncostedOrders: { today: 0, week: 0, month: 0 },
    notInHouseCurrency: { today: {}, week: {}, month: {} },
    houseCurrencyUnread: false,
    scannedDeliveries: { today: none, week: none, month: none },
    unread: { todayProcurementSpend: null, weekProcurementSpend: null, monthProcurementSpend: null },
    ...over,
  };
}

const show = (s: DashboardStats) =>
  render(
    <MemoryRouter>
      <KpiRow stats={s} pendingCount={0} lowStockCount={0} />
    </MemoryRouter>,
  );

describe('scannedHeldSaid', () => {
  it('is null when the scanned deliveries hold nothing back', () => {
    expect(scannedHeldSaid(undefined)).toBeNull();
    expect(scannedHeldSaid({ counted: 4, uncosted: 0, notInHouseCurrency: { EUR: 0 } })).toBeNull();
  });

  it('says a delivery with no invoice total, one and many', () => {
    expect(scannedHeldSaid({ counted: 2, uncosted: 1, notInHouseCurrency: {} })).toBe(
      '1 scanned delivery has no invoice total yet',
    );
    expect(scannedHeldSaid({ counted: 3, uncosted: 3, notInHouseCurrency: {} })).toBe(
      '3 scanned deliveries have no invoice total yet',
    );
  });

  it('names other money by code, most first, then the missing totals', () => {
    expect(scannedHeldSaid({ counted: 1, uncosted: 0, notInHouseCurrency: { EUR: 1 } })).toBe(
      '1 scanned delivery is in EUR, not the house’s money',
    );
    expect(scannedHeldSaid({ counted: 5, uncosted: 1, notInHouseCurrency: { USD: 1, EUR: 2 } })).toBe(
      '3 scanned deliveries are in other currencies (2 EUR, 1 USD), not the house’s money; ' +
        '1 scanned delivery has no invoice total yet',
    );
  });
});

describe('spendWithheldSaid', () => {
  it('joins the orders’ reason and the scanned deliveries’ reason', () => {
    expect(
      spendWithheldSaid({ uncosted: 2, other: {}, scanned: { counted: 1, uncosted: 1, notInHouseCurrency: {} } }),
    ).toBe('2 delivered orders have no recorded cost; 1 scanned delivery has no invoice total yet');
  });

  it('says a failed read when nothing else explains the dash', () => {
    expect(spendWithheldSaid({ uncosted: 0, other: {}, scanned: none, unread: 'The scanned papers … could not be read' })).toBe(
      'could not be read just now',
    );
    expect(spendWithheldSaid({ uncosted: 0, other: {}, scanned: none, unread: '  ' })).toBeNull();
    expect(spendWithheldSaid({ uncosted: 0, other: {}, scanned: none, unread: null })).toBeNull();
  });

  it('prefers a named reason over the failed-read words', () => {
    expect(
      spendWithheldSaid({ uncosted: 1, other: {}, scanned: none, unread: '1 delivered order has no recorded cost.' }),
    ).toBe('1 delivered order has no recorded cost');
  });
});

describe('spendMadeOf', () => {
  it('keeps the tile’s own words with no scanned delivery in the window', () => {
    expect(spendMadeOf(none, 'procurement, not sales')).toBe('procurement, not sales');
    expect(spendMadeOf(undefined, 'delivered purchase orders')).toBe('delivered purchase orders');
  });

  it('says the scanned deliveries the figure holds', () => {
    expect(spendMadeOf({ counted: 1, uncosted: 0, notInHouseCurrency: {} }, 'x')).toBe(
      'delivered orders and 1 scanned delivery',
    );
    expect(spendMadeOf({ counted: 4, uncosted: 0, notInHouseCurrency: {} }, 'x')).toBe(
      'delivered orders and 4 scanned deliveries',
    );
  });
});

describe('KpiRow — Paid to vendors with scanned deliveries', () => {
  it('a month held back by a scanned delivery says why, not only a dash', () => {
    show(
      stats({
        monthProcurementSpend: null,
        scannedDeliveries: { today: none, week: none, month: { counted: 2, uncosted: 1, notInHouseCurrency: {} } },
        unread: {
          todayProcurementSpend: null,
          weekProcurementSpend: null,
          monthProcurementSpend: '1 scanned delivery with no order has no invoice total on its papers yet.',
        },
      }),
    );
    expect(screen.getByText('1 scanned delivery has no invoice total yet')).toBeTruthy();
    expect(screen.queryByText('procurement, not sales')).toBeNull();
  });

  it('a stated figure with scanned deliveries in it says so', () => {
    show(
      stats({
        todayProcurementSpend: 120,
        monthProcurementSpend: 900,
        scannedDeliveries: {
          today: { counted: 1, uncosted: 0, notInHouseCurrency: {} },
          week: none,
          month: { counted: 3, uncosted: 0, notInHouseCurrency: {} },
        },
      }),
    );
    expect(screen.getByText('delivered orders and 1 scanned delivery')).toBeTruthy();
    expect(screen.getByText('delivered orders and 3 scanned deliveries')).toBeTruthy();
    expect(screen.queryByText('delivered purchase orders')).toBeNull();
  });

  it('a failed papers read says it could not be read', () => {
    show(
      stats({
        todayProcurementSpend: null,
        unread: {
          todayProcurementSpend: 'The scanned papers of deliveries with no order could not be read just now, so what they cost is not known.',
          weekProcurementSpend: null,
          monthProcurementSpend: null,
        },
      }),
    );
    expect(screen.getByText('could not be read just now')).toBeTruthy();
  });

  it('an older gateway with no scanned field keeps the tiles’ own words', () => {
    const s = stats();
    delete (s as any).scannedDeliveries;
    delete (s as any).unread;
    show(s);
    expect(screen.getByText('delivered purchase orders')).toBeTruthy();
    expect(screen.getByText('procurement, not sales')).toBeTruthy();
  });
});
