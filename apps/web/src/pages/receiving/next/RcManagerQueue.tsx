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
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ink, settle } from '@/lib/mudavym/motion';
import type { UnverifiedDelivery } from '@/services/api/receiving';
import { RcTally } from './RcTally';
import { EM, MONO, SANS, SERIF, capStyle, fmtDate, fmtMoneyWhole } from './rc-format';
import {
  LANE_LABEL,
  type ManagerQueueData,
  type OutcomeLane,
  type QueueItemVM,
} from './useReceivingNextData';

const LANES: OutcomeLane[] = ['accepted', 'short', 'refused'];

/* ── the outcome lanes ──────────────────────────────────────────────────── */

function LaneSpine({
  counts,
  active,
  onSelect,
}: {
  counts: Record<OutcomeLane, number | null>;
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
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 6,
                color: selected ? 'var(--seal, #1A5E6B)' : 'var(--ink-3, #7C7365)',
                transition: `color ${ink.ms}ms ${ink.easing}`,
              }}
            >
              {counts[lane] === null ? EM : counts[lane]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── the safety net for stock booked on a case count ────────────────────── */

function UnverifiedStrip({ items }: { items: UnverifiedDelivery[] }) {
  const overdue = items.filter((i) => i.severity === 'overdue').length;
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'baseline',
        border: `1px solid ${overdue ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
        borderRadius: 12,
        background: 'var(--paper-1, #F3EFE6)',
        padding: '10px 14px',
        fontFamily: SANS,
        fontSize: 12.5,
        color: 'var(--ink-2, #4F473C)',
      }}
    >
      <span style={{ ...capStyle, flex: 'none' }}>Uncounted</span>
      <span>
        <strong style={{ color: 'var(--ink-1, #211C16)' }}>{items.length}</strong> deliver
        {items.length === 1 ? 'y' : 'ies'} counted by case and not yet by bottle — oldest{' '}
        {items[0]?.ageHours ?? EM}h.
        {overdue > 0 && (
          <strong style={{ color: 'var(--ink-1, #211C16)' }}>
            {' '}
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
}: {
  item: QueueItemVM;
  expanded: boolean;
  onToggle: () => void;
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
                fontFamily: SERIF,
                fontSize: 14.5,
                fontWeight: 600,
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
        <span
          style={{
            flex: 'none',
            fontFamily: MONO,
            fontSize: 13.5,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: item.dollarsAtRisk > 0 ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
            minWidth: 72,
            textAlign: 'right',
          }}
        >
          {item.dollarsAtRisk > 0 ? fmtMoneyWhole(item.dollarsAtRisk) : EM}
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
                  {item.openClaims} open claim{item.openClaims === 1 ? '' : 's'} ·{' '}
                  {item.dollarsAtRisk > 0 ? fmtMoneyWhole(item.dollarsAtRisk) : EM} at risk
                  {item.backorderQty > 0 && (
                    <>
                      <br />
                      {item.backorderQty} on backorder
                    </>
                  )}
                  <br />
                  matched {fmtDate(item.verifiedAt)}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                onClick={() => navigate('/receipts')}
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

  const visible = useMemo(
    () => (lane === null ? data.items : data.items.filter((i) => i.lane === lane)),
    [data.items, lane],
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
          <RcTally
            value={data.totalAtRisk}
            format={fmtMoneyWhole}
            style={{
              fontFamily: MONO,
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--ink-1, #211C16)',
            }}
          />
        </span>
      </div>

      {data.unverified.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <UnverifiedStrip items={data.unverified} />
        </div>
      )}

      <LaneSpine counts={data.laneCounts} active={lane} onSelect={setLane} />

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
            The queue could not be loaded ({data.errorMessage}). What needs a decision is unknown —
            {' '}{EM}, not zero.
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

      {visible.length > 0 && (
        <div style={{ borderTop: 'none' }}>
          {visible.map((item) => (
            <QueueRow
              key={item.orderId}
              item={item}
              expanded={expandedId === item.orderId}
              onToggle={() =>
                setExpandedId((cur) => (cur === item.orderId ? null : item.orderId))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default RcManagerQueue;
