/**
 * RcStaffLane — the staff rendering: which delivery are you receiving?
 *
 * The locked rules from the legacy page survive intact:
 * - NO PRICES. Line cost is not floor-staff information; it invites an
 *   argument with a driver who has no authority to settle it.
 * - A failed fetch must never render as an empty list — "nothing is out for
 *   delivery" is a reassuring sentence, and a receiver who reads it walks
 *   away from the door (sys-03: an error is not an empty room).
 *
 * What the REWORK adds: each delivery is a card with the facts a receiver can
 * check at the door — vendor, PO, the line and bottle count — and one big
 * hand-off into the door flow. The hand-off is the card's entire right edge,
 * because this is used one-handed next to a double-parked truck.
 */

import { useNavigate } from 'react-router-dom';
import { ink } from '@/lib/mudavym/motion';
import { EM, GE, MONO, SANS, SERIF, capStyle, fmtDate, fmtInt, fmtUnits } from './rc-format';
import type { DeliveryVM, StaffLaneData } from './useReceivingNextData';

/**
 * The count the receiver is about to check against a pallet — in BOTTLES,
 * because that is the only thing anyone counts at a door.
 *
 * `quantity` is denominated in `unit_type`, so rendering it as bottles told a
 * receiver that a five-CASE order was five bottles: the exact arithmetic ADR
 * 0054 fixed in the gateway, reintroduced one layer up. When the server has
 * not computed `bottlesTotal` the honest output is the em dash plus what was
 * actually ordered, in its own unit. The pack size is not in this payload and
 * is never guessed.
 */
function countSentence(d: DeliveryVM): string {
  if (d.bottlesTotal !== null) return `${fmtInt(d.bottlesTotal)} bottles expected`;
  if (d.orderedQty !== null) return `${fmtUnits(d.orderedQty, d.unitType)} ordered · bottles ${EM}`;
  return `${EM} bottles`;
}

