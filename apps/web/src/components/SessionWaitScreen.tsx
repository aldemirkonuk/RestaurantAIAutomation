/**
 * What a signed-in person sees while their stored session waits to be read
 * again (a 429, a 5xx, a dropped connection on `/auth/me`): who they are is
 * not in doubt, so this is never /login. It says why, when the next try is,
 * and offers to try now, or to sign out (the wait has no attempt limit).
 */
import { useEffect, useState } from 'react'
import { sessionWaitWords, type SessionWait } from '../lib/sessionWait'
import './mudavym/house-page-loader.css'

export function SessionWaitScreen({
  wait,
  onRetryNow,
  onSignOut,
}: {
  wait: SessionWait
  onRetryNow?: () => void
  onSignOut?: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  const words = sessionWaitWords(wait, now)
  return (
    <div className="mdv-pageloader mudavym" role="status" aria-live="polite" data-session-wait={wait.reason}>
      <p className="mdv-pageloader__mark">{words.title}</p>
      <p style={{ margin: 0, maxWidth: 420, textAlign: 'center', color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.5 }}>
        {words.body}
      </p>
      {onRetryNow ? (
        <button
          type="button"
          onClick={onRetryNow}
          style={{
            marginTop: 8,
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid var(--rule-2, var(--ink-4))',
            background: 'var(--paper-1)',
            color: 'var(--ink-1)',
            font: 'inherit',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Try now
        </button>
      ) : null}
      {onSignOut ? (
        <button
          type="button"
          onClick={onSignOut}
          style={{ border: 0, background: 'none', color: 'var(--ink-2)', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
        >
          Sign out
        </button>
      ) : null}
    </div>
  )
}

export default SessionWaitScreen
