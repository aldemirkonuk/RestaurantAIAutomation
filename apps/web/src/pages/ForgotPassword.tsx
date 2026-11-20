import { PublicShell } from '../components/mudavym/PublicShell'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

export function ForgotPassword() {
  // /login hands the address over when it sends someone here to set a first
  // password (ADR 0024) — retyping it is friction with no purpose. Nothing is
  // revealed by the prefill: this endpoint answers identically for every
  // address, known or not, and that stays true.
  const location = useLocation()
  const prefilledEmail = new URLSearchParams(location.search).get('email') ?? ''
  const [email, setEmail] = useState(prefilledEmail)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await axios.post(`${API_URL}/api/v1/auth/request-password-reset`, {
        email,
      })
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

  return (
    <PublicShell
      title={submitted ? 'Check your email' : 'Reset your password'}
      eyebrow="Account access"
      voice={
        submitted
          ? 'A way back, if this address has an account.'
          : 'Enter the address you use to sign in.'
      }
      homeHref="/login"
      footer={
        <Link className="mdv-link" to="/login">
          Back to sign in
        </Link>
      }
    >
      <div className="mdv-pub__plate mdv-pub__stack">
        {submitted ? (
          <p role="status">
            If an account exists for <strong>{email}</strong>, a password
            reset email has been requested. Check your inbox and spam folder.
            Reset links expire after one hour.
          </p>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mdv-pub__stack"
            aria-busy={loading}
          >
            {error && (
              <p className="mdv-alert" role="alert">
                {error}
              </p>
            )}
            <div>
              <label className="mdv-label" htmlFor="email">
                Email address
              </label>
              <input
                className="mdv-input"
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <button
              className="mdv-btn mdv-btn--seal"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Requesting link…' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </PublicShell>
  )
}
