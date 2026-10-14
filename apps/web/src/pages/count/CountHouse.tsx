/**
 * The house a stock count is in, and the ways out of the wrong one.
 *
 * The count pages sit outside the app shell (App.tsx), so they had no house
 * name and no switcher: a phone last left in the other house walked that
 * house's count, and every line posts to its books the moment it is sent
 * (ADR 0343, the founder's F2 pick -- unchanged here). F-1628: each page
 * names the house, and a person with more than one house can switch there.
 * F-1629: a count link from another of their houses offers to open it there.
 * F-1617: an owner or a manager can stop a count, after saying so twice.
 */

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { abandonCountSession, houseHoldingCount, type HoldingHouse } from '@/services/api/countSessions'

const TAP = 'min-h-[56px] min-w-[56px]'
const BTN = `${TAP} rounded-xl px-4 text-base font-semibold`
const QUIET = `${BTN} bg-white/10 text-inkm-1 active:bg-white/20 disabled:opacity-50`
const DANGER = `${BTN} bg-amber-600 text-black active:bg-amber-700 disabled:opacity-50`

function saidBy(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

/** "Kadıköy, Istanbul" for the house open now; null when it is not known. */
function useCountHouseName(): string | null {
  const { availableRestaurants, activeRestaurantId } = useAuth()
  const here = (availableRestaurants ?? []).find((r) => r.id === activeRestaurantId)
  if (!here?.name) return null
  return here.city ? `${here.name}, ${here.city}` : here.name
}

/**
 * The house line under a count page's title. With more than one house it
 * offers the others; `onSwitched` runs after a switch, so a page showing a
 * count of the house just left can leave it.
 */
export function CountHouseLine({ onSwitched }: { onSwitched?: () => void }) {
  const { availableRestaurants, activeRestaurantId, setActiveRestaurantId } = useAuth()
  const name = useCountHouseName()
  const [switching, setSwitching] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const others = (availableRestaurants ?? []).filter((r) => r.id !== activeRestaurantId)

  const switchTo = async (id: string) => {
    const to = others.find((r) => r.id === id)
    if (!to) return
    setSwitching(true)
    setRefused(null)
    const ok = await setActiveRestaurantId(id)
    setSwitching(false)
    if (!ok) setRefused(`${to.name} could not be opened, so you are still in this house. Try again.`)
    else onSwitched?.()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 px-4 py-2 text-sm">
      <span data-testid="count-house" className="text-inkm-2">
        {name ? (
          <>
            In <span className="font-semibold text-inkm-1">{name}</span>
          </>
        ) : (
          'In the house open on this phone'
        )}
      </span>
      {others.length > 0 && (
        <label className="flex items-center gap-2 text-inkm-2">
          <span>Not this house?</span>
          <select
            aria-label="Switch to another house"
            value=""
            disabled={switching}
            onChange={(e) => void switchTo(e.target.value)}
            className="min-h-[44px] rounded-lg bg-white/10 px-2 text-inkm-1"
          >
            <option value="" disabled>
              {switching ? 'Switching…' : 'Switch'}
            </option>
            {others.map((r) => (
              <option key={r.id} value={r.id}>
                {r.city ? `${r.name}, ${r.city}` : r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {refused && (
        <p role="status" className="w-full text-amber-300">
          {refused}
        </p>
      )}
    </div>
  )
}

/**
 * F-1629: the count a link names is in another of this person's houses.
 * Says nothing while asking, when the read fails, or when no house of theirs
 * holds it; "Open it there" moves the session, and the page reads it again.
 */
export function CountHeldElsewhere({ sessionId }: { sessionId: string }) {
  const { activeRestaurantId, setActiveRestaurantId } = useAuth()
  const [house, setHouse] = useState<HoldingHouse | null>(null)
  const [opening, setOpening] = useState(false)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let live = true
    setHouse(null)
    Promise.resolve()
      .then(() => houseHoldingCount(sessionId))
      .then((h) => live && setHouse(h))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [sessionId, activeRestaurantId])

  if (!house || house.id === activeRestaurantId) return null
  const name = house.name || 'another of your houses'
  const open = async () => {
    setOpening(true)
    setRefused(false)
    const ok = await setActiveRestaurantId(house.id)
    setOpening(false)
    if (!ok) setRefused(true)
  }
  return (
    <div data-testid="count-held-elsewhere" className="space-y-2 rounded-xl bg-white/5 px-4 py-3">
      <p>This count is in {name}.</p>
      <button type="button" disabled={opening} className={`${QUIET} w-full`} onClick={() => void open()}>
        {opening ? `Opening ${name}…` : `Open it in ${name}`}
      </button>
      {refused && (
        <p role="status" className="text-sm text-amber-300">
          {name} could not be opened, so you are still in this house. Try again.
        </p>
      )}
    </div>
  )
}

/**
 * F-1617: "Stop this count", an owner's or a manager's act. Asks first, and
 * says what stopping keeps: every count already sent stays on the books.
 */
export function StopCount({ sessionId, onStopped }: { sessionId: string; onStopped: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      await abandonCountSession(sessionId)
      setAsking(false)
      onStopped()
    } catch (err) {
      setError(saidBy(err, 'The count could not be stopped. Check the signal and try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        data-ux-key="count:stop"
        className={`${QUIET} w-full`}
        onClick={() => setAsking(true)}
      >
        Stop this count
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-xl bg-white/5 px-4 py-3">
      <p role="alert" className="text-inkm-1">
        Stop this count? It closes for everyone. What was already counted stays on the books, and shelves not counted
        stay not counted.
      </p>
      {error && <p className="text-sm text-amber-300">{error}</p>}
      <button type="button" disabled={busy} className={`${DANGER} w-full`} onClick={() => void stop()}>
        Stop it
      </button>
      <button type="button" disabled={busy} className={`${QUIET} w-full`} onClick={() => setAsking(false)}>
        Keep counting
      </button>
    </div>
  )
}
