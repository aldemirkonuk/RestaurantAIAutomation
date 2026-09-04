/**
 * VerdictBlock — Direction B's block, on top of A's sheet (ADR 0104 D13).
 *
 * THE VERDICT COMES FIRST (D4). Before the parties, before the lines, before the
 * total: how many lines differ, how much money is at risk, and what the clock is
 * doing. Each exception is NAMED — "line 4 billed 12, received 10" — in words
 * AND numbers, never in colour alone: every state here reads correctly in
 * greyscale, printed, and to a screen reader, because the sentence carries the
 * meaning and the tint only repeats it.
 *
 * CONFIDENCE IS NEVER A NUMBER (D4, founder). There is no percentage anywhere in
 * this component and no code path that could produce one: the only numbers it
 * prints are quantities and money, both taken from the document.
 *
 * THE THIRD STATE IS NOT A PASS. `tiesOut: null` means the arithmetic could not
 * be tested (no stated total), and it renders as its own sentence. Folding it
 * into the green tick is the absence-as-health fault this repository names.
 */

import type {
  AdjudicatedLine,
  CanonicalDocument,
} from '../../services/api/canonical'
import { EM, MONO, SERIF, fmtMoney, fmtQty, fmtReceived } from './canonical-format'

/** The exception sentences, in the order a manager should read them. */
export function exceptionSentences(
  doc: CanonicalDocument,
): { lineNo: number; kind: string; sentence: string; money: number | null }[] {
  const currency = doc.layer1.currency.value
  return doc.layer3.lines
    .filter((l) => l.verdict !== 'ok')
    .map((l: AdjudicatedLine) => {
      const line = doc.layer1.lines[l.lineIndex]
      const name = line?.description.value ?? `Line ${l.lineIndex + 1}`
      const unit = line?.unit.value ?? ''
      const suffix = unit ? ` ${unit}` : ''
      let sentence: string
      switch (l.verdict) {
        case 'short_ship':
          sentence = `${name} — billed ${fmtQty(l.billed, currency)}${suffix}, received ${fmtReceived(l.received, currency)}${l.received === 'not_counted' ? '' : suffix}.`
          break
        case 'over_ship':
          sentence = `${name} — received ${fmtReceived(l.received, currency)}${suffix} against ${fmtQty(l.billed, currency)}${suffix} billed.`
          break
        case 'price_variance':
          sentence = `${name} — the unit price differs from what was agreed.`
          break
        case 'substitution':
          sentence = `${name} — a different item arrived. That is a decision, not a tolerance.`
          break
        default:
          sentence = `${name} — ${l.reason ?? l.verdict}.`
      }
      return {
        lineNo: l.lineIndex + 1,
        kind: l.verdict.replace(/_/g, ' '),
        sentence,
        money: l.moneyAtRisk,
      }
    })
}

export interface VerdictBlockProps {
  doc: CanonicalDocument
  /** The delivery states this document's event is in, for the clock chip. */
  states?: string[]
}

export function VerdictBlock({ doc, states = [] }: VerdictBlockProps) {
  const currency = doc.layer1.currency.value
  const exceptions = exceptionSentences(doc)
  const atRisk = exceptions.reduce((sum, e) => sum + (e.money ?? 0), 0)
  const anyMoneyKnown = exceptions.some((e) => e.money != null)
  /**
   * NOTHING READ IS NOT NOTHING WRONG.
   *
   * Caught on screen 2026-09-04: three real documents that extraction could not
   * read came back with zero lines, zero exceptions — and this block announced
   * "Nothing on this document differs from the delivery." A comparison that
   * never ran had rendered as a clean bill of health, which is this
   * repository's absence-as-health fault appearing in the one place it is most
   * expensive: the sentence a manager reads first.
   */
  const nothingRead = doc.layer1.lines.length === 0
  const clean = exceptions.length === 0 && !nothingRead

  return (
    <section
      className="cd-verdict"
      aria-label="Verdict"
      style={{
        borderLeft: `3px solid ${clean ? 'var(--seal, #1A5E6B)' : '#94661A'}`,
        borderRadius: 8,
        background: 'var(--paper-1, #F3EFE6)',
        padding: '9px 13px',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: SERIF,
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: '-.014em',
          lineHeight: 1.12,
        }}
      >
        {nothingRead
          ? 'Nothing was read from this document, so nothing could be compared.'
          : clean
            ? 'Nothing on this document differs from the delivery.'
            : `${exceptions.length} ${exceptions.length === 1 ? 'line differs' : 'lines differ'} from the delivery.`}
      </h2>

      {nothingRead && (
        <p style={{ margin: '3px 0 0', fontSize: 11.5, lineHeight: 1.35 }}>
          This is an <strong>unread</strong> document, not a clean one. No line
          on it has been checked against what was ordered, shipped, received or
          billed, and no amount is being claimed or ruled out.
        </p>
      )}

      <p
        style={{
          margin: '3px 0 0',
          fontFamily: MONO,
          fontSize: 11,
          color: 'var(--ink-2, #4F473C)',
        }}
      >
        {!clean && !nothingRead && (
          <>
            <span data-testid="money-at-risk">
              {anyMoneyKnown
                ? `${fmtMoney(atRisk, currency)} at risk`
                : 'the amount at risk is not yet computed'}
            </span>
            {' · '}
          </>
        )}
        <span>
          billed {fmtMoney(doc.layer1.totals.taxInclusiveAmount.value, currency)}
        </span>
        {states.length > 0 && (
          <>
            {' · '}
            <span data-testid="clock-chip">{states.join(' · ')}</span>
          </>
        )}
      </p>

      {/* The arithmetic self-check, with its third state kept separate. */}
      <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
        {nothingRead
          ? 'There are no lines to add up, so there is no arithmetic to check.'
          : doc.layer3.tiesOut === null
            ? 'The document states no total, so the arithmetic could not be checked. That is untested, not correct.'
            : doc.layer3.tiesOut
              ? 'The lines add up to the stated total.'
              : `The lines do not add up to the stated total (off by ${fmtMoney((doc.layer3.tieOutDeltaCents ?? 0) / 100, currency)}).`}
      </p>

      {exceptions.length > 0 && (
        <ul
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 8,
            margin: '8px 0 0',
            padding: 0,
            listStyle: 'none',
          }}
        >
          {exceptions.map((e) => (
            <li
              key={`${e.lineNo}-${e.kind}`}
              style={{
                border: '1px solid rgba(148,102,26,.32)',
                background: 'rgba(148,102,26,.10)',
                borderRadius: 7,
                padding: '5px 9px',
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  fontWeight: 600,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color: '#8A5F18',
                }}
              >
                {e.kind} · line {e.lineNo}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, lineHeight: 1.3, marginTop: 1 }}>
                {e.sentence}{' '}
                <strong style={{ fontFamily: MONO, fontWeight: 600 }}>
                  {e.money == null ? EM : fmtMoney(e.money, currency)}
                </strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default VerdictBlock
