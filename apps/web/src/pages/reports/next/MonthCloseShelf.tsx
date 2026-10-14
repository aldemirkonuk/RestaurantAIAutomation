/**
 * Closed months — F-1013, the founder's ruling of 2026-10-11 (sim ledger
 * S195): option C, the snapshot close.
 *
 * An owner or manager closes a month that has ended. The gateway keeps the
 * month's figures as they stood (the till, the cellar's value, what was
 * bought, the count variance, the month's write-offs, and the till's month as
 * a file), and that is the record. Nothing is locked: the books stay editable, and anything changed
 * inside a closed month afterwards is listed here against the record — who,
 * what, by how much. There is no reopen; closing the month again keeps a new
 * version beside the old one.
 *
 * Shown to owners and managers only (the routes refuse anyone else). Its own
 * section under the export shelf, in the shelf's styles.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api/client';
import { AuthContext } from '@/contexts/AuthContext';
import { houseToday } from '@/lib/houseZone';
import { getHouseLocale } from '@/lib/houseCurrency';
import { exportHouseWord } from '@/lib/tableExport';
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

/** One reason's share of the month's write-offs (F-1609). */
export interface MonthCloseWriteOffLine {
  movements: number;
  bottles: number;
  /** At the lots' cost, in the house's money; null when no bottle carried one. */
  cost: number | null;
  uncostedBottles: number;
  /** F-1653: of the uncosted, those at a cost in another money; absent on older closes. */
  otherMoneyBottles?: number;
  /** F-1653: of the costed, those whose cost is not an invoice's; absent on older closes. */
  notInvoicedBottles?: number;
}

export interface MonthCloseWriteOffs extends MonthCloseWriteOffLine {
  byReason: Array<MonthCloseWriteOffLine & { reason: 'breakage' | 'comp' | 'staff_pour' | 'other'; label: string }>;
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
    /** F-1606: gross less net where ingest took tax out; absent on older closes. */
    taxInside?: number | null;
    taxInsideCheckCount?: number | null;
    /** F-1691: the month's tips as money; null when no check carried one; absent on older closes. */
    tips?: number | null;
    tipsCheckCount?: number | null;
    /** Most first; a null server is a check that named no one. */
    tipsByServer?: Array<{ server: string | null; tips: number; checks: number }>;
  };
  /** F-1606: the house day its tax basis was stated; absent on older closes. */
  taxBasisSince?: string | null;
  /** F-1624: each stretch, when the house changed its tax answer inside the month; absent on older closes. */
  taxChangeNote?: string | null;
  /** "KDV", "sales tax" or "tax". */
  taxWord?: string;
  valuation: {
    inventoryValue: number | null;
    pricedInventoryValue: number | null;
    unpricedWines: number | null;
    /** F-1652: wines costed for only some bottles, and those bottles; absent on older closes. */
    partlyCostedWines?: number | null;
    uncostedBottles?: number | null;
    /** F-1654: of the unpriced, wines with a typed-in or order-price cost; absent on older closes. */
    notInvoicedWines?: number | null;
    valuedAt: string;
  };
  purchases: {
    orders: number;
    unpriced: number;
    totals: MonthCloseMoney[];
    /** Delivered in the month, still open (F-1632); absent on a close kept before. */
    awaiting?: { orders: number; totals: MonthCloseMoney[] };
  };
  variance: {
    counts: number;
    netBottles: number;
    shortBottles: number;
    overBottles: number;
    /** F-1544: open bottles, in ml, over the counts that named them; absent on an older close. */
    openMl?: { counts: number; netMl: number; shortMl: number; overMl: number };
  };
  /** F-1609. Absent on a close kept before write-offs were kept: unknown, never none. */
  writeOffs?: MonthCloseWriteOffs;
}

export interface MonthClose {
  id: string;
  month: string;
  version: number;
  closedAt: string;
  closedBy: { id: string; name: string | null } | null;
  zone: string;
  figures: MonthCloseFigures;
  /** F-1606: the house's tax basis when closed; null on a close kept before it was recorded. */
  taxBasis?: string | null;
  hasTillFile: boolean;
}

