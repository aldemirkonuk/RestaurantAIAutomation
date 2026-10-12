/**
 * Closed months — F-1013, the founder's ruling of 2026-10-11 (sim ledger
 * S195): option C, the snapshot close.
 *
 * An owner or manager closes a month that has ended. The gateway keeps the
 * month's figures as they stood (the till, the cellar's value, what was
 * bought, the count variance, and the till's month as a file), and that is the
 * record. Nothing is locked: the books stay editable, and anything changed
 * inside a closed month afterwards is listed here against the record — who,
 * what, by how much. There is no reopen; closing the month again keeps a new
 * version beside the old one.
 *
 * Shown to owners and managers only (the routes refuse anyone else). Its own
 * section under the export shelf, in the shelf's styles.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api/client';
import { houseToday } from '@/lib/houseZone';
import { EM, countOf, failureLine, failureOf, figure, money } from './rp-format';
import { monthLabel, thisMonth } from './rp-registers-trade';
import { reasonOf, saveFile } from './useReportExports';

/* ─────────────────────────────── the gateway (reports/month-close) ──── */

/**
 * `apps/api-gateway/src/reports/month-close/`. Shapes mirror
 * `month-close.service.ts` key for key. Kept beside the one view that reads
 * them, as CalendarNext and NewVendorSheet keep theirs.
 */
export interface MonthCloseMoney {
  /** ISO 4217; null is the house's money. */
  currency: string | null;
  total: number;
}

export interface MonthCloseFigures {
  currency: string | null;
  /** Net, the checks' subtotal (ADR 0287 AW17, F-1494); null when no check carried one. */
  till: {
    posConnected: boolean;
    netSales: number | null;
    netSalesCheckCount: number | null;
    checkCount: number | null;
    days: Array<{ date: string; netSales: number }>;
  };
  valuation: {
    inventoryValue: number | null;
    pricedInventoryValue: number | null;
    unpricedWines: number | null;
    valuedAt: string;
  };
  purchases: { orders: number; unpriced: number; totals: MonthCloseMoney[] };
  variance: { counts: number; netBottles: number; shortBottles: number; overBottles: number };
}

export interface MonthClose {
  id: string;
  month: string;
  version: number;
  closedAt: string;
  closedBy: { id: string; name: string | null } | null;
  zone: string;
  figures: MonthCloseFigures;
  hasTillFile: boolean;
}

export interface MonthCloseChange {
  kind: 'till' | 'stock' | 'purchase';
  at: string;
  day: string;
  who: string;
  what: string;
  delta: number | null;
  unit: 'bottles' | 'money';
  currency: string | null;
}

export interface MonthCloseAgainstNow {
  figure: 'till_net_sales' | 'till_checks' | 'purchases' | 'variance_net';
  label: string;
  atClose: number | null;
  now: number | null;
  delta: number | null;
  currency: string | null;
}

export interface MonthCloseDetail extends MonthClose {
  changes: MonthCloseChange[];
  changesNotListed: number;
  againstNow: MonthCloseAgainstNow[];
}

export async function listMonthCloses(): Promise<MonthClose[]> {
  const { data } = await apiClient.get<{ closes: MonthClose[] }>('/reports/month-close');
  if (!data || !Array.isArray(data.closes))
    throw new Error('the gateway answered without a list of closed months');
  return data.closes;
}

export async function closeMonth(month: string): Promise<MonthClose> {
  const { data } = await apiClient.post<MonthClose>('/reports/month-close', { month });
  return data;
}

export async function getMonthClose(id: string): Promise<MonthCloseDetail> {
  const { data } = await apiClient.get<MonthCloseDetail>(`/reports/month-close/${encodeURIComponent(id)}`);
  return data;
}

