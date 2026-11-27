/**
 * Compare to the previous period (r104 g1): the till can lay its window beside
 * the same-length window just before it. The prior is dashed, a delta rides in
 * One figure, and a day with no check stays a gap, never a zero.
 */
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CatPlot } from './rp-plot';
import { TillWindowPicker } from './Cutting';
import { compareOffered, daysBetween, splitTill, till } from './rp-registers-trade';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

/**
 * ONE read of 60 house days, 2026-08-03..2026-10-01 (DD-r104-22: web only, the
 * gateway's compare parameter is not used). The last 30 days are the window,
 * the 30 before are the prior. Prior day 5 rang nothing (absent), the window's
 * day 1 rang 130, every other window day 130 too; every other prior day 100.
 */
const FROM = '2026-09-02';
const TO = '2026-10-01';
const P_FROM = '2026-08-03';
const P_TO = '2026-09-01';

function payload(over: Record<string, unknown> = {}) {
  const priorSeries = daysBetween(P_FROM, P_TO)
    .filter((_, i) => i !== 4)
    .map((date) => ({ date, revenue: 100, checks: 2 }));
  const windowSeries = daysBetween(FROM, TO).map((date) => ({ date, revenue: 130, checks: 3 }));
  const dailySeries = [...priorSeries, ...windowSeries];
  return {
    posConnected: true,
    revenue: dailySeries.reduce((a, d) => a + d.revenue, 0),
    checkCount: dailySeries.reduce((a, d) => a + d.checks, 0),
    from: P_FROM,
    to: TO,
    days: 60,
    timezone: 'America/Los_Angeles',
    zoneUnset: false,
    dailySeries,
    ...over,
  };
}

const view = (raw: unknown, compare: boolean) =>
  till.view(till.select(raw), { days: 30, compare, currency: 'USD' });

describe('till: compare to the previous period', () => {
  it('asks days=2N and no compare parameter; off, it asks days=N', () => {
    expect(till.path!('r1', { days: 30, compare: true })).toBe('/analytics/pos-revenue/r1?days=60');
    expect(till.path!('r1', { days: 7, compare: true })).toBe('/analytics/pos-revenue/r1?days=14');
    expect(till.path!('r1', { days: 30 })).toBe('/analytics/pos-revenue/r1?days=30');
    expect(till.path!('r1', { days: 30, compare: true })).not.toMatch(/compare/);
  });

  it('365 days offers no compare: the read stays 365, nothing is split, and the picker says so in words', () => {
    expect(compareOffered(365)).toBe(false);
    expect(compareOffered(90)).toBe(true);
    expect(till.path!('r1', { days: 365, compare: true })).toBe('/analytics/pos-revenue/r1?days=365');
    const onCompare = vi.fn();
    render(<TillWindowPicker days={365} onChange={() => {}} compare onCompare={onCompare} />);
    expect(screen.queryByRole('button', { name: /Against the prior/ })).toBeNull();
    expect(screen.getByRole('note').textContent).toMatch(/no compare is offered at 365 days/);
  });

  it('[REVERT-FAILS] splits at the house day: the window is the last 30 days, the prior the 30 before', () => {
    const raw = payload();
    const w = splitTill(till.select(raw) as never, 30);
    expect(w.days).toBe(30);
    expect([w.from, w.to]).toEqual([FROM, TO]);
    expect([w.prior!.from, w.prior!.to]).toEqual([P_FROM, P_TO]);
    expect(w.revenue).toBe(30 * 130);
    expect(w.checkCount).toBe(30 * 3);
    expect(w.dailySeries).toHaveLength(30);
  });

  it('[REVERT-FAILS] the prior series sums to the 30 days before (API days 31-60), and a null day stays a gap', () => {
    const raw = payload();
    const cats = view(raw, true).cats!;
    expect(cats.data).toHaveLength(30);
    const prior = cats.data.map((d) => d.prior);
    // 29 known days of 100 = what the API says for days 31-60.
    expect(prior.reduce<number>((a, v) => a + (v ?? 0), 0)).toBe(29 * 100);
    expect(prior[4]).toBeNull();
    expect(prior.filter((v) => v === 0)).toHaveLength(0);
    expect(cats.priorLabel).toBe('the prior 30 days');
  });

  it('says the change in One figure, and a dash when there is nothing before to measure against', () => {
    const fig = (raw: unknown) => view(raw, true).figures.find((f) => f.label === 'Against the prior window')!;
    expect(fig(payload()).value).toBe('+34.5%');
    const bare = payload();
    const noPrior = payload({ dailySeries: bare.dailySeries.filter((d) => d.date >= FROM) });
    expect(fig(noPrior).value).toBe('—');
  });

  it('draws nothing of the prior when compare is off, or the read was too short to hold one', () => {
    expect(view(payload(), false).cats!.data.every((d) => d.prior === undefined)).toBe(true);
    expect(view(payload(), false).figures.some((f) => f.label.startsWith('Prior'))).toBe(false);
    const short = payload({ from: FROM, dailySeries: payload().dailySeries.filter((d) => d.date >= FROM) });
    expect(view(short, true).cats!.data.every((d) => d.prior === undefined)).toBe(true);
  });

  it('a gateway that sends no per-day checks leaves Checks and Average check unstated when comparing, never the 2N count', () => {
    const bare = payload();
    const noChecks = payload({ dailySeries: bare.dailySeries.map((d) => ({ date: d.date, revenue: d.revenue })) });
    const fig = (raw: unknown, compare: boolean, label: string) => view(raw, compare).figures.find((f) => f.label === label)!;
    expect(fig(noChecks, true, 'Checks').value).toBe('—');
    expect(fig(noChecks, true, 'Average check').value).toBe('—');
    // With the per-day count the gateway now sends, the window's own checks are summed: 30 days x 3.
    expect(fig(payload(), true, 'Checks').value).toBe('90');
  });

  it('[REVERT-FAILS] a staff reader whose till is withheld gets no window, no prior and no money from the larger read', () => {
    const withheld = { posConnected: true, salesWithheld: true, revenue: null, checkCount: null, from: P_FROM, to: TO, days: 60, dailySeries: null };
    const v = view(withheld, true);
    expect(v.cats?.data.some((d) => d.prior != null || d.value != null) ?? false).toBe(false);
    expect(v.figures.some((f) => f.label.startsWith('Prior'))).toBe(false);
    expect(splitTill(till.select(withheld) as never, 30).prior).toBeNull();
  });
});

