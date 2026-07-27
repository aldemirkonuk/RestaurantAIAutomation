import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Mail, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { Button } from '../components/ui'
import { toast } from 'sonner'
import { getOnboardingProgress } from '../services/api/menus'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

export function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResent, setLastResent] = useState<Date | null>(null)

  const token = searchParams.get('token')

  const handleVerify = async () => {
    if (!token) {
      setError('No verification token found in URL.')
      return
    }
    setVerifying(true)
    setError(null)
    try {
      const accessToken = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/auth/verify-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ token }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.message || 'Verification failed')

      // Store new tokens that include emailVerified: true in JWT payload
      localStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      setVerified(true)
      toast.success('Email verified! Redirecting...')
      // Check if menu already uploaded (re-verification flows) → skip /get-started
      const progress = await getOnboardingProgress().catch(() => null)
      const destination = progress?.menu_uploaded ? '/' : '/get-started'
      setTimeout(() => {
        window.location.href = destination
      }, 1500)
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Verification failed. The link may have expired.',
      )
    } finally {
      setVerifying(false)
    }
  }

  const handleResend = async () => {
    // Rate limit: 1 per 60 seconds (T-26-05-03)
    if (lastResent && Date.now() - lastResent.getTime() < 60000) {
      toast.error('Please wait 1 minute before resending')
      return
    }
    setResending(true)
    try {
      const accessToken = localStorage.getItem('accessToken')
      const resp = await fetch(`${API_URL}/api/v1/auth/resend-verification`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })
      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.message || 'Failed to resend')
      }
      setLastResent(new Date())
      toast.success('Verification email resent! Check your inbox.')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend verification email')
    } finally {
      setResending(false)
    }
  }

  if (verified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">Email Verified!</h2>
          <p className="text-gray-500 mt-2">Redirecting to your dashboard...</p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex mb-4">
            <BrandMark size={64} className="shadow-lg" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Check Your Email</h1>
          <p className="text-gray-500 mt-2">
            We sent a verification link to <strong>{user?.email}</strong>
          </p>
        </div>

        <div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-wine-50 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-wine-500" />
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="space-y-3 my-6">
            {[
              'Open the email from WineOps AI',
              'Click "Verify My Email"',
              `You'll be guided through setting up your wine list`,
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                <div className="w-5 h-5 rounded-full bg-wine-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          {token ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 text-center">
                Click below to verify your email address.
              </p>
              <Button className="w-full h-12" onClick={handleVerify} disabled={verifying}>
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Verifying...
                  </>
                ) : (
                  'Verify My Email'
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 text-center">
                Didn't receive the email? Check your spam folder or resend below.
              </p>
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Resending...
                  </>
                ) : (
                  'Resend Verification Email'
                )}
              </Button>
              {lastResent && (
                <p className="text-xs text-center text-gray-400">
                  Resent at {lastResent.toLocaleTimeString()}. Wait 1 minute before resending again.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <Link to="/login" className="text-sm text-wine-600 hover:text-wine-700 font-medium">
              Back to Sign In
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
