/**
 * "Is KDV inside this cost?" — the owner's or the manager's answer for a cost
 * typed by hand (ADR 0341 F3, founder 2026-10-12 S218: "Yes, stamp cost
 * basis"). Shown on a manual receipt, the opening stock file and the receipt
 * check, and only where it changes something: a house whose till prices
 * include tax, where margin advice uses a cost only once it is known to be
 * before tax. Every other house sees nothing, and sends nothing.
 *
 * THE RULES IT HOLDS:
 *   1. Nothing is chosen when it opens. The house's country is not turned into
 *      an answer: whether it may propose one is OD-232, still open. Nothing
 *      chosen sends nothing, and the cost is recorded as "not said".
 *   2. The sentence under it says what Save will record.
 *   3. Money: the caller shows it to owners and managers only (`enabled`), and
 *      the gateway refuses a cost from anyone else (F-312).
 */
import { useEffect, useState } from 'react'
import { getTaxBasis } from '../../pages/settings/next/TaxBasisSection'

export type CostTaxBasis = 'includes_tax' | 'excludes_tax'

export interface HouseCostTax {
  /** The house says its till prices include tax. */
  inclusive: boolean
  /** What the house's tax is called: "KDV" in Türkiye, "tax" elsewhere. */
  taxWord: string
}

/**
 * Whether this house's till prices include tax, read once per house. Null
 * while it is read, when it could not be read, and when `enabled` is false:
 * then the choice is not shown, and the cost is recorded as before.
 *
 * `houseId` is the active house: a switch of house does not remount a screen
 * that stays mounted (the manual receipt on /inventory), so without it the
 * question followed the house just left (F-1708). A new house reads again,
 * and shows nothing until its own answer is in.
 */
export function useHouseCostTax(enabled: boolean, houseId?: string | null): HouseCostTax | null {
  const [terms, setTerms] = useState<HouseCostTax | null>(null)
  useEffect(() => {
    setTerms(null)
    if (!enabled) return
    let live = true
    getTaxBasis()
      .then((r) => {
        if (live && r?.readable !== false)
          setTerms({ inclusive: r?.basis === 'prices_include_tax', taxWord: r?.taxWord || 'tax' })
      })
      .catch(() => {
        if (live) setTerms(null)
      })
    return () => {
      live = false
    }
  }, [enabled, houseId])
  return terms
}

export function CostTaxChoice({
  terms,
  value,
  onChange,
  disabled,
  what = 'this cost',
}: {
  terms: HouseCostTax | null
  value: CostTaxBasis | null
  onChange: (v: CostTaxBasis) => void
  disabled?: boolean
  /** What the question is about: "this cost", "the costs in this file". */
  what?: string
}) {
  if (!terms?.inclusive) return null
  const word = terms.taxWord
  const option = (v: CostTaxBasis, label: string) => (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
      <input
        type="radio"
        name="cost-tax-basis"
        value={v}
        checked={value === v}
        disabled={disabled}
        onChange={() => onChange(v)}
      />
      {label}
    </label>
  )
  return (
    <fieldset data-testid="cost-tax-choice" className="my-2">
      <legend className="text-xs font-semibold text-gray-900">
        Is {word} inside {what}?
      </legend>
      <div className="mt-1 flex items-center gap-4">
        {option('includes_tax', `Yes, ${word} is inside`)}
        {option('excludes_tax', `No, before ${word}`)}
      </div>
      <p data-testid="cost-tax-choice-says" className="mt-1 text-[11px] text-gray-500">
        {value === 'includes_tax'
          ? `Recorded as paid with ${word} inside. Margin advice works only on a cost before ${word}, so it will not use this one.`
          : value === 'excludes_tax'
            ? `Recorded as a cost before ${word}. Margin advice can use it.`
            : `Not said yet. The cost is recorded, but margin advice will not use it until you say.`}
      </p>
    </fieldset>
  )
}
