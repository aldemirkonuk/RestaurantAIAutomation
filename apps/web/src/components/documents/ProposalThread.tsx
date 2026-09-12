/**
 * ProposalThread — every position either side put on the record (ADR 0103 D7).
 *
 * WHY A THREAD AND NOT A FORM. The thing being built here is the evidence a
 * vendor argument rests on: who said what, when, about which line, with what
 * money at stake. A form that ended in "resolved: yes/no" would throw away the
 * only part that matters six months later. Every row stays; a counter points at
 * what it answers; an accept stamps who accepted and when.
 *
 * WRONG_VENUE IS MARKED AS A REJECTION, ON SCREEN. D7 says it never enters
 * RECONCILING — it is not a discrepancy to negotiate but a truck at the wrong
 * address — and the picker says so beside the option rather than letting someone
 * discover it from the state change afterwards.
 *
 * THE GATEWAY IS THE AUTHORITY ON EVERY REFUSAL. This component sends and shows
 * what comes back, verbatim. It does not decide whether a proposal may be filed,
 * because a client that re-implemented the rule would eventually disagree with
 * the server about what happened.
 */

import { useState } from 'react'
import type { Proposal, ReasonClass } from '../../services/api/deliveries'
import { REASON_CLASSES } from '../../services/api/deliveries'
import { EM, MONO, fmtStamp } from './canonical-format'

/** The sentence beside each reason, so the picker teaches rather than lists. */
const REASON_SENTENCES: Record<ReasonClass, string> = {
  SHORT_SHIP: 'fewer arrived than the paperwork says',
  OVER_SHIP: 'more arrived than the paperwork says',
  SUBSTITUTION: 'a different product arrived — a human has to accept the swap',
  VINTAGE_CHANGE: 'a different vintage — a substitution, never a tolerance',
  PRICE_VARIANCE: 'the price differs from what was agreed',
  DAMAGED: 'it arrived broken, leaking or spoiled',
  WRONG_VENUE: 'this is not our delivery — REJECTS the whole thing, never negotiated',
  DUPLICATE_DOCUMENT: 'we have already had this document',
  FREE_GOODS: 'supplied free under a deal — kept out of cost and price history',
  DEPOSIT_OR_FEE: 'refundable deposit or a fee, not goods',
}

export interface ProposalThreadProps {
  proposals: Proposal[] | null
  failedRead?: string | null
  jurisdiction?: string | null
  currency?: string | null
  /** Absent = read-only (no delivery, or the caller has no write path). */
  onPropose?: (body: {
    side: 'restaurant' | 'vendor'
    reason: ReasonClass
    lineNo?: number
    qtyProposedBottles?: number
    moneyAtRisk?: number
    note?: string
  }) => Promise<void>
  onCounter?: (proposalId: string, body: {
    side: 'restaurant' | 'vendor'
    reason: ReasonClass
    moneyAtRisk?: number
    note?: string
  }) => Promise<void>
  onAccept?: (proposalId: string) => Promise<void>
  /** The line the sheet has selected, pre-filled into a new proposal. */
  selectedLine?: number | null
  busy?: boolean
  error?: string | null
}

const KICK: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
}

