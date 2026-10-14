/**
 * KPI row — the cards survive the verdict ("KPI cards stay") but shed the
 * old-fashioned dress: hairline paper cards, micro uppercase labels, mono
 * tabular figures that arrive on the tally spring. Unknown = em dash, and an
 * unknown never counts (CountUp encodes that).
 *
 * Labels are honest about what the gateway actually returns: the money
 * figures are procurement SPEND (paid to vendors), never "revenue" — the
 * endpoint misnomer is documented in services/api/dashboard.ts.
 */

import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardStats } from '@/services/api/types';
import { formatNumber } from '@/lib/utils';
import CountUp from './CountUp';
import { WAITING_ON_YOU_ID } from './WaitingOnYou';
import { SPEND_KEPT_APART, spendMoney, spendPartsSaid, statsSpendOf } from './useDashboardNextData';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface KpiTileProps {
  label: string;
  value: number | null;
  format?: (n: number) => string;
  sub?: string;
  to?: string;
  /** An element on this page to open instead of another page (F-1204). */
  anchor?: string;
  loading?: boolean;
  accent?: boolean;
}

function KpiTile({ label, value, format, sub, to, anchor, loading, accent }: KpiTileProps) {
  const body = (
    <div className="dn-ink h-full rounded-md border border-paper-2 bg-paper-1 px-4 py-3 hover:border-seal-ring">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-inkm-4">{label}</p>
      {loading ? (
        <div className="dn-skel mt-2 h-7 w-16" aria-hidden />
      ) : (
        <p
          className={`mt-1 text-[26px] font-medium leading-tight ${accent && value != null && value > 0 ? 'text-seal' : 'text-inkm-1'}`}
          style={{ fontFamily: MONO, letterSpacing: '-0.015em' }}
        >
          <CountUp value={value} format={format} />
        </p>
      )}
      {/* DASH-W26 (P5): the sub wraps instead of being cut mid-word; the
          tiles are h-full in their grid row, so a row keeps one height. */}
      <p className="mt-1 text-[11px] leading-snug text-inkm-4">{loading ? ' ' : sub ?? ' '}</p>
    </div>
  );
  if (anchor) {
    // Scrolled and focused here rather than left to the browser: the address
    // keeps no #fragment and the panel takes the keyboard where the eye goes.
    const open = (e: MouseEvent<HTMLAnchorElement>) => {
      const el = document.getElementById(anchor);
      if (!el) return;
      e.preventDefault();
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      el.focus({ preventScroll: true });
    };
    return (
      <a
        href={`#${anchor}`}
        onClick={open}
        className="block h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal rounded-md"
      >
        {body}
      </a>
    );
  }
  return to ? (
    <Link to={to} className="block h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal rounded-md">
      {body}
    </Link>
  ) : (
    body
  );
}

export interface KpiRowProps {
  /** undefined = loading · null = unknown · value = real */
  stats: DashboardStats | null | undefined;
  /** Count of orders waiting for approval — undefined loading, null unknown. */
  pendingCount: number | null | undefined;
  /** Count of low-stock wines — undefined loading, null unknown. */
  lowStockCount: number | null | undefined;
  /**
   * DASH-W22 (founder, 2026-10-01, "A: hide amounts for staff"): false for a
   * role that sees counts, not money. The two spend tiles become today's
   * deliveries and this month's bottles in; the gateway withholds the spend
   * for that role too, so this is the page agreeing with it, not the guard.
   */
  seesAmounts?: boolean;
}