export interface MonthCloseChange {
  kind: 'till' | 'stock' | 'purchase';
  at: string;
  day: string;
  who: string;
  what: string;
  delta: number | null;
  /** 'ml': a count's open bottles that reached the books after the close (S227). */
  unit: 'bottles' | 'ml' | 'money';
  currency: string | null;
}

export interface MonthCloseAgainstNow {
  figure: 'till_net_sales' | 'till_checks' | 'purchases' | 'variance_net' | 'variance_open_ml' | 'writeoffs_bottles' | 'writeoffs_cost';
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

export interface MonthCloseList {
  closes: MonthClose[];
  /** F-1517: the house's month it opened in (YYYY-MM), the first it can close; null when unknown. */
  openedMonth: string | null;
}

export async function listMonthCloses(): Promise<MonthCloseList> {
  const { data } = await apiClient.get<{ closes: MonthClose[]; openedMonth?: string | null }>(
    '/reports/month-close',
  );
  if (!data || !Array.isArray(data.closes))
    throw new Error('the gateway answered without a list of closed months');
  const opened = data.openedMonth;
  const known = typeof opened === 'string' && /^\d{4}-\d{2}$/.test(opened);
  return { closes: data.closes, openedMonth: known ? opened : null };
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
  houseName: string | null,
): Promise<{ filename: string; mime: string; body: string }> {
  const { data } = await apiClient.get<string>(
    `/reports/month-close/${encodeURIComponent(close.id)}/till.csv`,
    { responseType: 'text', transformResponse: [(raw: unknown) => raw] },
  );
  if (typeof data !== 'string') throw new Error('the gateway answered without the file');
  // Reading the body as text drops the BOM; put it back so Excel reads UTF-8.
  return {
    // Named for its house, as the exports shelf names its files (F-1631).
    filename: `mudavym-${exportHouseWord(houseName)}-till-${close.month}-closed-v${close.version}.csv`,
    mime: 'text/csv;charset=utf-8',
    body: data.startsWith('\uFEFF') ? data : `\uFEFF${data}`,
  };
}

/** The month's write-offs as they were kept at the close (F-1609). */
export async function downloadMonthCloseWriteOffs(
  close: Pick<MonthClose, 'id' | 'month' | 'version'>,
  houseName: string | null,
): Promise<{ filename: string; mime: string; body: string }> {
  const { data } = await apiClient.get<string>(
    `/reports/month-close/${encodeURIComponent(close.id)}/writeoffs.csv`,
    { responseType: 'text', transformResponse: [(raw: unknown) => raw] },
  );
  if (typeof data !== 'string') throw new Error('the gateway answered without the file');
  return {
    filename: `mudavym-${exportHouseWord(houseName)}-writeoffs-${close.month}-closed-v${close.version}.csv`,
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

/**
 * When a month was closed, on the house's clock and in its formats, with the
 * year (F-1692): a December closed in January, and one closed again a year
 * later, must not read alike. Digits only, so the page stays English for a
 * Turkish house (ADR 0207 q7, F-1279), as F-1209 writes /receipts' dates.
 */
function when(iso: string, zone: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return d.toLocaleString(getHouseLocale(), zone ? { ...opts, timeZone: zone } : opts);
  } catch {
    return d.toLocaleString(getHouseLocale(), opts);
  }
}

function signed(text: string, n: number | null): string {
  if (n === null) return EM;
  return n > 0 ? `+${text}` : text;
}

/** By how much, in its own unit: money in its code (null is the house's), bottles as bottles, open bottles in ml. */
function delta(c: Pick<MonthCloseChange, 'delta' | 'unit' | 'currency'>): string {
  if (c.delta === null) return '';
  if (c.unit === 'ml') return signed(`${figure(c.delta)} ml`, c.delta);
  if (c.unit === 'bottles')
    // "-1 bottle", not "-1 bottles": the word follows how many, not the sign.
    return `${c.delta > 0 ? '+' : c.delta < 0 ? '-' : ''}${countOf(Math.abs(c.delta), 'bottle', 'bottles')}`;
  return signed(money(c.delta, 'full', c.currency), c.delta);
}

/**
 * F-1606: which tax basis the month's net was on (ADR 0341: net is made
 * without tax only from the day the house says its prices include it).
 */
export function taxBasisWords(close: MonthClose): string {
  const word = close.figures.taxWord ?? 'tax';
  const since = close.figures.taxBasisSince ?? null;
  const first = `${close.month}-01`;
  const last = `${close.month}-31`;
  // F-1624: the month was not on the answer in force at the close (the note
  // below names each stretch), so this line names that answer, not the month's.
  if (close.figures.taxChangeNote && close.taxBasis) {
    const now =
      close.taxBasis === 'prices_include_tax'
        ? `till prices include ${word}`
        : close.taxBasis === 'prices_exclude_tax'
          ? `till prices do not include ${word}`
          : close.taxBasis === 'not_vat_charging'
            ? `this house charges no ${word}`
            : null;
    if (now) return `Tax basis when this month was closed: ${now}. The month was not all on that answer; see below.`;
  }
  switch (close.taxBasis ?? null) {
    case null:
      return 'Tax basis: not recorded with this close, which was kept before closes recorded it.';
    case 'prices_include_tax':
      if (since === null || since <= first) return `Tax basis: till prices include ${word}, and net is without it.`;
      if (since > last)
        return `Tax basis: net is as the till sent it, with ${word} inside. The house said its prices include ${word} on ${since}, after this month.`;
      return `Tax basis: till prices include ${word}. Net is as the till sent it, with ${word} inside, before ${since}, and without ${word} from that day on.`;
    case 'prices_exclude_tax':
      return `Tax basis: till prices do not include ${word}, so net is before ${word}.`;
    case 'not_vat_charging':
      return `Tax basis: this house charges no ${word}.`;
    default:
      return `Tax basis: not stated when this month was closed, so net is as the till sent it and may hold ${word}.`;
  }
}

/** F-1606: the tax inside the till's prices this month, gross less net. */
function taxInsideWords(close: MonthClose): string | null {
  const t = close.figures.till;
  if (!t.posConnected || t.taxInside === undefined) return null;
  // F-1625: a house that never said its prices include tax gets no line.
  if (t.taxInside === null && close.taxBasis !== 'prices_include_tax') return null;
  const word = close.figures.taxWord ?? 'tax';
  const label = `${word[0].toUpperCase()}${word.slice(1)} inside till prices`;
  if (t.taxInside === null) return `${label}: ${EM}, not recorded: no check this month had it taken out of its price.`;
  const of =
    t.taxInsideCheckCount != null && t.netSalesCheckCount != null && t.taxInsideCheckCount < t.netSalesCheckCount
      ? ` from ${t.taxInsideCheckCount} of ${countOf(t.netSalesCheckCount, 'check', 'checks')}`
      : '';
  return `${label}: ${money(t.taxInside, 'full', close.figures.currency)}${of}`;
}

/** F-1691: the month's tips as money, in total and by who served. Null when the close kept none. */
function Tips({ f }: { f: MonthCloseFigures }) {
  const t = f.till;
  if (t.tips === undefined) return <>not kept with this close; close the month again to keep them</>;
  if (t.tips === null) return <>{EM}, not recorded: no check this month carried a tip</>;
  const of =
    t.tipsCheckCount != null && t.checkCount != null && t.tipsCheckCount < t.checkCount
      ? ` from ${t.tipsCheckCount} of ${countOf(t.checkCount, 'check', 'checks')}; the rest carried no tip amount`
      : '';
  return (
    <>
      {money(t.tips, 'full', f.currency)}
      {of}
      {(t.tipsByServer ?? []).length > 0 && (
        <ul aria-label="Tips by server">
          {(t.tipsByServer ?? []).map((s) => (
            <li key={s.server ?? ''}>
              {s.server ?? 'No server named'}: {money(s.tips, 'full', f.currency)} over{' '}
              {countOf(s.checks, 'check', 'checks')}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "7 bottles, €240 at cost" — the cost said only for what carried one. */
function writtenOff(l: MonthCloseWriteOffLine, currency: string | null): string {
  const bottles = countOf(l.bottles, 'bottle', 'bottles');
  // F-1653: a cost in another money is never added to the house's total.
  const other = l.otherMoneyBottles ?? 0;
  const otherWords = other > 0 ? `; ${countOf(other, 'bottle is', 'bottles are')} at a cost in another money, left out` : '';
  if (l.cost === null) return other > 0 ? `${bottles}, no cost in the house's money${otherWords}` : `${bottles}, no cost recorded`;
  const cost = money(l.cost, 'full', currency);
  const notInvoiced = l.notInvoicedBottles ?? 0;
  const notInvoicedWords =
    notInvoiced > 0
      ? `; ${countOf(notInvoiced, 'bottle is', 'bottles are')} at an order's price or a cost typed in, not an invoice's`
      : '';
  return (
    (l.uncostedBottles > 0
      ? `${bottles}, ${cost} at cost for ${l.bottles - l.uncostedBottles} of them`
      : `${bottles}, ${cost} at cost`) +
    notInvoicedWords +
    otherWords
  );
}

/**
 * F-1652 / F-1654: what the priced cellar total leaves out, in the owner's
 * words: wines with no cost at all, wines whose cost the house typed in or
 * took from an order (no invoice, so the close does not count it), and
 * bottles of wines costed only in part.
 */
function cellarGaps(v: MonthCloseFigures['valuation']): string {
  const unpriced = v.unpricedWines ?? 0;
  const typed = Math.min(v.notInvoicedWines ?? 0, unpriced);
  const none = unpriced - typed;
  const part = v.partlyCostedWines ?? 0;
  return [
    none > 0 ? `${countOf(none, 'wine has', 'wines have')} no cost` : null,
    typed > 0
      ? `${countOf(typed, 'wine has', 'wines have')} a cost typed in by the house or an order's price, not invoiced, so ${typed === 1 ? 'it is' : 'they are'} left out`
      : null,
    part > 0
      ? `${countOf(v.uncostedBottles ?? 0, 'bottle', 'bottles')} of ${countOf(part, 'wine', 'wines')} costed only in part ${(v.uncostedBottles ?? 0) === 1 ? 'has' : 'have'} no cost`
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join('; ');
}

function gapsAfter(v: MonthCloseFigures['valuation']): string {
  const gaps = cellarGaps(v);
  return gaps ? `; ${gaps}` : '';
}

/** F-1609: the month's write-offs, with their cost and count, by reason. */
function WriteOffs({ f }: { f: MonthCloseFigures }) {
  const w = f.writeOffs;
  if (!w) return <>not kept with this close; close the month again to keep it</>;
  if (w.movements === 0) return <>nothing written off in the month</>;
  return (
    <>
      {writtenOff(w, f.currency)} over {countOf(w.movements, 'take-off', 'take-offs')}
      <ul aria-label="Written off by reason">
        {w.byReason.map((r) => (
          <li key={r.reason}>
            {r.label}: {writtenOff(r, f.currency)}
          </li>
        ))}
      </ul>
    </>
  );
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
      {taxInsideWords(close) !== null && <li>{taxInsideWords(close)}</li>}
      {f.till.posConnected && (
        <li>
          Tips: <Tips f={f} />
        </li>
      )}
      <li>{taxBasisWords(close)}</li>
      {close.figures.taxChangeNote && <li data-testid="close-tax-change-note">{close.figures.taxChangeNote}</li>}
      <li>
        Bought (delivered): {bought}
        {f.purchases.unpriced > 0 ? `, and ${countOf(f.purchases.unpriced, 'order', 'orders')} with no price` : ''}
        {/* F-1632: a delivery still open is said, never silently left out. */}
        {f.purchases.awaiting && f.purchases.awaiting.orders > 0
          ? `. Not in it: ${countOf(f.purchases.awaiting.orders, 'order', 'orders')} delivered but still open (part still to come, or the invoice not checked yet)${
              f.purchases.awaiting.totals.length
                ? `, ${f.purchases.awaiting.totals.map((t) => money(t.total, 'full', t.currency ?? f.currency)).join(' + ')} at order total`
                : ''
            }; counted once closed`
          : ''}
      </li>
      <li>
        Count variance:{' '}
        {f.variance.counts === 0
          ? 'no shelf counts in the month'
          : `${countOf(f.variance.shortBottles, 'bottle', 'bottles')} short, ${countOf(f.variance.overBottles, 'bottle', 'bottles')} over`}
      </li>
      {/* F-1544 (F3 a): said only when a count named its open bottles. */}
      {f.variance.openMl && f.variance.openMl.counts > 0 && (
        <li>
          Open bottles counted: {figure(f.variance.openMl.shortMl)} ml short, {figure(f.variance.openMl.overMl)} ml over
        </li>
      )}
      <li>
        Written off: <WriteOffs f={f} />
      </li>
      <li>
        Cellar value when closed:{' '}
        {f.valuation.inventoryValue !== null
          ? money(f.valuation.inventoryValue, 'full', f.currency)
          : f.valuation.pricedInventoryValue !== null
            ? `${money(f.valuation.pricedInventoryValue, 'full', f.currency)} for the priced bottles${gapsAfter(f.valuation)}`
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
            a.figure === 'variance_open_ml'
              ? v === null
                ? figure(v)
                : `${figure(v)} ml`
              : a.figure === 'till_checks' || a.figure === 'variance_net' || a.figure === 'writeoffs_bottles'
                ? figure(v)
                : money(v, 'full', a.currency);
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

function Row({
  close,
  zone,
  latest,
  houseName,
}: {
  close: MonthClose;
  zone: string | null;
  latest: boolean;
  houseName: string | null;
}) {
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
        {/* F-1578: the kept file is the export shelf's till file, gross check
            totals, while the figure above is net; say so beside the two. */}
        {close.hasTillFile && (
          <p className="rp-cap">
            The Till CSV is the check totals as your till sent them. On most tills that includes tax
            and tips, so it reads higher than the net sales above.
          </p>
        )}
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
                const file = await downloadMonthCloseTill(close, houseName);
                saveFile(file.filename, file.mime, file.body);
              } catch (err) {
                setError(`The till file did not download: ${reasonOf(err)}`);
              }
            }}
          >
            Till CSV
          </button>
        )}
        {close.figures.writeOffs && (
          <button
            type="button"
            className="rp-mini rp-ink rp-focus"
            aria-label={`Download the write-offs of ${monthLabel(close.month)} as closed`}
            onClick={async () => {
              setError(null);
              try {
                const file = await downloadMonthCloseWriteOffs(close, houseName);
                saveFile(file.filename, file.mime, file.body);
              } catch (err) {
                setError(`The write-offs file did not download: ${reasonOf(err)}`);
              }
            }}
          >
            Write-offs CSV
          </button>
        )}
      </div>
    </li>
  );
}

export default function MonthCloseShelf({ restaurantId, zone }: MonthCloseShelfProps) {
  const qc = useQueryClient();
  const lastMonth = monthBefore(thisMonth(houseToday(zone)));
  const houseName =
    useContext(AuthContext)?.availableRestaurants?.find((b) => b.id === restaurantId)?.name ?? null;
  const [chosen, setMonth] = useState<string | null>(null);
  const key = ['month-closes', restaurantId];
  const list = useQuery({ queryKey: key, queryFn: listMonthCloses });
  const close = useMutation({
    mutationFn: (m: string) => closeMonth(m),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const failure = failureOf(list.error);
  const closes = list.data?.closes;
  // F-1517: no month before the house opened can be closed, and a house
  // opened this month has none to close yet, so none is preselected for it.
  const opened = list.data?.openedMonth ?? null;
  const noneYet = opened !== null && opened > lastMonth;
  const month = chosen ?? (noneYet ? '' : lastMonth);
  const seen = new Set<string>();
  // F-1513: a /logs month-close line links here (`/reports#rp-month-close`);
  // the router does not scroll to a hash, so the shelf brings itself in.
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.location.hash === '#rp-month-close') self.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  return (
    <section ref={self} id="rp-month-close" className="rp-exports" aria-labelledby="rp-month-close-title">
      <div className="rp-exports__head">
        <div>
          <h2 id="rp-month-close-title" className="rp-cut__title">
            Closed months
          </h2>
          <p className="rp-cap">
            Closing a month keeps its figures as they stand today: the till’s net sales, what was
            bought, the count variance, what was written off and the cellar’s value. Nothing is locked. If anything dated
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
              min={opened ?? undefined}
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

      {noneYet && opened && (
        <p className="rp-cap">
          This house opened in {monthLabel(opened)}. Its first month can be closed once{' '}
          {monthLabel(opened)} has ended.
        </p>
      )}

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
            return <Row key={c.id} close={c} zone={zone} latest={latest} houseName={houseName} />;
          })}
        </ul>
      )}
    </section>
  );
}
