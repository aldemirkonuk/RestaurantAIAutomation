import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
// A bare /register shows the landing page (ADR 0344); this link asks for the form.
import { START } from './landing/doors'
import { useAuth, LoginError } from '../contexts/AuthContext'
import { Button } from '../components/ui'
import { Mail, Lock, ArrowRight, KeyRound, Fingerprint } from 'lucide-react'
import { EndpaperShell } from '../components/brand/EndpaperShell'
import '../components/brand/auth-house.css'
import { GoogleSignInButton, type GoogleSignInHandle } from '../components/auth/GoogleSignInButton'
import {
  passkeysSupported,
  requestSignInCode,
  signInWithEmailCode,
  signInWithPasskey,
} from '../services/api/passkeys'
import { getErrorMessage } from '../services/api/client'
import {
  canRender,
  type IdentityProviderDescriptor,
  type SignInMethodsResult,
} from '../lib/identityProviders'

/*
 * The one look (r58: the legacy class fork is gone). Every colour here is a
 * token from mudavym.css, so both grounds resolve with the rest of the book:
 * grays are ink/paper, the wine scale is the seal, status hues (red, amber)
 * keep their classes because the house stylesheet has no status token, and
 * hand-drawn focus rings are dropped for the seal outline in auth-house.css.
 * `!` on a <p>/<h*> colour outranks globals.css's `.dark p` at (0,1,1).
 */
const houseFieldClass =
  'block w-full pl-11 pr-3 py-3 rounded-xl border border-paper-2 bg-paper-0 text-inkm-1 placeholder:text-inkm-3 transition-all focus:outline-none disabled:opacity-60'

/** The shared Button merges `className` last (tailwind-merge), so this replaces
 *  its wine fill and its literal-rgba shadow rather than stacking on them. */
const HOUSE_BUTTON = 'bg-seal text-paper-0 hover:bg-seal-deep shadow-none hover:shadow-none'

/**
 * What a refused sign-in says on the house path, in the book's voice (sketch
 * 118 frames 06-07). Keyed on the gateway's status, never on its message
 * text, and only for a plain refusal: a structured `code` (OAUTH_ONLY,
 * NO_SIGNIN_METHOD) keeps the gateway's own words. The gateway answers 401
 * for a wrong password and an unknown address alike (an enumeration guard),
 * so "did not match" is the honest reading of either.
 */
