/**
 * RcCreditDrafts — the drafted-but-unsent credit requests, rendered `--calm`.
 *
 * The founder's door brainstorm, item 4: "the credit request should already
 * be drafted when the count is saved. --calm, unsent … the receiver never
 * writes an email; the manager approves one later." This rail is where the
 * manager approves one later.
 *
 * The calm contract (same guarantee as OrdersNext's DraftRail, prc-02): a
 * draft is VISUALLY INCAPABLE of looking sent —
 * - state === 'open' is the only thing rendered here, and 'open' means the
 *   house opened the claim and no request has gone to the vendor;
 * - the edge is dashed and the card says who acted (the house, unasked) and
 *   what has NOT happened (nothing sent);
 * - the only forward control is the hold-to-approve die, a human gesture —
 *   completing it runs the REAL open→requested transition. A gateway refusal
 *   is stated in place and the die resets. There is no auto-anything.
 */

import { useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { settle, turn } from '@/lib/mudavym/motion';
import type { ProcurementCredit } from '@/services/api/credits';
import { EM, MONO, SANS, SERIF, capStyle, fmtDate, fmtMoney } from './rc-format';
import { useApproveCreditDraft, type CreditDraftsData } from './useReceivingNextData';

function DraftCard({ draft }: { draft: ProcurementCredit }) {
  const approve = useApproveCreditDraft();
  const [expanded, setExpanded] = useState(false);
  // Bumped after a refusal so the die remounts at rest instead of staying sealed.
  const [attempt, setAttempt] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);

  const onApprove = () => {
    setRefusal(null);
    approve.mutate(draft.id, {
      onError: (err) => {
        const msg = (err as { message?: string })?.message ?? 'request failed';
        setRefusal(`The gateway refused (${msg}) — still drafted, nothing sent.`);
        setAttempt((a) => a + 1);
      },
    });
  };

  return (
    <div
      style={{
        border: '1.5px dashed var(--seal-ring, rgba(26,94,107,.32))',
        borderRadius: 12,
        background: 'var(--paper-0, #FAF7F1)',
        padding: '12px 14px',
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--seal-deep, #14515C)',
            border: '1px dashed var(--seal-ring, rgba(26,94,107,.32))',
            borderRadius: 3,
            padding: '2px 6px',
          }}
        >
          Drafted by the house · unsent
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 15,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-1, #211C16)',
          }}
        >
          {fmtMoney(draft.claimed_amount)}
        </span>
      </div>

      <p
        style={{
          fontFamily: SERIF,
          fontSize: 13.5,
          fontWeight: 600,
          color: 'var(--ink-1, #211C16)',
          margin: '8px 0 0',
        }}
      >
        {draft.reason || 'Credit claim'}
        {draft.self_evidenced && (
          <span
            title="Provable from the vendor's own paperwork"
            style={{
              fontFamily: MONO,
              fontSize: 8.5,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--paper-0, #FAF7F1)',
              background: 'var(--seal, #1A5E6B)',
              borderRadius: 3,
              padding: '2px 6px',
              marginLeft: 8,
              verticalAlign: 'middle',
            }}
          >
            Provable
          </span>
        )}
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '3px 0 0' }}>
        Opened {fmtDate(draft.opened_at)} when the count was saved
        {draft.order_id ? ` · order ${draft.order_id.slice(0, 8)}` : ''} — a person has not sent
        anything to the vendor.
      </p>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          marginTop: 6,
          fontSize: 11.5,
          color: 'var(--seal-deep, #14515C)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textDecoration: 'underline',
          fontFamily: SANS,
        }}
      >
        {expanded ? 'Fold the working away' : 'Show the working'}
      </button>

      {/* the draft's working turns in — slower than settle, on purpose */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: `grid-template-rows ${turn.ms}ms ${turn.easing}`,
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              margin: '8px 0 2px',
              borderLeft: '2px solid var(--paper-2, #EAE4D8)',
              paddingLeft: 10,
              fontSize: 11.5,
              color: 'var(--ink-2, #4F473C)',
              lineHeight: 1.6,
            }}
          >
            <span style={capStyle}>What the house knows</span>
            <p style={{ margin: '3px 0 0' }}>{draft.notes || draft.reason || EM}</p>
            <p style={{ margin: '3px 0 0', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              claimed {fmtMoney(draft.claimed_amount)} · state {draft.state}
              {draft.document_id ? ' · document attached' : ' · no document attached'}
            </p>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <HoldToApprove
          key={`credit-${draft.id}-${attempt}`}
          label={`Hold to send the request — ${fmtMoney(draft.claimed_amount)}`}
          approvedLabel="Requested — it is with the vendor now"
          disabled={approve.isPending}
          onApprove={onApprove}
        />
        {refusal && (
          <p
            role="alert"
            style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}
          >
            {refusal}
          </p>
        )}
      </div>
    </div>
  );
}

export function RcCreditDrafts({ data }: { data: CreditDraftsData }) {
  const { drafts, hasData, isError, refetch } = data;

  return (
    <section aria-label="Drafted credit requests" style={{ fontFamily: SANS }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <h2
          style={{
            fontFamily: SERIF,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
            margin: 0,
          }}
        >
          Drafted, not sent
        </h2>
        <span style={capStyle}>the house acted · a person decides</span>
      </div>

      {isError && (
        <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          Drafts could not be loaded — how many exist is unknown.{' '}
          <button
            type="button"
            onClick={refetch}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--seal-deep, #14515C)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: SANS,
            }}
          >
            Try again
          </button>
        </p>
      )}

      {!hasData && !isError && (
        <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>Reaching the gateway…</p>
      )}

      {hasData && drafts.length === 0 && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--ink-3, #7C7365)',
            border: '1px dashed var(--paper-2, #EAE4D8)',
            borderRadius: 10,
            padding: '10px 12px',
            transition: `opacity ${settle.ms}ms ${settle.easing}`,
          }}
        >
          No credit request is waiting on a person. When a door count comes up short, the house
          drafts the claim here — unsent — with the evidence attached.
        </p>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} />
        ))}
      </div>
    </section>
  );
}

export default RcCreditDrafts;
