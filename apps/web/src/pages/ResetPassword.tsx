import { AuthSpread } from '../components/brand/AuthSpread'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

export function ResetPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only a server-confirmed token failure (invalid/expired/already-used)
  // means the token itself is the problem. A client-side validation error
  // (too short, mismatched) says nothing about the token, so offering "Request
  // a new link" there sends someone to burn a perfectly good link.
  const [tokenError, setTokenError] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setTokenError(false)

    if (!token) {
      setError('This reset link is missing its token. Request a new one below.')
      setTokenError(true)
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
      setTokenError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthSpread
      title={
        !token
          ? 'This link is incomplete'
          : success
            ? 'Password updated'
            : 'Choose a new password'
      }
      eyebrow="Account access"
      voice={
        !token
          ? 'Request another link to continue.'
          : success
            ? 'Your next step is to sign in.'
            : 'Use at least eight characters.'
      }
      footer={
        <Link className="mdv-link" to="/login">
          Back to sign in
        </Link>
      }
    >
      <div className="mdv-spread-stack">
        {!token ? (
          <Link className="mdv-btn mdv-btn--seal" to="/forgot-password">
            Request a new link
          </Link>
        ) : success ? (
          <p role="status">
            Your password has changed, and every session on Mudavym has
            been signed out. Redirecting you to sign in…
          </p>
        ) : (
          <form
            className="mdv-spread-stack"
            onSubmit={handleSubmit}
            aria-busy={loading}
          >
            <div>
              <label className="mdv-label" htmlFor="password">
                New password
              </label>
              <input
                className="mdv-input"
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label className="mdv-label" htmlFor="confirmPassword">
                Confirm new password
              </label>
              <input
                className="mdv-input"
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <button
              className="mdv-btn mdv-btn--seal"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Updating…' : 'Reset password'}
            </button>
            {error && (
              <div className="mdv-spread-stack">
                <p className="mdv-alert" role="alert">
                  {error}
                </p>
                {tokenError && (
                  <Link className="mdv-link" to="/forgot-password">
                    Request a new link
                  </Link>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </AuthSpread>
  )

}