describe('CatPlot with a prior', () => {
  const series = (withPrior: boolean): CatSeries => ({
    data: [1, 2, 3, 4].map((i) => ({ label: `d${i}`, value: i * 10, prior: withPrior ? (i === 2 ? null : i * 8) : undefined })),
    xLabel: 'day',
    yLabel: 'taken',
    unit: 'taken',
    format: String,
    priorLabel: 'the prior 30 days',
  });
  const wrap = (k: 'line' | 'area' | 'bars', p: boolean) =>
    render(<MemoryRouter><CatPlot series={series(p)} kind={k} /></MemoryRouter>);

  it.each(['line', 'area'] as const)('the %s drawing adds a dashed second line, and none without a prior', (k) => {
    const { container, unmount } = wrap(k, true);
    const dashed = Array.from(container.querySelectorAll('path.recharts-curve')).filter((p) => p.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBeGreaterThan(0);
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('the prior 30 days dashed beside it');
    unmount();
    const bare = wrap(k, false).container;
    expect(Array.from(bare.querySelectorAll('path.recharts-curve')).filter((p) => p.getAttribute('stroke-dasharray'))).toHaveLength(0);
  });

  it('the line breaks at a null prior day rather than resting on zero', () => {
    const { container } = wrap('line', true);
    const dashed = Array.from(container.querySelectorAll('path.recharts-curve')).find((p) => p.getAttribute('stroke-dasharray'))!;
    // Two segments: d1 alone is a point, d3-d4 a stroke; a bridged gap would be one `M`.
    expect((dashed.getAttribute('d') ?? '').match(/M/g)?.length).toBeGreaterThan(1);
  });

  it('the bars drawing adds a second, hollow bar series', () => {
    const { container } = wrap('bars', true);
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(2);
    expect(wrap('bars', false).container.querySelectorAll('.recharts-bar')).toHaveLength(1);
  });
});

describe('the compare toggle', () => {
  it('is pressed when comparing, offered only where the page wires it, and flips on a click', () => {
    const onCompare = vi.fn();
    const { rerender } = render(<TillWindowPicker days={30} onChange={() => {}} compare={false} onCompare={onCompare} />);
    const btn = screen.getByRole('button', { name: 'Against the prior 30 days' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(onCompare).toHaveBeenCalledWith(true);
    rerender(<TillWindowPicker days={30} onChange={() => {}} compare onCompare={onCompare} />);
    expect(screen.getByRole('button', { name: 'Against the prior 30 days' }).getAttribute('aria-pressed')).toBe('true');
    rerender(<TillWindowPicker days={30} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /Against the prior/ })).toBeNull();
  });
});
