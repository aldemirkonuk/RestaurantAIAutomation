/**
 * What a signed-in person sees while their stored session waits to be read
 * again (a 429, a 5xx, a dropped connection on `/auth/me`): who they are is
 * not in doubt, so this is never /login. It says why, when the next try is,
 * and offers to try now -- or to sign out, so a person whose gateway stays
 * down can still reach /login and another account (the wait has no attempt
 * limit by design: it never ends a session on its own).
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { sessionWaitWords, type SessionWait } from '../lib/sessionWait'
import './mudavym/house-page-loader.css'

export function SessionWaitScreen({
  wait,
  onRetryNow,
  onSignOut,
}: {
  wait: SessionWait
  onRetryNow?: () => void
  onSignOut?: () => void | Promise<void>
}) {
  const [leaving, setLeaving] = useState(false)
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
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {onRetryNow ? (
          <button type="button" onClick={onRetryNow} style={buttonStyle}>
            Try now
          </button>
        ) : null}
        {onSignOut ? (
          <button
            type="button"
            disabled={leaving}
            onClick={async () => {
              setLeaving(true)
              try {
                await onSignOut()
              } finally {
                setLeaving(false)
              }
            }}
            style={{ ...buttonStyle, background: 'transparent', color: 'var(--ink-2)' }}
          >
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

const buttonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--rule-2, var(--ink-4))',
  background: 'var(--paper-1)',
  color: 'var(--ink-1)',
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
}

export default SessionWaitScreen
