import { useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { profileApi } from '../../services/api/profile'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
        }
      }
    }
  }
}

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let gsiScriptPromise: Promise<void> | null = null

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (gsiScriptPromise) return gsiScriptPromise

  gsiScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google script')))
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google script'))
    document.head.appendChild(script)
  })
  return gsiScriptPromise
}

interface GoogleLinkButtonProps {
  isLinked: boolean
  onLinked: () => void
  onError?: (message: string) => void
}

/**
 * Real Google Identity Services (GSI) sign-in button that links the
 * signed-in user's Google account via the existing, already-working
 * POST /auth/me/link/google endpoint (which verifies a Google ID token).
 *
 * There is no other client-side Google token acquisition anywhere in the
 * app today — Profile.tsx's "Link Google" button was a toast-only stub.
 * This is the first real implementation; render it wherever account linking
 * is offered instead of duplicating the stub.
 */
export function GoogleLinkButton({ isLinked, onLinked, onError }: GoogleLinkButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const [linking, setLinking] = useState(false)

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  useEffect(() => {
    if (isLinked) return
    if (!clientId) {
      setNotConfigured(true)
      return
    }

    let cancelled = false
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !containerRef.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => {
            setLinking(true)
            try {
              await profileApi.linkProvider('google', { token: response.credential })
              onLinked()
            } catch (e: any) {
              onError?.(
                e?.response?.data?.message || e?.message || 'Failed to link Google account',
              )
            } finally {
              setLinking(false)
            }
          },
        })
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
        })
        setReady(true)
      })
      .catch(() => setNotConfigured(true))

    return () => {
      cancelled = true
    }
  }, [clientId, isLinked, onLinked, onError])

  if (isLinked) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700">
        <CheckCircle2 className="w-4 h-4" />
        Google account linked
      </div>
    )
  }

  if (notConfigured) {
    return (
      <p className="text-sm text-gray-400">
        Google sign-in isn&apos;t configured on this deployment yet.
      </p>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={containerRef} />
      {!ready && <span className="text-xs text-gray-400">Loading Google sign-in…</span>}
      {linking && <span className="text-xs text-gray-400">Linking…</span>}
    </div>
  )
}
