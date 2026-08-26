/**
 * /studio/invite/:token — accept a studio invite (ADR 0021).
 *
 * Deliberately NOT wrapped in StudioLayout and NOT gated on a studio role: the person
 * landing here has no studio role, which is the entire point of the invite. StudioLayout
 * also renders a role badge it would have to invent for them.
 *
 * The grant is bound server-side to the invite's target_email, so this page can only ever
 * succeed for the account the invite was issued to.
 */
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Wine, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../../components/ui/button'

const ROLE_LABELS: Record<string, string> = {
  developer: 'Developer',
  review_admin: 'Review Admin',
  certified_contributor: 'Certified Contributor',
}

/**
 * The orchestrator's status codes each mean something distinct to the person reading
 * this page, so they are mapped individually rather than collapsed into "failed".
 */
function messageForStatus(status: number, detail?: string): string {
  switch (status) {
    case 403:
      return 'This invite was issued to a different email address. Sign in with the account it was sent to, or ask for a new invite.'
    case 404:
      return "This invite link isn't valid. Check that you copied the whole link."
    case 409:
      return detail?.includes('already hold')
        ? 'You already have this role — nothing to do.'
        : 'This invite has already been used. Invites work exactly once.'
    case 410:
      return 'This invite has expired. Invites last 7 days; ask for a new one.'
    case 401:
      return 'Your session expired while you were on this page. Sign in again and reopen the link.'
    case 503:
      return 'The studio service is unavailable right now. Try again in a few minutes.'
    default:
      return detail || 'Could not accept the invite. Try again in a few minutes.'
  }
}

export function StudioInviteRedeem() {
  const { token } = useParams<{ token: string }>()
  const { user, refreshToken } = useAuth()
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [grantedRole, setGrantedRole] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleAccept = async () => {
    if (!token) return
    setStatus('working')
    setErrorMessage(null)
    try {
      const accessToken = localStorage.getItem('accessToken')
      const resp = await fetch('/api/v1/studio/invite/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ token }),
      })

      if (!resp.ok) {
        // The gateway relays the orchestrator's body; `detail` is FastAPI's field.
        const body = await resp.json().catch(() => ({}))
        setErrorMessage(messageForStatus(resp.status, body?.detail ?? body?.message))
        setStatus('error')
        return
      }

      const data = await resp.json()
      setGrantedRole(data.role_granted)
      // Studio roles are baked into the JWT at sign-in (auth.service.ts:432), so the token
      // in hand still says "no roles". Without a refresh the user would be denied at
      // /studio immediately after being granted access.
      await refreshToken()
      setStatus('done')
    } catch {
      setErrorMessage('Could not reach the server. Check your connection and try again.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F8F9] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-8 max-w-md w-full">
        <div className="flex items-center gap-2 mb-6">
          <Wine className="w-5 h-5 text-wine-600" />
          <span className="font-semibold text-slate-900 text-sm">WineOps Studio</span>
        </div>

        {status === 'done' ? (
          <>
            <div className="w-14 h-14 mb-5 bg-emerald-100 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">You're in</h1>
            <p className="text-slate-500 mb-8">
              You now have the{' '}
              <span className="font-medium text-slate-700">
                {ROLE_LABELS[grantedRole ?? ''] ?? grantedRole}
              </span>{' '}
              role.
            </p>
            {/* Full reload, not a client-side navigate: AuthContext derives studioRoles from
                the token once on mount, so the new role only takes effect on a fresh load. */}
            <a href="/studio" className="btn-primary w-full justify-center">
              Open Studio
            </a>
          </>
        ) : status === 'error' ? (
          <>
            <div className="w-14 h-14 mb-5 bg-danger-100 rounded-2xl flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-danger-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Invite not accepted</h1>
            <p className="text-slate-500 mb-8">{errorMessage}</p>
            <div className="space-y-3">
              <Button
                onClick={handleAccept}
                className="w-full justify-center bg-wine-600 text-white hover:bg-wine-700"
              >
                Try again
              </Button>
              <Link to="/" className="btn-ghost w-full justify-center">
                Go to Dashboard
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Accept your studio invite</h1>
            <p className="text-slate-500 mb-6">
              You've been invited to contribute to the WineOps master library. Accepting adds a
              studio role to your account.
            </p>
            {user?.email && (
              <p className="text-sm text-slate-400 mb-6">
                Accepting as <span className="font-medium text-slate-600">{user.email}</span>. The
                invite must have been issued to this address.
              </p>
            )}
            <Button
              onClick={handleAccept}
              disabled={status === 'working' || !token}
              className="w-full justify-center bg-wine-600 text-white hover:bg-wine-700"
            >
              {status === 'working' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Accepting...
                </>
              ) : (
                'Accept invite'
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default StudioInviteRedeem
