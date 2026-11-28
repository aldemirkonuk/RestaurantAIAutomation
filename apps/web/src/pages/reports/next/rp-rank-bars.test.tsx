/**
 * Ranked bars on the card and in full screen (r110 g2): the card draws its
 * cap with the tie kept and says "13 of 37 wines, highest margin first";
 * Highest / Lowest swaps the end; full screen draws every ranked row; restock
 * says its count with no Lowest; the combo line stays on the drawn rows.
 */
import { cloneElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 1200, height: 360 } as never),
  };
});

import { Drawing } from './Cutting';
import { CATALOGUE } from './rp-catalogue';

afterEach(cleanup);

const margins = Array.from({ length: 37 }, (_, i) => 100 - i * 2);
margins[11] = 78 * (1 + 1e-12);
margins[12] = 78;
const wineView = () => {
  const spec = CATALOGUE.quadrants;
  const items = margins.map((m, i) => ({ id: `w${i}`, name: `Wine ${i}`, velocityPerDay: 1, marginPerBottle: m, marginPct: null, quadrant: 'star' }));
  return spec.view(spec.select({ medians: {}, counts: {}, items }), { days: 30, currency: 'USD' });
};
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle').length;
const surface = (c: HTMLElement) => c.querySelector('.recharts-surface') as SVGElement;
const live = () => screen.getByTestId('rp-plot-live').textContent;

describe('ranked bars', () => {
  it('[REVERT-FAILS] the card draws 13 of 37 with the tie, says so, and Lowest draws the 12 smallest from the left', () => {
    const { container } = render(<Drawing view={wineView()} graph="bars" windowLine="" />);
    expect(bars(container)).toBe(13);
    expect(screen.getByText('13 of 37 wines, highest margin first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Highest' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Lowest' }));
    expect(screen.getByRole('button', { name: 'Lowest' })).toHaveAttribute('aria-pressed', 'true');
    expect(bars(container)).toBe(12);
    expect(screen.getByText('12 of 37 wines, lowest margin first')).toBeInTheDocument();
    fireEvent.focus(surface(container));
    // The first bar is the smallest margin: Wine 36 at $28.
    expect(live()).toMatch(/^Wine 36\. \$28/);
  });

  it('[REVERT-FAILS] full screen draws every ranked wine and needs no caption', () => {
    const { container } = render(<Drawing view={wineView()} graph="bars" windowLine="" flat />);
    expect(bars(container)).toBe(37);
    expect(screen.queryByText(/of 37 wines/)).toBeNull();
  });

  it('[REVERT-FAILS] Lowest then a re-read that leaves no row out goes back to Highest, not lowest-first with no words', () => {
    const spec = CATALOGUE.service;
    const make = (n: number) => {
      const waiters = Array.from({ length: n }, (_, i) => ({
        name: `Server ${String(i).padStart(2, '0')}`, checks: 100 + i, revenue: 5000 - i * 100, avgCheck: 50, wineAttachRate: null, tipPct: null, revenuePerCover: null,
      }));
      return spec.view(spec.select({ dataStatus: 'ok', adjusted: null, waiters, checksInWindow: 2000, sinceDays: 30 }), { days: 30, currency: 'USD' });
    };
    const { container, rerender } = render(<Drawing view={make(20)} graph="bars" windowLine="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Lowest' }));
    rerender(<Drawing view={make(10)} graph="bars" windowLine="" />);
    fireEvent.focus(surface(container));
    // Every row is drawn, so there is no pill; the first bar is the highest takings (Server 00), not the lowest.
    expect(screen.queryByRole('button', { name: 'Lowest' })).toBeNull();
    expect(live()).toMatch(/^Server 00 · /);
  });

  it('a Draw as goes back to Highest', () => {
    const view = wineView();
    const { rerender } = render(<Drawing view={view} graph="bars" windowLine="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Lowest' }));
    rerender(<Drawing view={view} graph="table" windowLine="" />);
    rerender(<Drawing view={view} graph="bars" windowLine="" />);
    expect(screen.getByRole('button', { name: 'Highest' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('[REVERT-FAILS] restock says its count and offers no Lowest', () => {
    const spec = CATALOGUE.restock;
    const reorderList = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`, name: `Good ${i}`, onHand: 1, daysOfCover: i, reorderPoint: 4, safetyStock: 2, stockoutProbability: 0.9 - i * 0.01,
    }));
    const view = spec.view(
      spec.select({ params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 }, skuCount: 60, reorderCount: 20, reorderList }),
      { days: 30 },
    );
    const { container } = render(<Drawing view={view} graph="bars" windowLine="" />);
    expect(bars(container)).toBe(14);
    expect(screen.getByText('14 of 20 wines, highest stockout risk first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lowest' })).toBeNull();
  });

  it('[REVERT-FAILS] servers at Lowest: bars and the line are the same servers', () => {
    const spec = CATALOGUE.service;
    const waiters = Array.from({ length: 20 }, (_, i) => ({
      name: `Server ${String(i).padStart(2, '0')}`, checks: 100 + i, revenue: 5000 - i * 100, avgCheck: 50, wineAttachRate: null, tipPct: null, revenuePerCover: null,
    }));
    const view = spec.view(spec.select({ dataStatus: 'ok', adjusted: null, waiters, checksInWindow: 2000, sinceDays: 30 }), { days: 30, currency: 'USD' });
    expect(view.cats!.data).toHaveLength(20);
    const { container } = render(<Drawing view={view} graph="combo" windowLine="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Lowest' }));
    expect(bars(container)).toBe(14);
    fireEvent.focus(surface(container));
    // The left bar is the lowest takings (Server 19), and its line point is Server 19's own checks.
    expect(live()).toContain('Server 19');
    expect(live()).toContain('119 checks');
  });
});

describe('the registers hand over every ranked row', () => {
  it('[REVERT-FAILS] quadrants: all 37 priced wines, highest margin first, with the cap and words; the table says it is cut', () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `w${i}`,
      name: `Wine ${i}`,
      velocityPerDay: 1,
      marginPerBottle: i < 37 ? margins[i] : null,
      marginPct: null,
      quadrant: i < 37 ? 'star' : null,
    }));
    const spec = CATALOGUE.quadrants;
    const view = spec.view(spec.select({ medians: {}, counts: { unclassified: 8 }, items }), { days: 30, currency: 'USD' });
    expect(view.cats!.data).toHaveLength(37);
    expect(view.cats!.rank).toEqual({ cap: 12, noun: 'wines', by: 'margin', ends: true });
    expect(view.table!.more).toContain('Showing 40 of 45, in the register’s own order.');
  });
});
