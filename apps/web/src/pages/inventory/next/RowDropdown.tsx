/**
 * One opened /inventory row — sketch INV-W4 frame 1, "the dropdown".
 *
 * NON-MODAL AND FORMLESS (ADR 0112 F8). Nothing in here is a field: the
 * dropdown shows, and each write it can start opens its own sealed sheet
 * (InventorySheets.tsx). That is the founder's 08-29 verdict on makeover B
 * (MAKEOVER-VERDICTS.md:66-73): the dropdown "shows everything", in place.
 *
 * Its reads happen on the gesture, not on the page: the ledger's last
 * purchases and their paper (`useRowDetail`), and the till lines /cellar
 * already reads for one row (`useRowRecord`), drawn with /cellar's own
 * clipped helpers (rowSeries.ts) so there is one velocity on two pages, not
 * a third copy with a fixed 16:00–23:00 window.
 *
 * Every link out goes where the target page actually opens: /receipts reads
 * `?doc=` and `?tab=credits` (ReceiptsNext.tsx:1319-1344), /orders reads
 * `?order=` (OrdersNext.tsx:132). Receipts has no link to one LINE of an
 * invoice and no filter by title, and the copy says so instead of pretending.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Popover } from '@/components/mudavym';
import type { ProcurementDocument } from '../../../services/api/documents';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import { fmtWhen } from '../../../lib/mudavym/format';
import { shortDate, volume } from '../../cellar/next/cellar-format';
import { useRowRecord } from '../../cellar/next/useCellarNextData';
import { velocity, whenItSells, type TillLine } from '../../cellar/next/rowSeries';
import { CountSheet, OrderSheet, PourSheet, TransferSheet, WriteOffSheet } from './InventorySheets';
import {
  cellMoney,
  EM,
  fmtCount,
  fmtPace,
  sold30,
  suggestedToPar,
  useRowDetail,
  type HouseCurrency,
  type InvRow,
  type PaperRead,
  type PurchaseLine,
} from './useInventoryNextData';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface RowDropdownProps {
  row: InvRow;
  canManage: boolean;
  currency: HouseCurrency;
  zoneName: (id: string | null) => string;
  locations: StorageLocation[];
  locationsUnavailable: boolean;
  providers: Provider[] | null;
  providersError: string | null;
  restaurantId: string | null;
}

type SheetId = 'count' | 'order' | 'writeoff' | 'transfer' | 'pour';

function KV({ k, children, testId }: { k: string; children: ReactNode; testId?: string }) {
  return (
    <div className="iv-kv" data-testid={testId}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function figure(v: number | null): string {
  return v === null ? EM : fmtCount(v);
}

/** The invoice among an order's paper, else whatever was filed first. */
function invoiceOf(docs: ProcurementDocument[]): ProcurementDocument | null {
  return docs.find((d) => d.doc_type === 'invoice') ?? docs[0] ?? null;
}

