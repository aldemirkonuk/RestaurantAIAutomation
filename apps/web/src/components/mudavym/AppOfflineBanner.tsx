/**
 * The offline banner — sketch 119, "the shared pieces": "the offline strip
 * and ladder ... a per-record rung from `useSyncManager`, which exposes only
 * `pendingCount` today." A full per-record four-rung ladder needs
 * `useSyncManager` to expose more than an aggregate count — not built here
 * (see shell-chrome.md's "not built" section); what IS built is sketch 103's
 * standing rule applied to this aggregate banner: QUEUED IS NEVER CONFIRMED.
 *
 * The legacy `OfflineBanner` (`ui/SyncStatus.tsx`) says "N changes will
 * sync" while offline and says nothing at all once back online — a change
 * that failed to send, or one still sending, reads as silence, which this
 * house's honesty rule (CLAUDE.md §9, `absence-reported-as-health`) treats
 * as the same failure shape as a swallowed read error. This banner instead
 * distinguishes, in words: queued on this device (not sent) · sending (sent,
 * not yet answered) · could not send (answered: refused) · nothing to say
 * (queue empty, online, no error — the banner renders nothing, same as
 * legacy's happy path).
 *
 * GATED like every shell chrome piece: off, `OfflineBanner` unchanged.
 */

import { useEffect, useState } from 'react'
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign'
import { useSyncManager } from '../../hooks/useSyncManager'
import {
  persistShowsAPrompt,
  readStorageHealth,
  requestPersistence,
  unsentWaitedTooLong,
  type StorageHealth,
} from '../../lib/deviceStorage'
import { OfflineBanner } from '../ui/SyncStatus'
import './house-offline-banner.css'

