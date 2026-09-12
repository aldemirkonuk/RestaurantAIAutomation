import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth, LoginError } from '../contexts/AuthContext'
import { Button } from '../components/ui'
import { Mail, Lock, AlertCircle, ArrowRight, KeyRound } from 'lucide-react'
import { motion } from 'framer-motion'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { GoogleSignInButton, type GoogleSignInHandle } from '../components/auth/GoogleSignInButton'
import {
  canRender,
  type IdentityProviderDescriptor,
  type SignInMethodsResult,
} from '../lib/identityProviders'

const fieldClass =
  'block w-full pl-11 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm transition-all focus:outline-none focus:border-wine-600 focus:ring-4 focus:ring-wine-600/10 disabled:opacity-60'

/**
 * Show every provider the registry declares but has not enabled (today:
 * Microsoft and Apple) as a greyed-out "coming soon" row on every sign-in.
 *
 * Off by default: two permanent dead rows in front of every user is noise, not
 * honesty, and the honest per-account signal — a provider genuinely linked to
 * *this* identity that cannot be used here — arrives in `unavailable` and is
 * always rendered. Flip this to `true` to advertise the roadmap.
 */
const SHOW_DECLARED_PROVIDERS = false

/**
 * Identity-first sign-in (ADR 0024).
 *
 * Enter an email, and the page shows the methods that identity *actually*
 * has — resolved from `password_hash` and `user_oauth_accounts` by
 * `POST /auth/sign-in-methods`, never inferred from the address.
 *
 * What this replaced, and why:
 *
 *  - A `@gmail.com` shortcut that opened Google's chooser before `login()`
 *    ever ran. Two of the ten production accounts on 2026-08-26 were gmail
 *    addresses holding a real password and NO linked Google account; the
 *    shortcut made their password unusable from this page. A domain is not an
 *    identity provider.
 *  - A backend that answered "which provider?" with "Google, probably". See
 *    auth.service.ts#validateUser.
 *
 * The page branches on no provider name of its own: it renders whatever the
 * registry sends back, looking each id up in `canRender`. Adding Apple or
 * Microsoft is a registry entry plus a button component.
 */
