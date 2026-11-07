/**
 * Whether a verification mail left, as the gateway reports it (onboarding
 * OB-3): sign-up and resend both answer `verificationMail`, read from what the
 * mailer said. 'sent' means the provider took it, not that it arrived.
 * 'unconfirmed' (OB-6) is a send the mailer had not answered within the
 * gateway's bound: it may still leave, so it is neither sent nor not sent.
 */
export type VerificationMail = 'sent' | 'not_sent' | 'unconfirmed'

/** The resend answer; `sent` alone is what a gateway before OB-3 sent. */
export interface VerificationResendAnswer {
  sent?: boolean
  verificationMail?: VerificationMail
}

/**
 * What became of a resend, from its answer (round 2 B-5, round 6 #789). An
 * answer with neither field is read as sent, which is what the page said
 * before; `sent: false` alone is read as not sent.
 */
export function resendOutcome(
  answer: VerificationResendAnswer | null | undefined,
): VerificationMail {
  if (answer?.verificationMail) return answer.verificationMail
  return answer?.sent === false ? 'not_sent' : 'sent'
}

/** One sentence on what became of a verification mail, in the house's words. */
export function verificationMailSentence(
  outcome: VerificationMail,
  email?: string | null,
): string {
  if (outcome === 'sent') {
    return `We sent a new verification email${email ? ` to ${email}` : ''}. Check your inbox.`
  }
  if (outcome === 'unconfirmed') {
    return 'We could not confirm the verification email went out. Try again in a minute, or check the address.'
  }
  return 'We could not send the verification email. Nothing was sent; try again in a minute.'
}
