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
import { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api/client';
import { AuthContext } from '@/contexts/AuthContext';
import { houseToday } from '@/lib/houseZone';
import { exportHouseWord } from '@/lib/tableExport';
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
  /** Delivered in the period, still open (F-1632): not in `received`. */
  awaitingOrders: number;
  awaiting: SpendMoney[];
  invoiced: SpendMoney[];
  invoices: number;
  credited: SpendMoney[];
  creditNotes: number;
  paperWithoutTotal: number;
  /** Unmarked invoices dated before `owedSince` (all, when it is null): not marked, never owed (F-1635). */
  unpaid: SpendMoney[];
  unpaidInvoices: number;
  unpaidWithoutTotal: number;
  /** Unmarked invoices dated since `owedSince`, less credit notes since then (F-1635). */
  owed: SpendMoney[];
  owedInvoices: number;
  /** Credit notes since `owedSince` not used up yet, taken off `owed`. */
  owedCreditNotes: number;
  owedWithoutTotal: number;
  /**
   * Credit notes dated before `owedSince` with credit not used up: never taken
   * off `owed`, said beside it (wave 109). Optional so an older gateway's answer reads.
   */
  earlyCreditNotes?: number;
  earlyCredit?: SpendMoney[];
}

export interface VendorSpend {
  from: string;
  to: string;
  zone: string;
  currency: string | null;
  /** Vendors with orders or paper in the period only (F-1643). */
  vendors: VendorSpendRow[];
  /**
   * Every vendor with something owed or not marked paid, any date (F-1643).
   * Optional only so an older gateway's answer still reads.
   */
  owing?: VendorOwedRow[];
  totals: {
    received: SpendMoney[];
    awaiting: SpendMoney[];
    invoiced: SpendMoney[];
    credited: SpendMoney[];
    unpaid: SpendMoney[];
    /** Only the vendors still owed something, added up; never less another vendor's credit (F-1673). */
    owed: SpendMoney[];
    /**
     * Vendors whose credit is more than their bills: credit in the house's
     * favour, kept apart (F-1673). Optional so an older gateway's answer reads.
     */
    inFavour?: SpendMoney[];
  };
  /** The house day it first marked an invoice paid; null when it never has. */
  owedSince: string | null;
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

export async function downloadVendorSpend(
  p: Period,
  houseName: string | null,
): Promise<{ filename: string; mime: string; body: string }> {
  const { data } = await apiClient.get<string>('/reports/vendor-spend/file.csv', {
    params: p,
    responseType: 'text',
    transformResponse: [(raw: unknown) => raw],
  });
  if (typeof data !== 'string') throw new Error('the gateway answered without the file');
  // Reading the body as text drops the BOM; put it back so Excel reads UTF-8.
  return {
    // Named for its house, as the exports shelf names its files (F-1631).
    filename: `mudavym-${exportHouseWord(houseName)}-spend-by-vendor-${p.from}-to-${p.to}.csv`,
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

/** Owed per currency; a credit bigger than the bills is the vendor's debt, said so. */
function owedAmounts(totals: SpendMoney[], house: string | null): string {
  if (totals.length === 0) return money(0, 'full', house);
  return totals
    .map((t) =>
      t.total < 0
        ? `${money(-t.total, 'full', t.currency ?? house)} in your favour`
        : money(t.total, 'full', t.currency ?? house),
    )
    .join(' + ');
}

type OwedFacts = Pick<
  VendorSpendRow,
  | 'owed'
  | 'owedInvoices'
  | 'owedCreditNotes'
  | 'owedWithoutTotal'
  | 'unpaid'
  | 'unpaidInvoices'
  | 'unpaidWithoutTotal'
  | 'earlyCreditNotes'
  | 'earlyCredit'
>;

/** One vendor's Owed and Not marked paid, any date (`VendorOwedRow` at the gateway). */
export type VendorOwedRow = OwedFacts & Pick<VendorSpendRow, 'providerId' | 'name'>;

/**
 * What one vendor is owed, in words (F-1635) — the reports shelf and the
 * vendor's sheet on /vendors say it the same way. `owed` is null until the
 * house has marked an invoice paid: before that nothing says which invoices
 * are still to pay. `notMarked` is the older unmarked invoices, never "owed".
 * Owed says how many credit notes not yet used it includes, and `earlyCredit`
 * says the credit notes older than `owedSince` it does not (wave 109).
 */
export function owedWords(
  v: OwedFacts,
  owedSince: string | null,
  house: string | null,
): { owed: string | null; notMarked: string | null; earlyCredit: string | null } {
  const owed =
    owedSince === null
      ? null
      : v.owedInvoices + v.owedCreditNotes === 0
        ? 'Owed: nothing'
        : `Owed: ${v.owed.length ? owedAmounts(v.owed, house) : EM} over ${countOf(v.owedInvoices, 'invoice', 'invoices')}` +
          (v.owedCreditNotes > 0
            ? `, includes ${countOf(v.owedCreditNotes, 'credit note', 'credit notes')} not yet used`
            : '') +
          (v.owedWithoutTotal > 0 ? `; ${v.owedWithoutTotal} with no total yet` : '');
  const notMarked =
    v.unpaidInvoices === 0
      ? null
      : `Not marked paid${owedSince ? `, dated before ${owedSince}` : ''}: ${v.unpaid.length ? amounts(v.unpaid, house) : EM} over ${countOf(v.unpaidInvoices, 'invoice', 'invoices')}` +
        (v.unpaidWithoutTotal > 0 ? `, ${v.unpaidWithoutTotal} with no total yet` : '');
  const early = v.earlyCreditNotes ?? 0;
  const earlyCredit =
    owedSince === null || early === 0
      ? null
      : `Not taken off Owed: ${countOf(early, 'credit note', 'credit notes')} dated before ${owedSince}` +
        (v.earlyCredit?.length ? `, ${amounts(v.earlyCredit, house)}` : '') +
        ` — nothing then could say whether ${early === 1 ? 'it was' : 'they were'} used`;
  return { owed, notMarked, earlyCredit };
}

export interface VendorSpendShelfProps {
  restaurantId: string;
  /** The house's IANA zone; the period is the house's days. Null: the reader's. */
  zone: string | null;
}

export default function VendorSpendShelf({ restaurantId, zone }: VendorSpendShelfProps) {
  const today = dayOf(houseToday(zone));
  const houseName =
    useContext(AuthContext)?.availableRestaurants?.find((b) => b.id === restaurantId)?.name ?? null;
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
                const file = await downloadVendorSpend(period, houseName);
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
            {/* F-1673: one vendor's credit is not set against another's bills; it is said apart. */}
            {s.owedSince && (s.totals.owed.length || s.totals.inFavour?.length)
              ? ` Owed now: ${amounts(s.totals.owed, s.currency)}.`
              : ''}
            {s.owedSince && s.totals.inFavour?.length
              ? ` Credit in your favour, from vendors whose credit is more than their bills: ${amounts(s.totals.inFavour, s.currency)}.`
              : ''}
            {s.totals.unpaid.length
              ? ` Not marked paid, ${s.owedSince ? `dated before ${s.owedSince}` : 'any date'}: ${amounts(s.totals.unpaid, s.currency)}.`
              : ''}
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
                    {/* F-1632: delivered but still open is said, not silently left out. */}
                    {v.awaitingOrders > 0 && (
                      <p className="rp-cap">
                        Not in Delivered yet: {countOf(v.awaitingOrders, 'order', 'orders')} delivered but still
                        open (part still to come, or the invoice not checked yet)
                        {v.awaiting.length ? `, ${amounts(v.awaiting, s.currency)} at order total` : ''}
                      </p>
                    )}
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
                    {/* F-1635: what is owed since the house could mark invoices paid, and the older unmarked ones. */}
                    {(() => {
                      const w = owedWords(v, s.owedSince, s.currency);
                      return (
                        <>
                          {w.owed && v.owedInvoices + v.owedCreditNotes > 0 && <p className="rp-cap">{w.owed}</p>}
                          {w.notMarked && <p className="rp-cap">{w.notMarked}</p>}
                          {w.earlyCredit && <p className="rp-cap">{w.earlyCredit}</p>}
                        </>
                      );
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {/* F-1643: vendors with nothing in the period but money still owed or
              not marked paid are said apart, not as rows of the period. */}
          {(() => {
            const inPeriod = new Set(s.vendors.map((v) => v.providerId));
            const rest = (s.owing ?? []).filter((o) => !inPeriod.has(o.providerId));
            if (rest.length === 0) return null;
            return (
              <>
                <p className="rp-cap">Also owed or not marked paid, from vendors with nothing in this period:</p>
                <ul className="rp-list rp-exports__list" aria-label="Owed and not marked paid, any date">
                  {rest.map((o) => {
                    const w = owedWords(o, s.owedSince, s.currency);
                    return (
                      <li key={o.providerId ?? 'none'} className="rp-export" data-status="ready">
                        <div className="rp-export__what">
                          <p className="rp-sentence">
                            <strong>
                              {o.providerId === null ? 'No vendor named' : (o.name ?? 'A vendor no longer on your list')}
                            </strong>
                          </p>
                          {w.owed && o.owedInvoices + o.owedCreditNotes > 0 && <p className="rp-cap">{w.owed}</p>}
                          {w.notMarked && <p className="rp-cap">{w.notMarked}</p>}
                          {w.earlyCredit && <p className="rp-cap">{w.earlyCredit}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            );
          })()}
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