export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, error: authError, clearError, resolveSignInMethods } = useAuth()
  const googleRef = useRef<GoogleSignInHandle>(null)

  const searchParams = new URLSearchParams(location.search)
  const redirectQuery = searchParams.get('redirect')
  const from = redirectQuery || (location.state as { from?: { pathname: string } })?.from?.pathname || '/'
  const prefilledEmail = searchParams.get('email') ?? ''

  const [email, setEmail] = useState(prefilledEmail)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [identity, setIdentity] = useState<SignInMethodsResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resolve = useCallback(
    async (address: string) => {
      setError(null)
      clearError()
      setResolving(true)
      try {
        setIdentity(await resolveSignInMethods(address))
      } finally {
        setResolving(false)
      }
    },
    [resolveSignInMethods, clearError],
  )

  // A bookmarked deep link may carry the address (`/login?email=…&redirect=…`),
  // e.g. the "set a password" hand-off below. Resolve it straight away so that
  // user lands on the method step, not on a form they have to retype.
  useEffect(() => {
    if (prefilledEmail) void resolve(prefilledEmail)
    // Intentionally mount-only: re-resolving on every render would hammer the
    // rate limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    await resolve(email)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    clearError()
    setLoading(true)

    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err: any) {
      // The gateway sends a structured `{ code, provider, providers }` for an
      // account with no password. Branch on the code, never on message text.
      // `OAUTH_ONLY` now means "these providers are genuinely linked to this
      // row", so redirecting into one is safe; `NO_SIGNIN_METHOD` means the
      // account has none at all and the only way forward is setting a password.
      if (err instanceof LoginError && err.code === 'OAUTH_ONLY') {
        if (err.provider === 'google' && googleRef.current?.open()) {
          // `login()` stashes the raw message in context error state before
          // throwing — clear it so it never flashes before the redirect fires.
          clearError()
          setLoading(false)
          return
        }
      }
      // Re-resolve so the page catches up with whatever the backend just
      // learned about this identity (e.g. a provider linked in another tab).
      if (err instanceof LoginError && (err.code === 'OAUTH_ONLY' || err.code === 'NO_SIGNIN_METHOD')) {
        void resolve(email)
      }
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const methods = identity?.methods ?? []
  const renderable = methods.filter((m) => canRender(m.id))
  const showPassword = renderable.some((m) => m.id === 'password')
  const showGoogle = renderable.some((m) => m.id === 'google')
  const atMethodStep = identity !== null
  // A method the registry offers but this page has no control for. Naming it
  // beats silently dropping it — the user would otherwise see a shorter list
  // with no explanation.
  const unrenderable = methods.filter((m) => !canRender(m.id))
  // Providers linked to this identity but not usable here, plus — behind the
  // flag below — every declared-but-disabled provider.
  const greyedOut = SHOW_DECLARED_PROVIDERS
    ? (identity?.declared ?? []).filter((p) => !p.enabled)
    : (identity?.unavailable ?? [])
  const nothingWorks =
    atMethodStep &&
    !showPassword &&
    !showGoogle &&
    !identity?.noSignInMethod &&
    unrenderable.length === 0 &&
    greyedOut.length === 0
  const setPasswordHref = `/forgot-password?email=${encodeURIComponent(identity?.email ?? email)}`

  return (
    <AuthShell title="Mudavym" subtitle="Sign in to manage your wine inventory">
      <AuthCard>
        {(error || authError) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <p className="text-sm font-medium text-red-900">Login Failed</p>
              <p className="text-sm text-red-700">{error || authError}</p>
            </div>
          </motion.div>
        )}

        {/* ── Step 1: who are you? ─────────────────────────────────── */}
        {!atMethodStep && (
          <form onSubmit={handleContinue} className="space-y-5">
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
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                  placeholder="you@restaurant.com"
                  disabled={resolving}
                />
              </div>
            </div>

            <Button type="submit" variant="default" size="lg" className="w-full" disabled={resolving}>
              {resolving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                  Checking...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Continue
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </span>
              )}
            </Button>
          </form>
        )}

        {/* ── Step 2: the methods this identity actually has ───────── */}
        {atMethodStep && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="truncate text-sm font-medium text-gray-800">{identity?.email}</span>
              <button
                type="button"
                onClick={() => {
                  setIdentity(null)
                  setPassword('')
                  setError(null)
                  clearError()
                }}
                className="shrink-0 text-sm font-medium text-wine-600 hover:text-wine-700"
              >
                Change
              </button>
            </div>

            {/* The honest state: a real account with nothing to sign in with.
                This is the aldemirkonuk@hotmail.com case — no password_hash,
                no user_oauth_accounts row. It used to be told to use Google. */}
            {identity?.noSignInMethod && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" strokeWidth={1.75} />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-900">
                      This account has no sign-in method set up
                    </p>
                    <p className="text-sm text-amber-800">
                      There is no password on it and no connected sign-in provider. Set a password to
                      get in.
                    </p>
                    <Link
                      to={setPasswordHref}
                      className="inline-block text-sm font-semibold text-wine-700 underline hover:text-wine-800"
                    >
                      Set a password
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {showPassword && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Lock className="h-[18px] w-[18px] text-wine-400" strokeWidth={1.75} />
                    </div>
                    <input
                      id="password"
                      type="password"
                      required
                      autoFocus
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={fieldClass}
                      placeholder="••••••••"
                      disabled={loading}
                    />
                  </div>
                </div>

                {/*
                  "Remember me" was removed 2026-07-31 (v3.0 task 44.15) and stays
                  removed: it had no `checked`/`onChange`, and binding it would need a
                  variable refresh-token TTL the backend does not have (fixed 7d token).
                  A bound control that changes nothing is worse than none.

                  "Forgot password?" is restored 2026-08-05 (v3.0 task 20). It now has
                  a real destination: /forgot-password -> POST
                  /auth/request-password-reset -> emailed link -> /reset-password ->
                  POST /auth/reset-password. See password-reset.dto.ts and
                  AuthService#requestPasswordReset for the enumeration-resistance
                  reasoning behind the always-succeeds response — that endpoint stays
                  enumeration-safe even though this page reveals methods (ADR 0024).
                */}
                <div className="flex justify-end -mt-2">
                  <Link to={setPasswordHref} className="text-sm font-medium text-wine-600 hover:text-wine-700">
                    Forgot password?
                  </Link>
                </div>

                <Button type="submit" variant="default" size="lg" className="w-full" disabled={loading}>
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                      Signing in...
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
            )}

            {showPassword && showGoogle && (
              <div className="flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-wine-100" />
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">or</span>
                <span className="h-px flex-1 bg-wine-100" />
              </div>
            )}

            {/* Linked to this account but unusable here. Stated, not hidden:
                a method silently missing from the list is how the fabricated
                "use Google" message managed to look plausible. */}
            {greyedOut.length > 0 && (
              <div className="space-y-2">
                {greyedOut.map((p: IdentityProviderDescriptor) => (
                  <div
                    key={p.id}
                    className="flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-2 text-center text-[13px] text-gray-400"
                    title={p.disabledReason ?? undefined}
                  >
                    {p.disabledReason ?? `${p.label} sign-in isn't available yet.`}
                  </div>
                ))}
              </div>
            )}

            {unrenderable.length > 0 && (
              <p className="text-center text-xs text-gray-400">
                {unrenderable.map((p) => p.label).join(', ')} sign-in is linked to this account but has
                no button on this page yet.
              </p>
            )}

            {nothingWorks && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                No sign-in method on this account works from this page yet.{' '}
                <Link to={setPasswordHref} className="font-semibold text-wine-700 underline">
                  Set a password
                </Link>{' '}
                to get in.
              </div>
            )}
          </div>
        )}

        {/*
          Mounted at both steps, hidden off-screen until Google is one of the
          resolved methods. It must stay mounted: the Google Identity script
          initialises here, One Tap (saved accounts) only fires on mount, and
          `googleRef.open()` needs `ready === true` to redirect an OAuth-only
          account after a failed password attempt. Off-screen rather than
          `display: none` so the GSI host stays clickable programmatically.
        */}
        <div
          className={
            atMethodStep && showGoogle
              ? 'mt-5'
              : 'pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0'
          }
          aria-hidden={!(atMethodStep && showGoogle)}
        >
          <GoogleSignInButton
            ref={googleRef}
            enableOneTap
            disabled={loading}
            onSuccess={() => navigate(from, { replace: true })}
            onError={setError}
          />
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-semibold text-wine-600 hover:text-wine-700 transition-colors"
            >
              Create one now
            </Link>
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  )
}
