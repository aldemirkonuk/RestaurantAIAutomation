import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '../components/ui'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

const fieldClass =
  'block w-full pl-11 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm transition-all focus:outline-none focus:border-wine-600 focus:ring-4 focus:ring-wine-600/10 disabled:opacity-60'

export function ResetPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('This reset link is missing its token. Request a new one below.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await axios.post(`${API_URL}/api/v1/auth/reset-password`, {
        token,
        newPassword: password,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err: any) {
      // The backend distinguishes invalid/expired/already-used; surfacing its
      // message is safe here — unlike the request step, a reset token in the
      // URL already proves the caller received the email, so there is no
      // enumeration risk in saying why it didn't work.
      setError(
        err?.response?.data?.message ||
          'This reset link is invalid or has expired. Request a new one below.',
      )
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthShell title="Mudavym" subtitle="Reset your password">
        <AuthCard>
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">Invalid reset link</p>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
                This link is missing its reset token. Request a new one to continue.
              </p>
            </div>
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-wine-600 hover:text-wine-700 mt-2"
            >
              Request a new link
            </Link>
          </div>
        </AuthCard>
      </AuthShell>
    )
  }

  if (success) {
    return (
      <AuthShell title="Mudavym" subtitle="Password reset">
        <AuthCard>
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">Password updated</p>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
                Redirecting you to sign in…
              </p>
            </div>
          </div>
        </AuthCard>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Mudavym" subtitle="Choose a new password">
      <AuthCard>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
            <p className="text-sm text-red-700">{error}</p>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              New Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="h-[18px] w-[18px] text-wine-400" strokeWidth={1.75} />
              </div>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
                placeholder="••••••••"
                disabled={loading}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
              Confirm New Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="h-[18px] w-[18px] text-wine-400" strokeWidth={1.75} />
              </div>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={fieldClass}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
          </div>

          <Button type="submit" variant="default" size="lg" className="w-full" disabled={loading}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                Updating...
              </span>
            ) : (
              'Reset Password'
            )}
          </Button>

          <p className="text-center text-sm text-gray-500">
            <Link to="/login" className="font-medium text-wine-600 hover:text-wine-700">
              Back to sign in
            </Link>
          </p>
        </form>
      </AuthCard>
    </AuthShell>
  )
}