export function RcStaffLane({ data }: { data: StaffLaneData }) {
  const navigate = useNavigate();
  const {
    deliveries,
    totalOutForDelivery,
    listTruncated,
    hasData,
    isError,
    isFetching,
    failure,
    refetch,
  } = data;

  return (
    <section aria-label="Deliveries expected today" style={{ fontFamily: SANS }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 12px' }}>
        Tap the delivery that just arrived. Prices are not shown here on purpose — counting is the
        door's whole job.
      </p>

      {!hasData && !isError && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3, #7C7365)' }}>Reaching the gateway…</p>
      )}

      {isError && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            borderRadius: 12,
            background: 'var(--paper-1, #F3EFE6)',
            padding: '14px 16px',
          }}
        >
          <p style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-1, #211C16)', margin: 0 }}>
            {failure?.forbidden
              ? 'This account is not permitted to see today’s deliveries.'
              : "Could not load today's deliveries."}
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '6px 0 0' }}>
            {failure?.forbidden ? (
              // A refusal is not an outage. Retrying cannot fix it, so the
              // sentence sends the receiver to the only thing that can.
              <>
                The gateway understood the request and refused it — this is a permission, not an
                outage, and trying again will not change it. There may still be a truck outside:
                write the delivery down on paper and ask a manager to open your access.
              </>
            ) : (
              <>
                This is not the same as having none — there may well be a truck outside. Write the
                delivery down on paper and tell a manager if this does not clear.
              </>
            )}
          </p>
          {failure && (
            <p
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: 'var(--ink-3, #7C7365)',
                margin: '6px 0 0',
              }}
            >
              {failure.status === null ? 'no status' : `HTTP ${failure.status}`} · {failure.message}
            </p>
          )}
          {!failure?.forbidden && (
          <button
            type="button"
            data-ux-key="receiving-next:staff-retry"
            onClick={refetch}
            disabled={isFetching}
            style={{
              marginTop: 10,
              minHeight: 44,
              padding: '0 18px',
              borderRadius: 10,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              opacity: isFetching ? 0.7 : 1,
              transition: `opacity ${ink.ms}ms ${ink.easing}`,
            }}
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
          )}
        </div>
      )}

      {hasData && !isError && deliveries.length === 0 && (
        <div
          style={{
            border: '1px solid var(--paper-2, #EAE4D8)',
            borderRadius: 12,
            background: 'var(--paper-1, #F3EFE6)',
            padding: '18px 16px',
            textAlign: 'center',
            fontSize: 12.5,
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          Nothing is out for delivery right now. When an order is confirmed or in transit, it
          appears here.
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {deliveries.map((d) => (
          <div
            key={d.id}
            style={{
              display: 'flex',
              alignItems: 'stretch',
              border: '1px solid var(--paper-2, #EAE4D8)',
              borderRadius: 14,
              background: 'var(--paper-1, #F3EFE6)',
              overflow: 'hidden',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, padding: '14px 16px' }}>
              <p
                style={{
                  fontFamily: SERIF,
                  fontSize: 17,
                  fontWeight: 600,
                  color: 'var(--ink-1, #211C16)',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {/* Vendor when the DTO carries it; the wine is the honest
                    fallback so two trucks can still be told apart. The
                    fallback is ANNOUNCED below rather than passed off as a
                    distributor name. */}
                {d.vendor ?? d.line ?? 'Delivery'}
              </p>
              {d.vendor === null && (
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--ink-3, #7C7365)',
                    margin: '3px 0 0',
                    fontStyle: 'italic',
                  }}
                >
                  Distributor not named by the gateway — the line above is the wine
                  {d.providerRef ? `, vendor ref ${d.providerRef}` : ''}.
                </p>
              )}
              <p
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--ink-2, #4F473C)',
                  margin: '5px 0 0',
                }}
              >
                PO {d.po ?? EM} · {d.lineCount} line · {countSentence(d)}
              </p>
              <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '4px 0 0' }}>
                {d.vendor && d.line ? `${d.line} · ` : ''}ordered {fmtDate(d.requestedAt)}
              </p>
            </div>
            {/* The hand-off: the card's whole right edge, one-thumb sized. */}
            <button
              type="button"
              data-ux-key="receiving-next:staff-door"
              onClick={() => navigate(`/receiving/${d.id}/door`)}
              aria-label={`Receive ${d.vendor ?? d.line ?? 'delivery'} at the door`}
              style={{
                flex: 'none',
                width: 118,
                border: 'none',
                borderLeft: '1px solid var(--paper-2, #EAE4D8)',
                background: 'var(--seal, #1A5E6B)',
                color: 'var(--paper-0, #FAF7F1)',
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: 13,
                lineHeight: 1.35,
                cursor: 'pointer',
                padding: '0 12px',
                transition: `filter ${ink.ms}ms ${ink.easing}`,
              }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.92)';
              }}
              onPointerUp={(e) => {
                (e.currentTarget as HTMLButtonElement).style.filter = '';
              }}
              onPointerLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.filter = '';
              }}
            >
              Receive at
              <br />
              the door →
            </button>
          </div>
        ))}
      </div>

      {deliveries.length > 0 && (
        <p style={{ ...capStyle, marginTop: 12 }}>
          {/* `deliveries.length` is a PAGE LENGTH — the gateway is asked for 25
              rows per status. `total` is its exact count, so the honest figure
              is available and no floor marker is needed (ADR 0051 clause 2).
              Only when the count itself did not arrive does the page fall back
              to the page length, and then it says `≥`. */}
          {totalOutForDelivery !== null
            ? `${totalOutForDelivery} out for delivery`
            : `${GE}${deliveries.length} out for delivery`}
          {listTruncated && totalOutForDelivery !== null
            ? ` · ${deliveries.length} shown`
            : ''}{' '}
          · counting happens at the door, matching happens at the desk
        </p>
      )}
    </section>
  );
}

export default RcStaffLane;
