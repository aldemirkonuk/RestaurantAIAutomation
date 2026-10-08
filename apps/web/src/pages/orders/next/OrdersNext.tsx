/**
 * OrdersNext — the Mudavym redesign of `/orders` (ADR 0044), the home of the
 * approval ceremony.
 *
 * What the founder kept (MAKEOVER-VERDICTS, /orders = KEEP+): the five-stage
 * order spine — pending · approved · ordered · delivered · recurring — plus
 * the month figure, and the drafted-order treatment. Both are load-bearing
 * here, on live data through the existing hooks only.
 *
 * Ceremonies (see MOTIONS.md for the full map):
 * - approve = HoldToApprove completing into the Seal landing (stamp);
 * - bulk approve = the dry emboss — same die, no wax, ONE impression;
 * - AI drafts never look sent (DraftRail, prc-02);
 * - writing an agreement down states the unit its price is in (AgreementSheet,
 *   ADR 0119 phase 1) — the order's unit and the price's unit are two fields,
 *   not one assumption;
 * - row expand = settle, with the working shown for every total;
 * - countdowns drain un-eased.
 *
 * Honesty rules: unknowns are em dashes, never zeros; a failed fetch is said
 * in words. The real seal lives only on a pending row — the rehearsal die
 * that stood here when nothing was pending was removed on the founder's
 * word (ORD-W2, 2026-10-01).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import { AgreementSheet } from './AgreementSheet';
import { BulkApproveBar } from './BulkApproveBar';
import { DraftRail } from './DraftRail';
import { LedgerRow } from './LedgerRow';
import { NewOrderSheet } from './NewOrderSheet';
import { VendorFirstPanel } from './VendorFirstPanel';
import { RecurrenceSheet } from './RecurrenceSheet';
import { ReceiptSheet } from './ReceiptSheet';
import { ResponsesSheet } from './ResponsesSheet';
import { StageSpine, type SpineStation } from './StageSpine';
import { Tally } from './Tally';
import { EM, MONO, SANS, SERIF, fmtMoneyWhole, fmtReadTime } from './format';
import { emptyStationSentence } from './recurrence';
import {
  OLDER_STEP,
  STAGES,
  stationView,
  useOrdersNextData,
  type OrderRowVM,
} from './useOrdersNextData';
import { useAuth } from '@/contexts/AuthContext';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { CEILING_PAGES, PAGE_LIMIT } from '@/services/api/order-book';

const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const VALID_STATIONS = new Set<string>([...STAGES, 'recurring']);

export default function OrdersNext() {
  const { activeRestaurantId, user } = useAuth();
  /* Read here as well as inside the sheet so the guard can fire BEFORE the
     composer opens — the legacy desk's `openCreateOrderFlow` rule
     (`pages/Orders.tsx:296-302`). React Query hands both callers the same
     cached read, so this is one request, not two. */
  const vendorList = useProviders(activeRestaurantId || user?.restaurantId || '');
  /**
   * A single order asked for from OUTSIDE the ledger — an email/SMS/push deep
   * link (`/orders/:id`, App.tsx) or a hand-off from another page that has not
   * been taught the path form yet (RcManagerQueue's "Open the order" still
   * sends `?order=`, RcManagerQueue.tsx:411). The path param wins when both are
   * somehow present. Read once; changing tabs mid-session is not this page's
   * job to react to.
   */
  const { id: routeOrderId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetOrderId = routeOrderId ?? searchParams.get('order');
  // Handed the deep-linked id, so an order that is not among the rows read
  // is asked for on its own before the page says anything about it.
  const data = useOrdersNextData(targetOrderId);
  /** Which target id this page has already acted on, so a manual collapse by
   *  the person afterwards is not fought by re-expanding on every render. */
  const handledTargetRef = useRef<string | null>(null);
  const [station, setStation] = useState<SpineStation | null>(() => {
    // A specific order (above) decides its own station once the book loads —
    // an initial `?station=` would only be overwritten a beat later, so it
    // is not read at all when a target id is also present.
    if (targetOrderId) return null;
    // `tab` is an alias for `station`: scheduled-tasks.service.ts's in-app
    // notification for a recurring order sends `?tab=recurring` while
    // recurring-order.template.ts's email for the SAME event sends
    // `?station=recurring` — two spellings for one intent.
    const requested = searchParams.get('station') ?? searchParams.get('tab');
    return requested && VALID_STATIONS.has(requested) ? (requested as SpineStation) : null;
  });
  /**
   * Show older, per house and station (founder, 2026-10-02 List): finished
   * orders come in `OLDER_STEP` a tap. A station with nothing open opens on
   * its newest 50 (2026-10-03 Empty tab), and once it has, `firstFifty` keeps
   * them (fork 8, ADR 0269).
   */
  const [older, setOlder] = useState<{ key: string; taps: number }>({ key: '', taps: 0 });
  const [firstFifty, setFirstFifty] = useState('');
  const viewKey = `${activeRestaurantId ?? ''}|${station ?? 'all'}`;
  const taps = older.key === viewKey ? older.taps : 0;
  const keepFirstFifty = firstFifty === viewKey;
  // Bumped in selectStation, so an older read that lands after a station change counts for nothing.
  const tapGen = useRef(0);
  /**
   * The chosen station lives in the URL (ADR 0160, ORD-W5): a reload, a shared
   * link or Back returns to the same station. `replace`, so stepping through
   * stations does not stack history entries; a deep-link `order` is dropped,
   * since the person has moved on from that one order.
   */
  const selectStation = (next: SpineStation | null) => {
    setStation(next);
    setOlder({ key: '', taps: 0 });
    setFirstFifty('');
    tapGen.current++;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('tab');
        p.delete('order');
        if (next) p.set('station', next);
        else p.delete('station');
        return p;
      },
      { replace: true },
    );
  };
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [writing, setWriting] = useState(false);
  /* The manual composer (fork F5) and the guard that travels with it. */
  const [ordering, setOrdering] = useState(false);
  const [vendorGuard, setVendorGuard] = useState<'before' | 'refused' | null>(null);
  /**
   * Which order's answers are open. ONE sheet for the page, not one per row:
   * the sheet reads that order's correspondence when it opens, and a mounted
   * instance per row would be one disabled query subscription per row.
   */
  const [responsesFor, setResponsesFor] = useState<string | null>(null);
  /** Which order's recurrence is open. One sheet for the page, as above. */
  const [recurrenceFor, setRecurrenceFor] = useState<string | null>(null);
  /** Which order's receipt is open. One sheet for the page, as above. */
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  const view = useMemo(
    () => stationView(data.rows, station, taps, targetOrderId, keepFirstFifty),
    [data.rows, station, taps, targetOrderId, keepFirstFifty],
  );
  // Fork 8 (ADR 0269): once a station has opened on its newest 50, an open
  // order arriving later does not fold them back behind Show older.
  const opensOnFifty =
    data.hasData && station !== 'recurring' && view.open.length === 0 && view.finished.length > 0;
  useEffect(() => {
    if (opensOnFifty && !keepFirstFifty) setFirstFifty(viewKey);
  }, [opensOnFifty, keepFirstFifty, viewKey]);

  const responsesRow = useMemo(
    () => (responsesFor === null ? null : (data.rows.find((r) => r.id === responsesFor) ?? null)),
    [data.rows, responsesFor],
  );

  const recurrenceRow = useMemo(
    () => (recurrenceFor === null ? null : (data.rows.find((r) => r.id === recurrenceFor) ?? null)),
    [data.rows, recurrenceFor],
  );

  const receiptRow = useMemo(
    () => (receiptFor === null ? null : (data.rows.find((r) => r.id === receiptFor) ?? null)),
    [data.rows, receiptFor],
  );

  const selectedRows = useMemo(
    () => data.rows.filter((r) => selected.has(r.id) && r.stage === 'pending' && !r.recurring),
    [data.rows, selected],
  );

  const targetRow = useMemo(
    () => (targetOrderId ? (data.rows.find((r) => r.id === targetOrderId) ?? null) : null),
    [data.rows, targetOrderId],
  );
  /**
   * A read that CAME BACK with rows, found nothing matching, and the order
   * then asked for on its own did not come back either — not "still loading",
   * not "still asking" and not "the read failed" (each is said elsewhere).
   *
   * This does NOT mean the order does not exist or is foreign: asked for on
   * its own, a missing order, a foreign one, a refused read and a timeout all
   * come back alike (`fetchOrderById`, ADR 0269), and a capped read lists only
   * the newest orders. The banner below says only what was actually checked —
   * how many orders were read and that reading this one failed, not a claim
   * about the order's existence or ownership.
   */
  const targetMissing =
    Boolean(targetOrderId) &&
    data.hasData &&
    !data.isError &&
    !targetRow &&
    data.target.state === 'unreadable';
  const targetChecking = Boolean(targetOrderId) && data.target.state === 'checking';
  /** The short form the cancelled banner falls back to; there is no row to number it. */
  const targetRef = (targetOrderId ?? '').slice(0, 8);

  useEffect(() => {
    if (!targetOrderId || !targetRow) return;
    if (handledTargetRef.current === targetOrderId) return;
    handledTargetRef.current = targetOrderId;
    if (targetRow.recurring) setStation('recurring');
    else if (station !== null && station !== targetRow.stage) setStation(null);
    setExpandedId(targetRow.id);
    // Deferred a tick so the row (now visible via the station change above)
    // has actually mounted before the browser is asked to scroll to it.
    const t = window.setTimeout(() => {
      const el = document.getElementById(`order-row-${targetRow.id}`);
      // `scrollIntoView` is not universal (jsdom's test DOM has none of it) —
      // a page that scrolls nowhere is a much smaller honesty gap than one
      // that throws.
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetOrderId, targetRow]);


  const setRowSelected = (id: string, next: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (next) n.add(id);
      else n.delete(id);
      return n;
    });

  const now = new Date();

  // The id a deep link scrolls to (see the targetOrderId effect above) — on
  // this wrapper, not LedgerRow itself, so the row component stays free of a
  // concern that is this page's, not its rows'.
  const renderRow = (row: OrderRowVM) => (
    <div key={row.id} id={`order-row-${row.id}`} data-testid={`order-row-${row.id}`}>
      <LedgerRow
        row={row}
        expanded={expandedId === row.id}
        onToggle={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
        selected={selected.has(row.id)}
        onSelectChange={(next) => setRowSelected(row.id, next)}
        bulkRunning={bulkRunning}
        approval={data.approvalByOrder?.get(row.id)}
        onOpenResponses={() => setResponsesFor(row.id)}
        onOpenRecurrence={() => setRecurrenceFor(row.id)}
        onOpenReceipt={() => setReceiptFor(row.id)}
        approvalGateError={data.approvalGateError}
      />
    </div>
  );

  /* An empty station off a read that did not cover every order says so, and
     never "nothing sits here" or "none of the {n} repeats" about orders that
     were never read (ADR 0269, PR-B). */
  const emptyIncomplete =
    station === 'recurring'
      ? data.book.mode === 'capped' || data.book.mode === 'partial'
        ? 'Not every order was read, so it cannot be said whether any order repeats.'
        : null
      : data.book.openComplete === false
        ? 'Nothing here among the orders read. Some open orders may be missing.'
        : null;

  /* Show older (founder, 2026-10-02 List): finished orders read but not shown,
     or, past the newest 3,000, older ones still to be read. */
  const canShowOlder =
    station !== 'recurring' &&
    (view.hiddenFinished > 0 ||
      (data.book.older.canRead && (station === null || station === 'delivered')));
  const onShowOlder = () => {
    const next = taps + 1;
    const want = OLDER_STEP * next + (view.open.length === 0 || keepFirstFifty ? OLDER_STEP : 0);
    const have = view.finished.length + view.hiddenFinished;
    if (want <= have || !data.book.older.canRead) {
      setOlder({ key: viewKey, taps: next });
      return;
    }
    // A tap that needs older orders counts only once they are in; a failed read
    // leaves it to be tapped again (Attack ledger 5). A house switch aborts the
    // read, which resolves false.
    const key = viewKey;
    const gen = tapGen.current;
    void data.book.older.read(want - have).then((ok) => {
      if (ok && gen === tapGen.current) setOlder({ key, taps: next });
    });
  };
  // The count only in a whole read: otherwise it counts rows read, not the house's.
  const olderLabel = data.book.older.reading
    ? 'Reading older orders…'
    : data.book.mode === 'whole' && view.hiddenFinished > 0
      ? `Show older (${view.hiddenFinished.toLocaleString('en-GB')} more)`
      : 'Show older';

  /* An empty vendor list stops the composer; an UNREADABLE one does not.
     A failed read drawn as "you have no vendors" would send a person off to add
     a vendor they already have — the absence-as-health fault, in one click. */
  const openTheComposer = () => {
    if (!vendorList.isError && !vendorList.isLoading && (vendorList.data ?? []).length === 0) {
      setVendorGuard('before');
      return;
    }
    setOrdering(true);
  };

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* ── masthead: the page name and the month figure ─────────────── */}
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.1,
                margin: '4px 0 0',
              }}
            >
              Orders
            </h1>
          </div>
          <div className="flex items-end gap-4">
            <button
              type="button"
              onClick={openTheComposer}
              data-testid="write-order"
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 13px',
                borderRadius: 9,
                border: '1px solid var(--seal, #1A5E6B)',
                background: 'var(--seal, #1A5E6B)',
                color: 'var(--paper-0, #FBF8F1)',
                cursor: 'pointer',
              }}
            >
              Write a new order
            </button>
            <button
              type="button"
              onClick={() => setWriting(true)}
              data-testid="write-agreement"
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 13px',
                borderRadius: 9,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Write down an agreement
            </button>
          <div className="text-right" style={{ fontFamily: SANS }}>
            <span
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 9.5,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-4, #665D50)',
              }}
            >
              {monthName.format(now)} so far
            </span>
            <Tally
              value={data.month.thisMonth}
              format={fmtMoneyWhole}
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                color: 'var(--ink-1, #211C16)',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
              last month {data.month.lastMonth === null ? EM : fmtMoneyWhole(data.month.lastMonth)}
              {data.month.unpricedThisMonth > 0 &&
                ` · ${data.month.unpricedThisMonth} unpriced — excluded, not zeroed`}
            </span>
          </div>
          </div>
        </header>

        {/* The composer. Its own overlay so the ledger under it never moves,
            and so the two units — the order's and the price's — are read
            together in one place (ADR 0119 phase 1). */}
        {/* Neither sheet is handed a refetch: each already awaits the orders
            invalidation (AgreementSheet.tsx:333, NewOrderSheet.tsx:380), which
            re-reads the orders, and a second call started a second whole read. */}
        <AgreementSheet
          open={writing}
          onClose={() => setWriting(false)}
        />

        {/* The manual entry (fork F5, 2026-09-05). Several lines placed
            together, and an honest account of which of them landed —
            `AgreementSheet` writes one line, `DraftRail` shows what the engine
            wrote, and neither is a cart. */}
        <NewOrderSheet
          open={ordering}
          onClose={() => setOrdering(false)}
          onNoVendors={() => setVendorGuard('refused')}
        />

        {/* The guard travels with it: caught before the composer opens, and
            again when the gateway answers 403 no_vendors on a real write. */}
        <VendorFirstPanel
          open={vendorGuard !== null}
          reason={vendorGuard ?? 'before'}
          onClose={() => setVendorGuard(null)}
        />

        {/* The vendors' answers to ONE order, with the three acts the legacy
            `OrderApprovalModal` had and this page did not: reject with a reason,
            step through several answers, and read the negotiation summary
            (orders.md §13.13; founder, 2026-09-05). Rendered from the row the
            page still holds, so a row that vanishes under a refetch closes the
            sheet rather than leaving it describing an order that is no longer
            in the book. */}
        {responsesRow && (
          <ResponsesSheet
            open
            onClose={() => setResponsesFor(null)}
            row={responsesRow}
            approval={data.approvalByOrder?.get(responsesRow.id)}
            approvalGateError={data.approvalGateError}
          />
        )}

        {/* The recurrence sheet, keyed off the row for the same reason the
            answers sheet is: one instance for the page, and it follows the
            order out of the book rather than describing one that has gone. */}
        {recurrenceRow && (
          <RecurrenceSheet
            open
            onClose={() => setRecurrenceFor(null)}
            row={recurrenceRow}
          />
        )}

        {receiptRow && (
          <ReceiptSheet open onClose={() => setReceiptFor(null)} row={receiptRow} />
        )}

        {/* ── the gateway, when it cannot be reached, is said plainly ──── */}
        {data.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            {/* A re-read that fails keeps the last rows on screen (React Query
                holds data across a refetch error), so "every figure is unknown"
                would be false over them — say how old they are (ORD-W15). */}
            <span
              data-testid="orders-read-error"
              style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}
            >
              {data.hasData && data.dataUpdatedAt ? (
                <>
                  The orders could not be re-read ({data.errorMessage}). What you see is the last
                  read, from {fmtReadTime(data.dataUpdatedAt)} — it may be out of date.
                </>
              ) : (
                <>
                  The orders could not be read ({data.errorMessage}). Every figure on this page is
                  unknown — shown as {EM}, never as zero.
                </>
              )}
            </span>
            <button
              type="button"
              onClick={data.refetch}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* ── a read that did not cover every order says so, one true
            sentence per fact (ADR 0269 fork 9): which orders were read,
            whether every open one is listed, and which figures it cannot
            back ──────────────────────────────────────────────────────── */}
        {(data.book.mode === 'capped' || data.book.mode === 'partial') && (
          <div
            role="status"
            data-testid="orders-read-notice"
            className="mb-4 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: 'var(--ink-2, #4F473C)',
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            <p>
              {data.book.mode === 'capped'
                ? `This house has ${(data.book.total ?? 0).toLocaleString('en-GB')} orders, more than this screen reads at once. The newest ${(CEILING_PAGES * PAGE_LIMIT).toLocaleString('en-GB')} are read; older finished orders come in under Show older.`
                : 'The orders kept changing while they were read, so some finished orders may be missing from this list.'}
            </p>
            <p>
              {data.book.openComplete
                ? 'Every open order is listed.'
                : 'Some open orders may be missing.'}
            </p>
            {data.book.unreadableStates !== null && data.book.unreadableStates > 0 && (
              <p>
                {data.book.unreadableStates === 1
                  ? '1 order is in a state this screen cannot read.'
                  : `${data.book.unreadableStates.toLocaleString('en-GB')} orders are in a state this screen cannot read.`}
              </p>
            )}
            <p>
              {data.book.openComplete
                ? 'Delivered, Recurring and the month figures show'
                : 'Every count and the month figures show'}{' '}
              {EM} because not every order was read. At least{' '}
              {(data.book.deliveredAtLeast ?? 0).toLocaleString('en-GB')} delivered and{' '}
              {(data.book.recurringAtLeast ?? 0).toLocaleString('en-GB')} recurring orders were
              read.
            </p>
          </div>
        )}

        {/* ── a link asked for ONE order that is not among the rows read: it
            is asked for on its own first (up to three tries) ─────────── */}
        {targetChecking && (
          <p
            role="status"
            data-testid="target-order-checking"
            className="mb-4 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: 'var(--ink-2, #4F473C)',
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            Looking for order {targetRef}…
          </p>
        )}

        {/* ── …and it did not come back either ── says only what was
            checked (§ targetMissing above): "not read here" is never widened
            into "does not exist" or "not this house's". */}
        {targetMissing && (
          <div
            role="alert"
            data-testid="target-order-missing"
            className="mb-4 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: 'var(--ink-2, #4F473C)',
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            {data.book.mode === 'whole' ? (
              <>
                Order {targetRef} could not be read. It is not among{' '}
                {data.book.total === 1
                  ? "this house's 1 order"
                  : `this house's ${(data.book.total ?? 0).toLocaleString('en-GB')} orders`}
                , read at {data.dataUpdatedAt !== null ? fmtReadTime(data.dataUpdatedAt) : EM}, and
                reading it on its own failed; it may belong to another house, or the read may have
                failed. The list is shown below instead.
              </>
            ) : (
              <>
                Order {targetRef} could not be read. It is not among{' '}
                {data.book.readCount === 1
                  ? 'the 1 order read so far'
                  : `the ${data.book.readCount.toLocaleString('en-GB')} orders read so far`}
                , at {data.dataUpdatedAt !== null ? fmtReadTime(data.dataUpdatedAt) : EM}, and
                reading it on its own failed; it may belong to another house, or the read may have
                failed. The list is shown below instead.
              </>
            )}{' '}
            <button
              type="button"
              data-testid="target-order-retry"
              onClick={() => {
                if (data.target.state === 'unreadable') data.target.retry();
              }}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* ── the one asked for exists, but the ledger never lists a
            cancelled one-time order — the count above is where it is kept.
            A cancelled recurring order IS listed, under Recurring. ────── */}
        {targetRow && targetRow.stage === 'cancelled' && !targetRow.recurring && (
          <div
            role="status"
            data-testid="target-order-cancelled"
            className="mb-4 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: 'var(--ink-2, #4F473C)',
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            Order {targetRow.orderNumber || targetRow.id.slice(0, 8)} is cancelled, so the ledger
            does not list it — it is kept in the cancelled count below.
          </div>
        )}

        {/* ── the five-stage spine the founder kept ────────────────────── */}
        <StageSpine
          counts={data.counts}
          recurringCount={data.recurringCount}
          active={station}
          onSelect={selectStation}
        />

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── the ledger ─────────────────────────────────────────────── */}
          <section aria-label="Order ledger">
            <BulkApproveBar
              selectedRows={selectedRows}
              onClear={() => setSelected(new Set())}
              onApproved={(ids) =>
                setSelected((prev) => {
                  const n = new Set(prev);
                  ids.forEach((id) => n.delete(id));
                  return n;
                })
              }
              onRunningChange={setBulkRunning}
            />

            {!data.hasData && !data.isError ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>
                Reading the order book…
              </p>
            ) : view.open.length === 0 && view.finished.length === 0 && !data.isError ? (
              emptyIncomplete !== null ? (
                <p
                  data-testid="orders-empty-incomplete"
                  style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}
                >
                  {emptyIncomplete}
                </p>
              ) : (
                <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>
                  {/*
                    * THE RECURRING STATION SAYS "NONE" ONLY FROM A MEASURED READ.
                    *
                    * Until 2026-09-05 this station was structurally empty — the
                    * route sent no recurrence and `toRow` set `recurring = false`
                    * for every order — and it printed "Nothing sits at recurring
                    * right now", which is a claim about the ORDERS made from a
                    * fact about the ROUTE. `emptyStationSentence` is handed the
                    * two counts and says which of the four cases this actually
                    * is; the one it will not say is "there are none" off a book
                    * that never answered.
                    */}
                  {station === 'recurring'
                    ? emptyStationSentence(
                        data.hasData,
                        data.rows.length,
                        data.recurrenceReadCount ?? 0,
                      )
                    : station === null
                      ? 'The book is open and empty — no active orders.'
                      : `Nothing sits at ${station} right now.`}
                </p>
              )
            ) : (
              // Every open order first, then the finished ones shown so far
              // (founder, 2026-10-03 Station): no new tab, nothing moved.
              <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                {view.open.map(renderRow)}
                {view.finished.length > 0 && station !== 'recurring' && (
                  <p
                    data-testid="finished-label"
                    style={{
                      fontFamily: MONO,
                      fontSize: 9.5,
                      fontWeight: 500,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-4, #665D50)',
                      margin: 0,
                      padding: '14px 0 6px',
                    }}
                  >
                    Finished deliveries
                  </p>
                )}
                {view.finished.map(renderRow)}
              </div>
            )}

            {canShowOlder && (
              <div style={{ fontFamily: SANS, marginTop: 10 }}>
                <button
                  type="button"
                  data-testid="show-older"
                  disabled={data.book.older.reading}
                  onClick={onShowOlder}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                    background: 'transparent',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: data.book.older.reading ? 'progress' : 'pointer',
                  }}
                >
                  {olderLabel}
                </button>
                {data.book.older.error && (
                  <p
                    role="status"
                    data-testid="show-older-error"
                    style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', marginTop: 6 }}
                  >
                    Older orders could not be read ({data.book.older.error}). Show older tries
                    again.
                  </p>
                )}
              </div>
            )}

            {data.cancelledCount !== null && data.cancelledCount > 0 && (
              <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4, #665D50)', marginTop: 10 }}>
                {data.cancelledCount} cancelled — kept in the book, off the figures.
              </p>
            )}
          </section>

          {/* ── the drafted-order rail ─────────────────────────────────── */}
          <DraftRail
            focusOrderId={expandedId}
            onOpenResponses={(orderId) =>
              data.rows.some((r) => r.id === orderId) ? () => setResponsesFor(orderId) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