/** "Try again" / "Discard": text buttons in the bar's own type (ADR 0241). */
const ACT = {
  font: 'inherit',
  color: 'var(--ink-1)',
  background: 'none',
  border: 0,
  padding: '4px 6px',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const

function pluralChange(n: number): string {
  return `${n} change${n === 1 ? '' : 's'}`
}

export function AppOfflineBanner() {
  const shellOn = useMudavymDesign('shell')
  if (!shellOn) return <OfflineBanner />
  // One fixed stack at the foot of the window, so the storage note sits under
  // the status bar instead of on top of it (house-offline-banner.css).
  return (
    <div className="mdv-offlinebar-stack">
      <HouseOfflineBanner />
      <DeviceStorageNote />
    </div>
  )
}

/** How often the note re-reads the queue's age while the app stays open. */
const STORAGE_NOTE_REREAD_MS = 10 * 60 * 1000

/**
 * A second line under the bar, only when there is unsent work on this device
 * and something about it is worth saying (the founder's storage ruling and
 * answers, 2026-09-29; lib/deviceStorage.ts):
 *   - it has waited longer than UNSENT_NUDGE_AFTER_MS (24 h): a quiet nudge;
 *   - the browser has not promised to keep it (not persistent, or cannot
 *     say — unknown is never read as safe): the Home Screen line. The founder
 *     made the Home Screen a strong hint, not a requirement, that ESCALATES:
 *     it has no dismiss and stays until the storage is persistent or the
 *     queue is empty. On Firefox, where asking shows a prompt, a button asks.
 * Nothing when there is no unsent work. It never blocks anything.
 */
function DeviceStorageNote() {
  const { pendingCount, notSentCount = 0, stillTryingCount = 0 } = useSyncManager()
  const [health, setHealth] = useState<StorageHealth | null>(null)
  const [reread, setReread] = useState(0)

  useEffect(() => {
    let live = true
    readStorageHealth()
      .then((h) => {
        if (live) setHealth(h)
      })
      .catch(() => {
        if (live) setHealth(null)
      })
    const again = () => setReread((n) => n + 1)
    const t = setInterval(again, STORAGE_NOTE_REREAD_MS)
    // Coming back to the app (e.g. after adding it to the Home Screen) re-reads.
    const onVisible = () => {
      if (document.visibilityState === 'visible') again()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pendingCount, notSentCount, stillTryingCount, reread])

  if (!health) return null
  const unsent = (health.pending ?? 0) + (health.parked ?? 0)
  if (unsent === 0) return null
  const waited = unsentWaitedTooLong(health)
  const unprotected = health.persisted !== true
  if (!waited && !unprotected) return null

  return (
    <div
      className="mdv-offlinebar mdv-offlinebar--note mudavym"
      role="status"
      data-ux-key="shell.offline.device-storage"
    >
      {unprotected && (
        <div data-ux-key="shell.offline.device-storage.unprotected">
          <span className="mdv-offlinebar__word">Add to Home Screen</span>
          <span>
            {' '}
            &middot; This browser may clear changes that are not sent yet. Adding Mudavym to
            the Home Screen keeps them safer.{' '}
          </span>
          {persistShowsAPrompt() && (
            <button
              type="button"
              style={ACT}
              onClick={() => {
                void requestPersistence().then(() => setReread((n) => n + 1))
              }}
            >
              Keep them on this device
            </button>
          )}
        </div>
      )}
      {waited && (
        <div data-ux-key="shell.offline.device-storage.waited">
          Some changes on this device have waited over a day to send — open with signal, or
          tell a manager.
        </div>
      )}
    </div>
  )
}

function HouseOfflineBanner() {
  const {
    isOnline,
    isSyncing,
    pendingCount,
    lastError,
    notSentCount = 0,
    stillTryingCount = 0,
    retryNotSent,
    discardNotSent,
  } = useSyncManager()

  // NOT SENT comes first (ADR 0241, OD-203 (a)): a change the server refused
  // for good is kept on this device and named here until the person decides.
  // It used to be deleted after three failures with only a console line.
  if (isOnline && notSentCount > 0) {
    return (
      <div className="mdv-offlinebar mdv-offlinebar--failed mudavym" role="alert">
        <span className="mdv-offlinebar__word">Not sent</span>
        <span>
          {' '}
          &middot; {pluralChange(notSentCount)} could not be saved and{' '}
          {notSentCount === 1 ? 'is' : 'are'} kept on this device.{' '}
        </span>
        <button
          type="button"
          style={ACT}
          onClick={() => void retryNotSent?.()}
        >
          Try again
        </button>{' '}
        <button
          type="button"
          style={ACT}
          onClick={() => {
            const n = notSentCount
            if (window.confirm(`Discard ${pluralChange(n)} that ${n === 1 ? 'was' : 'were'} not sent? This cannot be undone.`))
              void discardNotSent?.()
          }}
        >
          Discard
        </button>
      </div>
    )
  }

  if (!isOnline) {
    return (
      <div className="mdv-offlinebar mudavym" role="status">
        <span className="mdv-offlinebar__word">Offline</span>
        {pendingCount > 0 ? (
          <span>
            {' '}
            &middot; {pluralChange(pendingCount)} queued on this device — not sent, not
            confirmed. They will try to send once this device is back online.
          </span>
        ) : (
          <span> &middot; nothing is queued.</span>
        )}
      </div>
    )
  }

  if (isSyncing && pendingCount > 0) {
    return (
      <div className="mdv-offlinebar mudavym" role="status">
        <span className="mdv-offlinebar__word">Sending</span>
        <span> &middot; {pluralChange(pendingCount)} sent to the house, not yet confirmed.</span>
      </div>
    )
  }

  if (stillTryingCount > 0 && !lastError) {
    return (
      <div className="mdv-offlinebar mudavym" role="status">
        <span className="mdv-offlinebar__word">Still trying</span>
        <span>
          {' '}
          &middot; {pluralChange(stillTryingCount)} not sent yet. Kept on this device and
          retried until the house takes {stillTryingCount === 1 ? 'it' : 'them'}.{' '}
        </span>
        <button
          type="button"
          style={ACT}
          onClick={() => void retryNotSent?.()}
        >
          Try now
        </button>
      </div>
    )
  }

  if (lastError && pendingCount > 0) {
    return (
      <div className="mdv-offlinebar mdv-offlinebar--failed mudavym" role="alert">
        <span className="mdv-offlinebar__word">Could not send</span>
        <span> &middot; {pluralChange(pendingCount)} still queued. {lastError}</span>
      </div>
    )
  }

  return null
}

export default AppOfflineBanner
