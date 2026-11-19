import { AuthSpread } from '../components/brand/AuthSpread'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { readInviteMailSecret, withInviteMailSecret } from '../lib/inviteMailSecret'
import { useAuth } from '../contexts/AuthContext'
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
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  // The secret the invite mail's link carries (ADR 0229 fork 9, item 77),
  // handed on to /register as a fragment: only a join from the mail verifies.
  const mailSecret = readInviteMailSecret(useLocation().hash)
  const { isAuthenticated, refreshBranches, setActiveRestaurantId } = useAuth()
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

  const valid = preview?.valid === true ? preview : null
  const restaurantName = valid?.restaurant || 'the restaurant'
  const unavailable =
    !loadingPreview && !previewError && !valid
      ? unavailableCopy(preview?.valid === false ? preview.reason : undefined)
      : null
  return (
    <AuthSpread
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
      footer={
        <Link className="mdv-link" to="/login">
          Back to sign in
        </Link>
      }
    >
      <div
        className="mdv-spread-stack"
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
            <dl className="mdv-spread-facts">
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
    </AuthSpread>
  )

}
