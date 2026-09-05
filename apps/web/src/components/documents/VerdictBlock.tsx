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

/**
 * Whether this line had anything to be compared AGAINST.
 *
 * ADR 0103 A6, applied to the verdict rather than to the door column. A line
 * with no order line, no despatch line and no door count has three empty
 * columns and one billed quantity — there is no comparison to pass or fail, and
 * `received === 'not_counted'` is the explicit statement that nobody counted.
 */
export function hasComparisonSource(l: AdjudicatedLine): boolean {
  return l.ordered != null || l.shipped != null || l.received !== 'not_counted'
}

/** The exception sentences, in the order a manager should read them. */
export function exceptionSentences(doc: CanonicalDocument): {
  lineNo: number
  kind: string
  sentence: string
  money: number | null
  compared: boolean
}[] {
  const currency = doc.layer1.currency.value
  return doc.layer3.lines
    .filter((l) => l.verdict !== 'ok')
    .map((l: AdjudicatedLine) => {
      const line = doc.layer1.lines[l.lineIndex]
      const name = line?.description.value ?? `Line ${l.lineIndex + 1}`
      const unit = line?.unit.value ?? ''
      const suffix = unit ? ` ${unit}` : ''
      /**
       * NOT COMPARED IS NOT A DIFFERENCE.
       *
       * Caught on screen 2026-09-04: three documents with no order and no door
       * count rendered "4 lines differ from the delivery" and a
       * `NOT ADJUDICATED` chip on every line — the word ADJUDICATED asserting
       * that something had been judged, when nothing had been compared. The
       * mirror of absence-as-health: an absent comparison read as a finding.
       */
      if (!hasComparisonSource(l))
        return {
          lineNo: l.lineIndex + 1,
          kind: 'not compared',
          sentence: `${name} — billed ${fmtQty(l.billed, currency)}${suffix}. Nothing was ordered, despatched or counted against it, so nothing was compared.`,
          money: null,
          compared: false,
        }
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
        compared: true,
      }
    })
}

/**
 * THE SHEET MUST FLAG ITS OWN INCONSISTENCY.
 *
 * `layer3.tiesOut` is the DOOR's tie-out: the extractor's line sum against the
 * document's stated total, computed at intake. It says nothing about the ladder
 * this sheet actually prints. Measured on screen 2026-09-05: the Turkish
 * invoice `b1e02edf` rendered Lines ₺9.352,00 + Charges ₺180,00 = Before tax
 * ₺9.532,00, Tax ₺1.834,40 — a ladder totalling ₺11.366,40 — with the stated
 * total ₺11.186,40 printed directly beneath it, and this block said "The lines
 * add up to the stated total." The page contradicted itself in two adjacent
 * rows and reported health.
 *
 * So the printed ladder is checked against the printed total, here, from the
 * same envelopes the totals block renders. Returns null when the two agree to
 * the cent, and null when any of the three is absent — an ABSENT number is not
 * a disagreement, and claiming one would be the mirror fault.
 */
