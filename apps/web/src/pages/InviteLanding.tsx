import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { readInviteMailSecret, withInviteMailSecret } from '../lib/inviteMailSecret'
import { useAuth } from '../contexts/AuthContext'
import { forgetJoin, rememberJoin } from '../lib/joinResume'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { toast } from 'sonner'
import axios from 'axios'
import { apiClient, getErrorMessage } from '../services/api/client'

/** Gateway shape (0149 row 49): `getInvitePreview` names which of three
 * reasons made the invite unusable — `used` (already accepted), `expired`
 * (past `expires_at`) or `not_found` (no row for this code). A read that
 * FAILED (network, 503) never reaches here as `reason`: `loadPreview`'s
 * catch sets `previewError` instead, so `reason` only ever describes an
 * invite the gateway actually read. */
type InvitePreviewReason = 'used' | 'expired' | 'not_found'

type Preview =
  | { valid: false; reason?: InvitePreviewReason | string }
  | {
      valid: true
      restaurant?: string
      organization?: string
      city?: string | null
      inviter?: string | null
      role?: string
    }

/** Copy per reason (0149 row 49: "names which" — no more one collapsed
 * "no longer available" message for used/expired/not_found alike). An
 * unrecognized or absent reason keeps the old generic wording rather than
 * asserting something the gateway did not say. */
function unavailableCopy(reason: string | undefined): {
  title: string
  body: string
} {
  switch (reason) {
    case 'used':
      return {
        title: 'This invitation was already used',
        body: 'Someone has already accepted it. Ask the restaurant owner for a new invitation if you still need access.',
      }
    case 'expired':
      return {
        title: 'This invitation has expired',
        body: 'Ask the restaurant owner for a new link.',
      }
    case 'not_found':
      return {
        title: 'This invitation was not found',
        body: 'Check the link, or ask the restaurant owner to send a new one.',
      }
    default:
      return {
        title: 'This invitation is no longer available',
        body: 'Ask the restaurant owner for a new link.',
      }
  }
}

export function InviteLanding() {
  const publicDesign = usePublicDesign()
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  // The secret the invite mail's link carries (ADR 0229 fork 9, item 77),
  // handed on to /register as a fragment: only a join from the mail verifies.
  const mailSecret = readInviteMailSecret(useLocation().hash)
  const { user, isAuthenticated, logout, refreshBranches, setActiveRestaurantId } =
    useAuth()
  // The accept route needs a verified address (F-274): an unverified account
  // verifies first and is brought back here, rather than losing the invite.
  const unverified = isAuthenticated && user?.emailVerified === false
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

  // Being here is the way back from verifying: nothing more to keep.
  useEffect(() => {
    forgetJoin()
  }, [])

  const verifyFirst = () => {
    if (!code) return
    rememberJoin(`/invite/${encodeURIComponent(code)}`, user?.userId)
    navigate('/verify-email')
  }

  // A link opened from a mail has nothing to go back to (F-277).
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' ? idx > 0 : window.history.length > 1) navigate(-1)
    else navigate('/', { replace: true })
  }

  const handleAccept = async () => {
    if (!code) return
    const token = localStorage.getItem('accessToken')
    if (!token) return
    setAcceptError(null)
    setAccepting(true)
    try {
      const { data } = await apiClient.post<{ restaurant?: string; restaurantId?: string }>(
        `/auth/invite/${encodeURIComponent(code)}/accept`,
      )
      toast.success(`You've joined ${data.restaurant || 'the restaurant'}!`)
      // Accepting lands the person in the house they just joined (ADR 0164,
      // R1). The accept route mints nothing, so without this the session kept
      // naming the house it was in before, or none.
      if (data.restaurantId) await setActiveRestaurantId(data.restaurantId)
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
    const unavailable =
      !loadingPreview && !previewError && !valid
        ? unavailableCopy(preview?.valid === false ? preview.reason : undefined)
        : null
    return (
      <PublicShell
        title={
          loadingPreview
            ? 'Opening your invitation'
            : previewError
              ? 'Invitation unavailable'
              : unavailable
                ? unavailable.title
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
          className="mdv-pub__plate mdv-pub__stack"
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
            <p>{unavailable?.body ?? 'Ask the restaurant owner for a new link.'}</p>
          ) : (
            <>
              <dl className="mdv-pub__facts">
                <div>
                  <dt>Restaurant</dt>
                  <dd>{restaurantName}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>
                    {valid.role
                      ? valid.role.charAt(0).toUpperCase() + valid.role.slice(1)
                      : 'Member'}
                  </dd>
                </div>
              </dl>
              {acceptError && (
                <p className="mdv-alert" role="alert">
                  {acceptError}
                </p>
              )}
              {isAuthenticated ? (
                <>
                  {/* Join uses whoever is signed in on this device (F-275). */}
                  <p data-testid="invite-signed-in-as">
                    You are signed in as <strong>{user?.email}</strong>.{' '}
                    <button
                      type="button"
                      className="mdv-link"
                      onClick={() => void logout()}
                    >
                      Not you? Sign out
                    </button>
                  </p>
                  {unverified ? (
                    <>
                      <p>
                        Confirm your email address first. We will bring you
                        back here to join.
                      </p>
                      <button className="mdv-btn mdv-btn--seal" onClick={verifyFirst}>
                        Confirm my email
                      </button>
                    </>
                  ) : (
                    <button
                      className="mdv-btn mdv-btn--seal"
                      disabled={accepting}
                      onClick={() => void handleAccept()}
                    >
                      {accepting ? 'Joining…' : `Join ${restaurantName}`}
                    </button>
                  )}
                  <button className="mdv-btn" onClick={goBack}>
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
                    to={withInviteMailSecret(
                      `/register?invite=${encodeURIComponent(code ?? '')}`,
                      mailSecret,
                    )}
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
                to={withInviteMailSecret(`/register?invite=${code}`, mailSecret)}
                className="block w-full text-center border border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50"
              >
                Create account to accept
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4" data-testid="invite-signed-in-as">
              You&apos;re signed in as{' '}
              <span className="font-medium text-gray-700">{user?.email}</span>.{' '}
              <button
                type="button"
                onClick={() => void logout()}
                className="underline hover:text-gray-700"
              >
                Not you? Sign out
              </button>
            </p>
            {acceptError && (
              <p className="text-sm text-rose-500 mb-3">{acceptError}</p>
            )}
            {unverified ? (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  Confirm your email address first. We will bring you back here
                  to join.
                </p>
                <button
                  type="button"
                  onClick={verifyFirst}
                  className="w-full flex items-center justify-center gap-2 bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 shadow-[0_10px_28px_-10px_rgba(26,94,107,0.55)]"
                >
                  Confirm my email
                </button>
              </>
            ) : (
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
            )}
            <button
              type="button"
              onClick={goBack}
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
