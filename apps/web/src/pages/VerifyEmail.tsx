import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Mail, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { Button } from '../components/ui'
import { toast } from 'sonner'
import { getOnboardingProgress } from '../services/api/menus'
import { apiClient, getErrorMessage } from '../services/api/client'
import { tokenHouse } from '../lib/houseMemory'
import {
  CODE_REFUSAL_SENTENCE,
  clearSignUpMail,
  codeDigits,
  codeRefusal,
  noteSignUpMail,
  readSignUpMail,
  resendOutcome,
  signUpMailSentence,
  verificationMailSentence,
  type CodeRefusal,
  type VerificationMail,
  type VerificationResendAnswer,
} from '../lib/verificationMail'

type SessionPair = { accessToken: string; refreshToken: string }

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
  const { user, loading, logout, signInWithSession } = useAuth()
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResent, setLastResent] = useState<Date | null>(null)
  const [refusal, setRefusal] = useState<'sign-in' | 'other-account' | null>(null)
  // OB-6: the code box (F3: "the tab that signed up takes the code").
  const [code, setCode] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeRefused, setCodeRefused] = useState<CodeRefusal | null>(null)
  const codeInFlight = useRef(false)
  const verifyInFlight = useRef(false)
  // OB-6: what became of the latest verification mail, one state for the
  // whole page. The sign-up's send is kept in session storage by
  // `registerAccount`; a resend writes its own answer to the same key, so a
  // reload says the same thing and a newer answer replaces an older one.
  // The note is this account's only (QA r19 on #914): it is read for the
  // signed-in address, and says nothing once that address is verified.
  const [resentState, setMailState] = useState<VerificationMail | null>(null)
  const mailState = user?.emailVerified
    ? null
    : resentState ?? readSignUpMail(user?.email)
  const mailSentence = signUpMailSentence(mailState)
  // The address is verified but the session read after it failed (ADR 0020:
  // a failed read says it failed). The pair is kept for "Try again".
  const [sessionReadFailed, setSessionReadFailed] = useState(false)
  const verifiedPair = useRef<SessionPair | null>(null)

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

  /**
   * The link or the code verified the address: keep the new session and move
   * on through the router (OB-6). `signInWithSession` stores the pair with
   * the one helper every sign-in uses, so `activeRestaurantId` follows the
   * token's house (ADR 0164), and resolves only after `/auth/me` has set the
   * now-verified person. No 1.5 s wait and no full page load.
   */
  const finishVerified = async (pair: SessionPair) => {
    verifiedPair.current = pair
    setVerified(true)
    setSessionReadFailed(false)
    try {
      await signInWithSession(pair)
    } catch {
      setSessionReadFailed(true)
      return
    }
    // Verified: the sign-up's mail note (OB-6) has nothing left to say, and
    // must not come back if this account ever has to verify again.
    clearSignUpMail()
    // A session in no house goes to the chooser (ADR 0164): it shows a
    // membership waiting to be accepted (ADR 0229 fork 13), and sends an
    // account-only signup (ADR 0213) with nothing waiting on to
    // /get-started. Only a session in a house asks whether the menu is
    // already uploaded (re-verification flows).
    const house = tokenHouse(pair.accessToken)
    const progress = house ? await getOnboardingProgress().catch(() => null) : null
    const destination = !house
      ? '/choose-house'
      : progress?.menu_uploaded
        ? '/'
        : '/get-started'
    toast.success('Email verified.')
    navigate(destination, { replace: true })
  }

  const handleVerify = async () => {
    if (!token) {
      setError('No verification token found in URL.')
      return
    }
    if (verifyInFlight.current) return
    verifyInFlight.current = true
    setVerifying(true)
    setError(null)
    try {
      const { data } = await apiClient.post<SessionPair>('/auth/verify-email', {
        token,
      })
      await finishVerified(data)
    } catch (err: unknown) {
      const refused = linkRefusal(err)
      if (refused) setRefusal(refused)
      else setError(getErrorMessage(err))
    } finally {
      verifyInFlight.current = false
      setVerifying(false)
    }
  }

  // F3: a link opened where its person is signed in verifies by itself, once.
  // Mail scanners hold no session, so the signed-out branch keeps its button.
  const autoVerified = useRef(false)
  useEffect(() => {
    if (autoVerified.current || !token || loading || !user) return
    if (user.emailVerified === true) return
    autoVerified.current = true
    void handleVerify()
    // handleVerify reads only state this effect already keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, user])

  /** POST the six digits; never twice at once, never fewer than six. */
  const submitCode = async (digits: string) => {
    if (digits.length !== 6 || codeInFlight.current) return
    codeInFlight.current = true
    setCodeBusy(true)
    setCodeRefused(null)
    setError(null)
    try {
      const { data } = await apiClient.post<SessionPair>('/auth/verify-email', {
        code: digits,
      })
      await finishVerified(data)
    } catch (err: unknown) {
      setCodeRefused(codeRefusal(err))
    } finally {
      codeInFlight.current = false
      setCodeBusy(false)
    }
  }

  const onCodeChange = (raw: string) => {
    const digits = codeDigits(raw)
    setCode(digits)
    // Typing the sixth digit, or pasting all six, submits by itself.
    if (digits.length === 6) void submitCode(digits)
  }

  const retrySession = () => {
    if (verifiedPair.current) void finishVerified(verifiedPair.current)
  }

  const signOutThenSignIn = () =>
    void logout().then((out) => {
      // `false`: they chose to keep unsent changes and stay signed in (ADR 0241).
      if (out) navigate(signInHref, { replace: true })
    })

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

  // Walk 2026-11-11: typing the sixth digit submits by itself, the refusal
  // line above the buttons clears, and the Resend button moves up under a
  // pointer that was aiming at "Verify with this code". The press landed
  // 18 ms after the code verified and mailed a new code to a verified
  // address. No resend while a code or link is being checked, or after.
  const resendLocked = resending || codeBusy || verifying || verified

  const handleResend = async () => {
    if (codeInFlight.current || verifyInFlight.current || verified) return
    // Rate limit: 1 per 60 seconds (T-26-05-03)
    if (lastResent && Date.now() - lastResent.getTime() < 60000) {
      toast.error('Please wait 1 minute before resending')
      return
    }
    setResending(true)
    setError(null)
    try {
      const { data } = await apiClient.post<VerificationResendAnswer>(
        '/auth/resend-verification',
      )
      // Said from what the mailer answered (round 2 B-5, round 6 #789):
      // one state, so a newer answer replaces an older note instead of
      // stacking beside it. A send that did not leave, or was not confirmed,
      // is never "sent" and leaves the resend button enabled.
      const outcome = resendOutcome(data)
      setMailState(outcome)
      noteSignUpMail(outcome, user?.email)
      if (outcome !== 'sent') {
        setLastResent(null)
        return
      }
      setLastResent(new Date())
      toast.success(verificationMailSentence('sent', user?.email))
    } catch (err: unknown) {
      // Inline only (both renderings already show `error`) — a toast here
      // duplicated the same failure as a second, dismissable surface.
      setError(getErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  // The code box: signed in, no link in the URL, not yet verified (F3). A
  // signed-out person keeps today's sign-in path and sees no box.
  const canTypeCode = !token && !loading && Boolean(user) && user?.emailVerified !== true
  const mailTrouble = mailState === 'not_sent' || mailState === 'unconfirmed'

  const codeBox = canTypeCode ? (
    <form
      data-testid="verify-code-box"
      className={publicDesign ? 'mdv-pub__stack' : 'space-y-3'}
      onSubmit={(e) => {
        e.preventDefault()
        void submitCode(code)
      }}
    >
      <label
        htmlFor="verify-email-code"
        className={publicDesign ? undefined : 'block text-sm font-medium text-gray-700'}
      >
        Code from the email
      </label>
      <input
        id="verify-email-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
        disabled={codeBusy}
        className={
          publicDesign
            ? 'block w-full px-3 py-3 rounded-xl border border-paper-2 bg-paper-0 text-inkm-1 placeholder:text-inkm-3 tracking-[0.3em] focus:outline-none disabled:opacity-60'
            : 'block w-full px-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 tracking-[0.3em] focus:outline-none focus:border-wine-600 focus:ring-4 focus:ring-wine-600/10 disabled:opacity-60'
        }
      />
      {codeRefused && (
        <p
          role="alert"
          className={publicDesign ? 'mdv-alert' : 'text-sm text-red-700'}
          data-testid="verify-code-refusal"
        >
          {CODE_REFUSAL_SENTENCE[codeRefused]}
        </p>
      )}
      {codeRefused === 'sign-in' && (
        <Link
          className={publicDesign ? 'mdv-link' : 'text-sm text-wine-600 font-semibold'}
          to="/login?redirect=%2Fverify-email"
        >
          Sign in again
        </Link>
      )}
      {publicDesign ? (
        <button
          type="submit"
          className="mdv-btn"
          disabled={codeBusy || code.length !== 6}
        >
          {codeBusy ? 'Checking…' : 'Verify with this code'}
        </button>
      ) : (
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          size="lg"
          disabled={codeBusy || code.length !== 6}
        >
          {codeBusy ? 'Checking...' : 'Verify with this code'}
        </Button>
      )}
    </form>
  ) : null

  if (publicDesign) {
    return (
      <PublicShell
        title={
          verified
            ? 'Email verified'
            : token
              ? 'Verify your email'
              : 'Check your email'
        }
        eyebrow="Account access"
        voice={
          verified
            ? sessionReadFailed
              ? 'Your address is verified.'
              : 'Opening your workspace…'
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
            sessionReadFailed ? (
              <>
                <p className="mdv-alert" role="alert">
                  Your address is verified, but your account could not be
                  loaded just now.
                </p>
                <button className="mdv-btn mdv-btn--seal" onClick={retrySession}>
                  Try again
                </button>
              </>
            ) : (
              <p role="status">Your address is verified. Opening your workspace…</p>
            )
          ) : (
            <>
              {error && (
                <p className="mdv-alert" role="alert">
                  {error}
                </p>
              )}
              {mailSentence && (
                <p
                  className={mailState === 'not_sent' ? 'mdv-alert' : 'mdv-note'}
                  role={mailState === 'not_sent' ? 'alert' : 'status'}
                >
                  {mailSentence}
                </p>
              )}
              {token ? (
                linkGate ?? (
                  <>
                    <button
                      className="mdv-btn mdv-btn--seal"
                      onClick={handleVerify}
                      disabled={verifying}
                    >
                      {verifying ? 'Verifying…' : 'Verify my email'}
                    </button>
                    {/* Round 2 B-4: a link the gateway refused (expired,
                        used) offers a fresh one, not only the same button. */}
                    {(error || mailTrouble) && user && (
                      <button
                        className="mdv-btn"
                        onClick={handleResend}
                        disabled={resendLocked}
                      >
                        {resending ? 'Requesting…' : 'Send me a new link'}
                      </button>
                    )}
                    {lastResent && (
                      <p role="status" className="mdv-note">
                        Another verification email was sent at{' '}
                        {lastResent.toLocaleTimeString()}.
                      </p>
                    )}
                  </>
                )
              ) : (
                <>
                  {user?.email && (
                    <p>
                      Account: <strong>{user.email}</strong>
                    </p>
                  )}
                  {mailState !== 'not_sent' && (
                    <p>
                      Open the verification link in your inbox, or type the
                      code from the email. If it is missing, check your spam
                      folder.
                    </p>
                  )}
                  {codeBox}
                  {user ? (
                    <button
                      className="mdv-btn mdv-btn--seal"
                      onClick={handleResend}
                      disabled={resendLocked}
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
                      Another verification email was sent at{' '}
                      {lastResent.toLocaleTimeString()}. Wait one minute before
                      requesting again.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </PublicShell>
    )
  }

  if (verified) {
    return (
      <AuthShell
        title="Email Verified!"
        subtitle={
          sessionReadFailed
            ? 'Your account could not be loaded just now.'
            : 'Opening your workspace…'
        }
      >
        <AuthCard className="text-center py-10 space-y-4">
          <CheckCircle
            className="w-14 h-14 text-emerald-500 mx-auto"
            strokeWidth={1.5}
          />
          {sessionReadFailed && (
            <>
              <p role="alert" className="text-sm text-red-700">
                Your address is verified, but your account could not be
                loaded just now.
              </p>
              <Button className="w-full" size="lg" onClick={retrySession}>
                Try again
              </Button>
            </>
          )}
        </AuthCard>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Check Your Email"
      subtitle={
        mailState === 'not_sent'
          ? 'We could not send the verification email'
          : mailState === 'unconfirmed'
            ? 'Sending the verification email is taking longer than usual'
            : user?.email
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

        {mailSentence && (
          <p
            role={mailState === 'not_sent' ? 'alert' : 'status'}
            className={
              mailState === 'not_sent'
                ? 'mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700'
                : 'mb-4 text-sm text-gray-600 text-center'
            }
          >
            {mailSentence}
          </p>
        )}

        <div className="space-y-3 my-6">
          {(mailState === 'not_sent' ? [] : [
            'Open the email from Mudavym',
            'Click "Verify My Email"',
            `You'll be guided through setting up your wine list`,
          ]).map((text, i) => (
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
            {(error || mailTrouble) && user && (
              <Button
                variant="outline"
                className="w-full"
                size="lg"
                onClick={handleResend}
                disabled={resendLocked}
              >
                {resending ? 'Resending...' : 'Send me a new link'}
              </Button>
            )}
            {lastResent && (
              <p className="text-xs text-center text-gray-400">
                Sent at {lastResent.toLocaleTimeString()}.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {codeBox}
            {mailState !== 'not_sent' && (
              <p className="text-sm text-gray-600 text-center">
                Didn&apos;t receive the email? Check your spam folder or resend
                below.
              </p>
            )}
            <Button
              variant="outline"
              className="w-full"
              size="lg"
              onClick={handleResend}
              disabled={resendLocked}
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
                Sent at {lastResent.toLocaleTimeString()}. Wait 1 minute
                before resending again.
              </p>
            )}
          </div>
        )}

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
