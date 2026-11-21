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
import { daysBetween, till } from './rp-registers-trade';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

/** A 30-day window 2026-09-02..2026-10-01 and the 30 days before it. */
const FROM = '2026-09-02';
const TO = '2026-10-01';
const P_FROM = '2026-08-03';
const P_TO = '2026-09-01';

function payload(over: Record<string, unknown> = {}) {
  const priorDays = daysBetween(P_FROM, P_TO);
  // Every prior day rang 100, except the 5th, which rang nothing (absent).
  const priorSeries = priorDays.filter((_, i) => i !== 4).map((date) => ({ date, revenue: 100 }));
  return {
    posConnected: true,
    revenue: 3900,
    checkCount: 60,
    from: FROM,
    to: TO,
    days: 30,
    timezone: 'America/Los_Angeles',
    zoneUnset: false,
    dailySeries: [{ date: FROM, revenue: 130, checks: 2 }],
    prior: { from: P_FROM, to: P_TO, revenue: priorSeries.length * 100, checkCount: 58, dailySeries: priorSeries },
    ...over,
  };
}

const view = (raw: unknown, compare: boolean) =>
  till.view(till.select(raw), { days: 30, compare, currency: 'USD' });

describe('till: compare to the previous period', () => {
  it('asks the gateway for compare=prior only when the reader did', () => {
    expect(till.path!('r1', { days: 30, compare: true })).toBe('/analytics/pos-revenue/r1?days=30&compare=prior');
    expect(till.path!('r1', { days: 30 })).toBe('/analytics/pos-revenue/r1?days=30');
  });

  it('the prior series sums to the API prior revenue, and a null day stays a gap', () => {
    const raw = payload();
    const cats = view(raw, true).cats!;
    expect(cats.data).toHaveLength(30);
    const prior = cats.data.map((d) => d.prior);
    // 29 known days of 100 = the API's prior revenue.
    expect(prior.reduce<number>((a, v) => a + (v ?? 0), 0)).toBe((raw.prior as { revenue: number }).revenue);
    expect(prior[4]).toBeNull();
    expect(prior.filter((v) => v === 0)).toHaveLength(0);
    expect(cats.priorLabel).toBe('the prior 30 days');
  });

  it('says the change in One figure, and a dash when there is nothing before to measure against', () => {
    const fig = (raw: unknown) => view(raw, true).figures.find((f) => f.label === 'Against the prior window')!;
    expect(fig(payload()).value).toBe('+34.5%');
    const none = payload({ prior: { from: P_FROM, to: P_TO, revenue: 0, dailySeries: [] } });
    expect(fig(none).value).toBe('—');
  });

  it('draws nothing of the prior when compare is off, or the gateway sent none', () => {
    expect(view(payload(), false).cats!.data.every((d) => d.prior === undefined)).toBe(true);
    expect(view(payload(), false).figures.some((f) => f.label.startsWith('Prior'))).toBe(false);
    expect(view(payload({ prior: undefined }), true).cats!.data.every((d) => d.prior === undefined)).toBe(true);
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