/** The till's month as it was written up at the close, ready to hand to the reader. */
export async function downloadMonthCloseTill(
  close: Pick<MonthClose, 'id' | 'month' | 'version'>,
): Promise<{ filename: string; mime: string; body: string }> {
  const { data } = await apiClient.get<string>(
    `/reports/month-close/${encodeURIComponent(close.id)}/till.csv`,
    { responseType: 'text', transformResponse: [(raw: unknown) => raw] },
  );
  if (typeof data !== 'string') throw new Error('the gateway answered without the file');
  // Reading the body as text drops the BOM; put it back so Excel reads UTF-8.
  return {
    filename: `mudavym-till-${close.month}-closed-v${close.version}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: data.startsWith('\uFEFF') ? data : `\uFEFF${data}`,
  };
}

export interface MonthCloseShelfProps {
  restaurantId: string;
  /** The house's IANA zone; the month is the house's month. Null: the reader's. */
  zone: string | null;
}

/** The month before YYYY-MM. */
export function monthBefore(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function when(iso: string, zone: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  try {
    return d.toLocaleString(undefined, zone ? { ...opts, timeZone: zone } : opts);
  } catch {
    return d.toLocaleString(undefined, opts);
  }
}

function signed(text: string, n: number | null): string {
  if (n === null) return EM;
  return n > 0 ? `+${text}` : text;
}

/** By how much, in its own unit: money in its code (null is the house's), bottles as bottles. */
function delta(c: Pick<MonthCloseChange, 'delta' | 'unit' | 'currency'>): string {
  if (c.delta === null) return '';
  if (c.unit === 'bottles')
    // "-1 bottle", not "-1 bottles": the word follows how many, not the sign.
    return `${c.delta > 0 ? '+' : c.delta < 0 ? '-' : ''}${countOf(Math.abs(c.delta), 'bottle', 'bottles')}`;
  return signed(money(c.delta, 'full', c.currency), c.delta);
}

function Kept({ close }: { close: MonthClose }) {
  const f = close.figures;
  const bought = f.purchases.totals.length
    ? f.purchases.totals.map((t) => money(t.total, 'full', t.currency ?? f.currency)).join(' + ')
    : money(0, 'full', f.currency);
  return (
    <ul className="rp-cap" aria-label={`Figures kept for ${monthLabel(close.month)}`}>
      <li>
        Net sales through the till:{' '}
        {!f.till.posConnected
          ? 'no till connected'
          : f.till.netSales === null
            ? `${EM}, not recorded: no check carried a net figure`
            : money(f.till.netSales, 'full', f.currency)}
        {!f.till.posConnected || f.till.checkCount === null
          ? ''
          : f.till.netSales !== null &&
              f.till.netSalesCheckCount !== null &&
              f.till.netSalesCheckCount < f.till.checkCount
            ? ` from ${f.till.netSalesCheckCount} of ${countOf(f.till.checkCount, 'check', 'checks')}; the rest carried no net figure`
            : ` over ${countOf(f.till.checkCount, 'check', 'checks')}`}
      </li>
      <li>
        Bought (delivered): {bought}
        {f.purchases.unpriced > 0 ? `, and ${countOf(f.purchases.unpriced, 'order', 'orders')} with no price` : ''}
      </li>
      <li>
        Count variance:{' '}
        {f.variance.counts === 0
          ? 'no shelf counts in the month'
          : `${countOf(f.variance.shortBottles, 'bottle', 'bottles')} short, ${countOf(f.variance.overBottles, 'bottle', 'bottles')} over`}
      </li>
      <li>
        Cellar value when closed:{' '}
        {f.valuation.inventoryValue !== null
          ? money(f.valuation.inventoryValue, 'full', f.currency)
          : f.valuation.pricedInventoryValue !== null
            ? `${money(f.valuation.pricedInventoryValue, 'full', f.currency)} for the priced wines; ${countOf(f.valuation.unpricedWines ?? 0, 'wine has', 'wines have')} no cost`
            : EM}
      </li>
    </ul>
  );
}

function Since({ detail }: { detail: MonthCloseDetail }) {
  return (
    <div className="rp-export__what">
      <ul className="rp-cap" aria-label="Kept against now">
        {detail.againstNow.map((a) => {
          const fmt = (v: number | null) =>
            a.figure === 'till_checks' || a.figure === 'variance_net' ? figure(v) : money(v, 'full', a.currency);
          return (
            <li key={`${a.figure}:${a.currency ?? ''}`}>
              {a.label}
              {a.figure === 'purchases' && a.currency ? ` (${a.currency})` : ''}: {fmt(a.atClose)} kept, {fmt(a.now)}{' '}
              now
              {a.delta !== null && a.delta !== 0 ? ` (${signed(fmt(a.delta), a.delta)})` : ''}
            </li>
          );
        })}
      </ul>
      {detail.changes.length === 0 ? (
        // F-1467: never "nothing changed" while a figure above moved.
        detail.againstNow.some((a) => a.delta !== null && a.delta !== 0) ? (
          <p className="rp-cap">
            A figure above has moved since the month was closed, but no single change could be listed for it.
          </p>
        ) : (
          <p className="rp-cap">Nothing dated in this month has changed since it was closed.</p>
        )
      ) : (
        <>
          <p className="rp-sentence">
            <strong>Changed after close</strong>
          </p>
          <ul className="rp-cap" aria-label="Changed after close">
            {detail.changes.map((c, i) => (
              <li key={`${c.kind}:${c.at}:${i}`}>
                {c.day} · {c.who} · {c.what}
                {c.delta !== null ? ` ${delta(c)}` : ''}
              </li>
            ))}
          </ul>
          {detail.changesNotListed > 0 && (
            <p className="rp-cap">…and {countOf(detail.changesNotListed, 'more change', 'more changes')} not listed here.</p>
          )}
        </>
      )}
    </div>
  );
}

function Row({ close, zone, latest }: { close: MonthClose; zone: string | null; latest: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['month-close', close.id],
    queryFn: () => getMonthClose(close.id),
    enabled: open,
  });
  const failure = failureOf(detail.error);
  return (
    <li className="rp-export" data-status="ready">
      <div className="rp-export__what">
        <p className="rp-sentence">
          <strong>{monthLabel(close.month)}</strong>
          <span className="rp-cap">
            {' '}
            · {close.version > 1 ? `closed again (version ${close.version})` : 'closed'}
            {!latest ? ', an earlier version' : ''}
          </span>
        </p>
        <p className="rp-cap">
          {when(close.closedAt, zone)} by {close.closedBy ? (close.closedBy.name ?? 'a team member') : 'someone no longer on the team'}
        </p>
        <Kept close={close} />
        {open &&
          (failure ? (
            <p className="rp-note" role="alert">
              {failureLine('closed month', failure)}
            </p>
          ) : detail.data ? (
            <Since detail={detail.data} />
          ) : (
            <p className="rp-cap" role="status">
              Reading what changed since…
            </p>
          ))}
        {error && (
          <p className="rp-note" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="rp-row rp-export__acts">
        <button
          type="button"
          className="rp-mini rp-ink rp-focus"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide changes' : 'What changed since'}
        </button>
        {close.hasTillFile && (
          <button
            type="button"
            className="rp-mini rp-ink rp-focus"
            aria-label={`Download the till's ${monthLabel(close.month)} as closed`}
            onClick={async () => {
              setError(null);
              try {
                const file = await downloadMonthCloseTill(close);
                saveFile(file.filename, file.mime, file.body);
              } catch (err) {
                setError(`The till file did not download: ${reasonOf(err)}`);
              }
            }}
          >
            Till CSV
          </button>
        )}
      </div>
    </li>
  );
}

