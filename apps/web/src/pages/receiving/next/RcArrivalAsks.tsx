/**
 * RcArrivalAsks — "Did it arrive?" for the orders past their expected date
 * (ADR 0207, round 3; the founder's delegation of 2026-09-21: "think of a best
 * way to handle this ... You tell me").
 *
 * An order past its date and not received is ASKED about before it counts
 * against its vendor. Three choices, each an act the house already has:
 *   Yes — receive it   opens the receiving door for that order;
 *   Not yet            recorded here: the order then counts as late, in the
 *                      window its date fell in;
 *   Cancel             the sealed cancellation, which lives on Orders.
 * Unanswered, the order is "unconfirmed, not counted" on the vendor's card.
 * Thirty days on it leaves this list for Incomplete orders under Documents &
 * Reports.
 *
 * Shown to the people the gateway asks — owners and managers today.
 * Honesty: a failed read says so in the gateway's words; an empty list says
 * what empty means. Motion: `ink` on the acts only (ADR 0134's token).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ink } from '@/lib/mudavym/motion';
import { SealedRejectDie } from '@/components/orders/SealedRejectDie';
import { MONO, SANS, SERIF, capStyle } from './rc-format';
import { useAnswerNotYet, useArrivalAsks } from './useArrivalAsks';
import type { ArrivalAsk } from './useArrivalAsks';

function message(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
}

const act: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
  textDecoration: 'none',
  transition: `border-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing}`,
};

function Ask({ a }: { a: ArrivalAsk }) {
  const notYet = useAnswerNotYet();
  const name = a.orderNumber ?? 'This order';
  const receive = a.choices.find((c) => c.key === 'receive');
  const canSayNotYet = a.choices.some((c) => c.key === 'not_yet');
  // ADR 0207 round 4 — "It never arrived — cancel", in place, replacing the
  // link to Orders (the rebuilt page had no act for a CONFIRMED/IN_TRANSIT
  // order at all). reasonCode is locked: this ask exists only for an order
  // already past its deadline, so never_arrived is always the true category.
  const [cancelling, setCancelling] = useState(false);
  const [cancelledNote, setCancelledNote] = useState<string | null>(null);
  return (
    <li data-testid="arrival-ask" style={{ listStyle: 'none', padding: '10px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
      <p style={{ margin: 0, fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
        {name}
        {a.providerName ? ` · ${a.providerName}` : ''}
      </p>
      <p style={{ margin: '2px 0 0', fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
        expected {a.expectedDate} · {a.daysPast} {a.daysPast === 1 ? 'day' : 'days'} past
      </p>
      <p style={{ margin: '4px 0 0', fontFamily: SANS, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)' }}>
        {a.standing === 'unconfirmed'
          ? 'Nobody here has said whether it arrived, so it is not counted against the vendor yet.'
          : `Someone here said not yet on ${String(a.answeredAt ?? '').slice(0, 10)} — it counts as late.`}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {receive && 'route' in receive && (
          <Link to={receive.route} className="rc-ask-act" style={act}>
            Yes — receive it
          </Link>
        )}
        {canSayNotYet && (
          <button
            type="button"
            className="rc-ask-act"
            style={act}
            disabled={notYet.isPending}
            onClick={() => notYet.mutate(a.orderId)}
          >
            {notYet.isPending ? 'Recording…' : 'Not yet'}
          </button>
        )}
        {!cancelling && (
          <button
            type="button"
            className="rc-ask-act"
            style={{ ...act, color: 'var(--ink-2, #4F473C)', borderColor: 'var(--paper-2, #EAE4D8)' }}
            onClick={() => setCancelling(true)}
          >
            It never arrived — cancel
          </button>
        )}
      </div>
      {notYet.isError && (
        <p role="alert" style={{ margin: '6px 0 0', fontFamily: SANS, fontSize: 11.5, color: 'var(--alarm, #A33A2B)' }}>
          {message(notYet.error, 'The answer could not be recorded. Nothing was changed.')}
        </p>
      )}
      {cancelling && (
        <div style={{ marginTop: 8 }}>
          <SealedRejectDie
            orderId={a.orderId}
            reasonCode="never_arrived"
            label="Hold to cancel"
            totalCost={a.totalCost}
            currency={a.currency}
            onRejected={() => setCancelling(false)}
            onCreditClaimOpened={(r) =>
              setCancelledNote(
                r.ok
                  ? r.result.alreadyOpen
                    ? 'A claim for this order was already open — nothing was opened twice.'
                    : `A credit claim for this order was opened, chasing the vendor for ${r.result.claim.claimedAmount}${r.result.claim.currency ? ` ${r.result.claim.currency}` : ''}.`
                  : r.message,
              )
            }
          />
        </div>
      )}
      {cancelledNote && (
        <p role="status" style={{ margin: '6px 0 0', fontFamily: SANS, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)' }}>
          {cancelledNote}
        </p>
      )}
    </li>
  );
}

export function RcArrivalAsks({ enabled }: { enabled: boolean }) {
  const q = useArrivalAsks(enabled);
  if (!enabled) return null;
  return (
    <section data-testid="arrival-asks" style={{ marginBottom: 22 }}>
      <style>{`
        .rc-ask-act:hover { text-decoration: underline }
        .rc-ask-act:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        @media (prefers-reduced-motion: reduce) { .rc-ask-act { transition: none !important } }
      `}</style>
      <p style={capStyle}>Did it arrive?</p>
      <h2 style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, margin: '2px 0 6px' }}>Orders past their date</h2>
      {q.isError ? (
        <p role="alert" style={{ margin: 0, fontFamily: SANS, fontSize: 12, lineHeight: 1.45, color: 'var(--alarm, #A33A2B)' }}>
          {message(q.error, 'The orders past their date could not be read.')} That is a failed read — this list is unknown,
          not empty.
        </p>
      ) : !q.data ? (
        <p aria-busy="true" style={{ margin: 0, fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
          Reading the orders past their date…
        </p>
      ) : !q.data.forYou ? (
        <p style={{ margin: 0, fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>{q.data.sentence}</p>
      ) : q.data.asks.length === 0 ? (
        <p data-testid="arrival-asks-empty" style={{ margin: 0, fontFamily: SANS, fontSize: 12, lineHeight: 1.45, color: 'var(--ink-3, #7C7365)' }}>
          No order is past its date and waiting. Orders more than 30 days past are in Incomplete orders under Documents &amp;
          Reports.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0 }}>
          {q.data.asks.map((a) => (
            <Ask key={a.orderId} a={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default RcArrivalAsks;
