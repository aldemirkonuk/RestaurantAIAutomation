/**
 * Spend by vendor — F-1608 (sim 52, owner-year-and-accountant finding 5).
 *
 * What the house spent with each vendor over any period it picks: what was
 * delivered (the month close's "Bought (delivered)", per vendor) and what was
 * invoiced (the invoices dated in the period, at their printed totals), and
 * the same as a file for the accountant. The two are never added together.
 *
 * Shown to owners and managers only (the routes refuse anyone else). Its own
 * section beside the closed months, in the export shelf's styles.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api/client';
import { houseToday } from '@/lib/houseZone';
import { EM, countOf, failureLine, failureOf, money } from './rp-format';
import { reasonOf, saveFile } from './useReportExports';

/* ─────────────────────────────── the gateway (reports/vendor-spend) ──── */

/** `apps/api-gateway/src/reports/vendor-spend/vendor-spend.service.ts`, key for key. */
export interface SpendMoney {
  currency: string | null;
  total: number;
}

export interface VendorSpendRow {
  providerId: string | null;
  name: string | null;
  received: SpendMoney[];
  receivedOrders: number;
  unpricedOrders: number;
  invoiced: SpendMoney[];
  invoices: number;
  credited: SpendMoney[];
  creditNotes: number;
  paperWithoutTotal: number;
}

export interface VendorSpend {
  from: string;
  to: string;
  zone: string;
  currency: string | null;
  vendors: VendorSpendRow[];
  totals: { received: SpendMoney[]; invoiced: SpendMoney[]; credited: SpendMoney[] };
  unverifiedPaper: number;
  duplicatePaper: number;
  paperWithoutCurrency: number;
  basis: string[];
}

export interface Period {
  from: string;
  to: string;
}

export async function getVendorSpend(p: Period): Promise<VendorSpend> {
  const { data } = await apiClient.get<VendorSpend>('/reports/vendor-spend', { params: p });
  if (!data || !Array.isArray(data.vendors)) throw new Error('the gateway answered without a list of vendors');
  return data;
}

export async function downloadVendorSpend(p: Period): Promise<{ filename: string; mime: string; body: string }> {
  const { data } = await apiClient.get<string>('/reports/vendor-spend/file.csv', {
    params: p,
    responseType: 'text',
    transformResponse: [(raw: unknown) => raw],
  });
  if (typeof data !== 'string') throw new Error('the gateway answered without the file');
  // Reading the body as text drops the BOM; put it back so Excel reads UTF-8.
  return {
    filename: `mudavym-spend-by-vendor-${p.from}-to-${p.to}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: data.startsWith('\uFEFF') ? data : `\uFEFF${data}`,
  };
}

/** `houseToday`'s local-midnight Date as YYYY-MM-DD, read with the local getters it is built for. */
export function dayOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The quick periods, on the house's calendar. `today` is YYYY-MM-DD. */
export function periods(today: string): Record<'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear', Period> {
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return {
    thisMonth: { from: `${y}-${pad(m)}-01`, to: today },
    lastMonth: { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}` },
    thisYear: { from: `${y}-01-01`, to: today },
    lastYear: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  };
}

const QUICK: Array<{ key: keyof ReturnType<typeof periods>; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisYear', label: 'This year' },
  { key: 'lastYear', label: 'Last year' },
];

/** Each currency in its own code, joined; the house's money first (the gateway orders them). */
function amounts(totals: SpendMoney[], house: string | null): string {
  if (totals.length === 0) return money(0, 'full', house);
  return totals.map((t) => money(t.total, 'full', t.currency ?? house)).join(' + ');
}

export interface VendorSpendShelfProps {
  restaurantId: string;
  /** The house's IANA zone; the period is the house's days. Null: the reader's. */
  zone: string | null;
}