export default function MonthCloseShelf({ restaurantId, zone }: MonthCloseShelfProps) {
  const qc = useQueryClient();
  const lastMonth = monthBefore(thisMonth(houseToday(zone)));
  const [month, setMonth] = useState(lastMonth);
  const key = ['month-closes', restaurantId];
  const list = useQuery({ queryKey: key, queryFn: listMonthCloses });
  const close = useMutation({
    mutationFn: (m: string) => closeMonth(m),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const failure = failureOf(list.error);
  const closes = list.data;
  const seen = new Set<string>();

  return (
    <section id="rp-month-close" className="rp-exports" aria-labelledby="rp-month-close-title">
      <div className="rp-exports__head">
        <div>
          <h2 id="rp-month-close-title" className="rp-cut__title">
            Closed months
          </h2>
          <p className="rp-cap">
            Closing a month keeps its figures as they stand today: the till’s net sales, what was
            bought, the count variance and the cellar’s value. Nothing is locked. If anything dated
            in that month changes later, it is listed under the month — who, what and by how much.
            Closing it again keeps a new version beside the first.
          </p>
        </div>
        <div className="rp-row" style={{ gap: 8 }}>
          <label className="rp-field">
            <span className="rp-eyebrow">Month</span>
            <input
              type="month"
              className="rp-select rp-focus"
              aria-label="Month to close"
              value={month}
              max={lastMonth}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rp-btn rp-ink rp-focus"
            data-strong="true"
            disabled={!month || close.isPending}
            onClick={() => close.mutate(month)}
          >
            {close.isPending ? 'Closing…' : 'Close the month'}
          </button>
        </div>
      </div>

      {close.isError && (
        <p className="rp-note" role="alert">
          The month was not closed: {reasonOf(close.error)}{' '}
          <button type="button" className="rp-mini rp-ink rp-focus" onClick={() => close.reset()}>
            Dismiss
          </button>
        </p>
      )}

      {failure ? (
        <p className="rp-note" role="alert">
          {failureLine('list of closed months', failure)}{' '}
          <button type="button" className="rp-mini rp-ink rp-focus" onClick={() => void list.refetch()}>
            Read again
          </button>
        </p>
      ) : closes === undefined ? (
        <p className="rp-cap" role="status">
          Reading this house’s closed months…
        </p>
      ) : closes.length === 0 ? (
        <p className="rp-cap">No month has been closed for this house yet.</p>
      ) : (
        <ul className="rp-list rp-exports__list">
          {closes.map((c) => {
            // The list is newest close first, so the first row of a month is its latest version.
            const latest = !seen.has(c.month);
            seen.add(c.month);
            return <Row key={c.id} close={c} zone={zone} latest={latest} />;
          })}
        </ul>
      )}
    </section>
  );
}
