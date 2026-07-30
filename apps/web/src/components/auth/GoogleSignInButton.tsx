import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getGoogleClientId, loadGoogleIdentityScript } from '../../lib/googleIdentity'

interface GoogleSignInButtonProps {
  /** Called after the session is established, so the caller can redirect. */
  onSuccess: () => void
  onError?: (message: string) => void
  disabled?: boolean
}

/** Official multicolor Google "G" — same mark Anthropic / Google use on auth screens. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/**
 * Google sign-in — Anthropic-style: white surface, gray border, dark label,
 * official Google G. GSI stays hidden; this button opens the account chooser.
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
          text: 'signin_with',
          shape: 'rectangular',
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
    <div>
      <div
        ref={gsiHostRef}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
      />

      <button
        type="button"
        disabled={disabled || signingIn || !ready}
        onClick={openGoogleChooser}
        className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[#DADCE0] bg-white px-4 text-[15px] font-medium text-[#3C4043] shadow-none transition-colors hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-1 active:bg-[#F1F3F4] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {signingIn ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            Signing in…
          </>
        ) : (
          <>
            <GoogleGlyph className="h-5 w-5 shrink-0" />
            Sign in with Google
          </>
        )}
      </button>

      {!ready && !signingIn && (
        <p className="mt-2 text-center text-xs text-gray-400">Loading Google sign-in…</p>
      )}
    </div>
  )
}
