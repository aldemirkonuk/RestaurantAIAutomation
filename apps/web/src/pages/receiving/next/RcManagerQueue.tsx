/**
 * RcManagerQueue — the manager rendering: what needs a decision, worst money
 * first (the server sorts by dollars at risk, provable claims outranking
 * equally-valued unprovable ones — receiving.service.ts:managerQueue; the
 * order is kept, never re-derived here).
 *
 * The structure the REWORK asked for:
 * - the three outcomes as first-class lanes — accepted (goods kept, paper
 *   disagrees) · short · refused — selectable, each with its count;
 * - each row expands (settle) into the facts: the match sentence, what is
 *   short or refused, how many claims hang off it, and the two hand-offs —
 *   the order itself, and /receipts for line-item editing, which is
 *   deliberately NOT done here (the door brainstorm's one exclusion);
 * - the unverified strip stays ahead of the queue: an uncounted delivery is
 *   the one that turns into unexplained shrinkage.
 *
 * Sketch 107 (ADR 0160 §107, "B+ with A's vendor boxes and its bolder
 * figures"): rows are grouped into a box per vendor — "the vendor box as an
 * object on the page" — with the queue's own worst-money-first order kept
 * (a vendor's box rank is where its worst row first appears, never a
 * re-sorted vendor total). A failed vendor-name lookup is drawn as one named
 * box ("vendor names could not be loaded"), never silently as "unknown
 * vendor" per row. The founder's scale question ("what happens when one
 * delivery carries far more operations than the drawing shows") is answered
 * per box: more than VENDOR_BOX_CAP rows collapse behind "Show N more"
 * rather than growing the box without end. Each row also opens the
 * append-only verdict ledger (`RcVerdictLedger`) — the line sheet the
 * founder approved as drawn.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ink, settle } from '@/lib/mudavym/motion';
import type { UnverifiedDelivery } from '@/services/api/receiving';
import { RcTally } from './RcTally';
import { RcVerdictLedger } from './RcVerdictLedger';
import {
  EM,
  GE,
  MONO,
  SANS,
  SERIF,
  capStyle,
  fmtDate,
  fmtIntFloor,
  fmtMoneyWholeCcy,
  fmtMoneyWholeFloor,
} from './rc-format';
import {
  LANE_LABEL,
  SERVER_WINDOWS,
  type ManagerQueueData,
  type OutcomeLane,
  type QueueItemVM,
} from './useReceivingNextData';

const LANES: OutcomeLane[] = ['accepted', 'short', 'refused'];

/** More than this many rows in one vendor box collapse behind "Show more". */
const VENDOR_BOX_CAP = 5;

interface VendorGroup {
  key: string;
  name: string;
  items: QueueItemVM[];
  /**
   * Summed PER CURRENCY, never across them — a box with a EUR order and a
   * USD order is two subtotals, not one invented number (fixer review,
   * 2026-09-18: "a priced receipt needs its currency",
   * procurement_orders.currency). Keyed by the order's own currency code, or
   * '' for a legacy order that carries none (treated as this page's other
   * figures already do: USD). Empty when nothing in the box is priced yet.
   */
  atRiskByCurrency: Array<{ currency: string | null; amount: number }>;
  /** Rows in this box with no at-risk figure at all — "missing is not zero". */
  unpricedCount: number;
  /** True for the one box standing in for a failed name lookup — never per-row. */
  nameUnavailable: boolean;
}

/**
 * Groups keep the server's own worst-money-first order: a box's rank is the
 * position of the first (worst) row belonging to it, since `Map` preserves
 * insertion order. Nothing here re-sorts by a vendor's summed total — that
 * would be a second ordering the server never stated.
 */