type Refusal = 'mismatch' | 'throttled' | null
function signInNote(refusal: Refusal, message: string): { pause: boolean; title: string; detail: string } {
  if (refusal === 'mismatch') {
    return { pause: false, title: 'That password did not match.', detail: 'Check it and try again, or reset it below.' }
  }
  if (refusal === 'throttled') {
    return {
      pause: true,
      title: 'Too many tries — wait a moment.',
      detail: 'This connection has made too many sign-in attempts. Try again in a few minutes.',
    }
  }
  return { pause: false, title: 'Sign-in didn’t go through.', detail: message }
}

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
  const { login, error: authError, clearError, resolveSignInMethods, signInWithSession } = useAuth()
  const googleRef = useRef<GoogleSignInHandle>(null)

  const searchParams = new URLSearchParams(location.search)
  const redirectQuery = searchParams.get('redirect')
  const from = redirectQuery || (location.state as { from?: { pathname: string } })?.from?.pathname || '/'
  const prefilledEmail = searchParams.get('email') ?? ''

  const [email, setEmail] = useState(prefilledEmail)
  const [password, setPassword] = useState('')
  // Google sign-in is not set up on this deployment: its row, and the "or"
  // rule above it, are not drawn at all.
  const [googleGone, setGoogleGone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [identity, setIdentity] = useState<SignInMethodsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal>(null)
  // The two doors that are not a password (ADR 0222 / ADR 0229; founder
  // 2026-09-25, item 29): a passkey on this device, or an emailed code.
  const canUsePasskey = passkeysSupported()
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [codeSentTo, setCodeSentTo] = useState<{ email: string; notice: string } | null>(null)
  const [code, setCode] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)

  const resetNotes = () => {
    setError(null)
    setRefusal(null)
    clearError()
  }

  const handlePasskey = async () => {
    resetNotes()
    setPasskeyBusy(true)
    try {
      await signInWithSession(await signInWithPasskey())
      navigate(from, { replace: true })
    } catch (err: any) {
      // A prompt the person closed, or a device with no passkey for Mudavym:
      // not a fault, and the way forward is the emailed code.
      setError(
        err?.name === 'NotAllowedError' || err?.name === 'AbortError'
          ? 'No passkey was used. If this device has none, type your email, continue, and choose “Email me a sign-in code”.'
          : getErrorMessage(err),
      )
    } finally {
      setPasskeyBusy(false)
    }
  }

  const sendCode = async (address: string) => {
    resetNotes()
    setCodeBusy(true)
    try {
      const res = await requestSignInCode(address)
      setCodeSentTo({ email: address, notice: res.message })
      setCode('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCodeBusy(false)
    }
  }

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!codeSentTo) return
    resetNotes()
    setCodeBusy(true)
    try {
      await signInWithSession(await signInWithEmailCode(codeSentTo.email, code))
      navigate(from, { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCodeBusy(false)
    }
  }

  const resolve = useCallback(
    async (address: string) => {
      setError(null)
      setRefusal(null)
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
    setRefusal(null)
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
      setRefusal(
        err instanceof LoginError && !err.code
          ? err.status === 401
            ? 'mismatch'
            : err.status === 429
              ? 'throttled'
              : null
          : null,
      )
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

  // The fields themselves never change with `on` (ADR 0143 row 35 — sketch
  // 118 — reopens colour-only for exactly this pair of pages, but "same
  // fields and flow" still holds): this tree is shared by both the endpaper
  // shell and today's card, and only the chrome around it branches below.
  const content = (
    <>
      {(error || authError) && (() => {
        const note = signInNote(refusal, (error || authError) as string)
        return (
          <div role="alert" className={note.pause ? 'mdv-ep-note border-amber-600' : 'mdv-ep-note border-red-700'}>
            <p className={note.pause ? 'mdv-ep-note-title !text-amber-800' : 'mdv-ep-note-title !text-red-800'}>{note.title}</p>
            <p className="mdv-ep-note-detail">{note.detail}</p>
          </div>
        )
      })()}
      

      {/* ── Step 1: who are you? ─────────────────────────────────── */}
      {!atMethodStep && (
          <form onSubmit={handleContinue} className="space-y-5">
            <div>
              <label htmlFor="email" className={'block text-sm font-medium text-inkm-2 mb-2'}>
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className={'h-[18px] w-[18px] text-seal'} strokeWidth={1.75} />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={houseFieldClass}
                  placeholder="you@restaurant.com"
                  disabled={resolving}
                />
              </div>
            </div>

            <Button type="submit" variant="default" size="lg" className={`w-full ${HOUSE_BUTTON}`} disabled={resolving}>
              {resolving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className={'w-4 h-4 border-2 border-paper-0 opacity-80 border-t-transparent rounded-full animate-spin'} />
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

        {/* A passkey names nobody in advance: the device offers the one it
            holds, so it needs no address. Drawn only where the browser can
            run the ceremony at all. */}
        {!atMethodStep && canUsePasskey && (
          <button
            type="button"
            onClick={() => void handlePasskey()}
            disabled={passkeyBusy || resolving}
            className={
              'mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-paper-2 bg-paper-0 px-4 py-2 text-sm font-medium text-inkm-1 hover:bg-paper-1 disabled:opacity-60'
            }
          >
            <Fingerprint className={'h-[18px] w-[18px] text-seal'} strokeWidth={1.75} />
            {passkeyBusy ? 'Waiting for your device…' : 'Sign in with a passkey'}
          </button>
        )}

        {/* ── Step 2: the methods this identity actually has ───────── */}
        {atMethodStep && (
          <div className="space-y-5">
            <div className={'flex items-center justify-between gap-3 rounded-[3px] bg-paper-1 px-4 py-3'}>
              <span className={'truncate text-sm font-medium text-inkm-1'}>{identity?.email}</span>
              <button
                type="button"
                onClick={() => {
                  setIdentity(null)
                  setPassword('')
                  setCodeSentTo(null)
                  setCode('')
                  setError(null)
                  setRefusal(null)
                  clearError()
                }}
                className={'shrink-0 text-sm font-medium text-seal hover:text-seal-deep'}
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
                    <p className={'text-sm font-medium !text-amber-900'}>
                      This account has no sign-in method set up
                    </p>
                    <p className={'text-sm !text-amber-800'}>
                      There is no password on it and no connected sign-in provider. Email yourself a
                      sign-in code below, or set a password.
                    </p>
                    {/* A status plate has no token, so its link keeps a fixed dark
                        seal: under `.dark`, globals.css lifts `.text-wine-700`
                        to #5FB0BC, which reads 2.40:1 on amber-50. wine-800 is
                        outside that remap (10.63:1). */}
                    <Link
                      to={setPasswordHref}
                      className={
                        'inline-block text-sm font-semibold text-wine-800 underline hover:text-wine-900'
                      }
                    >
                      Set a password
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {codeSentTo && (
              <form onSubmit={handleCode} className="space-y-5">
                <p className={'text-sm !text-inkm-4'}>{codeSentTo.notice}</p>
                <div>
                  <label htmlFor="sign-in-code" className={'block text-sm font-medium text-inkm-2 mb-2'}>
                    Sign-in code
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <KeyRound className={'h-[18px] w-[18px] text-seal'} strokeWidth={1.75} />
                    </div>
                    <input
                      id="sign-in-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      autoFocus
                      maxLength={7}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className={houseFieldClass}
                      placeholder="123456"
                      disabled={codeBusy}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="default"
                  size="lg"
                  className={`w-full ${HOUSE_BUTTON}`}
                  disabled={codeBusy || code.replace(/\s+/g, '').length !== 6}
                >
                  {codeBusy ? 'Checking…' : 'Sign In'}
                </Button>
                <div className="flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void sendCode(codeSentTo.email)}
                    disabled={codeBusy}
                    className={'text-sm font-medium text-seal hover:text-seal-deep'}
                  >
                    Send a new code
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeSentTo(null)
                      setCode('')
                      resetNotes()
                    }}
                    className={'text-sm font-medium text-seal hover:text-seal-deep'}
                  >
                    Sign in another way
                  </button>
                </div>
              </form>
            )}

            {!codeSentTo && showPassword && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className={'block text-sm font-medium text-inkm-2 mb-2'}>
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Lock className={'h-[18px] w-[18px] text-seal'} strokeWidth={1.75} />
                    </div>
                    <input
                      id="password"
                      type="password"
                      required
                      autoFocus
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={(refusal === 'mismatch' ? houseFieldClass.replace('border-paper-2', 'border-red-700') : houseFieldClass)}
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
                  <Link to={setPasswordHref} className={'text-sm font-medium text-seal hover:text-seal-deep'}>
                    Forgot password?
                  </Link>
                </div>

                <Button type="submit" variant="default" size="lg" className={`w-full ${HOUSE_BUTTON}`} disabled={loading}>
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className={'w-4 h-4 border-2 border-paper-0 opacity-80 border-t-transparent rounded-full animate-spin'} />
                      Signing in...
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
            )}

            {!codeSentTo && showPassword && showGoogle && (
              <div className="flex items-center gap-3" aria-hidden>
                <span className={'h-px flex-1 bg-seal-tint'} />
                <span className={'text-xs font-medium uppercase tracking-wide text-inkm-3'}>or</span>
                <span className={'h-px flex-1 bg-seal-tint'} />
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
                    className={
                      'flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-paper-2 px-4 py-2 text-center text-[13px] text-inkm-3'
                    }
                    title={p.disabledReason ?? undefined}
                  >
                    {p.disabledReason ?? `${p.label} sign-in isn't available yet.`}
                  </div>
                ))}
              </div>
            )}

            {unrenderable.length > 0 && (
              <p className={'text-center text-xs !text-inkm-3'}>
                {unrenderable.map((p) => p.label).join(', ')} sign-in is linked to this account but has
                no button on this page yet.
              </p>
            )}

            {nothingWorks && (
              <div className={'rounded-xl border border-paper-2 bg-paper-0 p-4 text-sm text-inkm-4'}>
                No password or sign-in provider on this account works from this page yet. Email yourself a
                sign-in code below, or{' '}
                <Link to={setPasswordHref} className={'font-semibold text-seal-deep underline'}>
                  set a password
                </Link>
                .
              </div>
            )}

            {/* The emailed code: always offered once an address is typed.
                The gateway answers the same whether or not the address has
                an account (ADR 0229), so offering it reveals nothing. */}
            {!codeSentTo && (
              <button
                type="button"
                onClick={() => void sendCode(identity?.email ?? email)}
                disabled={codeBusy || loading}
                className={
                  'flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-paper-2 bg-paper-0 px-4 py-2 text-sm font-medium text-inkm-1 hover:bg-paper-1 disabled:opacity-60'
                }
              >
                <Mail className={'h-[18px] w-[18px] text-seal'} strokeWidth={1.75} />
                {codeBusy ? 'Sending…' : 'Email me a sign-in code'}
              </button>
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
        {/* House path: "Continue with Google" also sits on the first page,
            under the address (founder, 2026-09-19). A Google account with no
            Mudavym account is refused by the gateway exactly as before. */}
        {!atMethodStep && !googleGone && (
          <div className="mt-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-paper-2" />
            <span className="text-xs font-medium uppercase tracking-wide text-inkm-3">or</span>
            <span className="h-px flex-1 bg-paper-2" />
          </div>
        )}
        <div
          className={
            (atMethodStep ? showGoogle : true) && !googleGone
              ? 'mt-5'
              : 'pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0'
          }
          aria-hidden={!(atMethodStep ? showGoogle : true) || googleGone}
        >
          <GoogleSignInButton
            ref={googleRef}
            enableOneTap
            onUnavailable={() => setGoogleGone(true)}
            disabled={loading}
            onSuccess={() => navigate(from, { replace: true })}
            onError={(message) => {
              // A Google refusal is its own message: never let a password
              // mismatch from earlier on this step dress it as one.
              setRefusal(null)
              setError(message)
            }}
          />
        </div>

        <div className="mt-6 text-center">
          <p className={'text-sm !text-inkm-4'}>
            Don&apos;t have an account?{' '}
            <Link
              to={START}
              className={
                'font-semibold text-seal hover:text-seal-deep transition-colors'
              }
            >
              Create one now
            </Link>
          </p>
        </div>
    </>
  )

  // sketch 118 · Direction B (the endpaper), the founder's 2026-09-19 pick —
  // ADR 0149 row 35.
  return (
    <EndpaperShell
      kicker="The house"
      houseLine="Kept, page by page."
      tag="Every house's book looks the same on the inside — this is where yours opens."
      folio="Sign in"
      pageKey={atMethodStep ? 'methods' : 'address'}
      frontMatter
    >
      <h2 className="mdv-ep-leaf-title">Welcome back.</h2>
      <p className="mdv-ep-leaf-lede">Your house keeps its book here.</p>
      {content}
    </EndpaperShell>
  )
}
