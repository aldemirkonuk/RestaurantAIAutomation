import { useEffect, useState } from 'react'
import type { MeBusy } from '../contexts/AuthContext'

/**
 * The calm line a page shows while the gateway is busy and the person's
 * session is being read again. The route is kept; nobody is sent to sign in.
 */
export function HouseBusyNotice({ busy }: { busy: MeBusy }) {
  const retryAt = 'retryAt' in busy ? busy.retryAt : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (retryAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [retryAt])

  const seconds = retryAt === null ? 0 : Math.max(1, Math.ceil((retryAt - now) / 1000))
  return (
    <p role="status" className="text-slate-600 font-medium text-center">
      {retryAt === null
        ? 'The house is still busy. Reload this page in a moment.'
        : `One moment, the house is busy; trying again in ${seconds}s.`}
    </p>
  )
}
