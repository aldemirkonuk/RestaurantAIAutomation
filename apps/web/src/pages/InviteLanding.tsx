import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { toast } from 'sonner'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

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
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, refreshBranches } = useAuth()
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
    try {
      const resp = await fetch(`${API_URL}/api/v1/auth/invite/${encodeURIComponent(code)}`)
      const data = await resp.json()
      setPreview(data)
    } catch {
      setPreview({ valid: false })
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
      const resp = await fetch(
        `${API_URL}/api/v1/auth/invite/${encodeURIComponent(code)}/accept`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      const data = await resp.json().catch(() => ({}))
      if (resp.status === 409) {
        toast.success(`You're already a member of ${(preview as any).restaurant || 'this restaurant'}`)
        await refreshBranches()
        navigate('/', { replace: true })
        return
      }
      if (!resp.ok) {
        throw new Error(data.message || 'Could not accept invite')
      }
      toast.success(`You've joined ${data.restaurant || 'the restaurant'}!`)
      await refreshBranches()
      navigate('/', { replace: true })
    } catch (e) {
      setAcceptError(
        e instanceof Error
          ? e.message
          : "Couldn't add you to this restaurant. Please try again or contact the owner.",
      )
    } finally {
      setAccepting(false)
    }
  }

  const loginHref = `/login?redirect=${encodeURIComponent(`/invite/${code ?? ''}`)}`

  if (loadingPreview || preview === null) {
    return (
      <AuthShell title="WineOps AI" subtitle="Loading invite…">
        <AuthCard className="flex justify-center py-10">
          <RefreshCw className="w-7 h-7 animate-spin text-wine-600" strokeWidth={1.75} />
        </AuthCard>
      </AuthShell>
    )
  }

  if (!preview.valid) {
    return (
      <AuthShell title="This invite has expired" subtitle="Ask the restaurant owner for a new link.">
        <AuthCard className="text-center">
          <AlertCircle className="w-8 h-8 text-wine-400 mx-auto mb-3" strokeWidth={1.75} />
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
  const roleLabel = preview.role ? preview.role.charAt(0).toUpperCase() + preview.role.slice(1) : 'Member'

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
              Role: <span className="font-medium text-gray-600">{roleLabel}</span>
            </p>
            <div className="space-y-3 mt-6">
              <Link
                to={loginHref}
                className="block w-full text-center bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 shadow-[0_10px_28px_-10px_rgba(114,47,55,0.55)]"
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
            {acceptError && <p className="text-sm text-rose-500 mb-3">{acceptError}</p>}
            <button
              type="button"
              disabled={accepting}
              onClick={() => void handleAccept()}
              className="w-full flex items-center justify-center gap-2 bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 disabled:opacity-60 shadow-[0_10px_28px_-10px_rgba(114,47,55,0.55)]"
            >
              {accepting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.75} />
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
