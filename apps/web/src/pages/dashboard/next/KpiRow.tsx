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

import { Link } from 'react-router-dom';
import type { DashboardStats } from '@/services/api/types';
import { formatMoney, formatNumber } from '@/lib/utils';
import CountUp from './CountUp';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface KpiTileProps {
  label: string;
  value: number | null;
  format?: (n: number) => string;
  sub?: string;
  to?: string;
  loading?: boolean;
  accent?: boolean;
}

function KpiTile({ label, value, format, sub, to, loading, accent }: KpiTileProps) {
  const body = (
    <div className="dn-ink h-full rounded-md border border-paper-2 bg-paper-1 px-4 py-3 hover:border-seal-ring">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-inkm-3">{label}</p>
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
      <p className="mt-1 truncate text-[11px] text-inkm-3">{loading ? ' ' : sub ?? ' '}</p>
    </div>
  );
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
}

export function KpiRow({ stats, pendingCount, lowStockCount }: KpiRowProps) {
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

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiTile
        label="In the cellar"
        value={bottles}
        format={(n) => formatNumber(Math.round(n))}
        sub={wines != null ? `across ${formatNumber(wines)} wines` : undefined}
        to="/inventory"
        loading={loading}
      />
      <KpiTile
        label="Running low"
        value={lowStockCount === undefined ? null : lowStockCount}
        format={(n) => formatNumber(Math.round(n))}
        sub={lowStockCount != null && lowStockCount > 0 ? 'below their minimum' : 'wines below minimum'}
        to="/inventory"
        loading={lowStockCount === undefined}
        accent
      />
      <KpiTile
        label="Waiting on you"
        value={pendingCount === undefined ? null : pendingCount}
        format={(n) => formatNumber(Math.round(n))}
        sub="approvals in the queue"
        to="/orders"
        loading={pendingCount === undefined}
        accent
      />
      <KpiTile
        label="Paid to vendors · today"
        value={todaySpend}
        format={(n) => formatMoney(n, 'compact')}
        sub="delivered purchase orders"
        to="/orders"
        loading={loading}
      />
      <KpiTile
        label="Paid to vendors · month"
        value={monthSpend}
        format={(n) => formatMoney(n, 'compact')}
        sub="procurement, not sales"
        to="/reports"
        loading={loading}
      />
    </div>
  );
}

export default KpiRow;