function groupByVendor(items: QueueItemVM[], namesUnavailable: boolean): VendorGroup[] {
  const subtotal = (its: QueueItemVM[]) => {
    const byCcy = new Map<string, number>();
    let unpricedCount = 0;
    for (const i of its) {
      if (i.atRisk === null) {
        unpricedCount += 1;
        continue;
      }
      const ccy = i.currency ?? '';
      byCcy.set(ccy, (byCcy.get(ccy) ?? 0) + i.atRisk);
    }
    return {
      atRiskByCurrency: Array.from(byCcy, ([currency, amount]) => ({
        currency: currency || null,
        amount,
      })),
      unpricedCount,
    };
  };

  if (namesUnavailable) {
    return items.length === 0
      ? []
      : [
          {
            key: '__unavailable',
            name: 'Vendor names could not be loaded',
            items,
            ...subtotal(items),
            nameUnavailable: true,
          },
        ];
  }
  const order: string[] = [];
  const byKey = new Map<string, QueueItemVM[]>();
  for (const item of items) {
    const key = item.providerId ?? '__none';
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(item);
  }
  return order.map((key) => {
    const its = byKey.get(key)!;
    return {
      key,
      name: key === '__none' ? 'No vendor on the order' : (its[0].providerName ?? 'Unnamed vendor'),
      items: its,
      ...subtotal(its),
      nameUnavailable: false,
    };
  });
}

/* ── the outcome lanes ──────────────────────────────────────────────────── */

