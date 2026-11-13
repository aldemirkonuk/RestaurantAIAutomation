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
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRestaurantSettingsStore } from '../../../stores/restaurantSettingsStore';
import { formatVolume } from '../../../utils/volumeUtils';
import { Popover } from '@/components/mudavym';
import { RemoveFromInventoryModal } from '../../../components/inventory/RemoveFromInventoryModal';
import { reconcileItem, updateInventoryItem } from '../../../services/api/inventory';
import { queryKeys } from '../../../lib/query-keys';
import type { InventoryItem } from '../useInventoryPage';
import type { ProcurementDocument } from '../../../services/api/documents';
import type { Provider } from '../../../services/api/providers';
import type { StorageLocation } from '../../../hooks/useStorageLocations';
import { fmtWhen } from '../../../lib/mudavym/format';
import { shortDate, volume } from '../../cellar/next/cellar-format';
import { useRowRecord } from '../../cellar/next/useCellarNextData';
import { velocity, whenItSells, type TillLine } from '../../cellar/next/rowSeries';
import { CountSheet, OrderSheet, PourSheet, TransferSheet, WriteOffSheet } from './InventorySheets';
import { writeFailure } from './iv-failure';
import { oneLine, rowFilename, runExport, valuationColumns } from './iv-export';
import {
  cellMoney,
  EM,
  fmtCount,
  fmtPace,
  noZoneWord,
  sold30,
  suggestedToPar,
  useRowDetail,
  type HouseCurrency,
  type InvRow,
  type PaperRead,
  type PurchaseLine,
} from './useInventoryNextData';
import { NameThisWine } from './NameThisWine';

type ReconcileFigures = { live: number; shadow: number };
const HOLDS = new WeakMap<QueryClient, Map<string, ReconcileFigures[]>>();
const WHY = new WeakMap<QueryClient, Map<string, 'landed' | 'unknown'>>();
function reconcileHolds(qc: QueryClient): Map<string, ReconcileFigures[]> {
  let m = HOLDS.get(qc);
  if (!m) HOLDS.set(qc, (m = new Map()));
  return m;
}
function reconcileWhy(qc: QueryClient): Map<string, 'landed' | 'unknown'> {
  let m = WHY.get(qc);
  if (!m) WHY.set(qc, (m = new Map()));
  return m;
}

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

/**
 * Why "Remove from inventory" cannot start for this row, or null when it can.
 * The remove modal (shared with the legacy page) reconciles live, shadow and
 * the open bottle to zero before it soft-deletes, and it reads a missing figure
 * as 0. A figure this page did not read would therefore be removed without its
 * ledger row, so the act waits until the book says what is held.
 */
export function removeBlocked(row: InvRow): string | null {
  if (row.stock === null || row.shadow === null || row.openMl === null)
    return 'the book did not say how many are held, so it cannot be zeroed first';
  if (row.wineId === null) return 'this row is not tied to a library title, so its stock cannot be zeroed first';
  return null;
}

/**
 * Why "Mark inactive" cannot start for this row, or null when it can. An
 * inactive row keeps its stock_live; a title brought back later is a new row
 * beside it, so stock left on the inactive one falls out of the book unseen
 * (security review, 2026-10-31). Only an empty row may be marked inactive.
 */
export function inactiveBlocked(row: InvRow): string | null {
  if (row.stock === null || row.shadow === null || row.openMl === null)
    return 'the book did not say how many are held. Count it to zero or remove it first';
  if (row.stock > 0 || row.shadow > 0 || row.openMl > 0) return 'bottles are still held. Count it to zero or remove it first';
  return null;
}

/** The row in the remove modal's shape: only the fields it reads, all read from the book. */
export function removeTarget(row: InvRow): InventoryItem {
  return {
    id: row.wineId ?? '',
    inventoryId: row.id,
    name: row.name ?? 'This title',
    liveStock: row.stock,
    shadowStock: row.shadow ?? undefined,
    openMl: row.openMl ?? undefined,
    wac: row.wac ?? undefined,
  } as unknown as InventoryItem;
}

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
/** INV-W36: `role="menu"` promises the menu keys, so the More menu keeps that
 *  promise. ArrowDown and ArrowUp step through the items and wrap; Home and End
 *  jump to the first and last. Tab leaves the menu: focus goes back to More
 *  first, the menu closes, and the browser's own Tab then moves on from More.
 *  Without that, focus left a menu that stayed open, and because the menu is
 *  drawn at the end of the page, Tab jumped to the top of it. */
function onMenuKeys(e: KeyboardEvent<HTMLElement>, opener: HTMLElement | null, close: () => void): void {
  if (e.key === 'Tab') {
    opener?.focus();
    close();
    return;
  }
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  let next: HTMLElement;
  if (e.key === 'ArrowDown') next = items[at === last ? 0 : at + 1];
  else if (e.key === 'ArrowUp') next = items[at <= 0 ? last : at - 1];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items[last];
  else return;
  e.preventDefault();
  next.focus();
}

