/**
 * The drafted-order rail — the treatment the founder asked to keep ("it shows
 * you a lot of things with the receipt and the details"), under the prc-02
 * guardrail: an AI draft is VISUALLY INCAPABLE of reaching the Sent state
 * without a human hand.
 *
 * How the guarantee is built, not just styled:
 * - a draft's edge is dashed and it never carries a sent timestamp — "sent"
 *   markings are rendered exclusively from the server's `sentAt`, which only
 *   approve-draft (or the scheduled sender) can set;
 * - the only forward control is the hold-to-approve die (the same ceremony as
 *   an order approval — sending money-bearing mail to a vendor IS an
 *   approval);
 * - when the autonomous layer has scheduled a send, the countdown is shown
 *   draining DEAD LINEAR (an eased countdown lies about time) with Cancel
 *   live and getting stronger as the clock runs out — wired to the real
 *   cancel-scheduled-send endpoint.
 */

import { useEffect, useRef, useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { ink, settle, turn, useReducedMotion } from '@/lib/mudavym/motion';
import {
  useActiveConversations,
  useApproveDraft,
  useCancelScheduledSend,
  useDiscardDraft,
  useOrderConversations,
  type ActiveConversationDto,
  type OrderConversationDto,
} from '@/hooks/queries/useDraftEmailQueries';
import { EM, MONO, SANS, SERIF, fmtCountdown, fmtDate, fmtMoney, num } from './format';

/* ── the scheduled-send countdown ───────────────────────────────────────── */

function CountdownBar({
  until,
  onCancel,
  cancelling,
}: {
  until: string;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const reduced = useReducedMotion();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [remaining, setRemaining] = useState(() => new Date(until).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(until).getTime() - Date.now()), 250);
    return () => clearInterval(id);
  }, [until]);

  // The drain is un-eased on purpose: the operator is timing a decision
  // against it, and any easing curve would misreport how much time is left.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) {
      el.style.transform = 'scaleX(0)';
      return;
    }
    if (reduced) return; // stepped width below, no travel
    const anim = el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: ms,
      easing: 'linear',
      fill: 'forwards',
    });
    return () => anim.cancel();
  }, [until, reduced]);

  const closed = remaining <= 0;
  const urgent = !closed && remaining < 30_000;

  return (
    <div
      style={{
        border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
        borderRadius: 10,
        padding: '8px 10px',
        background: 'var(--paper-0, #FAF7F1)',
        fontFamily: SANS,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          {closed ? (
            'The window has closed — the house is sending it.'
          ) : (
            <>
              Sends itself in{' '}
              <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
                {fmtCountdown(remaining)}
              </span>
            </>
          )}
        </span>
        {!closed && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            style={{
              flex: 'none',
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: cancelling ? 'default' : 'pointer',
              // the cancel gets STRONGER as time runs out, never weaker
              border: `1px solid ${urgent ? 'var(--seal, #1A5E6B)' : 'var(--seal-ring, rgba(26,94,107,.32))'}`,
              background: urgent ? 'var(--seal, #1A5E6B)' : 'transparent',
              color: urgent ? 'var(--paper-0, #FAF7F1)' : 'var(--seal-deep, #14515C)',
              opacity: cancelling ? 0.6 : 1,
              transition: `background ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing}`,
            }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel auto-send'}
          </button>
        )}
      </div>
      <div
        aria-hidden
        style={{ marginTop: 6, height: 3, borderRadius: 2, background: 'var(--paper-2, #EAE4D8)', overflow: 'hidden' }}
      >
        <div
          ref={barRef}
          style={{
            height: '100%',
            background: 'var(--seal, #1A5E6B)',
            transformOrigin: '0 50%',
            // reduced motion: a stepped, honest width instead of travel
            transform: reduced
              ? `scaleX(${closed ? 0 : Math.min(1, remaining / Math.max(remaining, 1))})`
              : undefined,
          }}
        />
      </div>
    </div>
  );
}

/* ── one thread line inside an expanded draft ───────────────────────────── */

function ThreadLine({ row }: { row: OrderConversationDto }) {
  const isDraft = row.direction === 'OUTBOUND' && !row.sentAt;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '4px 8px',
        borderRadius: 6,
        // a sent message earns a solid edge and a timestamp; a draft never does
        border: isDraft ? '1px dashed var(--ink-3, #7C7365)' : '1px solid var(--paper-2, #EAE4D8)',
        fontFamily: SANS,
        fontSize: 11.5,
        color: 'var(--ink-2, #4F473C)',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', color: 'var(--ink-3, #7C7365)', flex: 'none' }}>
        {row.direction === 'INBOUND' ? '← vendor' : '→ house'}
      </span>
      <span className="min-w-0 flex-1 truncate">{row.emailType?.toLowerCase().replace(/_/g, ' ') ?? EM}</span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)', flex: 'none' }}>
        {isDraft ? 'draft — not sent' : row.sentAt ? `sent ${fmtDate(row.sentAt)}` : fmtDate(row.createdAt)}
      </span>
    </div>
  );
}

/* ── the expanded body of one draft card ────────────────────────────────── */

