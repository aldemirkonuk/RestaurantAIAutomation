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
 * in words; the rehearsal die (shown when no pending order is loaded) is
 * wired to NOTHING and says so.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { HoldToApprove, Wordmark } from '@/components/mudavym';
import { AgreementSheet } from './AgreementSheet';
import { BulkApproveBar } from './BulkApproveBar';
import { DraftRail } from './DraftRail';
import { LedgerRow } from './LedgerRow';
import { RecurrenceSheet } from './RecurrenceSheet';
import { ResponsesSheet } from './ResponsesSheet';
import { StageSpine, type SpineStation } from './StageSpine';
import { Tally } from './Tally';
import { EM, MONO, SANS, SERIF, fmtMoneyWhole } from './format';
import { emptyStationSentence } from './recurrence';
import { STAGES, useOrdersNextData, type OrderRowVM } from './useOrdersNextData';

const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const VALID_STATIONS = new Set<string>([...STAGES, 'recurring']);

/** The die with nothing behind it — clearly guarded demo state. */
function RehearsalCard() {
  const [runs, setRuns] = useState(0);
  const [sealedOnce, setSealedOnce] = useState(false);
  return (
    <div
      style={{
        border: '1px dashed var(--ink-3, #7C7365)',
        borderRadius: 12,
        padding: '12px 14px',
        background: 'var(--paper-1, #F3EFE6)',
        fontFamily: SANS,
      }}
      data-testid="rehearsal-die"
    >
      <div className="mb-1 flex items-center justify-between">
        <span style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
          The die, at rest
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7C7365)',
            border: '1px dashed var(--ink-3, #7C7365)',
            borderRadius: 3,
            padding: '2px 6px',
          }}
        >
          Rehearsal · no order attached
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '0 0 8px' }}>
        No pending order is loaded, so the ceremony has nothing to act on. Completing this hold approves
        nothing and sends nothing — it only shows the gesture.
      </p>
      <HoldToApprove
        key={`rehearsal-${runs}`}
        label="Hold to try the seal — approves nothing"
        approvedLabel="Sealed — a rehearsal only"
        onApprove={() => setSealedOnce(true)}
      />
      {sealedOnce && (
        <button
          type="button"
          onClick={() => setRuns((r) => r + 1)}
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--ink-3, #7C7365)',
            textDecoration: 'underline',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Reset the rehearsal
        </button>
      )}
    </div>
  );
}

export default function OrdersNext() {
  const data = useOrdersNextData();
  /**
   * A single order asked for from OUTSIDE the ledger — an email/SMS/push deep
   * link (`/orders/:id`, App.tsx) or a hand-off from another page that has not
   * been taught the path form yet (RcManagerQueue's "Open the order" still
   * sends `?order=`, RcManagerQueue.tsx:411). The path param wins when both are
   * somehow present. Read once; changing tabs mid-session is not this page's
   * job to react to.
   */
  const { id: routeOrderId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const targetOrderId = routeOrderId ?? searchParams.get('order');
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [writing, setWriting] = useState(false);
  /**
   * Which order's answers are open. ONE sheet for the page, not one per row:
   * the sheet reads that order's correspondence when it opens, and a mounted
   * instance per row would be one disabled query subscription per row.
   */
  const [responsesFor, setResponsesFor] = useState<string | null>(null);
  /** Which order's recurrence is open. One sheet for the page, as above. */
  const [recurrenceFor, setRecurrenceFor] = useState<string | null>(null);

  const visibleRows = useMemo(() => {
    const byDate = (a: OrderRowVM, b: OrderRowVM) =>
      new Date(b.requestedAt ?? 0).getTime() - new Date(a.requestedAt ?? 0).getTime();
    if (station === 'recurring') return data.rows.filter((r) => r.recurring).sort(byDate);
    const oneTime = data.rows.filter((r) => !r.recurring && r.stage !== 'cancelled');
    return (station === null ? oneTime : oneTime.filter((r) => r.stage === station)).sort(byDate);
  }, [data.rows, station]);

  const responsesRow = useMemo(
    () => (responsesFor === null ? null : (data.rows.find((r) => r.id === responsesFor) ?? null)),
    [data.rows, responsesFor],
  );

  const recurrenceRow = useMemo(
    () => (recurrenceFor === null ? null : (data.rows.find((r) => r.id === recurrenceFor) ?? null)),
    [data.rows, recurrenceFor],
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
   * A read that CAME BACK with rows, found nothing matching — not "still
   * loading" and not "the fetch failed" (both are said elsewhere).
   *
   * This does NOT mean the order does not exist or is foreign: `data.rows` is
   * only the first page the list endpoint returns (`services/api/orders.ts`
   * sends no `limit`; the gateway defaults to 50, newest first —
   * `procurement.service.ts`), so a real order of this house that is merely
   * older than the 50 most recent looks identical, from here, to one that
   * truly does not exist or belongs to another house. The banner below says
   * only what was actually checked — how many rows were loaded, not a claim
   * about the order's existence or ownership.
   */
  const targetMissing = Boolean(targetOrderId) && data.hasData && !data.isError && !targetRow;

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

  const pendingKnownEmpty = data.hasData && data.counts.pending === 0;
  const showRehearsal = data.isError || pendingKnownEmpty;

  const setRowSelected = (id: string, next: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (next) n.add(id);
      else n.delete(id);
      return n;
    });

  const now = new Date();

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
                color: 'var(--ink-3, #7C7365)',
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
            <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
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
        <AgreementSheet
          open={writing}
          onClose={() => setWriting(false)}
          onSaved={() => data.refetch()}
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
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
              The gateway could not be reached ({data.errorMessage}). Every figure on this page is
              unknown — shown as {EM}, never as zero.
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

        {/* ── a link asked for ONE order, and it is not among the rows this
            page loaded ── says only what was checked (§ targetMissing
            above): the list read is one page, so "not loaded here" is never
            widened into "does not exist" or "not this house's". */}
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
            Order {targetOrderId} was not among the {data.rows.length} most recently loaded
            orders — it may exist further back, or belong to a different house. Showing every
            loaded order below instead.
          </div>
        )}

        {/* ── the one asked for exists, but the ledger never lists a
            cancelled order — the count above is where it is kept ──────── */}
        {targetRow && targetRow.stage === 'cancelled' && (
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
          onSelect={setStation}
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
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
                Reaching the gateway…
              </p>
            ) : visibleRows.length === 0 && !data.isError ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>
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
            ) : (
              <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                {visibleRows.map((row) => (
                  // The id a deep link scrolls to (see the targetOrderId
                  // effect above) — on this wrapper, not LedgerRow itself, so
                  // the row component stays free of a concern that is this
                  // page's, not its rows'.
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
                      approvalGateError={data.approvalGateError}
                    />
                  </div>
                ))}
              </div>
            )}

            {showRehearsal && (
              <div className="mt-4">
                <RehearsalCard />
              </div>
            )}

            {data.cancelledCount !== null && data.cancelledCount > 0 && (
              <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3, #7C7365)', marginTop: 10 }}>
                {data.cancelledCount} cancelled — kept in the book, off the figures.
              </p>
            )}
          </section>

          {/* ── the drafted-order rail ─────────────────────────────────── */}
          <DraftRail />
        </div>
      </div>
    </div>
  );
}