export function ladderDisagreement(doc: CanonicalDocument): {
  computed: number
  stated: number
  delta: number
} | null {
  const t = doc.layer1.totals
  const before = t.taxExclusiveAmount.value
  const tax = t.taxAmount.value
  const stated = t.taxInclusiveAmount.value
  if (before == null || tax == null || stated == null) return null
  const computed = Math.round((before + tax) * 100) / 100
  const delta = Math.round((stated - computed) * 100) / 100
  return Math.abs(Math.round(delta * 100)) <= 1 ? null : { computed, stated, delta }
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
  /** The sheet's own rows against the sheet's own stated total. */
  const ladder = ladderDisagreement(doc)
  /**
   * NOTHING COMPARED IS NOT NOTHING WRONG EITHER — and it is not a difference.
   *
   * `differing` counts only lines that HAD a comparison source, so "N lines
   * differ" is said only when at least one line was genuinely compared. With no
   * order and no door count anywhere on the document the headline names the
   * absence instead, in the words ADR 0103 A6 uses on the door column.
   */
  const compared = doc.layer3.lines.filter(hasComparisonSource)
  const differing = exceptions.filter((e) => e.compared)
  const nothingCompared = !nothingRead && compared.length === 0
  const clean = differing.length === 0 && !nothingRead && !nothingCompared

  return (
    <section
      className="cd-verdict"
      aria-label="Verdict"
      style={{
        // Amber means SOMETHING DIFFERS. A document nobody compared is neither
        // clean nor in exception, so it gets neither colour — the sentence
        // carries the meaning and the tint must not overstate it.
        borderLeft: `3px solid ${
          nothingCompared || nothingRead
            ? 'var(--ink-3, #7C7365)'
            : clean
              ? 'var(--seal, #1A5E6B)'
              : '#94661A'
        }`,
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
          : nothingCompared
            ? 'Not compared — no order or door count to compare against.'
            : clean
              ? 'Nothing on this document differs from the delivery.'
              : `${differing.length} ${differing.length === 1 ? 'line differs' : 'lines differ'} from the delivery.`}
      </h2>

      {nothingRead && (
        <p style={{ margin: '3px 0 0', fontSize: 11.5, lineHeight: 1.35 }}>
          This is an <strong>unread</strong> document, not a clean one. No line
          on it has been checked against what was ordered, shipped, received or
          billed, and no amount is being claimed or ruled out.
        </p>
      )}

      {nothingCompared && (
        <p
          data-testid="not-compared-note"
          style={{ margin: '3px 0 0', fontSize: 11.5, lineHeight: 1.35 }}
        >
          This document was <strong>read</strong> but not{' '}
          <strong>compared</strong>. It sits on no order line, no despatch line
          and no door count, so there is nothing to check its quantities
          against — that is a missing counterpart, not a discrepancy, and no
          amount is being claimed or ruled out.
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
        {!clean && !nothingRead && !nothingCompared && (
          <>
            <span data-testid="money-at-risk">
              {anyMoneyKnown
                ? `${fmtMoney(atRisk, currency)} at risk`
                : 'the amount at risk is not yet computed'}
            </span>
            {' · '}
          </>
        )}
        {nothingCompared && (
          <>
            {/* Not "0.00 at risk". Nothing was compared, so no amount is being
                claimed and none is being ruled out either. */}
            <span data-testid="money-at-risk">nothing is being claimed</span>
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

      {/* The arithmetic self-check, with its third state kept separate. The
          LADDER check comes first: a sheet whose own rows do not add up must
          say so before it reports on anybody else's arithmetic. */}
      <p
        data-testid="tie-out-sentence"
        style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}
      >
        {nothingRead
          ? 'There are no lines to add up, so there is no arithmetic to check.'
          : ladder
            ? `The stated total ${fmtMoney(ladder.stated, currency)} does not match the lines plus charges plus tax, ${fmtMoney(ladder.computed, currency)} — off by ${fmtMoney(Math.abs(ladder.delta), currency)}.`
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
              data-testid={e.compared ? 'exception-card' : 'not-compared-card'}
              style={{
                border: e.compared
                  ? '1px solid rgba(148,102,26,.32)'
                  : '1px solid var(--paper-2, #EAE4D8)',
                background: e.compared ? 'rgba(148,102,26,.10)' : 'transparent',
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
                  color: e.compared ? '#8A5F18' : 'var(--ink-3, #7C7365)',
                }}
              >
                {e.kind} · line {e.lineNo}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, lineHeight: 1.3, marginTop: 1 }}>
                {e.sentence}
                {/* An em dash where a claim would go says "we have not worked
                    it out yet". On a line nobody compared there is no claim to
                    work out, so the slot is absent rather than empty. */}
                {e.compared && (
                  <>
                    {' '}
                    <strong style={{ fontFamily: MONO, fontWeight: 600 }}>
                      {e.money == null ? EM : fmtMoney(e.money, currency)}
                    </strong>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default VerdictBlock
