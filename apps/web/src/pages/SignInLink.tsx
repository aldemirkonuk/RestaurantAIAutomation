import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PublicShell } from '../components/mudavym/PublicShell'
import { useAuth } from '../contexts/AuthContext'
import { getErrorMessage } from '../services/api/client'
import { signInWithEmailLink } from '../services/api/passkeys'

function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') ?? ''
}

/**
 * `/login/code#t=<token>`, the link in a sign-in mail (QA round 23). The hash
 * is dropped as soon as it is read, and nothing is sent until a click: mail
 * scanners open links, and a request on load would spend the token.
 */
export function SignInLink() {
  const navigate = useNavigate()
  const { signInWithSession } = useAuth()
  const [token] = useState(tokenFromHash)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    token ? null : 'This link is incomplete. Open it again from the email, or ask for a new code.',
  )

  useEffect(() => {
    if (!window.location.hash) return
    const { pathname, search } = window.location
    window.history.replaceState(window.history.state, '', pathname + search)
  }, [])

  const signIn = async () => {
    setBusy(true)
    try {
      await signInWithSession(await signInWithEmailLink(token))
      navigate('/', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <PublicShell
      title="Sign in"
      eyebrow="Account access"
      homeHref="/login"
      footer={
        <Link className="mdv-link" to="/login">
          Back to sign in
        </Link>
      }
    >
      <div className="mdv-pub__plate mdv-pub__stack">
        {error ? (
          <>
            <p className="mdv-alert" role="alert">
              {error}
            </p>
            <Link className="mdv-btn mdv-btn--seal" to="/login">
              Go to sign in
            </Link>
          </>
        ) : (
          <button className="mdv-btn mdv-btn--seal" onClick={signIn} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        )}
      </div>
    </PublicShell>
  )
}
