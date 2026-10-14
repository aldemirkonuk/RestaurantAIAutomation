import { useState } from 'react'
import {
  ANSWERS,
  answerLabel,
  confirmTaxBasis,
  getTaxBasis,
  readAnswer,
  type TaxBasisAnswer,
  type TaxBasisReadout,
} from '../../pages/settings/next/TaxBasisSection'

/**
 * Whether the house's tax basis is asked in the arrival (F-1590): only when it
 * can be read and is still unset. A read that fails, or a house that has
 * answered, goes straight on to the menu, and the dashboard's setup line stays
 * the fallback (ADR 0341 §2). Never decided by the country: every house that
 * has not answered is asked, and the country only suggests (ADR 0341 §1-§2).
 */
export async function taxBasisToAsk(): Promise<TaxBasisReadout | null> {
  try {
    const reg = await getTaxBasis()
    return reg && reg.readable === true && reg.basis === 'unset' ? reg : null
  } catch {
    return null
  }
}

interface TaxBasisStepProps {
  reg: TaxBasisReadout
  /** Answered or skipped; the arrival goes on to the menu either way. */
  onDone: () => void
}

/**
 * "Do the prices on your till include KDV?", asked once the house is open and
 * before any till is connected (F-1590). A check stored before the answer is
 * never made pre-tax later (ADR 0341 F2), so the earliest moment is the only
 * one that keeps the first week's net right. Skipping records nothing.
 */
export function TaxBasisStep({ reg, onDone }: TaxBasisStepProps) {
  const [chosen, setChosen] = useState<TaxBasisAnswer | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answer = readAnswer(chosen, reg)
  const proposal = reg.proposal

  const handleSave = async () => {
    if (!answer.canConfirm || chosen === null) return
    setSaving(true)
    setError(null)
    try {
      await confirmTaxBasis(chosen)
      onDone()
    } catch (e: any) {
      setError(
        `The answer was not saved — ${e?.response?.data?.message || e?.message || 'no reason was given'}. You can skip and answer it later in Settings.`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">Your till&apos;s prices</p>
      <h1 className="mt-3 font-serif text-4xl sm:text-5xl leading-tight">
        Do the prices on your till include {reg.taxWord}?
      </h1>
      <p className="mt-4 text-[#6d685f]">
        Net sales are counted before {reg.taxWord}. Answer now, before your till sends its first sale: sales recorded
        before you answer stay as the till sent them.
      </p>

      <fieldset className="mt-8 space-y-3">
        <legend className="sr-only">Till prices and {reg.taxWord}</legend>
        {ANSWERS.map((a) => (
          <label key={a} className="flex items-center gap-3 border border-[#211f1b]/15 bg-white px-4 py-3 text-sm">
            <input
              type="radio"
              name="tax-basis"
              value={a}
              checked={chosen === a}
              onChange={() => setChosen(a)}
            />
            <span>{answerLabel(a, reg.taxWord)}</span>
          </label>
        ))}
      </fieldset>

      {proposal && chosen === null && (
        <p data-testid="arrival-tax-proposal" className="mt-3 text-sm text-[#6d685f]">
          Suggested from your country: “{answerLabel(proposal.basis, reg.taxWord)}”. {proposal.why} Nothing is set
          until you choose.
        </p>
      )}
      {chosen !== null && <p className="mt-3 text-sm text-[#6d685f]">{answer.sentence}</p>}

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-9 flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !answer.canConfirm}
          className="bg-[#1a5e6b] px-6 py-3 text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-[#6d685f] underline underline-offset-4">
          Skip for now — the dashboard will ask again
        </button>
      </div>
    </>
  )
}