function invoiceOf(docs: ProcurementDocument[]): ProcurementDocument | null {
  return docs.find((d) => d.doc_type === 'invoice') ?? docs[0] ?? null;
}

export default function RowDropdown(props: RowDropdownProps) {
  const { row, canManage, currency, zoneName } = props;
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const detail = useRowDetail(row.id);
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const blocked = removeBlocked(row);
  // Only marking INACTIVE is held back; marking a row active again never strands stock.
  const toggleBlocked = row.active === true ? inactiveBlocked(row) : null;
  const title = row.name ?? 'This title';
  const unit = useRestaurantSettingsStore((st) => st.measurementUnit);

  // Mark inactive / active: the legacy page's toggleActive
  // (InventoryCommandPage.tsx:345), the same PATCH /inventory/:rid/item/:id.
  // The book lists active titles only (database.service getRestaurantInventory
  // filters is_active), so a row marked inactive leaves the list.
  const toggleActive = async () => {
    if (row.active === null || toggling || toggleBlocked !== null) return;
    const next = !row.active;
    setMoreOpen(false);
    setToggling(true);
    try {
      await updateInventoryItem(row.id, { isActive: next }, props.restaurantId ?? undefined);
      toast.success(
        next ? `${title} marked active` : `${title} marked inactive. The book lists active titles only, so it leaves this list.`,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    } catch (e) {
      const f = writeFailure(e, {
        refused: 'Nothing changed',
        act: `${title} was marked ${next ? 'active' : 'inactive'}`,
        check: 'Re-read the book before trying again.',
      });
      if (f.unknown) void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      toast.error(f.text);
    } finally {
      setToggling(false);
    }
  };

  // "Reconcile N into live": the legacy expansion's one tap (RowExpansion.tsx:207-214),
  // the same POST /inventory-ledger/inventory/:id/reconcile with the count set to
  // live + shadow. Held back while either figure is unread, since the sum would be a guess.
  //
  // The route sets LIVE to an absolute count and never touches the shadow lots
  // (record_stock_count), so a landed tap leaves live = L+S with shadow still S and
  // the row still offering the tap; each further tap would add S again. Once a tap
  // has landed, or its outcome is unknown, it is held for this title while the row
  // reads the figures from before or after that tap, and comes back only when live
  // or shadow read differently. The hold lives with the page's query client, so it
  // outlasts closing and reopening the row, but not a reload.
  const [reconciling, setReconciling] = useState(false);
  const [, bumpHold] = useState(0);
  const hold = reconcileHolds(queryClient).get(row.id);
  const held =
    hold !== undefined &&
    row.stock !== null &&
    row.shadow !== null &&
    hold.some((f) => f.live === row.stock && f.shadow === row.shadow);
  const canReconcile =
    row.stock !== null && row.shadow !== null && row.shadow > 0 && row.wineId !== null && !reconciling && !held;
  const reconcileShadow = async () => {
    if (!canReconcile || row.stock === null || row.shadow === null || row.wineId === null) return;
    const before = { live: row.stock, shadow: row.shadow };
    const total = row.stock + row.shadow;
    const holdIt = (landed: boolean) => {
      reconcileHolds(queryClient).set(row.id, [before, { live: total, shadow: before.shadow }]);
      reconcileWhy(queryClient).set(row.id, landed ? 'landed' : 'unknown');
      bumpHold((n) => n + 1);
    };
    setMoreOpen(false);
    setReconciling(true);
    try {
      await reconcileItem(row.id, { wineId: row.wineId, actualCount: total, notes: 'Shadow reconciled into live' });
      holdIt(true);
      toast.success(`${title}: live set to ${fmtCount(total)}, the shadow bottles counted in.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    } catch (e) {
      const f = writeFailure(e, {
        refused: 'Nothing was reconciled',
        act: 'live was set to the count with the shadow bottles in it',
        check: 'Re-read the book before trying again.',
      });
      if (f.unknown) {
        holdIt(false);
        void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      }
      toast.error(f.text);
    } finally {
      setReconciling(false);
    }
  };
  const holdWhy = held ? reconcileWhy(queryClient).get(row.id) : undefined;

  const copyName = async () => {
    setMoreOpen(false);
    try {
      await navigator.clipboard.writeText(oneLine(row.name ?? 'Unnamed title'));
      toast.success('Name copied');
    } catch {
      toast.error('Could not copy to the clipboard.');
    }
  };

  const head: { k: string; v: ReactNode }[] = [];
  if (row.name) head.push({ k: 'House name', v: row.name });
  if (row.libraryName) head.push({ k: 'On the library as', v: <em>{row.libraryName}</em> });
  if (row.grape) head.push({ k: 'Grape', v: row.grape });
  // The house's measurement unit, as the legacy row reads it (RowExpansion.tsx:69,172).
  if (row.bottleSizeMl !== null)
    head.push({ k: 'Format', v: unit === 'oz' && row.bottleSizeMl > 0 ? formatVolume(row.bottleSizeMl, 'oz') : volume(row.bottleSizeMl) });
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

      <NameThisWine inventoryId={row.id} currentName={row.name} restaurantId={props.restaurantId} />

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
          label="More things to do with this title: move bottles between zones, record a pour by hand, reconcile shadow into live, export or copy it, mark it inactive, or remove it from inventory"
        >
          <div className="iv-menu" role="menu" onKeyDown={(e) => onMenuKeys(e, moreRef.current, () => setMoreOpen(false))}>
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
            {row.shadow !== null && row.shadow > 0 && held ? (
              <p className="iv-note" role="note" data-testid="reconcile-held">
                {holdWhy === 'landed'
                  ? 'Reconcile is done for now: live was already set with the shadow bottles counted in, and the shadow lots still read until they are cleared. It comes back when live or shadow reads differently.'
                  : 'Reconcile is held: the last one may have landed. It comes back when live or shadow reads differently.'}
              </p>
            ) : row.shadow !== null && row.shadow > 0 ? (
              <button
                type="button"
                role="menuitem"
                className="iv-menu-item iv-focus"
                disabled={!canReconcile}
                onClick={() => void reconcileShadow()}
              >
                Reconcile {fmtCount(row.shadow)} into live
              </button>
            ) : null}
            <button type="button" role="menuitem" className="iv-menu-item iv-focus" onClick={() => void copyName()}>
              Copy the name
            </button>
            <button
              type="button"
              role="menuitem"
              className="iv-menu-item iv-focus"
              onClick={() => {
                setMoreOpen(false);
                // Legacy's right-click "Export this row": the valuation columns, as CSV, named after the title.
                void runExport([row], valuationColumns(currency.code ?? null), rowFilename(row), title);
              }}
            >
              Export this row
            </button>
            {row.active !== null ? (
              <button
                type="button"
                role="menuitem"
                className="iv-menu-item iv-focus"
                disabled={toggling || toggleBlocked !== null}
                aria-describedby={toggleBlocked ? `iv-inactive-why-${row.id}` : undefined}
                onClick={() => void toggleActive()}
              >
                {row.active ? 'Mark inactive' : 'Mark active'}
              </button>
            ) : null}
            {toggleBlocked ? (
              <p className="iv-menu-note" id={`iv-inactive-why-${row.id}`} data-testid="inactive-blocked">
                Mark inactive waits: {toggleBlocked}.
              </p>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="iv-menu-item iv-focus"
              disabled={blocked !== null}
              aria-describedby={blocked ? `iv-remove-why-${row.id}` : undefined}
              onClick={() => {
                setMoreOpen(false);
                setRemoving(true);
              }}
            >
              Remove from inventory
            </button>
            {blocked ? (
              <p className="iv-menu-note" id={`iv-remove-why-${row.id}`} data-testid="remove-blocked">
                Remove waits: {blocked}.
              </p>
            ) : null}
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
      {removing && blocked === null ? (
        <RemoveFromInventoryModal
          isOpen
          items={[removeTarget(row)]}
          onClose={() => setRemoving(false)}
          onRemoved={() => {
            setRemoving(false);
            void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
            void queryClient.invalidateQueries({ queryKey: ['inventory-next'] });
          }}
        />
      ) : null}
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
              ? (noZoneWord(row.stock) ?? EM)
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
  const pos = record.data?.books?.find((b) => b.book === 'pos') ?? null;
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
          <div className="iv-bars" role="img" aria-label={`Sold per day from ${shortDate(vel.from)} to ${shortDate(vel.to)}`}>
            {vel.days.map((d) => (
              <i
                key={d.date}
                title={`${shortDate(d.date)}: ${fmtCount(d.qty)}`}
                data-peak={d.qty >= maxDay * 0.75 ? 'true' : undefined}
                style={{ height: `${Math.max((d.qty / maxDay) * 100, 4)}%` }}
              />
            ))}
          </div>
          <div className="iv-barscale">
            <span>{shortDate(vel.from)}</span>
            <span>{shortDate(vel.to)}</span>
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
                        title={`${label} ${h}:00 — ${fmtCount(b?.qty ?? 0)}`}
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
                : `${fmtCount(detail.lots.length)} lot${detail.lots.length === 1 ? '' : 's'}, the latest sold ${shortDate(
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
      {/* The legacy expansion's "View ledger" (RowExpansion.tsx), same destination. */}
      <p className="iv-note">
        <Link className="iv-linkish iv-focus" to="/documents-reports" data-testid="row-view-ledger">
          View the ledger
        </Link>{' '}
        — it opens the house’s documents and reports, not this title alone.
      </p>
    </section>
  );
}
