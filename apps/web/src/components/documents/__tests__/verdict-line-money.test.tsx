/**
 * r34 walk w2 F6: a compared line whose money is not worked out yet ended its
 * card with a bare " —" after the sentence's full stop, which read as a
 * dangling dash. It now says so in words, and a known amount is unchanged.
 * SYNTHETIC data.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerdictBlock } from '../VerdictBlock'
import type { AdjudicatedLine, CanonicalDocument } from '../../../services/api/canonical'

const env = <T,>(value: T | null) => ({ value, source: 'extracted', confidence: null, revision: 1 })

function doc(l: Partial<AdjudicatedLine>): CanonicalDocument {
  const money = (n: number | null) => env(n)
  return {
    documentId: 'doc-syn',
    layer1: {
      currency: env('TRY'),
      lines: [{ description: env('Local Check Brut NV'), unit: env('case') }],
      totals: {
        linesNetTotal: money(600),
        allowancesTotal: money(0),
        chargesTotal: money(0),
        taxExclusiveAmount: money(600),
        taxAmount: money(0),
        taxInclusiveAmount: money(600),
        amountDue: money(600),
      },
    },
    layer2: { lines: [{ lineIndex: 0, canonicalUom: 'case', packSize: 12 }] },
    layer3: {
      lines: [
        { lineIndex: 0, ordered: null, shipped: 24, received: 36, billed: 24, verdict: 'over_ship', reason: null, moneyAtRisk: null, ...l },
      ],
      tiesOut: true,
      tieOutDeltaCents: 0,
      verdicts: [],
    },
  } as unknown as CanonicalDocument
}

describe('a compared line whose money is not worked out (r34 w2 F6)', () => {
  it('[REVERT-FAILS] ends in words, never a bare dash', () => {
    render(<VerdictBlock doc={doc({ moneyAtRisk: null })} />)
    const unknown = screen.getByTestId('line-money-unknown')
    expect(unknown).toHaveTextContent('The money on it is not worked out yet.')
    const card = unknown.parentElement as HTMLElement
    expect(card.textContent).toMatch(/billed\. The money on it is not worked out yet\.$/)
    expect(card.textContent).not.toMatch(/—\s*$/)
  })

  it('a worked-out amount still follows the sentence, and no words are added', () => {
    render(<VerdictBlock doc={doc({ moneyAtRisk: 120 })} />)
    expect(screen.queryByTestId('line-money-unknown')).toBeNull()
    expect(screen.getByText(/120/, { selector: 'strong' })).toBeTruthy()
  })

  it('a line nobody compared has no money slot at all', () => {
    render(<VerdictBlock doc={doc({ shipped: null, received: 'not_counted' as never, verdict: 'ok' })} />)
    expect(screen.queryByTestId('line-money-unknown')).toBeNull()
  })
})