export default function VendorSpendShelf({ restaurantId, zone }: VendorSpendShelfProps) {
  const today = dayOf(houseToday(zone));
  const [period, setPeriod] = useState<Period>(() => periods(today).thisYear);
  const [error, setError] = useState<string | null>(null);
  const valid = Boolean(period.from && period.to && period.from <= period.to);
  const spend = useQuery({
    queryKey: ['vendor-spend', restaurantId, period.from, period.to],
    queryFn: () => getVendorSpend(period),
    enabled: valid,
  });
  const failure = failureOf(spend.error);
  const s = spend.data;
  const quick = periods(today);

  return (
    <section id="rp-vendor-spend" className="rp-exports" aria-labelledby="rp-vendor-spend-title">
      <div className="rp-exports__head">
        <div>
          <h2 id="rp-vendor-spend-title" className="rp-cut__title">
            Spend by vendor
          </h2>
          <p className="rp-cap">
            What you spent with each vendor between two dates: what was delivered, and what they
            invoiced. Download it as a file for your accountant.
          </p>
        </div>
        <div className="rp-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {QUICK.map((q) => (
            <button
              key={q.key}
              type="button"
              className="rp-mini rp-ink rp-focus"
              aria-pressed={period.from === quick[q.key].from && period.to === quick[q.key].to}
              onClick={() => setPeriod(quick[q.key])}
            >
              {q.label}
            </button>
          ))}
          <label className="rp-field">
            <span className="rp-eyebrow">From</span>
            <input
              type="date"
              className="rp-select rp-focus"
              aria-label="Spend from"
              value={period.from}
              max={period.to || undefined}
              onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
            />
          </label>
          <label className="rp-field">
            <span className="rp-eyebrow">To</span>
            <input
              type="date"
              className="rp-select rp-focus"
              aria-label="Spend to"
              value={period.to}
              min={period.from || undefined}
              onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="rp-btn rp-ink rp-focus"
            data-strong="true"
            disabled={!valid}
            onClick={async () => {
              setError(null);
              try {
                const file = await downloadVendorSpend(period);
                saveFile(file.filename, file.mime, file.body);
              } catch (err) {
                setError(`The file did not download: ${reasonOf(err)}`);
              }
            }}
          >
            Download CSV
          </button>
        </div>
      </div>

      {!valid && <p className="rp-cap">Pick a start date on or before the end date.</p>}

      {error && (
        <p className="rp-note" role="alert">
          {error}
        </p>
      )}

      {!valid ? null : failure ? (
        <p className="rp-note" role="alert">
          {failureLine('spend by vendor', failure)}{' '}
          <button type="button" className="rp-mini rp-ink rp-focus" onClick={() => void spend.refetch()}>
            Read again
          </button>
        </p>
      ) : !s ? (
        <p className="rp-cap" role="status">
          Reading what you spent…
        </p>
      ) : (
        <>
          <p className="rp-cap">
            {s.from} to {s.to}, both days included. Delivered: {amounts(s.totals.received, s.currency)}.
            Invoiced: {amounts(s.totals.invoiced, s.currency)}
            {s.totals.credited.length ? `, and ${amounts(s.totals.credited, s.currency)} in credit notes` : ''}.
          </p>
          {s.vendors.length === 0 ? (
            <p className="rp-cap">No order was delivered and no invoice is dated in this period.</p>
          ) : (
            <ul className="rp-list rp-exports__list" aria-label="Spend by vendor">
              {s.vendors.map((v) => (
                <li key={v.providerId ?? 'none'} className="rp-export" data-status="ready">
                  <div className="rp-export__what">
                    <p className="rp-sentence">
                      <strong>
                        {v.providerId === null ? 'No vendor named' : (v.name ?? 'A vendor no longer on your list')}
                      </strong>
                    </p>
                    <p className="rp-cap">
                      Delivered: {amounts(v.received, s.currency)} over{' '}
                      {countOf(v.receivedOrders, 'order', 'orders')}
                      {v.unpricedOrders > 0
                        ? `, and ${countOf(v.unpricedOrders, 'order', 'orders')} with no price`
                        : ''}
                    </p>
                    <p className="rp-cap">
                      Invoiced: {v.invoices + v.creditNotes === 0 ? EM : amounts(v.invoiced, s.currency)} over{' '}
                      {countOf(v.invoices, 'invoice', 'invoices')}
                      {v.creditNotes > 0
                        ? `; credit notes ${amounts(v.credited, s.currency)} over ${countOf(v.creditNotes, 'note', 'notes')}`
                        : ''}
                      {v.paperWithoutTotal > 0
                        ? `; ${countOf(v.paperWithoutTotal, 'invoice', 'invoices')} with no total yet`
                        : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {s.unverifiedPaper > 0 && (
            <p className="rp-cap">
              {countOf(s.unverifiedPaper, 'invoice or credit note has', 'invoices or credit notes have')} not
              been checked against the paper yet.
            </p>
          )}
          {s.paperWithoutCurrency > 0 && (
            <p className="rp-cap">
              Left out of these totals: {countOf(s.paperWithoutCurrency, 'invoice', 'invoices')} that name no
              currency.
            </p>
          )}
          <ul className="rp-cap" aria-label="How these figures are counted">
            {s.basis.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