export function KpiRow({ stats, pendingCount, lowStockCount, seesAmounts = true }: KpiRowProps) {
  const loading = stats === undefined;
  const s = stats ?? null;

  const wines = s ? s.totalWines : null;
  const bottles = s ? s.totalBottles : null;
  // Deployed gateways predating the honest rename still send the spend
  // figures as `todaySales`/`monthSales` (same numbers, old misnomer — see
  // the DashboardStats doc comment in services/api/types.ts). Read both.
  const legacy = (s ?? {}) as { todaySales?: number; monthSales?: number };
  const monthSpend = s
    ? typeof s.monthProcurementSpend === 'number'
      ? s.monthProcurementSpend
      : typeof legacy.monthSales === 'number'
        ? legacy.monthSales
        : null
    : null;
  const todaySpend = s
    ? typeof s.todayProcurementSpend === 'number'
      ? s.todayProcurementSpend
      : typeof legacy.todaySales === 'number'
        ? legacy.todaySales
        : null
    : null;
  // Counts the gateway adds beside the spend (DASH-W22); a gateway older than
  // that sends neither, and an absent count is unknown, never zero.
  const counts = (s ?? {}) as { todayDeliveries?: number; monthBottlesIn?: number };
  const todayDeliveries = typeof counts.todayDeliveries === 'number' ? counts.todayDeliveries : null;
  // F-701: a delivery with no price is left out of the spend, and the tile
  // says so instead of reading as complete. An older gateway sends no count.
  const unpricedNote = (n: number | null | undefined) =>
    typeof n === 'number' && n > 0
      ? `${formatNumber(n)} ${n === 1 ? 'delivery' : 'deliveries'} with no price not counted`
      : undefined;
  const todayUnpriced = unpricedNote(s?.todayProcurementUnpriced);
  const monthUnpriced = unpricedNote(s?.monthProcurementUnpriced);
  const monthBottlesIn = typeof counts.monthBottlesIn === 'number' ? counts.monthBottlesIn : null;
  // F-783: a house with no time zone gets null day figures and `zone_unset`
  // (the same flag the calendar reads), so the four day tiles say why they are
  // blank instead of standing empty beside the cellar count.
  const zoneUnset = (s as { zone_unset?: boolean } | null)?.zone_unset === true;
  const noZone = 'unknown until the time zone is set';
  // F-1052: each figure in the currency it was paid in, so euros from an
  // importer never read as lira. F-1055: a figure paid in two currencies is
  // null, and its sub says each part rather than leaving a bare dash.
  const todayIn = statsSpendOf(s, 'today');
  const monthIn = statsSpendOf(s, 'month');
  const apart = (w: typeof todayIn, total: number | null) => {
    if (total != null) return undefined;
    const said = spendPartsSaid(w.parts, 'compact');
    return said ? `${said}, ${SPEND_KEPT_APART}` : (w.note ?? undefined);
  };

  // DASH-W37: "items", never "wines" — the house holds every drink (ADR 0115,
  // ADR 0186), and the founder chose the word that still holds when food lands.
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-tour="dashboard-kpis">
      <KpiTile
        label="In the cellar"
        value={bottles}
        format={(n) => formatNumber(Math.round(n))}
        sub={wines != null ? `across ${formatNumber(wines)} ${wines === 1 ? 'item' : 'items'}` : undefined}
        to="/inventory"
        loading={loading}
      />
      <KpiTile
        label="Running low"
        value={lowStockCount === undefined ? null : lowStockCount}
        format={(n) => formatNumber(Math.round(n))}
        sub={lowStockCount != null && lowStockCount > 0 ? 'below their minimum' : 'items below minimum'}
        to="/inventory?filter=low-stock"
        loading={lowStockCount === undefined}
        accent
      />
      <KpiTile
        label="Waiting on you"
        value={pendingCount === undefined ? null : pendingCount}
        format={(n) => formatNumber(Math.round(n))}
        sub="approvals in the queue"
        anchor={WAITING_ON_YOU_ID}
        loading={pendingCount === undefined}
        accent
      />
      {seesAmounts ? (
        <>
          {/* F-1711: these sum delivered purchase orders, not payments made
              (procurement_invoice_payments is not read here), so they say
              "Bought", never "Paid". Payments owed and made live on /vendors. */}
          <KpiTile
            label="Bought · today"
            value={todaySpend}
            format={(n) => spendMoney(n, todayIn.currency, 'compact')}
            sub={zoneUnset ? noZone : (apart(todayIn, todaySpend) ?? todayUnpriced ?? 'delivered orders')}
            to="/orders?station=delivered"
            loading={loading}
          />
          <KpiTile
            label="Bought · month"
            value={monthSpend}
            format={(n) => spendMoney(n, monthIn.currency, 'compact')}
            sub={zoneUnset ? noZone : (apart(monthIn, monthSpend) ?? monthUnpriced ?? 'delivered orders')}
            to="/reports"
            loading={loading}
          />
        </>
      ) : (
        <>
          <KpiTile
            label="Deliveries · today"
            value={todayDeliveries}
            format={(n) => formatNumber(Math.round(n))}
            sub={zoneUnset ? noZone : 'orders received today'}
            to="/orders?station=delivered"
            loading={loading}
          />
          <KpiTile
            label="Bottles in · month"
            value={monthBottlesIn}
            format={(n) => formatNumber(Math.round(n))}
            sub={zoneUnset ? noZone : 'received this month'}
            loading={loading}
          />
        </>
      )}
    </div>
  );
}

export default KpiRow;
