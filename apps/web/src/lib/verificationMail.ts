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

/**
 * Keep the sign-up's outcome for the next page. Anything the gateway did not
 * say clears the key, so an earlier sign-up's note is never shown for this one.
 * Storage that throws (private mode, blocked) keeps nothing.
 */
export function noteSignUpMail(outcome: unknown): void {
  try {
    if (isVerificationMail(outcome)) {
      window.sessionStorage.setItem(VERIFICATION_MAIL_KEY, outcome)
    } else {
      window.sessionStorage.removeItem(VERIFICATION_MAIL_KEY)
    }
  } catch {
    /* storage blocked: the page shows its usual words */
  }
}

/** The kept outcome, or null. Never throws. */
export function readSignUpMail(): VerificationMail | null {
  try {
    const kept = window.sessionStorage.getItem(VERIFICATION_MAIL_KEY)
    return isVerificationMail(kept) ? kept : null
  } catch {
    return null
  }
}

/** Forget the kept outcome once it has been shown. Never throws. */
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
