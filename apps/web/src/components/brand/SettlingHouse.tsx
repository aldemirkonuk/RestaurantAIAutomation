import { Link } from 'react-router-dom'
import { EndpaperShell } from './EndpaperShell'
import './book-states.css'

interface SettlingHouseProps {
  /** The first read did not come back and the waiting is over: say so, offer another try. */
  held?: boolean
  onRetry?: () => void
}

/**
 * What a signed-in person sees while the first read of their session is
 * waiting out a rate limit, and when it still did not come back. Never a
 * redirect to the front door: the session is kept either way.
 */
export function SettlingHouse({ held = false, onRetry }: SettlingHouseProps) {
  return (
    <EndpaperShell kicker="The house" houseLine="Kept, page by page." folio={held ? 'Held' : 'Opening'}>
      <div className="mdv-bs" role="status" aria-live="polite" data-testid="settling-house">
        {held ? (
          <>
            <h2 className="mdv-ep-leaf-title">Your house didn&rsquo;t answer.</h2>
            <p className="mdv-ep-leaf-lede">You are still signed in. Try again in a moment.</p>
            <button type="button" className="mdv-ep-act-quiet" onClick={onRetry}>
              Try again
            </button>
            <p style={{ marginTop: 16 }}>
              <Link to="/login" className="mdv-bs-home">
                Sign in again
              </Link>
            </p>
          </>
        ) : (
          <>
            <h2 className="mdv-ep-leaf-title">One moment, setting up your house.</h2>
            <p className="mdv-ep-leaf-lede">The page opens by itself.</p>
            <span className="mdv-bs-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </>
        )}
      </div>
    </EndpaperShell>
  )
}

export default SettlingHouse
