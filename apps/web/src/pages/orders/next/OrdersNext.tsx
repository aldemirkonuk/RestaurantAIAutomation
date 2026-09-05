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

import { useMemo, useState } from 'react';
import { HoldToApprove, Wordmark } from '@/components/mudavym';
import { AgreementSheet } from './AgreementSheet';
import { BulkApproveBar } from './BulkApproveBar';
import { DraftRail } from './DraftRail';
import { LedgerRow } from './LedgerRow';
import { StageSpine, type SpineStation } from './StageSpine';
import { Tally } from './Tally';
import { EM, MONO, SANS, SERIF, fmtMoneyWhole } from './format';
import { useOrdersNextData, type OrderRowVM } from './useOrdersNextData';

const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' });

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
  const [station, setStation] = useState<SpineStation | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [writing, setWriting] = useState(false);

  const visibleRows = useMemo(() => {
    const byDate = (a: OrderRowVM, b: OrderRowVM) =>
      new Date(b.requestedAt ?? 0).getTime() - new Date(a.requestedAt ?? 0).getTime();
    if (station === 'recurring') return data.rows.filter((r) => r.recurring).sort(byDate);
    const oneTime = data.rows.filter((r) => !r.recurring && r.stage !== 'cancelled');
    return (station === null ? oneTime : oneTime.filter((r) => r.stage === station)).sort(byDate);
  }, [data.rows, station]);

  const selectedRows = useMemo(
    () => data.rows.filter((r) => selected.has(r.id) && r.stage === 'pending' && !r.recurring),
    [data.rows, selected],
  );

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
                {station === null
                  ? 'The book is open and empty — no active orders.'
                  : `Nothing sits at ${station} right now.`}
              </p>
            ) : (
              <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                {visibleRows.map((row) => (
                  <LedgerRow
                    key={row.id}
                    row={row}
                    expanded={expandedId === row.id}
                    onToggle={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                    selected={selected.has(row.id)}
                    onSelectChange={(next) => setRowSelected(row.id, next)}
                    bulkRunning={bulkRunning}
                    approval={data.approvalByOrder?.get(row.id)}
                    approvalGateError={data.approvalGateError}
                  />
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
