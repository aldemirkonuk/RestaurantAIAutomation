import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { useEffect, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Mail, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { Button } from '../components/ui'
import { toast } from 'sonner'
import { getOnboardingProgress } from '../services/api/menus'
import { apiClient, getErrorMessage } from '../services/api/client'
import { storeSession } from '../lib/houseMemory'
import { pendingJoin, rememberJoin, takeHeldJoin } from '../lib/joinResume'

/**
 * The two answers the verify route gives a click it will not honour (ADR 0229
 * fork 12; the founder, 2026-09-28, item 81, "Link needs sign-in
 * (Recommended)"): the link verifies only for someone signed in to the
 * account it was sent for. Routed on the status and the code, never the prose.
 */
function linkRefusal(err: unknown): 'sign-in' | 'other-account' | null {
  const response = (err as { response?: { status?: number; data?: { code?: string } } })
    ?.response
  if (response?.data?.code === 'LINK_FOR_ANOTHER_ACCOUNT') return 'other-account'
  if (response?.status === 401 || response?.data?.code === 'SIGN_IN_TO_VERIFY')
    return 'sign-in'
  return null
}

export function VerifyEmail() {
  const publicDesign = usePublicDesign()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading, logout } = useAuth()
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResent, setLastResent] = useState<Date | null>(null)
  const [refusal, setRefusal] = useState<'sign-in' | 'other-account' | null>(null)
  const [verifiedElsewhere, setVerifiedElsewhere] = useState(false)

  // A new account with no house, made in a tab that was holding an invite
  // (F-288): the invite becomes this account's, so verifying (often in a new
  // tab, from the mail) brings them back to it.
  useEffect(() => {
    if (!user?.userId || user.restaurantId) return
    const held = takeHeldJoin()
    if (held) rememberJoin(held, user.userId)
  }, [user?.userId, user?.restaurantId])

  const token = searchParams.get('token')
  // Back to this very link after signing in (Login honours `redirect`).
  const signInHref = `/login?redirect=${encodeURIComponent(
    token ? `/verify-email?token=${token}` : '/verify-email',
  )}`
  // Fork 12: someone signed out holds only the mailbox. They sign in first;
  // without the password, the sign-in page's emailed code proves the address
  // and (ADR 0229 fork 6) removes a password they never set.
  const mustSignIn = Boolean(token) && ((!loading && !user) || refusal === 'sign-in')
  const alreadyVerified = Boolean(token) && user?.emailVerified === true && !verified
  // No link in hand, but the address was proven elsewhere — the link opened on
  // the phone (F-440). Known from the account, or from a resend that found it
  // verified. Continue loads the app afresh so it reads the verified account.
  const addressVerified =
    !token && !verified && (user?.emailVerified === true || verifiedElsewhere)

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

      // Store new tokens that include emailVerified: true in JWT payload.
      // One helper stores every session, so `activeRestaurantId` follows the
      // token's house (ADR 0164).
      const house = storeSession(data.accessToken, data.refreshToken)
      setVerified(true)
      toast.success('Email verified! Redirecting...')
      // A session in no house goes to the chooser (ADR 0164): it shows a
      // membership waiting to be accepted (ADR 0229 fork 13), and sends an
      // account-only signup (ADR 0213) with nothing waiting on to
      // /get-started. Only a session in a house asks whether the menu is
      // already uploaded (re-verification flows).
      // An invite this account opened before verifying comes first: it is
      // what they were doing when they were sent here (F-274, F-288).
      const join = pendingJoin(user?.userId)
      const progress =
        house && !join ? await getOnboardingProgress().catch(() => null) : null
      const destination = join
        ? join
        : !house
        ? '/choose-house'
        : progress?.menu_uploaded
          ? '/'
          : '/get-started'
      setTimeout(() => {
        window.location.href = destination
      }, 1500)
    } catch (err: unknown) {
      const refused = linkRefusal(err)
      if (refused) setRefusal(refused)
      else setError(getErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  const signOutThenSignIn = () =>
    void logout().then((out) => {
      // `false`: they chose to keep unsent changes and stay signed in (ADR 0241).
      if (out) navigate(signInHref, { replace: true })
    })

  // F-636: a person waiting on the mail had no way off this page. There is no
  // way to change an address before it is verified, so a wrong one means
  // signing out and signing up again with the right address; the same
  // sign-out (it asks first about unsent changes) also lets them simply leave.
  const signOutTo = (to: string) =>
    void logout().then((out) => {
      if (out) navigate(to, { replace: true })
    })
  const showWayOut = Boolean(user) && user?.emailVerified !== true
  const wayOut = (house: boolean) =>
    showWayOut ? (
      <div
        data-testid="verify-way-out"
        className={house ? 'mdv-pub__stack' : 'mt-6 space-y-2 text-center'}
      >
        <p className={house ? 'mdv-note' : 'text-sm text-gray-600'}>
          Wrong address? Sign out and create your account again with the right
          one.
        </p>
        <button
          type="button"
          className={
            house
              ? 'mdv-btn'
              : 'text-sm text-wine-600 hover:text-wine-700 font-semibold'
          }
          onClick={() => signOutTo('/register')}
        >
          Sign out and use another address
        </button>
        <button
          type="button"
          className={
            house ? 'mdv-link' : 'block w-full text-sm text-gray-600 hover:text-gray-800'
          }
          onClick={() => signOutTo('/login')}
        >
          Sign out
        </button>
      </div>
    ) : null

  /** What the page says for a link it cannot honour yet (fork 12). */
  const linkGate = mustSignIn ? (
    <div className="mdv-pub__stack" data-testid="verify-needs-sign-in">
      <p>
        This link works only while you are signed in to the account it was
        sent for.
      </p>
      <Link className="mdv-btn mdv-btn--seal" to={signInHref}>
        Sign in to verify
      </Link>
      <p className="mdv-note">
        Not your password, or you never set one? On the sign-in page choose
        “Email me a sign-in code”. The code proves this address, and any
        password you did not set is removed.
      </p>
    </div>
  ) : refusal === 'other-account' ? (
    <div className="mdv-pub__stack">
      <p className="mdv-alert" role="alert">
        This link is for a different account than the one signed in here.
      </p>
      <button className="mdv-btn mdv-btn--seal" onClick={signOutThenSignIn}>
        Sign out and sign in to that account
      </button>
    </div>
  ) : alreadyVerified ? (
    <div className="mdv-pub__stack">
      <p role="status">This address is already verified.</p>
      <Link className="mdv-btn mdv-btn--seal" to="/">
        Continue
      </Link>
    </div>
  ) : null

  const handleResend = async () => {
    // Rate limit: 1 per 60 seconds (T-26-05-03)
    if (lastResent && Date.now() - lastResent.getTime() < 60000) {
      toast.error('Please wait 1 minute before resending')
      return
    }
    setResending(true)
    setError(null)
    try {
      const { data } = await apiClient.post<{ alreadyVerified?: boolean }>(
        '/auth/resend-verification',
      )
      if (data?.alreadyVerified) {
        setVerifiedElsewhere(true)
        return
      }
      setLastResent(new Date())
      toast.success('Verification email requested. Check your inbox.')
    } catch (err: unknown) {
      // Inline only (both renderings already show `error`) — a toast here
      // duplicated the same failure as a second, dismissable surface.
      setError(getErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  if (publicDesign) {
    return (
      <PublicShell
        title={
          verified || addressVerified
            ? 'Email verified'
            : token
              ? 'Verify your email'
              : 'Check your email'
        }
        eyebrow="Account access"
        voice={
          verified
            ? 'Opening your workspace…'
            : addressVerified
              ? 'Nothing more to do here.'
              : token
                ? 'Confirm this address to continue.'
                : 'Look for the verification email from Mudavym.'
        }
        homeHref="/login"
        footer={
          <Link className="mdv-link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <div className="mdv-pub__plate mdv-pub__stack">
          {verified ? (
            <p role="status">Your address is verified. Redirecting you now…</p>
          ) : (
            <>
              {error && (
                <p className="mdv-alert" role="alert">
                  {error}
                </p>
              )}
              {token ? (
                linkGate ?? (
                  <button
                    className="mdv-btn mdv-btn--seal"
                    onClick={handleVerify}
                    disabled={verifying}
                  >
                    {verifying ? 'Verifying…' : 'Verify my email'}
                  </button>
                )
              ) : addressVerified ? (
                <>
                  <p role="status">This address is verified.</p>
                  <a className="mdv-btn mdv-btn--seal" href="/">
                    Continue
                  </a>
                </>
              ) : (
                <>
                  {user?.email && (
                    <p>
                      Account: <strong>{user.email}</strong>
                    </p>
                  )}
                  <p>
                    Open the verification link in your inbox. If it is missing,
                    check your spam folder.
                  </p>
                  {user ? (
                    <button
                      className="mdv-btn mdv-btn--seal"
                      onClick={handleResend}
                      disabled={resending}
                    >
                      {resending ? 'Requesting…' : 'Resend verification email'}
                    </button>
                  ) : (
                    <Link
                      className="mdv-btn mdv-btn--seal"
                      to="/login?redirect=%2Fverify-email"
                    >
                      Sign in to resend
                    </Link>
                  )}
                  {lastResent && (
                    <p role="status" className="mdv-note">
                      Another verification email was requested at{' '}
                      {lastResent.toLocaleTimeString()}. Wait one minute before
                      requesting again.
                    </p>
                  )}
                </>
              )}
              {wayOut(true)}
            </>
          )}
        </div>
      </PublicShell>
    )
  }

  if (verified) {
    return (
      <AuthShell title="Email Verified!" subtitle="Redirecting you now…">
        <AuthCard className="text-center py-10">
          <CheckCircle
            className="w-14 h-14 text-emerald-500 mx-auto"
            strokeWidth={1.5}
          />
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
            <AlertCircle
              className="w-4 h-4 text-red-500 flex-shrink-0"
              strokeWidth={1.75}
            />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-3 my-6">
          {[
            'Open the email from Mudavym',
            'Click "Verify My Email"',
            `You'll be guided through setting up your wine list`,
          ].map((text, i) => (
            <div
              key={i}
              className="flex items-start gap-3 bg-wine-50/50 rounded-xl p-3"
            >
              <div className="w-5 h-5 rounded-full bg-wine-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>

        {token && linkGate ? (
          <div className="space-y-3 text-sm text-gray-600 text-center">
            {linkGate}
          </div>
        ) : token ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 text-center">
              Click below to verify your email address.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying ? (
                <>
                  <Loader2
                    className="w-4 h-4 animate-spin mr-2"
                    strokeWidth={1.75}
                  />
                  Verifying...
                </>
              ) : (
                'Verify My Email'
              )}
            </Button>
          </div>
        ) : addressVerified ? (
          <div className="space-y-3 text-center">
            <p role="status" className="text-sm text-gray-600">
              This address is verified.
            </p>
            <a
              href="/"
              className="inline-block w-full rounded-xl bg-wine-600 py-3 text-sm font-semibold text-white hover:bg-wine-700"
            >
              Continue
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 text-center">
              Didn&apos;t receive the email? Check your spam folder or resend
              below.
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
                  <Loader2
                    className="w-4 h-4 animate-spin mr-2"
                    strokeWidth={1.75}
                  />
                  Resending...
                </>
              ) : (
                'Resend Verification Email'
              )}
            </Button>
            {lastResent && (
              <p className="text-xs text-center text-gray-400">
                Resent at {lastResent.toLocaleTimeString()}. Wait 1 minute
                before resending again.
              </p>
            )}
          </div>
        )}

        {wayOut(false)}

        <div className="mt-6 pt-4 border-t border-gray-100 text-center">
          <Link
            to="/login"
            className="text-sm text-wine-600 hover:text-wine-700 font-semibold"
          >
            Back to Sign In
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  )
}
