/**
 * The onboarding half of the founder's cellar decision: **infer, then confirm
 * at onboarding**. Filed as §13 item 1 of `.planning/06-pages/wines.md`
 * ("Roadmap for the adaptation") and built here because `/get-started` is the
 * onboarding surface; the step component itself lives with the cellar.
 *
 * This wrapper owns exactly three things the step deliberately does not:
 *
 * 1. **The data.** `useCellarRegisters()` (tenant-keyed by
 *    `activeRestaurantId`) supplies the readout and the `PUT` that records it
 *    with `source: 'confirmed'`.
 * 2. **When there is nothing to ask.** A house whose registers are already
 *    `confirmed`/`manual` is not asked again, and a readout that could not be
 *    READ is not turned into a question either — an unread register is not an
 *    absent one, and re-asking on a failed read would launder a gateway error
 *    into the house's own answer. In both cases this renders nothing and calls
 *    `onDone()`, so the step can never wedge onboarding.
 * 3. **Skippability.** The step is never a gate. "Confirm later" continues the
 *    flow and writes nothing at all — the registers stay `inferred`, which is
 *    honestly different from `confirmed`.
 *
 * The whole component is behind `useMudavymDesign('cellar')` at the call site
 * (`GetStarted.tsx`) and lazy-loaded, so with the flag off neither this file
 * nor the cellar's CSS reaches the legacy bundle.
 */

import { useEffect, useState } from 'react'
import CellarRegistersStep from '../../pages/cellar/next/CellarRegistersStep'
import { useCellarRegisters } from '../../pages/cellar/next/useCellarNextData'
import '../../pages/cellar/next/cellar-next.css'

export interface CellarRegistersOnboardingProps {
  /** Continue the onboarding flow. Called on confirm, on skip, and when there is nothing to ask. */
  onDone: () => void
}

export default function CellarRegistersOnboarding({
  onDone,
}: CellarRegistersOnboardingProps) {
  const { data, loading, error, save } = useCellarRegisters()
  const [saveError, setSaveError] = useState<string | null>(null)

  // Nothing to ask: already answered, or the books could not be read at all.
  const nothingToAsk = !loading && (Boolean(error) || data?.awaitingConfirmation !== true)

  useEffect(() => {
    if (nothingToAsk) onDone()
  }, [nothingToAsk, onDone])

  if (nothingToAsk) return null

  return (
    <section className="mudavym" data-testid="onboarding-cellar-registers">
      <CellarRegistersStep
        readout={data}
        loading={loading}
        error={error}
        saving={save.isPending}
        saveError={saveError}
        onConfirm={async (registers) => {
          setSaveError(null)
          try {
            await save.mutateAsync({ registers, source: 'confirmed' })
            onDone()
          } catch (e) {
            // The flow is not advanced on a failed write: the house would
            // otherwise walk away believing it had answered.
            setSaveError(e instanceof Error ? e.message : 'no reason given')
          }
        }}
      />
      <button
        type="button"
        onClick={onDone}
        className="text-sm text-gray-500 hover:text-gray-800 mt-4"
        data-testid="onboarding-cellar-registers-skip"
      >
        Confirm later — you can change this under Settings &rarr; Cellar
      </button>
    </section>
  )
}