export default function RowDropdown(props: RowDropdownProps) {
  const { row, canManage, currency, zoneName } = props;
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const detail = useRowDetail(row.id);

  const head: { k: string; v: ReactNode }[] = [];
  if (row.name) head.push({ k: 'House name', v: row.name });
  if (row.libraryName) head.push({ k: 'On the library as', v: <em>{row.libraryName}</em> });
  if (row.grape) head.push({ k: 'Grape', v: row.grape });
  if (row.bottleSizeMl !== null) head.push({ k: 'Format', v: volume(row.bottleSizeMl) });
  if (row.vintage !== null) head.push({ k: 'Vintage', v: String(row.vintage) });
  // open_ml is what is LEFT in the open bottle: each pour subtracts from it
  // (inventory_lots.open_bottle_ml), as the legacy row says ("ml left").
  if (row.openMl !== null && row.openMl > 0) head.push({ k: 'Open bottle', v: `${fmtCount(row.openMl)} ml left` });

  return (
    <div className="iv-drop" data-testid="row-dropdown" aria-label={`${row.name ?? 'This title'}, opened`}>
      {head.length > 0 ? (
        <dl className="iv-head-facts">
          {head.map((h) => (
            <KV key={h.k} k={h.k}>
              {h.v}
            </KV>
          ))}
        </dl>
      ) : null}

      <div className="iv-drop-cols">
        <WhereTheCountComesFrom row={row} zoneName={zoneName} onCount={() => setSheet('count')} />
        <HowFastItPours row={row} />
        <WhatItHasCost row={row} currency={currency} detail={detail} />
      </div>

      <Paperwork detail={detail} currency={currency} providers={props.providers} />

      <div className="iv-actions" role="group" aria-label="What to do with this title">
        <button type="button" className="iv-btn iv-focus" onClick={() => setSheet('count')}>
          Record a count
        </button>
        <button type="button" className="iv-btn iv-focus" data-seal="true" onClick={() => setSheet('order')}>
          Order more
        </button>
        {canManage ? (
          <button type="button" className="iv-btn iv-focus" onClick={() => setSheet('writeoff')}>
            Write off
          </button>
        ) : null}
        <button
          ref={moreRef}
          type="button"
          className="iv-btn iv-focus"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          More
        </button>
        <Popover
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          anchorRef={moreRef}
          width={220}
          label="More things to do with this title: move bottles between zones, or record a pour by hand"
        >
          <div className="iv-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="iv-menu-item iv-focus"
              onClick={() => {
                setMoreOpen(false);
                setSheet('transfer');
              }}
            >
              Transfer between zones
            </button>
            <button
              type="button"
              role="menuitem"
              className="iv-menu-item iv-focus"
              onClick={() => {
                setMoreOpen(false);
                setSheet('pour');
              }}
            >
              Record a pour
            </button>
          </div>
        </Popover>
      </div>

      {sheet === 'count' ? <CountSheet row={row} onClose={() => setSheet(null)} /> : null}
      {sheet === 'order' ? (
        <OrderSheet
          row={row}
          onClose={() => setSheet(null)}
          providers={props.providers}
          providersError={props.providersError}
          restaurantId={props.restaurantId}
        />
      ) : null}
      {sheet === 'writeoff' && canManage ? <WriteOffSheet row={row} onClose={() => setSheet(null)} /> : null}
      {sheet === 'transfer' ? (
        <TransferSheet
          row={row}
          onClose={() => setSheet(null)}
          locations={props.locations}
          locationsUnavailable={props.locationsUnavailable}
        />
      ) : null}
      {sheet === 'pour' ? <PourSheet row={row} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

/* ── column 1 ──────────────────────────────────────────────────────────── */

function WhereTheCountComesFrom({
  row,
  zoneName,
  onCount,
}: {
  row: InvRow;
  zoneName: (id: string | null) => string;
  onCount: () => void;
}) {
  const toPar = suggestedToPar(row);
  const zones = row.zones?.filter((z) => z.qty > 0) ?? null;
  return (
    <section className="iv-col">
      <h4 className="iv-sec">Where the count comes from</h4>
      <dl>
        <KV k="Live, till-verified" testId="drop-live">
          <span className="iv-num">{figure(row.stock)}</span>
        </KV>
        <KV k="Shadow, awaiting reconcile">
          <span className="iv-num">{figure(row.shadow)}</span>
        </KV>
        <KV k="Par · reorder point">
          <span className="iv-num">
            {row.par === null ? EM : row.par === 0 ? 'none set' : fmtCount(row.par)} · {figure(row.reorderPoint)}
          </span>
        </KV>
        <KV k="Suggested to par">
          {/* — is kept for a figure that could not be read (the footer's
              promise). A title at or above par, or with no par, is read and
              says so. */}
          {toPar !== null ? (
            <span className="iv-num">{fmtCount(toPar)}</span>
          ) : row.stock === null ? (
            <span className="iv-num">{EM}</span>
          ) : row.par === null || row.par <= 0 ? (
            'no par set'
          ) : (
            'none, at or above par'
          )}
        </KV>
        <KV k="Where">
          {zones === null
            ? 'could not be read'
            : zones.length === 0
              ? 'in no zone'
              : zones.map((z) => `${zoneName(z.locationId)} ${fmtCount(z.qty)}`).join(' · ')}
        </KV>
        <KV k="Last counted">{row.lastCountedAt ? fmtWhen(row.lastCountedAt) : 'never counted'}</KV>
      </dl>
      <button type="button" className="iv-linkish iv-focus" onClick={onCount}>
        Record a count
      </button>
    </section>
  );
}

/* ── column 2 ──────────────────────────────────────────────────────────── */

function HowFastItPours({ row }: { row: InvRow }) {
  const record = useRowRecord(row.name);
  const pos = record.data?.books.find((b) => b.book === 'pos') ?? null;
  const tillLines: TillLine[] = useMemo(
    () => (pos?.readable ? pos.ledger : []).map((l) => ({ at: l.at, qty: l.qty, unitPrice: l.unitPrice })),
    [pos],
  );
  const vel = useMemo(() => velocity(tillLines), [tillLines]);
  const hours = useMemo(() => whenItSells(tillLines), [tillLines]);
  const maxDay = Math.max(1, ...vel.days.map((d) => d.qty));
  const maxHour = Math.max(1, ...hours.buckets.map((b) => b.qty));

  const sentence = !row.analyticsReadable
    ? 'Selling pace could not be read — the sales figures did not answer for this read. This is a read error, not a title with nothing sold.'
    : row.velocity === null
      ? 'Selling pace: unmeasured — the analytics have nothing for this title yet.'
      : row.velocity === 0
        ? 'Nothing sold lately, so there is no runway to give.'
        : `About ${fmtPace(row.velocity)} a day (${fmtCount(sold30(row.velocity))} sold in the last 30 days)${row.runway === null ? '.' : `; at that pace it lasts ${fmtCount(Math.round(row.runway))} day${Math.round(row.runway) === 1 ? '' : 's'}.`}`;

  return (
    <section className="iv-col">
      <h4 className="iv-sec">How fast it pours</h4>
      <p className="iv-said">{sentence}</p>
      {record.loading ? (
        <p className="iv-note">Reading the till…</p>
      ) : record.error ? (
        <p className="iv-note">The till could not be read. This is unread, not a quiet night.</p>
      ) : vel.days.length === 0 ? (
        <p className="iv-note" data-testid="velocity-none">
          {/* The pace above is the ledger's live sales over 30 days
              (inventory_analytics). The day chart reads the till book, which
              holds only wine lines the till could not match, so an empty chart
              never means "never sold". Say what each one is, never "none". */}
          {pos?.readable === false
            ? 'The till could not be read. This is unread, not a quiet night.'
            : row.velocity !== null && row.velocity > 0
              ? 'That pace is the last 30 days of sales on the books. The day-by-day chart is not drawn for this title yet.'
              : row.velocity === 0
                ? 'No day-by-day chart either: no sales on the books in the last 30 days.'
                : 'No day-by-day chart either.'}
        </p>
      ) : (
        <>
          <div className="iv-bars" role="img" aria-label={`Sold per day from ${vel.from} to ${vel.to}`}>
            {vel.days.map((d) => (
              <i
                key={d.date}
                title={`${d.date}: ${fmtCount(d.qty)}`}
                data-peak={d.qty >= maxDay * 0.75 ? 'true' : undefined}
                style={{ height: `${Math.max((d.qty / maxDay) * 100, 4)}%` }}
              />
            ))}
          </div>
          <div className="iv-barscale">
            <span>{vel.from}</span>
            <span>{vel.to}</span>
          </div>
          <p className="iv-note">
            {vel.days.length} day{vel.days.length === 1 ? '' : 's'} of evidence{vel.clipped ? ', capped at the last 14' : ''}.
            Days before the first till line are not drawn as zeroes.
          </p>
          {hours.buckets.length > 0 ? (
            <>
              <div className="iv-heat" style={{ gridTemplateColumns: `28px repeat(${hours.hours.length}, 1fr)` }}>
                <span />
                {hours.hours.map((h) => (
                  <span key={`h${h}`} className="iv-heat-h">
                    {h}
                  </span>
                ))}
                {DOW.map((label, dow) => [
                  <span key={`l${dow}`} className="iv-heat-d">
                    {label}
                  </span>,
                  ...hours.hours.map((h) => {
                    const b = hours.buckets.find((x) => x.dow === dow && x.hour === h);
                    return (
                      <span
                        key={`${dow}-${h}`}
                        className="iv-heat-c"
                        title={`${label} ${h}:00 — ${b?.qty ?? 0}`}
                        style={{ opacity: b ? 0.18 + (b.qty / maxHour) * 0.82 : 0 }}
                      />
                    );
                  }),
                ])}
              </div>
              <p className="iv-note">
                {hours.peak ? `Busiest: ${DOW[hours.peak.dow]} at ${hours.peak.hour}:00. ` : ''}Only the hours this house
                has sold in are drawn.
              </p>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ── column 3 ──────────────────────────────────────────────────────────── */

function WhatItHasCost({
  row,
  currency,
  detail,
}: {
  row: InvRow;
  currency: HouseCurrency;
  detail: ReturnType<typeof useRowDetail>;
}) {
  const priced = (detail.purchases ?? []).filter((l) => l.unitCost !== null);
  const last = priced[0] ?? null;
  const before = priced[1] ?? null;
  const unread = detail.purchasesError !== null;
  const reading = detail.purchases === null && !unread;
  const bought = (l: PurchaseLine | null) =>
    reading ? EM : unread ? 'could not be read' : l === null ? 'none on the ledger' : `${cellMoney(l.unitCost, currency)} · ${shortDate(l.at)}`;
  const change =
    last && before && last.unitCost !== null && before.unitCost !== null && before.unitCost > 0
      ? ((last.unitCost - before.unitCost) / before.unitCost) * 100
      : null;
  const margin = row.bottle !== null && row.bottle > 0 && row.wac !== null ? ((row.bottle - row.wac) / row.bottle) * 100 : null;

  return (
    <section className="iv-col">
      <h4 className="iv-sec">What it has cost</h4>
      <dl>
        <KV k="Weighted average cost">
          <span className="iv-num">{cellMoney(row.wac, currency)}</span>
          {row.wac !== null && row.costProvenance ? <span className="iv-dim"> · {row.costProvenance === 'invoice' ? 'from invoices' : 'estimated'}</span> : null}
        </KV>
        <KV k="Last bought">{bought(last)}</KV>
        <KV k="Before that">{bought(before)}</KV>
        <KV k="Was → now">
          {change === null || !last || !before ? (
            EM
          ) : (
            <span className="iv-num">
              {cellMoney(before.unitCost, currency)} → {cellMoney(last.unitCost, currency)} ({change > 0 ? '+' : ''}
              {change.toFixed(0)}%)
            </span>
          )}
        </KV>
        <KV k="Your price">
          <span className="iv-num">
            {cellMoney(row.bottle, currency)} · {cellMoney(row.glass, currency)}
          </span>
        </KV>
        <KV k="Margin over cost">
          <span className="iv-num">{margin === null ? EM : `${margin.toFixed(0)}%`}</span>
        </KV>
        <KV k="Market">
          {EM} <span className="iv-dim">no market price is read</span>
        </KV>
        <KV k="Auction lots">
          {detail.lotsError ? (
            <>
              could not be read{' '}
              <button type="button" className="iv-linkish iv-focus" onClick={detail.rereadLots}>
                Read again
              </button>
            </>
          ) : detail.lots === null
              ? EM
              : detail.lots.length === 0
                ? 'none'
                : `${detail.lots.length} lot${detail.lots.length === 1 ? '' : 's'}, the latest sold ${shortDate(
                    detail.lots.map((l) => l.saleDate).sort().at(-1) ?? null,
                  )}`}
        </KV>
      </dl>
    </section>
  );
}

/* ── paperwork ─────────────────────────────────────────────────────────── */

function PaperActions({ line, paper }: { line: PurchaseLine; paper: PaperRead | undefined }) {
  if (!line.orderId) return <span className="iv-dim">Not tied to an order, so there is no paper to find.</span>;
  if (!paper || (paper.docs === null && paper.failed === null)) return <span className="iv-dim">Reading the paper…</span>;
  if (paper.failed) return <span className="iv-dim">The paper could not be read.</span>;
  const doc = invoiceOf(paper.docs ?? []);
  if (!doc) return <span className="iv-dim">No invoice filed for this delivery.</span>;
  return (
    <span className="iv-paper-acts">
      {doc.status === 'needs_review' ? (
        <Link className="iv-linkish iv-focus" to={`/receipts?doc=${encodeURIComponent(doc.id)}`}>
          Match this line
        </Link>
      ) : (
        <Link className="iv-linkish iv-focus" to={`/receipts?doc=${encodeURIComponent(doc.id)}`}>
          Open the invoice line
        </Link>
      )}
      {doc.ties_out === false ? (
        <Link className="iv-linkish iv-focus" to="/receipts?tab=credits">
          Claim a credit
        </Link>
      ) : null}
    </span>
  );
}

function Paperwork({
  detail,
  currency,
  providers,
}: {
  detail: ReturnType<typeof useRowDetail>;
  currency: HouseCurrency;
  providers: Provider[] | null;
}) {
  const vendorOf = (paper: PaperRead | undefined) => {
    const id = paper?.docs ? invoiceOf(paper.docs)?.provider_id : null;
    if (!id) return EM;
    return providers?.find((p) => p.id === id)?.name ?? EM;
  };
  return (
    <section className="iv-paperwork">
      <h4 className="iv-sec">Paperwork</h4>
      {detail.purchasesError ? (
        <p className="iv-note">
          The receipts could not be read. This is unread, not a title never bought.{' '}
          <button type="button" className="iv-linkish iv-focus" onClick={detail.rereadPurchases}>
            Read again
          </button>
        </p>
      ) : detail.purchases === null ? (
        <p className="iv-note">Reading the receipts…</p>
      ) : detail.purchases.length === 0 ? (
        <p className="iv-note">No delivery of this title is on the ledger.</p>
      ) : (
        <>
          <table className="iv-papertable">
            <thead>
              <tr>
                <th>Received</th>
                <th>Vendor</th>
                <th>Order</th>
                <th>At the door</th>
                <th>Unit</th>
                <th>Invoice</th>
                <th>
                  <span className="iv-sr">What to do</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.purchases.map((line) => {
                const paper = line.orderId ? detail.paper.get(line.orderId) : undefined;
                const doc = paper?.docs ? invoiceOf(paper.docs) : null;
                return (
                  <tr key={line.id}>
                    <td data-label="Received">{shortDate(line.at)}</td>
                    <td data-label="Vendor">{vendorOf(paper)}</td>
                    <td data-label="Order">
                      {line.orderId ? (
                        <Link className="iv-linkish iv-focus" to={`/orders?order=${encodeURIComponent(line.orderId)}`}>
                          Open the order
                        </Link>
                      ) : (
                        EM
                      )}
                    </td>
                    <td data-label="At the door" className="iv-num">
                      {line.qty === null ? EM : fmtCount(line.qty)}
                    </td>
                    <td data-label="Unit" className="iv-num">
                      {cellMoney(line.unitCost, currency)}
                    </td>
                    <td data-label="Invoice">{doc ? (doc.doc_number ?? 'filed, no number') : EM}</td>
                    <td>
                      <PaperActions line={line} paper={paper} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="iv-note">
            Receipts opens at the invoice, not the line: it has no link to one line yet.{' '}
            <Link className="iv-linkish iv-focus" to="/receipts">
              All {detail.purchasesTotal ?? detail.purchases.length} receipts of this title
            </Link>{' '}
            — Receipts cannot filter by title yet, so this opens the whole list.
          </p>
        </>
      )}
    </section>
  );
}