function LaneSpine({
  counts,
  atFloor,
  active,
  onSelect,
}: {
  counts: Record<OutcomeLane, number | null>;
  /** The lane counts are filters over a capped list; a full list makes them floors. */
  atFloor: boolean;
  active: OutcomeLane | null;
  onSelect: (lane: OutcomeLane | null) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Delivery outcomes"
      style={{
        display: 'flex',
        gap: 6,
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
        paddingBottom: 0,
      }}
    >
      {LANES.map((lane) => {
        const selected = active === lane;
        return (
          <button
            key={lane}
            type="button"
            role="tab"
            aria-selected={selected}
            data-ux-key={`receiving-next:lane-${lane}`}
            onClick={() => onSelect(selected ? null : lane)}
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '8px 12px 10px',
              border: 'none',
              background: 'transparent',
              color: selected ? 'var(--seal-deep, #14515C)' : 'var(--ink-2, #4F473C)',
              borderBottom: selected
                ? '2px solid var(--seal, #1A5E6B)'
                : '2px solid transparent',
              cursor: 'pointer',
              transition: `color ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing}`,
            }}
          >
            {LANE_LABEL[lane]}
            <span
              title={
                atFloor
                  ? `At least this many. The queue is served capped at ${SERVER_WINDOWS.QUEUE_ITEMS} rows and came back full, so anything beyond it is not counted here.`
                  : undefined
              }
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 6,
                color: selected ? 'var(--seal, #1A5E6B)' : 'var(--ink-3, #7C7365)',
                transition: `color ${ink.ms}ms ${ink.easing}`,
              }}
            >
              {fmtIntFloor(counts[lane], atFloor)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── the safety net for stock booked on a case count ────────────────────── */

const stripShell = {
  display: 'flex',
  gap: 10,
  alignItems: 'baseline',
  borderRadius: 12,
  background: 'var(--paper-1, #F3EFE6)',
  padding: '10px 14px',
  fontFamily: SANS,
  fontSize: 12.5,
  color: 'var(--ink-2, #4F473C)',
} as const;

/**
 * The safety net used to render only when `items.length > 0`, and the hook set
 * `unverified: []` whenever the query did not answer — so the one figure whose
 * silence turns into unexplained shrinkage went silent exactly when its query
 * failed. "Nothing uncounted" and "we do not know whether anything is
 * uncounted" are opposite instructions to a manager.
 */
function UnverifiedUnknownStrip() {
  return (
    <div
      role="status"
      style={{ ...stripShell, border: '1px solid var(--seal-ring, rgba(26,94,107,.32))' }}
    >
      <span style={{ ...capStyle, flex: 'none' }}>Uncounted</span>
      <span>
        <strong style={{ color: 'var(--ink-1, #211C16)' }}>Unknown</strong> — the uncounted list did
        not load. This is not a report of zero: a delivery booked on a case count and never counted
        by bottle may well be sitting there. Reload before treating the queue below as the whole
        picture.
      </span>
    </div>
  );
}

function UnverifiedStrip({ items, atFloor }: { items: UnverifiedDelivery[]; atFloor: boolean }) {
  const overdue = items.filter((i) => i.severity === 'overdue').length;
  return (
    <div
      style={{
        ...stripShell,
        border: `1px solid ${overdue ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
      }}
    >
      <span style={{ ...capStyle, flex: 'none' }}>Uncounted</span>
      <span>
        <strong
          style={{ color: 'var(--ink-1, #211C16)' }}
          title={`At least this many. The list is built from the newest ${SERVER_WINDOWS.UNVERIFIED} receipt events, so an older uncounted delivery falls outside it.`}
        >
          {fmtIntFloor(items.length, atFloor)}
        </strong>{' '}
        deliver{items.length === 1 ? 'y' : 'ies'} counted by case and not yet by bottle — oldest{' '}
        {items[0]?.ageHours ?? EM}h.
        {overdue > 0 && (
          <strong style={{ color: 'var(--ink-1, #211C16)' }}>
            {' '}
            {GE}
            {overdue} past two days — a short case there can no longer be claimed from the vendor.
          </strong>
        )}
      </span>
    </div>
  );
}

/* ── one decision row ───────────────────────────────────────────────────── */

function QueueRow({
  item,
  expanded,
  onToggle,
  onOpenLedger,
}: {
  item: QueueItemVM;
  expanded: boolean;
  onToggle: () => void;
  onOpenLedger: () => void;
}) {
  const navigate = useNavigate();
  const linkStyle = {
    fontFamily: SANS,
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
    background: 'transparent',
    color: 'var(--seal-deep, #14515C)',
    cursor: 'pointer',
    transition: `background ${ink.ms}ms ${ink.easing}`,
  } as const;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
        background: expanded ? 'var(--paper-1, #F3EFE6)' : 'transparent',
        transition: `background ${settle.ms}ms ${settle.easing}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-ux-key="receiving-next:queue-row"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          width: '100%',
          padding: '11px 12px',
          border: 'none',
          background: 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: SANS,
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                // Bolder main figure (sketch 107, A's graft onto B+): the
                // line's own name carries more weight than the chrome around it.
                fontFamily: SERIF,
                fontSize: 16.5,
                fontWeight: 700,
                color: 'var(--ink-1, #211C16)',
              }}
            >
              {item.orderNumber || item.orderId.slice(0, 8)}
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color:
                  item.lane === 'refused'
                    ? 'var(--ink-1, #211C16)'
                    : 'var(--seal-deep, #14515C)',
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                borderRadius: 3,
                padding: '2px 6px',
              }}
            >
              {item.chip}
            </span>
            {item.selfEvidenced && (
              <span
                title="Their packing slip and their invoice disagree — provable from their own paperwork"
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--paper-0, #FAF7F1)',
                  background: 'var(--seal, #1A5E6B)',
                  borderRadius: 3,
                  padding: '2px 6px',
                }}
              >
                Provable
              </span>
            )}
          </span>
          <span
            style={{
              display: 'block',
              // `width: 0` + `minWidth: 100%`: the ellipsised line takes the
              // row's width but contributes NONE to its parents' min-content.
              // A `nowrap` line otherwise reports its full text width upward,
              // and the vendor box, the section and <main> grow to fit it —
              // 12px of sideways scroll at 390 (confirmer walk, 2026-09-18).
              width: 0,
              minWidth: '100%',
              fontSize: 11.5,
              color: 'var(--ink-3, #7C7365)',
              marginTop: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.summary || `verdict: ${item.verdict}`}
          </span>
        </span>
        {/* A measured $0 and an absent figure used to collapse into the same
            em dash, while `openClaims` printed a literal 0 beside it — so one
            row could read "$— · 0 open claims". `atRisk` is null ONLY when the
            server sent no figure; a real zero renders as $0 and is dimmed,
            not hidden (ADR 0051 clause 1). */}
        <span
          title={
            item.atRisk === null
              ? 'The server sent no figure for this row — unknown, not zero.'
              : item.atRisk === 0
                ? 'Measured: this row has nothing at risk.'
                : undefined
          }
          style={{
            flex: 'none',
            fontFamily: MONO,
            // Bolder main figure, same graft as the line's name above.
            fontSize: 15,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color:
              item.atRisk !== null && item.atRisk > 0
                ? 'var(--ink-1, #211C16)'
                : 'var(--ink-3, #7C7365)',
            minWidth: 76,
            textAlign: 'right',
          }}
        >
          {fmtMoneyWholeCcy(item.atRisk, item.currency)}
        </span>
        <span
          aria-hidden
          style={{
            flex: 'none',
            color: 'var(--ink-3, #7C7365)',
            fontSize: 11,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: `transform ${settle.ms}ms ${settle.easing}`,
          }}
        >
          ›
        </span>
      </button>

      {/* row expand = settle: 0fr→1fr, same token as the chevron above */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: `grid-template-rows ${settle.ms}ms ${settle.easing}`,
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: '2px 12px 14px', fontFamily: SANS }}>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                marginBottom: 12,
              }}
            >
              <div>
                <span style={capStyle}>The facts</span>
                <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
                  {item.summary || `The match engine returned "${item.verdict}" with no sentence.`}
                </p>
              </div>
              <div>
                <span style={capStyle}>Claims</span>
                <p
                  style={{
                    fontFamily: MONO,
                    fontSize: 12.5,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ink-2, #4F473C)',
                    margin: '4px 0 0',
                    lineHeight: 1.6,
                  }}
                >
                  {/* ALWAYS a floor. The server links claims with `.limit(200)`
                      and no `.order()`, capped per restaurant rather than per
                      order, so the client cannot see whether the window was
                      full — `≥0` means "none inside the window", which is a
                      weaker and truer claim than "none". */}
                  {fmtIntFloor(item.openClaimsFloor, true)} open claim
                  {item.openClaimsFloor === 1 ? '' : 's'} ·{' '}
                  {fmtMoneyWholeCcy(item.atRisk, item.currency)} at risk
                  {item.backorderQty > 0 && (
                    <>
                      <br />
                      {item.backorderQty} on backorder
                    </>
                  )}
                  <br />
                  matched {fmtDate(item.verifiedAt)}
                </p>
                <p style={{ fontSize: 10.5, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
                  Claim counts are lower bounds: the gateway links at most{' '}
                  {SERVER_WINDOWS.LINKED_CREDITS} credit rows per restaurant and does not order
                  them, so a claim can sit outside the window.
                  {item.atRisk === 0 &&
                    ` The ${fmtMoneyWholeCcy(0, item.currency)} above is measured, not missing.`}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* The append-only verdict ledger (ADR 0149 row 23; sketch 107's
                  "line sheet") — the overlay the founder approved as drawn. */}
              <button
                type="button"
                style={{ ...linkStyle, fontWeight: 700 }}
                data-ux-key="receiving-next:queue-open-ledger"
                onClick={onOpenLedger}
              >
                Open the verdict ledger
              </button>
              <button
                type="button"
                style={linkStyle}
                data-ux-key="receiving-next:queue-open-order"
                onClick={() => navigate(`/orders?order=${item.orderId}`)}
              >
                Open the order
              </button>
              {/* Line-item editing belongs at a desk, on /receipts — the door
                  brainstorm's one deliberate exclusion. This page hands off
                  rather than growing an editor. */}
              <button
                type="button"
                style={linkStyle}
                data-ux-key="receiving-next:queue-open-receipts"
                // Carries the order, exactly as its sibling above does. Landing
                // a manager on an unfiltered desk after they picked one row is
                // how the wrong receipt gets edited.
                // TODO(receipts): `pages/receipts/next/ReceiptsNext.tsx:447`
                // reads only `?tab`, so this parameter is inert until that page
                // selects by order id. Passing it now means the hand-off starts
                // working the moment it does, with no change here.
                onClick={() => navigate(`/receipts?order=${encodeURIComponent(item.orderId)}`)}
              >
                Edit line items at the desk — /receipts
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── the queue ──────────────────────────────────────────────────────────── */

export function RcManagerQueue({ data }: { data: ManagerQueueData }) {
  const [lane, setLane] = useState<OutcomeLane | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [ledgerFor, setLedgerFor] = useState<QueueItemVM | null>(null);

  const visible = useMemo(
    () => (lane === null ? data.items : data.items.filter((i) => i.lane === lane)),
    [data.items, lane],
  );

  const vendorGroups = useMemo(
    () => groupByVendor(visible, data.providerNamesUnavailable),
    [visible, data.providerNamesUnavailable],
  );

  return (
    <section aria-label="Deliveries needing a decision" style={{ fontFamily: SANS }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            fontFamily: SERIF,
            fontSize: 19,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
            margin: 0,
          }}
        >
          Needing a decision
        </h2>
        <span style={{ textAlign: 'right' }}>
          <span style={capStyle}>At risk</span>{' '}
          {/* Summed over the same capped list as the lane counts, so a full
              window makes each currency's total a lower bound. Never a single
              number across currencies (confirmer review, 2026-09-18) — one
              RcTally per currency the queue carries, same rule as the vendor
              boxes' own subtotals. RcTally keeps its contract: null is the em
              dash and the dash→number arrival does not tick. */}
          {data.totalAtRiskByCurrency.length === 0 ? (
            <RcTally
              value={null}
              style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: 'var(--ink-1, #211C16)' }}
            />
          ) : (
            data.totalAtRiskByCurrency.map((c, i) => (
              <span key={c.currency ?? ''}>
                {i > 0 && ' + '}
                <RcTally
                  value={c.amount}
                  format={(n) => fmtMoneyWholeFloor(n, data.itemsAtFloor, c.currency)}
                  style={{
                    fontFamily: MONO,
                    fontSize: 17,
                    fontWeight: 700,
                    color: 'var(--ink-1, #211C16)',
                  }}
                />
              </span>
            ))
          )}
        </span>
      </div>

      {/* Three states, three renderings — and the unknown one is the reason
          this block exists (F7). Loading is covered by "Reaching the gateway…"
          below, so silence here only ever means a measured zero. */}
      {data.unverified === null && !data.isLoading && (
        <div style={{ marginBottom: 12 }}>
          <UnverifiedUnknownStrip />
        </div>
      )}
      {data.unverified !== null && data.unverified.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <UnverifiedStrip items={data.unverified} atFloor={data.unverifiedAtFloor} />
        </div>
      )}

      <LaneSpine
        counts={data.laneCounts}
        atFloor={data.itemsAtFloor}
        active={lane}
        onSelect={setLane}
      />

      {data.isError && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            border: '1px solid var(--paper-2, #EAE4D8)',
            borderRadius: 12,
            background: 'var(--paper-1, #F3EFE6)',
            padding: '12px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
            {data.failure?.forbidden ? (
              <>
                This account is not permitted to see the decision queue. The gateway understood the
                request and refused it — a permission, not an outage, so retrying will not help. Ask
                an owner to open manager access. What needs a decision is unknown — {EM}, not zero.
              </>
            ) : (
              <>
                The queue could not be loaded ({data.errorMessage}). What needs a decision is unknown
                — {EM}, not zero.
              </>
            )}
            <span
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 10.5,
                color: 'var(--ink-3, #7C7365)',
                marginTop: 4,
              }}
            >
              {data.failure?.status === null ? 'no status' : `HTTP ${data.failure?.status}`} ·{' '}
              {data.errorMessage}
            </span>
          </span>
          {!data.failure?.forbidden && (
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
          )}
        </div>
      )}

      {!data.hasData && !data.isError && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3, #7C7365)', marginTop: 12 }}>
          Reaching the gateway…
        </p>
      )}

      {data.hasData && visible.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3, #7C7365)', marginTop: 12 }}>
          {lane === null
            ? 'Nothing to chase. Every verified delivery matched its paperwork.'
            : `Nothing sits at ${LANE_LABEL[lane].toLowerCase()} right now.`}
        </p>
      )}

      {/* A vendor box earns its place only when there is more than one vendor
          to compare — with a single, NAMED vendor its header would just
          repeat the page's own "At risk" tally back at the reader. The one
          exception is the failed-lookup box: it carries real information (the
          lookup itself failed) that a flat list would silently lose. */}
      {visible.length > 0 &&
        !(vendorGroups.length > 1 || vendorGroups[0]?.nameUnavailable) && (
        <div style={{ borderTop: 'none' }}>
          {visible.map((item) => (
            <QueueRow
              key={item.orderId}
              item={item}
              expanded={expandedId === item.orderId}
              onToggle={() => setExpandedId((cur) => (cur === item.orderId ? null : item.orderId))}
              onOpenLedger={() => setLedgerFor(item)}
            />
          ))}
        </div>
      )}

      {visible.length > 0 && (vendorGroups.length > 1 || vendorGroups[0]?.nameUnavailable) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          {vendorGroups.map((group) => {
            const isOpen = expandedVendors.has(group.key);
            const capped = group.items.length > VENDOR_BOX_CAP;
            const shown = isOpen ? group.items : group.items.slice(0, VENDOR_BOX_CAP);
            const nameId = `receiving-vendor-box-name-${group.key}`;
            return (
              <div
                key={group.key}
                data-ux-key="receiving-next:vendor-box"
                role="group"
                aria-labelledby={nameId}
                style={{
                  border: group.nameUnavailable
                    ? '1px solid var(--seal-ring, rgba(26,94,107,.32))'
                    : '1px solid var(--paper-2, #EAE4D8)',
                  borderRadius: 14,
                  overflow: 'hidden',
                  background: 'var(--paper-0, #FAF7F1)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--paper-2, #EAE4D8)',
                    background: 'var(--paper-1, #F3EFE6)',
                  }}
                >
                  <span
                    id={nameId}
                    style={{
                      fontFamily: SERIF,
                      fontSize: 15,
                      fontWeight: 700,
                      color: group.nameUnavailable
                        ? 'var(--ink-2, #4F473C)'
                        : 'var(--ink-1, #211C16)',
                      fontStyle: group.nameUnavailable ? 'italic' : 'normal',
                    }}
                  >
                    {group.name}
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        fontWeight: 500,
                        color: 'var(--ink-4, #665D50)',
                        marginLeft: 8,
                      }}
                    >
                      {group.items.length} deliver{group.items.length === 1 ? 'y' : 'ies'}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--ink-1, #211C16)',
                      flex: 'none',
                      textAlign: 'right',
                    }}
                    title="From GET /procurement/receiving/queue"
                  >
                    {/* Never a single number across currencies (fixer review,
                        2026-09-18) — each currency subtotal prints on its
                        own, floor-marked like every other capped figure on
                        this page, and an unpriced row is named, not folded
                        into 0. */}
                    {group.atRiskByCurrency.length === 0
                      ? EM
                      : group.atRiskByCurrency
                          .map(
                            (c) =>
                              `${data.itemsAtFloor ? GE : ''}${fmtMoneyWholeCcy(c.amount, c.currency)}`,
                          )
                          .join(' + ')}
                    {group.unpricedCount > 0 && (
                      <span style={{ color: 'var(--ink-4, #665D50)', fontWeight: 400, fontSize: 10.5 }}>
                        {' '}
                        · {group.unpricedCount} unpriced
                      </span>
                    )}
                  </span>
                </div>
                <div>
                  {shown.map((item) => (
                    <QueueRow
                      key={item.orderId}
                      item={item}
                      expanded={expandedId === item.orderId}
                      onToggle={() =>
                        setExpandedId((cur) => (cur === item.orderId ? null : item.orderId))
                      }
                      onOpenLedger={() => setLedgerFor(item)}
                    />
                  ))}
                </div>
                {/* The founder's scale question: a box pages rather than
                    growing without end when one vendor holds far more
                    operations than the drawing showed. */}
                {capped && (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={
                      isOpen
                        ? `Show fewer from ${group.name}`
                        : `Show ${group.items.length - VENDOR_BOX_CAP} more from ${group.name}`
                    }
                    onClick={() =>
                      setExpandedVendors((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '8px 14px',
                      fontFamily: SANS,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--seal-deep, #14515C)',
                      background: 'transparent',
                      border: 'none',
                      borderTop: '1px solid var(--paper-2, #EAE4D8)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {isOpen ? 'Show fewer' : `Show ${group.items.length - VENDOR_BOX_CAP} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ledgerFor && (
        <RcVerdictLedger
          open
          onClose={() => setLedgerFor(null)}
          orderId={ledgerFor.orderId}
          orderLabel={ledgerFor.orderNumber || ledgerFor.orderId.slice(0, 8)}
          vendorName={ledgerFor.providerName}
        />
      )}
    </section>
  );
}

export default RcManagerQueue;
