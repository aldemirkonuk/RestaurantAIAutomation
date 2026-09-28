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

import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign'
import { useSyncManager } from '../../hooks/useSyncManager'
import { OfflineBanner } from '../ui/SyncStatus'
import './house-offline-banner.css'

function pluralChange(n: number): string {
  return `${n} change${n === 1 ? '' : 's'}`
}

export function AppOfflineBanner() {
  const shellOn = useMudavymDesign('shell')
  if (!shellOn) return <OfflineBanner />
  return <HouseOfflineBanner />
}

function HouseOfflineBanner() {
  const { isOnline, isSyncing, pendingCount, lastError } = useSyncManager()

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
