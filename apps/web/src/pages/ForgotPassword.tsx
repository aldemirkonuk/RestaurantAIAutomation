import { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { Mail, AlertCircle, CheckCircle2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '../components/ui'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

const fieldClass =
  'block w-full pl-11 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm transition-all focus:outline-none focus:border-wine-600 focus:ring-4 focus:ring-wine-600/10 disabled:opacity-60'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await axios.post(`${API_URL}/api/v1/auth/request-password-reset`, { email })
      // The backend always returns success regardless of whether the email
      // matched an account — that is deliberate (enumeration resistance, see
      // AuthService#requestPasswordReset). The UI mirrors that: there is no
      // "email not found" branch to render, because rendering one would leak
      // exactly what the backend is designed not to.
      setSubmitted(true)
    } catch (err: any) {
      // A real failure here (network down, 429 from the per-IP throttle, 5xx)
      // is different from "email not found" and is safe to surface — it says
      // nothing about whether the account exists.
      if (err?.response?.status === 429) {
        setError('Too many requests. Please wait a few minutes and try again.')
      } else {
        setError('Something went wrong. Please try again in a moment.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <AuthShell title="WineOps AI" subtitle="Check your email">
        <AuthCard>
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center text-center gap-4 py-4"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">Check your email</p>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
                If an account exists for <span className="font-medium text-gray-700">{email}</span>,
                we've sent a link to reset your password. The link expires in 1 hour.
              </p>
            </div>
            <Link to="/login" className="text-sm font-medium text-wine-600 hover:text-wine-700 mt-2">
              Back to sign in
            </Link>
          </motion.div>
        </AuthCard>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="WineOps AI" subtitle="Reset your password">
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

        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Enter the email address on your account and we'll send you a link to reset your password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Mail className="h-[18px] w-[18px] text-wine-400" strokeWidth={1.75} />
              </div>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
                placeholder="you@restaurant.com"
                disabled={loading}
                autoFocus
              />
            </div>
          </div>

          <Button type="submit" variant="default" size="lg" className="w-full" disabled={loading}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                Sending...
              </span>
            ) : (
              'Send Reset Link'
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
