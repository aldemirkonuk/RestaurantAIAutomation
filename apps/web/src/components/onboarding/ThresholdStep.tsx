import { useEffect, useState } from 'react'
import { getCarriedCount, setDefaultThreshold } from '../../services/api/menus'

interface ThresholdStepProps {
  onDone: () => void
}

/**
 * The house's low-stock number, drawn inside the arrival (F-1062). One number
 * for the whole house, not a per-item form.
 *
 * The number is copied onto an item only when the item is added, so it says
 * so (F-1059): items already carried keep their own number unless the person
 * ticks the counted "Also set it on the N items you carry now". Nothing
 * carried changes without that tick.
 */
export function ThresholdStep({ onDone }: ThresholdStepProps) {
  const [value, setValue] = useState(6)
  const [carried, setCarried] = useState<number | null>(null)
  const [applyToCarried, setApplyToCarried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Unread, the offer is not drawn: an uncounted "N items" would be a guess.
    getCarriedCount()
      .then((n) => {
        if (live) setCarried(n)
      })
      .catch(() => {
        if (live) setCarried(null)
      })
    return () => {
      live = false
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await setDefaultThreshold(value, applyToCarried && (carried ?? 0) > 0)
      onDone()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'We could not save the number yet. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#1a5e6b]">Low stock</p>
      <h1 className="mt-3 font-serif text-4xl sm:text-5xl leading-tight">When should we say an item is running low?</h1>
      <p className="mt-4 text-[#6d685f]">
        One number for the house. Every item you add from now on starts with it, and we flag the item when it
        drops below that many. You can change any item&apos;s number later from Inventory.
      </p>

      <div className="mt-10 flex items-center gap-4">
        <button
          type="button"
          aria-label="One less"
          onClick={() => setValue((v) => Math.max(0, v - 1))}
          className="h-10 w-10 border border-[#211f1b]/20 bg-white text-lg"
        >
          −
        </button>
        <input
          type="number"
          aria-label="Low-stock number"
          min={0}
          max={999}
          value={value}
          onChange={(e) => setValue(Math.min(999, Math.max(0, parseInt(e.target.value, 10) || 0)))}
          className="w-24 border-b border-[#211f1b]/25 bg-transparent py-1 text-center font-serif text-3xl outline-none"
        />
        <button
          type="button"
          aria-label="One more"
          onClick={() => setValue((v) => Math.min(999, v + 1))}
          className="h-10 w-10 border border-[#211f1b]/20 bg-white text-lg"
        >
          +
        </button>
      </div>
      <p className="mt-2 text-xs uppercase tracking-wider text-[#6d685f]">per item, for the whole house</p>

      {carried != null && carried > 0 && (
        <label className="mt-8 flex items-start gap-3 border border-[#211f1b]/15 bg-white px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={applyToCarried}
            onChange={(e) => setApplyToCarried(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also set it on the {carried} item{carried === 1 ? '' : 's'} you carry now.
            <span className="block text-[#6d685f]">
              Left unticked, they keep the number each one has today.
            </span>
          </span>
        </label>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-9 flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-[#1a5e6b] px-6 py-3 text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-[#6d685f] underline underline-offset-4">
          Skip for now
        </button>
      </div>
    </>
  )
}
