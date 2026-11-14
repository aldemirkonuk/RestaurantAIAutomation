/**
 * r31 walk w2, F2: the sheet's verdict card said P1 as "received 24 cases
 * against 2 cases billed". Layer 3 counts a case line in bottles; the card
 * printed the bottles with the paper's unit word. The door frame's rule
 * (#1370) now holds here too: received in bottles, billed as the paper's
 * count with its bottles beside it when the pack is known.
 */
import { describe, expect, it } from 'vitest'
import { billedWords, exceptionSentences, receivedWords } from '../VerdictBlock'
import type { AdjudicatedLine, CanonicalDocument } from '../../../services/api/canonical'

const env = <T,>(value: T | null) => ({ value, source: 'extracted', confidence: null, revision: 1 })

function sheet(
  l: Partial<AdjudicatedLine>,
  over: { unit?: string; uom?: string | null; pack?: number | null } = {},
): CanonicalDocument {
  return {
    layer1: {
      currency: env('TRY'),
      lines: [{ description: env('Local Check Brut NV'), unit: env(over.unit ?? 'case') }],
    },
    layer2: {
      lines: [{ lineIndex: 0, canonicalUom: over.uom === undefined ? 'case' : over.uom, packSize: over.pack ?? null }],
    },
    layer3: {
      lines: [
        { lineIndex: 0, ordered: null, shipped: null, received: 24, billed: 24, verdict: 'ok', reason: null, moneyAtRisk: null, ...l },
      ],
    },
  } as unknown as CanonicalDocument
}

const said = (d: CanonicalDocument) => exceptionSentences(d).map((s) => s.sentence)

describe('the verdict card says a case line in bottles (r31 w2 F2)', () => {
  it('over ship on a case of 12: received in bottles, billed as cases with their bottles', () => {
    expect(said(sheet({ received: 36, billed: 24, verdict: 'over_ship' }, { pack: 12 }))).toEqual([
      'Local Check Brut NV — received 36 bottles against 2 cases (24 bottles) billed.',
    ])
  })

  it("P1 before the door's pack reaches the paper: the paper's own 2 cases, never 24 cases", () => {
    const s = said(sheet({ received: 24, billed: 2, verdict: 'over_ship' }))
    expect(s).toEqual(['Local Check Brut NV — received 24 bottles against 2 cases billed.'])
    expect(s.join(' ')).not.toContain('24 cases')
  })

  it('short ship on a case of 12, and a count still to come', () => {
    expect(said(sheet({ received: 12, billed: 24, verdict: 'short_ship' }, { pack: 12 }))).toEqual([
      'Local Check Brut NV — billed 2 cases (24 bottles), received 12 bottles.',
    ])
    expect(said(sheet({ received: 'not_counted', billed: 24, ordered: 24, verdict: 'short_ship' }, { pack: 12 }))).toEqual([
      'Local Check Brut NV — billed 2 cases (24 bottles), received not counted.',
    ])
  })

  it('a door count nothing else speaks for is said in bottles', () => {
    expect(said(sheet({ received: 24, billed: null, verdict: 'over_ship' }, { pack: 12 }))[0]).toBe(
      'Local Check Brut NV — counted 24 bottles at the door. Nothing has been ordered, despatched or billed against it, so nothing was compared.',
    )
  })

  it('a bottle line reads as it did', () => {
    expect(said(sheet({ received: 10, billed: 12, verdict: 'short_ship' }, { unit: 'bottle', uom: 'bottle' }))).toEqual([
      'Local Check Brut NV — billed 12 bottles, received 10 bottles.',
    ])
  })

  it('the words alone', () => {
    expect(billedWords(30, 'case', true, 12, 'TRY')).toBe('30 bottles')
    expect(billedWords(12, 'case', true, 12, 'TRY')).toBe('1 case (12 bottles)')
    expect(receivedWords(1, 'case', true, 'TRY')).toBe('1 bottle')
    expect(receivedWords(3, 'kg', false, 'TRY')).toBe('3 kg')
  })
})