export function ProposalThread({
  proposals,
  failedRead,
  jurisdiction,
  currency,
  onPropose,
  onCounter,
  onAccept,
  selectedLine,
  busy,
  error,
}: ProposalThreadProps) {
  const [open, setOpen] = useState(false)
  const [counteringId, setCounteringId] = useState<string | null>(null)
  const [side, setSide] = useState<'restaurant' | 'vendor'>('restaurant')
  const [reason, setReason] = useState<ReasonClass>('SHORT_SHIP')
  const [qty, setQty] = useState('')
  const [money, setMoney] = useState('')
  const [note, setNote] = useState('')

  // A FAILED READ IS NOT AN EMPTY THREAD (ADR 0067). "Nobody has disputed
  // anything" is exactly the sentence an agreement would be argued from.
  if (proposals === null)
    return (
      <section
        data-testid="thread-failed"
        style={{ fontSize: 11.5, color: '#B0362C', padding: '6px 0' }}
      >
        The positions on this delivery could not be read
        {failedRead ? ` — ${failedRead}` : ''}. This is not “nobody has disputed
        anything”: it is a question this screen cannot answer right now.
      </section>
    )

  const submit = async () => {
    const body = {
      side,
      reason,
      ...(selectedLine != null ? { lineNo: selectedLine + 1 } : {}),
      ...(qty.trim() ? { qtyProposedBottles: Number(qty.replace(',', '.')) } : {}),
      ...(money.trim() ? { moneyAtRisk: Number(money.replace(',', '.')) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    if (counteringId && onCounter) await onCounter(counteringId, body)
    else if (onPropose) await onPropose(body)
    setQty('')
    setMoney('')
    setNote('')
    setCounteringId(null)
    setOpen(false)
  }

  return (
    <section
      data-testid="proposal-thread"
      aria-label="Positions on this delivery"
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 10,
        padding: '8px 11px',
        background: 'var(--paper-0, #FFFDF8)',
      }}
    >
      <span style={KICK}>
        Positions on the record · {proposals.length}
      </span>

      {proposals.length === 0 && (
        <p
          data-testid="thread-empty"
          style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
        >
          Nobody has disputed anything on this delivery. Agreement still needs both
          sides on the record — a document the vendor issued counts as theirs.
        </p>
      )}

      <ol style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {proposals.map((p) => (
          <li
            key={p.id}
            data-testid="proposal-row"
            data-side={p.side}
            data-status={p.status}
            style={{
              borderLeft: `3px solid ${p.side === 'vendor' ? '#946612' : 'var(--seal, #1A5E6B)'}`,
              paddingLeft: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              {p.side === 'vendor' ? 'The vendor' : 'We'} ·{' '}
              {p.reason.replace(/_/g, ' ').toLowerCase()}
              {p.line_no != null ? ` · line ${p.line_no}` : ''}
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 10.5,
                color: 'var(--ink-2, #4F473C)',
              }}
            >
              {p.note ?? REASON_SENTENCES[p.reason] ?? EM}
              {p.qty_proposed != null ? ` · ${p.qty_proposed}` : ''}
              {p.money_at_risk != null
                ? ` · ${currency === 'TRY' ? '₺' : ''}${p.money_at_risk}`
                : ''}
            </span>
            <span style={{ display: 'block', fontFamily: MONO, fontSize: 9, color: 'var(--ink-3, #7C7365)' }}>
              {fmtStamp(p.proposed_at, jurisdiction, currency)} · {p.status}
              {p.counters_proposal_id ? ' · answers an earlier position' : ''}
            </span>

            {p.status === 'open' && (onAccept || onCounter) && (
              <span className="cd-no-print" style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                {onAccept && (
                  <button
                    type="button"
                    data-testid="accept-proposal"
                    disabled={busy}
                    onClick={() => void onAccept(p.id)}
                    style={linkButton}
                  >
                    Accept it
                  </button>
                )}
                {onCounter && (
                  <button
                    type="button"
                    data-testid="counter-proposal"
                    onClick={() => {
                      setCounteringId(p.id)
                      setSide(p.side === 'vendor' ? 'restaurant' : 'vendor')
                      setReason(p.reason)
                      setOpen(true)
                    }}
                    style={linkButton}
                  >
                    Answer it
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>

      {(onPropose || onCounter) && !open && (
        <button
          type="button"
          data-testid="open-proposal-form"
          className="cd-no-print"
          onClick={() => {
            setCounteringId(null)
            setOpen(true)
          }}
          style={{ ...linkButton, marginTop: 6 }}
        >
          Put a position on the record
        </button>
      )}

      {open && (
        <div data-testid="proposal-form" style={{ marginTop: 7, display: 'grid', gap: 5 }}>
          <span style={KICK}>
            {counteringId ? 'Answering a position' : 'A new position'}
            {selectedLine != null ? ` · line ${selectedLine + 1}` : ' · the whole delivery'}
          </span>

          <label style={{ fontSize: 11, fontWeight: 600 }}>
            Whose position
            <select
              data-testid="proposal-side"
              value={side}
              onChange={(e) => setSide(e.target.value as 'restaurant' | 'vendor')}
              style={field}
            >
              <option value="restaurant">Ours</option>
              <option value="vendor">The vendor’s (record what they said)</option>
            </select>
          </label>

          <label style={{ fontSize: 11, fontWeight: 600 }}>
            What is wrong
            <select
              data-testid="proposal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonClass)}
              style={field}
            >
              {REASON_CLASSES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ').toLowerCase()} — {REASON_SENTENCES[r]}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, flex: 1 }}>
              How many arrived (bottle-equivalents)
              <input
                data-testid="proposal-qty"
                value={qty}
                inputMode="decimal"
                onChange={(e) => setQty(e.target.value)}
                style={{ ...field, fontFamily: MONO }}
              />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, flex: 1 }}>
              Money at risk
              <input
                data-testid="proposal-money"
                value={money}
                inputMode="decimal"
                onChange={(e) => setMoney(e.target.value)}
                style={{ ...field, fontFamily: MONO }}
              />
            </label>
          </div>

          <label style={{ fontSize: 11, fontWeight: 600 }}>
            In your words
            <textarea
              data-testid="proposal-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ ...field, resize: 'vertical' }}
            />
          </label>

          {error && (
            <p data-testid="proposal-error" role="alert" style={{ margin: 0, fontSize: 11, color: '#B0362C' }}>
              {error}
            </p>
          )}

          <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)} style={linkButton}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="submit-proposal"
              disabled={busy}
              onClick={() => void submit()}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 7,
                border: 0,
                background: 'var(--seal, #1A5E6B)',
                color: '#FFFDF8',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Recording…' : 'Record it'}
            </button>
          </span>
        </div>
      )}
    </section>
  )
}

const linkButton: React.CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--seal-deep, #14515C)',
  background: 'none',
  border: 0,
  padding: 0,
  cursor: 'pointer',
}

const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 2,
  padding: '4px 7px',
  fontSize: 12,
  border: '1px solid var(--paper-2, #EAE4D8)',
  borderRadius: 7,
  background: 'var(--paper-0, #FFFDF8)',
}

export default ProposalThread
