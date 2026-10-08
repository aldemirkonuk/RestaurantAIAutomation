/**
 * A-048 (analytics walk, 2026-10-03), ADR 0294: the Performance card printed
 * "Against a house median of 72" — dollars PER COVER, with no unit and no
 * currency — under "Average check $186", beside nothing it could be compared
 * with, and called a share of sales "Wine attach".
 *
 * Every case below fails at origin/main `f5f658934`: the median there has no
 * currency and no "per cover", the money is a literal `$`, there is no "Sales
 * per cover" row, the label is "Wine attach", and every null benchmark reads
 * "no other server here has enough attributed services" — false when the read
 * failed, and false when the only figures are the member's own.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MemberPerformance } from '../../../services/api/team';

const api = vi.hoisted(() => ({ perf: {} as unknown }));

vi.mock('../../../services/api/team', () => ({
  getMemberPerformance: () => Promise.resolve(api.perf),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'manager',
    user: { id: 'u1', restaurantId: 'r1', role: 'manager' },
  }),
}));

import { PerformanceCard } from './PerformanceCard';

const TRY = { currency: 'TRY', country: 'Türkiye', readable: true };
const tl = (v: number, digits = 2) =>
  new Intl.NumberFormat('tr-Latn-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);

/** Lucas: 2 services, both with covers. The house: 4 services by 2 servers. */
const COMPUTED: MemberPerformance = {
  hasData: true,
  money: TRY,
  metrics: {
    salesPerShift: 1900,
    avgCheck: 190,
    salesPerCover: 76,
    coverServices: 2,
    wineAttachPct: 25,
  },
  analytic: {
    unit: '/cover',
    series: [72, 80],
    median: 75,
    band: [72, 80],
    benchmark: { state: 'computed', services: 4, servers: 2, includesMember: true },
  },
  services: [
    { date: '2026-09-01', covers: 25 },
    { date: '2026-09-02', covers: 25 },
  ],
};

async function card(perf: MemberPerformance): Promise<HTMLElement> {
  api.perf = perf;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PerformanceCard memberId="m-lucas" memberName="Lucas" />
    </QueryClientProvider>,
  );
  const h = await screen.findByText('Sales / shift');
  return h.closest('section') as HTMLElement;
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

describe('PerformanceCard — every figure has its unit (A-048)', () => {
  it("prints the median in the house's currency, per cover, with what it is taken over", async () => {
    const el = await card(COMPUTED);
    expect(text(el)).toContain(
      `Against a house median of ${tl(75)} per cover: 4 services by 2 servers, Lucas's own included, among the restaurant's ≤200 most recent — not its whole history.`,
    );
  });

  it("sets the member's own sales per cover beside it", async () => {
    const el = await card(COMPUTED);
    const row = screen.getByText('Sales per cover').closest('.tm-kv') as HTMLElement;
    expect(text(row)).toContain(tl(76));
    expect(text(el)).toContain("Over Lucas's last 2 logged services.");
  });

  it('prints every money figure in the house currency, never a literal dollar', async () => {
    const el = await card(COMPUTED);
    expect(text(el)).toContain(tl(1900, 0));
    expect(text(el)).toContain(tl(190));
    expect(text(el)).not.toContain('$');
  });

  it("labels wine sales over net sales 'Wine share of sales', not 'Wine attach'", async () => {
    const el = await card(COMPUTED);
    expect(screen.getByText('Wine share of sales')).toBeTruthy();
    expect(text(el)).not.toMatch(/wine attach/i);
    const row = screen.getByText('Wine share of sales').closest('.tm-kv') as HTMLElement;
    expect(text(row)).toContain(
      new Intl.NumberFormat('tr-Latn-TR', { style: 'percent', maximumFractionDigits: 1 }).format(0.25),
    );
  });

  it("refuses the comparison when the only per-cover figures are the member's own", async () => {
    const el = await card({
      ...COMPUTED,
      analytic: {
        ...COMPUTED.analytic!,
        median: null,
        band: null,
        benchmark: { state: 'self-only', services: 2, servers: 1, includesMember: true },
      },
    });
    expect(text(el)).toContain(
      "the only per-cover figures in the house's recent services (the restaurant's ≤200 most recent) are Lucas's own, so there is nothing to set them against.",
    );
    expect(text(el)).not.toContain('no other server');
  });

  it("says when the median does not include the member's services", async () => {
    const el = await card({
      ...COMPUTED,
      analytic: {
        ...COMPUTED.analytic!,
        benchmark: { state: 'computed', services: 2, servers: 1, includesMember: false },
      },
    });
    expect(text(el)).toContain("2 services by 1 server, none of them Lucas's,");
  });

  it('says no recent service records covers, and does not blame other servers', async () => {
    const el = await card({
      ...COMPUTED,
      analytic: {
        ...COMPUTED.analytic!,
        median: null,
        band: null,
        benchmark: { state: 'no-covers', services: 0, servers: 0, includesMember: false },
      },
    });
    expect(text(el)).toContain(
      "none of the restaurant's ≤200 most recent services records covers with its sales",
    );
    expect(text(el)).not.toContain('no other server');
  });

  it('says the benchmark could not be read when that read failed', async () => {
    const el = await card({
      ...COMPUTED,
      analytic: {
        ...COMPUTED.analytic!,
        median: null,
        band: null,
        benchmark: { state: 'unreadable', services: 0, servers: 0, includesMember: false },
      },
    });
    expect(text(el)).toContain("the restaurant's recent services could not be read");
    expect(text(el)).not.toContain('no other server');
  });

  it('prints an unknown average check as the dash, never as zero', async () => {
    await card({ ...COMPUTED, metrics: { ...COMPUTED.metrics!, avgCheck: null } });
    const row = screen.getByText('Average check').closest('.tm-kv') as HTMLElement;
    expect(text(row)).toBe('Average check—');
  });

  it("says which of the member's services the per-cover figure counts, when not all", async () => {
    const el = await card({ ...COMPUTED, metrics: { ...COMPUTED.metrics!, coverServices: 1 } });
    expect(text(el)).toContain('Sales per cover counts the 1 of these 2 services that record covers with their sales.');
  });

  it('says the currency is not recorded when the house states none', async () => {
    const el = await card({ ...COMPUTED, money: { currency: null, country: null, readable: true } });
    expect(text(el)).toContain('currency not recorded');
    expect(text(el)).not.toContain('$');
  });

  it('says the currency could not be read when the gateway sends none (built before ADR 0294)', async () => {
    const { money: _drop, ...older } = COMPUTED;
    const el = await card({
      ...older,
      analytic: { unit: '/cover', series: [72, 80], median: 75, band: [72, 80] },
    });
    expect(text(el)).toContain('currency could not be read');
    expect(text(el)).toContain(
      "per cover, taken over the restaurant's most recent services — ≤200 of them",
    );
    expect(text(el)).not.toContain('$');
  });
});
