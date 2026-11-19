/**
 * The calendar's shading says what it measures (c2 need 15): a legend with a
 * five-step scale, and cells that draw in 36 ms apart — none of it moving for a
 * person who asked for reduced motion.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const ledgerState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('./useDashboardNextData', async (orig) => ({
  ...(await orig<typeof import('./useDashboardNextData')>()),
  useMonthLedger: () => ({ month: ledgerState.current, refetch: vi.fn() }),
  useDayOrders: () => ({ state: 'idle' }),
}));

import { SalesCalendar } from './SalesCalendar';
import { HEAT_STEP_MS, drawDelay, heatPercent } from './calendarHeat';
import type { DayLedger, MonthLedger } from './useDashboardNextData';

function day(date: string, net: number | null, checks = 10): DayLedger {
  return {
    date,
    procurement_spend: null,
    bottles_sold: null,
    events: [],
    order_count: null,
    net_sales: net,
    checks: net == null ? null : checks,
    net_checks: net == null ? null : checks,
  };
}

function ready(days: DayLedger[], over: Partial<MonthLedger> = {}) {
  return {
    state: 'ready',
    ledger: {
      year: 2026,
      month: 10,
      daily: days,
      monthlySpend: 0,
      monthlyBottles: 0,
      monthlyNetSales: 1000,
      monthlyChecks: 30,
      monthlyNetChecks: 30,
      monthlyDaysCounted: 3,
      monthlyDaysBegun: 3,
      timezone: 'America/Los_Angeles',
      zoneUnset: false,
      today: '2026-10-20',
      sales: 'shown',
      amounts: 'shown',
      ...over,
    },
  };
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/?month=2026-10']}>
      <SalesCalendar restaurantId="r-1" alerts={[]} activity={[]} zone="America/Los_Angeles" seesAmounts />
    </MemoryRouter>,
  );
}

const animateSpy = vi.fn();
function media(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  animateSpy.mockReset();
  (Element.prototype as unknown as { animate: unknown }).animate = animateSpy;
  media(false);
  ledgerState.current = ready([day('2026-10-01', 100), day('2026-10-02', 400), day('2026-10-03', 250)]);
});
afterEach(() => {
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

describe('the heat scale', () => {
  it('is zero for a quiet day and rises with the day, never past the busiest', () => {
    expect(heatPercent(0, 400)).toBe(0);
    expect(heatPercent(null, 400)).toBe(0);
    expect(heatPercent(100, 400)).toBeLessThan(heatPercent(400, 400));
    expect(heatPercent(400, 400)).toBe(36);
  });
});

describe('the legend', () => {
  it('names what the shading measures and its five steps, with the busiest day', () => {
    mount();
    const legend = screen.getByTestId('dn-cal-legend');
    expect(legend.textContent).toMatch(/Shaded by net sales/);
    expect(legend.textContent).toMatch(/Less/);
    expect(legend.textContent).toMatch(/More/);
    expect(legend.textContent).toMatch(/busiest day \$400/);
    expect(legend.querySelectorAll('[data-step]')).toHaveLength(5);
  });

  it('is absent when no day carries shade', () => {
    ledgerState.current = ready([day('2026-10-01', 0, 0)]);
    mount();
    expect(screen.queryByTestId('dn-cal-legend')).toBeNull();
  });

  it('says paid to vendors for a role that sees spend and not sales', () => {
    ledgerState.current = ready(
      [{ ...day('2026-10-01', null), procurement_spend: 300 }],
      { sales: 'withheld' },
    );
    mount();
    expect(screen.getByTestId('dn-cal-legend').textContent).toMatch(/Shaded by what was paid to vendors/);
  });
});

describe('the draw-in', () => {
  it('delays each cell 36 ms after the one before', () => {
    expect(HEAT_STEP_MS).toBe(36);
    expect(drawDelay(3, false)).toBe(108);
    mount();
    const delays = animateSpy.mock.calls.map((c) => (c[1] as { delay: number }).delay);
    expect(delays.length).toBe(31);
    expect(delays.slice(0, 4)).toEqual([0, 36, 72, 108]);
  });

  it('animates only transform, opacity and clip-path', () => {
    mount();
    const keys = new Set(animateSpy.mock.calls.flatMap((c) => (c[0] as Record<string, unknown>[]).flatMap((k) => Object.keys(k))));
    expect([...keys].filter((k) => !['opacity', 'transform', 'clipPath', 'offset'].includes(k))).toEqual([]);
  });

  it('does not stagger, or hide a cell, under reduced motion', () => {
    media(true);
    expect(drawDelay(30, true)).toBe(0);
    mount();
    expect(animateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('dn-cal-legend').getAttribute('data-still')).toBe('true');
  });
});
