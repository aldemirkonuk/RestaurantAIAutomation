import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Mail, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { Button } from '../components/ui'
import { toast } from 'sonner'
import { getOnboardingProgress } from '../services/api/menus'
import { apiClient, getErrorMessage } from '../services/api/client'


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
      const { data } = await apiClient.post<{
        accessToken: string
        refreshToken: string
      }>('/auth/verify-email', { token })

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
      setError(getErrorMessage(err))
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
      await apiClient.post('/auth/resend-verification')
      setLastResent(new Date())
      toast.success('Verification email resent! Check your inbox.')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  if (verified) {
    return (
      <AuthShell title="Email Verified!" subtitle="Redirecting you now…">
        <AuthCard className="text-center py-10">
          <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto" strokeWidth={1.5} />
        </AuthCard>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Check Your Email"
      subtitle={
        user?.email
          ? `We sent a verification link to ${user.email}`
          : 'We sent a verification link to your inbox'
      }
    >
      <AuthCard>
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-wine-50 rounded-full flex items-center justify-center ring-1 ring-wine-100">
            <Mail className="w-6 h-6 text-wine-600" strokeWidth={1.75} />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" strokeWidth={1.75} />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-3 my-6">
          {[
            'Open the email from Mudavym',
            'Click "Verify My Email"',
            `You'll be guided through setting up your wine list`,
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-3 bg-wine-50/50 rounded-xl p-3">
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
            <Button className="w-full" size="lg" onClick={handleVerify} disabled={verifying}>
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" strokeWidth={1.75} />
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
              Didn&apos;t receive the email? Check your spam folder or resend below.
            </p>
            <Button
              variant="outline"
              className="w-full"
              size="lg"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" strokeWidth={1.75} />
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
          <Link to="/login" className="text-sm text-wine-600 hover:text-wine-700 font-semibold">
            Back to Sign In
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  )
}
