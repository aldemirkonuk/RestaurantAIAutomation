import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getGoogleClientId, loadGoogleIdentityScript } from '../../lib/googleIdentity'

interface GoogleSignInButtonProps {
  /** Called after the session is established, so the caller can redirect. */
  onSuccess: () => void
  onError?: (message: string) => void
  disabled?: boolean
}

/**
 * Google sign-in for the login/register screens.
 *
 * Uses Google Identity Services to obtain an ID token, then exchanges it via
 * AuthContext.loginWithGoogle (POST /auth/oauth/google), which verifies the
 * token server-side and issues our own access/refresh tokens.
 *
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is absent — an unconfigured
 * deployment should not show a button that cannot work.
 */
export function GoogleSignInButton({ onSuccess, onError, disabled }: GoogleSignInButtonProps) {
  const { loginWithGoogle } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  const clientId = getGoogleClientId()

  // GSI holds the callback from initialize() for the life of the page, so it
  // must not close over stale props.
  const handlersRef = useRef({ onSuccess, onError, loginWithGoogle })
  useEffect(() => {
    handlersRef.current = { onSuccess, onError, loginWithGoogle }
  }, [onSuccess, onError, loginWithGoogle])

  const handleCredential = useCallback(async (credential: string) => {
    setSigningIn(true)
    try {
      await handlersRef.current.loginWithGoogle(credential)
      handlersRef.current.onSuccess()
    } catch (e: any) {
      handlersRef.current.onError?.(e?.message || 'Google sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      setUnavailable(true)
      return
    }

    let cancelled = false
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !containerRef.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => void handleCredential(response.credential),
        })
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width: 360,
        })
        setReady(true)
      })
      .catch(() => setUnavailable(true))

    return () => {
      cancelled = true
    }
  }, [clientId, handleCredential])

  if (unavailable) return null

  return (
    <div className="space-y-2">
      <div
        className={
          disabled || signingIn
            ? 'pointer-events-none flex justify-center opacity-60'
            : 'flex justify-center'
        }
      >
        <div ref={containerRef} />
      </div>
      {!ready && (
        <p className="text-center text-xs text-gray-400">Loading Google sign-in…</p>
      )}
      {signingIn && <p className="text-center text-xs text-gray-500">Signing you in…</p>}
    </div>
  )
}
