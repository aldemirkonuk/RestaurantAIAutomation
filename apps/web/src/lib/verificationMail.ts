/**
 * Whether a verification mail left, as the gateway reports it (onboarding
 * OB-3): sign-up and resend both answer `verificationMail`, read from what the
 * mailer said. 'sent' means the provider took it, not that it arrived.
 * 'unconfirmed' (OB-6) means the mailer had not answered within the gateway's
 * bound: the mail may still leave, so it is never worded as sent or as failed.
 */
export type VerificationMail = 'sent' | 'not_sent' | 'unconfirmed'

const OUTCOMES: readonly VerificationMail[] = ['sent', 'not_sent', 'unconfirmed']

function isVerificationMail(value: unknown): value is VerificationMail {
  return OUTCOMES.includes(value as VerificationMail)
}

/** The resend answer; `sent` alone is what a gateway before OB-3 sent. */
export interface VerificationResendAnswer {
  sent?: boolean
  verificationMail?: VerificationMail
}

/**
 * What became of a resend, from its answer (round 2 B-5, round 6 #789). An
 * answer with neither field is read as sent, which is what the page said
 * before; `sent: false` alone is read as not sent. A `verificationMail` this
 * page does not know is read as 'unconfirmed': never as sent.
 */
export function resendOutcome(
  answer: VerificationResendAnswer | null | undefined,
): VerificationMail {
  const said = answer?.verificationMail
  if (said !== undefined && said !== null) {
    return isVerificationMail(said) ? said : 'unconfirmed'
  }
  return answer?.sent === false ? 'not_sent' : 'sent'
}

export const UNCONFIRMED_SENTENCE =
  'Sending is taking longer than usual. The email may still arrive; if it has not in a minute, send a new one.'

/** One sentence on what became of a verification mail, in the house's words. */
export function verificationMailSentence(
  outcome: VerificationMail,
  email?: string | null,
): string {
  if (outcome === 'sent') {
    return `We sent a new verification email${email ? ` to ${email}` : ''}. Check your inbox.`
  }
  if (outcome === 'unconfirmed') return UNCONFIRMED_SENTENCE
  return 'We could not send the verification email. Nothing was sent; try again in a minute.'
}

/**
 * The sign-up's mail outcome, handed to `/verify-email` (OB-6). Register.tsx
 * navigates there after `registerAccount`; this key carries what the gateway
 * said across that one navigation without touching Register.tsx.
 */
export const VERIFICATION_MAIL_KEY = 'mudavym:verification-mail'

/** An address as the note compares it: trimmed and folded. */
function folded(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Keep the sign-up's outcome for the next page, tied to the address it was
 * mailed to (QA r19 on #914: a note kept bare was shown to whichever account
 * next used the tab). Anything the gateway did not say, or no address, clears
 * the key, so an earlier sign-up's note is never shown for this one. Storage
 * that throws (private mode, blocked) keeps nothing.
 */
export function noteSignUpMail(outcome: unknown, email: string | null | undefined): void {
  try {
    if (isVerificationMail(outcome) && folded(email)) {
      window.sessionStorage.setItem(
        VERIFICATION_MAIL_KEY,
        JSON.stringify({ outcome, email: folded(email) }),
      )
    } else {
      window.sessionStorage.removeItem(VERIFICATION_MAIL_KEY)
    }
  } catch {
    /* storage blocked: the page shows its usual words */
  }
}

/**
 * The kept outcome for `email`, or null: null for another address, for no
 * address, and for a note kept before it carried one. Never throws.
 */
export function readSignUpMail(email: string | null | undefined): VerificationMail | null {
  try {
    const want = folded(email)
    if (!want) return null
    const kept = JSON.parse(window.sessionStorage.getItem(VERIFICATION_MAIL_KEY) ?? 'null') as {
      outcome?: unknown
      email?: unknown
    } | null
    if (!kept || kept.email !== want) return null
    return isVerificationMail(kept.outcome) ? kept.outcome : null
  } catch {
    return null
  }
}

/** Forget the kept outcome: at sign-out and once verified. Never throws. */
export function clearSignUpMail(): void {
  try {
    window.sessionStorage.removeItem(VERIFICATION_MAIL_KEY)
  } catch {
    /* storage blocked */
  }
}

/**
 * The sentence right after sign-up, or null for 'sent' (the page's usual
 * words already say to open the mail).
 */
export function signUpMailSentence(outcome: VerificationMail | null): string | null {
  if (outcome === 'not_sent') {
    return 'We could not send the verification email. Nothing was sent; send it again below.'
  }
  if (outcome === 'unconfirmed') return UNCONFIRMED_SENTENCE
  return null
}

/** How the code box words a refusal (OB-6), chosen from status and code only. */
export type CodeRefusal = 'wrong' | 'spent' | 'locked' | 'busy' | 'sign-in' | 'failed'

/**
 * Read a refused `POST /auth/verify-email { code }` by its status and its
 * `code`, never its message. A wrong code and an expired one share one
 * refusal at the gateway (`CODE_REFUSAL`), so they share one here.
 */
export function codeRefusal(err: unknown): CodeRefusal {
  const response = (err as { response?: { status?: number; data?: { code?: string } } })
    ?.response
  const status = response?.status
  const code = response?.data?.code
  if (code === 'CODE_SPENT') return 'spent'
  if (code === 'CODE_LOCKED_FOR_THE_DAY') return 'locked'
  if (code === 'CODE_REFUSED') return 'wrong'
  if (status === 401 || code === 'SIGN_IN_TO_VERIFY') return 'sign-in'
  if (status === 429) return 'busy'
  if (status === 400) return 'wrong'
  return 'failed'
}

export const CODE_REFUSAL_SENTENCE: Record<CodeRefusal, string> = {
  wrong:
    'That code is not right, or it has expired. Check the newest email from Mudavym, or send a new one.',
  spent: 'Too many tries for this code. Send a new email and use the code in it.',
  locked:
    'Too many wrong codes for this address today. Open the link in the email instead, or try again tomorrow.',
  busy: 'Too many tries just now. Wait a minute and try again.',
  'sign-in': 'Your session has ended. Sign in again to finish verifying.',
  failed: 'The code could not be checked just now. Nothing changed; try again.',
}

/** Six digits from whatever was typed or pasted: spaces and dashes dropped. */
export function codeDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}
