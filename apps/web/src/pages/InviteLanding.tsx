import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import '../components/mudavym/public-pages.css'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { toast } from 'sonner'
import axios from 'axios'
import { apiClient, getErrorMessage } from '../services/api/client'

type Preview =
  | { valid: false; reason?: string }
  | {
      valid: true
      restaurant?: string
      organization?: string
      city?: string | null
      inviter?: string | null
      role?: string
    }

export function InviteLanding() {
  const publicDesign = usePublicDesign()
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, refreshBranches } = useAuth()
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  const loadPreview = useCallback(async () => {
    if (!code) {
      setPreview({ valid: false })
      setLoadingPreview(false)
      return
    }
    setLoadingPreview(true)
    setPreviewError(null)
    try {
      const { data } = await apiClient.get<Preview>(
        `/auth/invite/${encodeURIComponent(code)}`,
      )
      setPreview(data)
    } catch {
      setPreviewError('We could not load this invitation. Please try again.')
    } finally {
      setLoadingPreview(false)
    }
  }, [code])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  const handleAccept = async () => {
    if (!code) return
    const token = localStorage.getItem('accessToken')
    if (!token) return
    setAcceptError(null)
    setAccepting(true)
    try {
      const { data } = await apiClient.post<{ restaurant?: string }>(
        `/auth/invite/${encodeURIComponent(code)}/accept`,
      )
      toast.success(`You've joined ${data.restaurant || 'the restaurant'}!`)
      await refreshBranches()
      navigate('/', { replace: true })
    } catch (e) {
      // 409 = already a member: still a success from the user's point of view.
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        toast.success(
          `You're already a member of ${(preview as any)?.restaurant || 'this restaurant'}`,
        )
        await refreshBranches()
        navigate('/', { replace: true })
        return
      }
      setAcceptError(getErrorMessage(e))
    } finally {
      setAccepting(false)
    }
  }

  const loginHref = `/login?redirect=${encodeURIComponent(`/invite/${code ?? ''}`)}`

  if (publicDesign) {
    const valid = preview?.valid === true ? preview : null
    const restaurantName = valid?.restaurant || 'the restaurant'
    return (
      <PublicShell
        title={
          loadingPreview
            ? 'Opening your invitation'
            : previewError
              ? 'Invitation unavailable'
              : !valid
                ? 'This invitation is no longer available'
                : 'You are invited'
        }
        eyebrow="Workspace invitation"
        voice={valid ? `Join ${restaurantName}.` : undefined}
        homeHref="/login"
        footer={
          <Link className="mdv-link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <div
          className="mdv-pub__plate mdv-public-stack"
          aria-busy={loadingPreview || accepting}
        >
          {loadingPreview ? (
            <p role="status">Loading invitation…</p>
          ) : previewError ? (
            <>
              <p role="alert">{previewError}</p>
              <button className="mdv-btn" onClick={() => void loadPreview()}>
                Try again
              </button>
            </>
          ) : !valid ? (
            <p>Ask the restaurant owner for a new link.</p>
          ) : (
            <>
              <dl className="mdv-public-record">
                <div>
                  <dt>Restaurant</dt>
                  <dd>{restaurantName}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{valid.role || 'Member'}</dd>
                </div>
              </dl>
              {acceptError && (
                <p className="mdv-alert" role="alert">
                  {acceptError}
                </p>
              )}
              {isAuthenticated ? (
                <>
                  <button
                    className="mdv-btn mdv-btn--seal"
                    disabled={accepting}
                    onClick={() => void handleAccept()}
                  >
                    {accepting ? 'Joining…' : `Join ${restaurantName}`}
                  </button>
                  <button className="mdv-btn" onClick={() => navigate(-1)}>
                    Cancel, go back
                  </button>
                </>
              ) : (
                <>
                  <Link className="mdv-btn mdv-btn--seal" to={loginHref}>
                    Sign in to accept
                  </Link>
                  <Link
                    className="mdv-btn"
                    to={`/register?invite=${encodeURIComponent(code ?? '')}`}
                  >
                    Create account to accept
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      </PublicShell>
    )
  }

  if (previewError) {
    return (
      <AuthShell title="Invitation unavailable" subtitle={previewError}>
        <AuthCard>
          <button type="button" onClick={() => void loadPreview()}>
            Try again
          </button>
        </AuthCard>
      </AuthShell>
    )
  }

  if (loadingPreview || preview === null) {
    return (
      <AuthShell title="Mudavym" subtitle="Loading invite…">
        <AuthCard className="flex justify-center py-10">
          <RefreshCw
            className="w-7 h-7 animate-spin text-wine-600"
            strokeWidth={1.75}
          />
        </AuthCard>
      </AuthShell>
    )
  }

  if (!preview.valid) {
    return (
      <AuthShell
        title="This invite has expired"
        subtitle="Ask the restaurant owner for a new link."
      >
        <AuthCard className="text-center">
          <AlertCircle
            className="w-8 h-8 text-wine-400 mx-auto mb-3"
            strokeWidth={1.75}
          />
          <Link
            to="/login"
            className="mt-4 inline-block border border-gray-200 text-gray-700 rounded-xl px-6 py-3 text-sm font-medium hover:bg-gray-50"
          >
            Back to sign in
          </Link>
        </AuthCard>
      </AuthShell>
    )
  }

  const restaurantName = preview.restaurant || 'Restaurant'
  const roleLabel = preview.role
    ? preview.role.charAt(0).toUpperCase() + preview.role.slice(1)
    : 'Member'

  return (
    <AuthShell
      title={!isAuthenticated ? `You're invited` : `Add ${restaurantName}?`}
      subtitle={
        !isAuthenticated
          ? `Join ${restaurantName} and start managing wine inventory together.`
          : `You'll be added as ${roleLabel} at ${restaurantName}.`
      }
    >
      <AuthCard className="text-center">
        {!isAuthenticated ? (
          <>
            <p className="text-xs text-gray-400">
              Role:{' '}
              <span className="font-medium text-gray-600">{roleLabel}</span>
            </p>
            <div className="space-y-3 mt-6">
              <Link
                to={loginHref}
                className="block w-full text-center bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 shadow-[0_10px_28px_-10px_rgba(26,94,107,0.55)]"
              >
                Sign in to accept
              </Link>
              <Link
                to={`/register?invite=${code}`}
                className="block w-full text-center border border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50"
              >
                Create account to accept
              </Link>
            </div>
          </>
        ) : (
          <>
            {acceptError && (
              <p className="text-sm text-rose-500 mb-3">{acceptError}</p>
            )}
            <button
              type="button"
              disabled={accepting}
              onClick={() => void handleAccept()}
              className="w-full flex items-center justify-center gap-2 bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 disabled:opacity-60 shadow-[0_10px_28px_-10px_rgba(26,94,107,0.55)]"
            >
              {accepting ? (
                <>
                  <RefreshCw
                    className="w-4 h-4 animate-spin"
                    strokeWidth={1.75}
                  />
                  Adding…
                </>
              ) : (
                `Add ${restaurantName}`
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="mt-3 w-full text-sm text-gray-400 underline hover:text-gray-600"
            >
              Cancel, go back
            </button>
          </>
        )}
      </AuthCard>
    </AuthShell>
  )
}
