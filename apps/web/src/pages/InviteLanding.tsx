import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Wine, AlertCircle, RefreshCw } from 'lucide-react'
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4">
        <RefreshCw className="w-8 h-8 animate-spin text-wine-500" />
      </div>
    )
  }

  if (!preview.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8 text-center"
        >
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-gray-900">This invite has expired</h1>
          <p className="text-sm text-gray-500 mt-2">
            This invite link is no longer valid. Ask the restaurant owner for a new one.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block border border-gray-200 text-gray-700 rounded-xl px-6 py-3 text-sm font-medium hover:bg-gray-50"
          >
            Back to sign in
          </Link>
        </motion.div>
      </div>
    )
  }

  const restaurantName = preview.restaurant || 'Restaurant'
  const roleLabel = preview.role ? preview.role.charAt(0).toUpperCase() + preview.role.slice(1) : 'Member'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8"
      >
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-wine-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Wine className="w-7 h-7 text-white" />
          </div>
        </div>

        {!isAuthenticated ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900 text-center">
              You've been invited to {restaurantName}
            </h1>
            <p className="text-sm text-gray-500 text-center mt-2">
              Join {restaurantName} and start managing wine inventory together.
            </p>
            <p className="text-xs text-gray-400 text-center mt-3">
              Role: <span className="font-medium text-gray-600">{roleLabel}</span>
            </p>
            <div className="space-y-3 mt-6">
              <Link
                to={loginHref}
                className="block w-full text-center bg-wine-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-wine-700"
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
            <h1 className="text-lg font-semibold text-gray-900 text-center">
              Add {restaurantName} to your branches?
            </h1>
            <p className="text-sm text-gray-500 text-center mt-2">
              You'll be added as {roleLabel} at {restaurantName}.
            </p>
            {acceptError && (
              <p className="text-sm text-rose-500 mt-3 text-center">{acceptError}</p>
            )}
            <button
              type="button"
              disabled={accepting}
              onClick={() => void handleAccept()}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-wine-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-wine-700 disabled:opacity-60"
            >
              {accepting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
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
      </motion.div>
    </div>
  )
}
