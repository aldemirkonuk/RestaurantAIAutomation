import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getGoogleClientId, loadGoogleIdentityScript } from '../../lib/googleIdentity'

interface GoogleSignInButtonProps {
  /** Called after the session is established, so the caller can redirect. */
  onSuccess: () => void
  onError?: (message: string) => void
  disabled?: boolean
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.6h5.1c-.2 1.2-1.5 3.5-5.1 3.5-3.1 0-5.6-2.5-5.6-5.6S8.9 6.1 12 6.1c1.7 0 2.9.7 3.6 1.4l2.4-2.4C16.6 3.7 14.5 2.7 12 2.7 6.9 2.7 2.7 6.9 2.7 12S6.9 21.3 12 21.3c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
      />
      <path
        fill="#34A853"
        d="M3.9 7.4l3 2.2C7.7 7.4 9.7 6.1 12 6.1c1.7 0 2.9.7 3.6 1.4l2.4-2.4C16.6 3.7 14.5 2.7 12 2.7 8.3 2.7 5.1 4.8 3.9 7.4z"
      />
      <path
        fill="#4A90E2"
        d="M12 21.3c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-3.1 0-5.7-2.1-6.6-4.9l-3 2.3C4.1 18.7 7.7 21.3 12 21.3z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 12c0-.7.1-1.4.3-2l-3-2.3C2.2 9 2 10.5 2 12s.2 3 .7 4.3l3-2.3c-.2-.6-.3-1.3-.3-2z"
      />
    </svg>
  )
}

/**
 * Google sign-in for the login/register screens.
 *
 * Uses Google Identity Services to obtain an ID token, then exchanges it via
 * AuthContext.loginWithGoogle. Renders a WineOps-styled AuthCard button; the
 * official GSI button stays hidden and is only used to open Google's chooser.
 */
export function GoogleSignInButton({ onSuccess, onError, disabled }: GoogleSignInButtonProps) {
  const { loginWithGoogle } = useAuth()
  const gsiHostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  const clientId = getGoogleClientId()

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
        if (cancelled || !window.google?.accounts?.id || !gsiHostRef.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => void handleCredential(response.credential),
        })
        window.google.accounts.id.renderButton(gsiHostRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 360,
        })
        setReady(true)
      })
      .catch(() => setUnavailable(true))

    return () => {
      cancelled = true
    }
  }, [clientId, handleCredential])

  const openGoogleChooser = () => {
    const gsiButton = gsiHostRef.current?.querySelector<HTMLElement>(
      'div[role="button"], button, [tabindex="0"]',
    )
    gsiButton?.click()
  }

  if (unavailable) {
    return (
      <p className="text-center text-xs text-gray-400">
        Google sign-in isn&apos;t configured on this deployment yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {/* Official GSI control — kept off-screen; our branded button triggers it. */}
      <div
        ref={gsiHostRef}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
      />

      <button
        type="button"
        disabled={disabled || signingIn || !ready}
        onClick={openGoogleChooser}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-wine-200/80 py-2.5 text-sm font-medium text-wine-700 transition-colors hover:bg-wine-50 hover:text-wine-800 disabled:opacity-50"
      >
        {signingIn ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-wine-600/80 border-t-transparent" />
            Signing in with Google…
          </>
        ) : (
          <>
            <GoogleGlyph className="h-4 w-4" />
            Continue with Google
          </>
        )}
      </button>

      {!ready && !signingIn && (
        <p className="text-center text-xs text-gray-400">Loading Google sign-in…</p>
      )}
    </div>
  )
}
