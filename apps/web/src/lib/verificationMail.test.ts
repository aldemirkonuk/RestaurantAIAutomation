import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VERIFICATION_MAIL_KEY,
  noteSignUpMail,
  readSignUpMail,
  resendOutcome,
  signUpMailSentence,
  verificationMailSentence,
} from './verificationMail'

/** Onboarding OB-3 / OB-6: the three outcomes of a verification send. */
describe('resendOutcome', () => {
  it('reads each of the three outcomes the gateway says', () => {
    expect(resendOutcome({ sent: true, verificationMail: 'sent' })).toBe('sent')
    expect(resendOutcome({ sent: false, verificationMail: 'not_sent' })).toBe('not_sent')
    expect(resendOutcome({ sent: false, verificationMail: 'unconfirmed' })).toBe(
      'unconfirmed',
    )
  })

  it('never reads an outcome it does not know as sent', () => {
    expect(
      resendOutcome({ sent: true, verificationMail: 'queued' as never }),
    ).toBe('unconfirmed')
  })

  it('keeps the pre-OB-3 reading of a bare `sent`', () => {
    expect(resendOutcome({ sent: false })).toBe('not_sent')
    expect(resendOutcome({})).toBe('sent')
  })
})

describe('verificationMailSentence', () => {
  it('says each outcome in its own words', () => {
    expect(verificationMailSentence('sent', 'a@b.test')).toBe(
      'We sent a new verification email to a@b.test. Check your inbox.',
    )
    expect(verificationMailSentence('not_sent')).toMatch(
      /^We could not send the verification email/,
    )
    const unconfirmed = verificationMailSentence('unconfirmed', 'a@b.test')
    expect(unconfirmed).toMatch(/may still arrive/)
    expect(unconfirmed).not.toMatch(/We sent|Check your inbox|could not send/)
  })

  it('after sign-up, only not_sent and unconfirmed add a sentence', () => {
    expect(signUpMailSentence('sent')).toBeNull()
    expect(signUpMailSentence(null)).toBeNull()
    expect(signUpMailSentence('not_sent')).toMatch(/could not send/)
    expect(signUpMailSentence('unconfirmed')).toMatch(/may still arrive/)
  })
})

describe('the sign-up hand-off', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('keeps a known outcome and clears for anything else', () => {
    noteSignUpMail('unconfirmed')
    expect(sessionStorage.getItem(VERIFICATION_MAIL_KEY)).toBe('unconfirmed')
    expect(readSignUpMail()).toBe('unconfirmed')
    noteSignUpMail(undefined)
    expect(sessionStorage.getItem(VERIFICATION_MAIL_KEY)).toBeNull()
  })

  it('never throws when storage does', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => noteSignUpMail('sent')).not.toThrow()
    expect(readSignUpMail()).toBeNull()
  })
})