function DraftDetail({ draft }: { draft: ActiveConversationDto }) {
  const conversations = useOrderConversations(draft.orderId);
  const approveDraft = useApproveDraft();
  const discardDraft = useDiscardDraft();
  const cancelSend = useCancelScheduledSend();
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  // "show the working" reveal — the draft text turns in like a page, slower
  // than settle on purpose (turn token).
  useEffect(() => {
    const el = contentRef.current;
    if (!el || reduced) return;
    const anim = el.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: turn.ms, easing: turn.easing, fill: 'both' },
    );
    return () => anim.cancel();
  }, [reduced]);

  const rows = conversations.data ?? [];
  const scheduled = rows.find(
    (r) =>
      r.direction === 'OUTBOUND' &&
      !r.sentAt &&
      r.scheduledSendAt &&
      new Date(r.scheduledSendAt).getTime() > Date.now(),
  );

  const fail = (verb: string) => (err: unknown) => {
    const msg = (err as { message?: string })?.message ?? 'request failed';
    setActionError(`Not ${verb} — the gateway refused (${msg}).`);
    setAttempt((a) => a + 1);
  };

  return (
    <div ref={contentRef} className="grid gap-3 pt-2">
      {scheduled?.scheduledSendAt && (
        <CountdownBar
          until={scheduled.scheduledSendAt}
          cancelling={cancelSend.isPending}
          onCancel={() => {
            setActionError(null);
            cancelSend.mutate(draft.orderId, {
              onError: fail('cancelled'),
            });
          }}
        />
      )}

      {/* the draft itself — dashed edge, no timestamp, incapable of "sent" */}
      <div
        style={{
          border: '1.5px dashed var(--ink-3, #7C7365)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--paper-0, #FAF7F1)',
        }}
      >
        <div className="mb-1 flex items-center justify-between">
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
            Draft · not sent
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)' }}>
            round {draft.roundCount ?? EM}
          </span>
        </div>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--ink-2, #4F473C)',
            whiteSpace: 'pre-wrap',
            maxHeight: 180,
            overflow: 'auto',
            margin: 0,
          }}
        >
          {draft.draftContent ?? 'The draft body has not arrived yet.'}
        </p>
      </div>

      {/* the thread it belongs to — sent rows carry their proof, drafts do not */}
      {rows.length > 0 && (
        <div className="grid gap-1">
          {rows.slice(0, 4).map((r) => (
            <ThreadLine key={r.id} row={r} />
          ))}
          {rows.length > 4 && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)', paddingLeft: 8 }}>
              + {rows.length - 4} earlier in the thread
            </span>
          )}
        </div>
      )}
      {conversations.isError && (
        <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
          The thread could not be fetched — what is shown above is the draft alone.
        </p>
      )}

      <div className="grid gap-1">
        <HoldToApprove
          key={`send-${draft.orderId}-${attempt}`}
          label={`Hold to approve & send to ${draft.providerName ?? 'the vendor'}`}
          approvedLabel="Approved — leaving the house"
          disabled={approveDraft.isPending || discardDraft.isPending}
          onApprove={() => {
            setActionError(null);
            approveDraft.mutate({ orderId: draft.orderId }, { onError: fail('sent') });
          }}
        />
        <button
          type="button"
          disabled={discardDraft.isPending || approveDraft.isPending}
          onClick={() => {
            setActionError(null);
            discardDraft.mutate(draft.orderId, { onError: fail('discarded') });
          }}
          style={{
            justifySelf: 'end',
            fontFamily: SANS,
            fontSize: 11.5,
            color: 'var(--ink-3, #7C7365)',
            textDecoration: 'underline',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {discardDraft.isPending ? 'Discarding…' : 'Discard the draft'}
        </button>
        {actionError && (
          <p role="alert" style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
            {actionError}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── one draft card ─────────────────────────────────────────────────────── */

function DraftCard({ draft }: { draft: ActiveConversationDto }) {
  const [expanded, setExpanded] = useState(false);
  const qty = num(draft.quantity);
  const price = num(draft.quotedPrice);
  const total = qty !== null && price !== null ? qty * price : null;

  return (
    <div
      style={{
        border: '1px dashed var(--ink-3, #7C7365)',
        borderRadius: 12,
        background: 'var(--paper-1, #F3EFE6)',
        padding: '10px 12px',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-baseline gap-3 text-left"
        style={{ fontFamily: SANS, cursor: 'pointer' }}
      >
        <span className="min-w-0 flex-1">
          <span
            className="block truncate"
            style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}
          >
            {draft.wineName ?? draft.orderNumber ?? EM}
          </span>
          <span className="block truncate" style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
            {draft.providerName ?? EM} · drafted {fmtDate(draft.createdAt)}
          </span>
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-1, #211C16)',
            flex: 'none',
          }}
        >
          {qty !== null ? `${qty} × ${fmtMoney(price)}` : fmtMoney(total)}
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
      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: `grid-template-rows ${settle.ms}ms ${settle.easing}`,
        }}
      >
        <div style={{ overflow: 'hidden' }}>{expanded && <DraftDetail draft={draft} />}</div>
      </div>
    </div>
  );
}

/* ── the rail ───────────────────────────────────────────────────────────── */

export function DraftRail() {
  const drafts = useActiveConversations();
  const list = drafts.data ?? [];
  // Data absent means UNKNOWN (fetching, retrying, or no restaurant context
  // yet) — "no drafts waiting" may only be said once the list has arrived.
  const known = Array.isArray(drafts.data);

  return (
    <section aria-label="Drafted orders awaiting approval">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: 'var(--ink-1, #211C16)', margin: 0 }}>
          Drafted by the house
        </h2>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
          {known ? list.length : EM} awaiting your hand
        </span>
      </div>
      <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '0 0 10px' }}>
        Nothing here can reach a vendor without your approval.
      </p>
      {drafts.isError ? (
        <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          The gateway could not be reached — whether drafts exist is unknown, not zero.
        </p>
      ) : !known ? (
        <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>Reaching the gateway…</p>
      ) : list.length === 0 ? (
        <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
          No drafts waiting. When the house writes to a vendor, it stages the letter here first.
        </p>
      ) : (
        <div className="grid gap-2">
          {list.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </section>
  );
}

export default DraftRail;
