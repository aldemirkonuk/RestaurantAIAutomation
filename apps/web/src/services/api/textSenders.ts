/**
 * The house's text senders, and each person's consent to be reached on one
 * (ADR 0121; ADR 0114's "house declares, each person consents").
 *
 * ONE CLIENT MODULE, READ BY THREE SURFACES. `/connections` draws the house's
 * senders, `/team`'s composer states whether a crew text can leave, and
 * `/profile` is where a person agrees. ADR 0114 closed G20 by refusing a fourth
 * OAuth catalogue for exactly this reason: three hand-written subsets of one
 * list is how a product ends up telling three different stories about what it
 * can do. `services/api/team.ts` re-exports `getTextSenders` from here rather
 * than declaring a second one.
 */

import { apiClient } from './client'

export interface HouseTextSender {
  id: string
  channel: 'whatsapp' | 'sms'
  path: 'bring_your_own' | 'mudavym_registers'
  state: 'requested' | 'submitted' | 'in_review' | 'connected' | 'rejected' | 'revoked'
  identity: string | null
  market: string
  /** NULL means NEVER PROBED, which is not the same as unreachable. */
  lastProbeAt: string | null
}

export interface PersonTextConsent {
  phone: string
  channel: 'whatsapp' | 'sms' | 'any'
  consentedAt: string
}

export interface TextSendersReadout {
  senders: { whatsapp: HouseTextSender | null; sms: HouseTextSender | null }
  /** `false` means the READ FAILED. It is not "this house has no sender". */
  readable: boolean
  reason: string | null
  /** The server's own statement that nothing can leave through a sender yet. */
  transport: { built: boolean; words: string }
  myConsent: {
    consent: PersonTextConsent | null
    readable: boolean
    reason: string | null
  }
  /** `null` = not this caller's to see, or unreadable. Never an invented zero. */
  crewConsents: number | null
}

export async function getTextSenders(): Promise<TextSendersReadout> {
  const { data } = await apiClient.get<TextSendersReadout>('/communications/text-senders')
  return data
}

/**
 * A person agrees that this house may text them at a number they state.
 *
 * There is no variant of this that takes a user id. A consent a manager could
 * record for somebody else is a roster entry wearing the word "consent", and
 * the gateway has no route for one.
 */
export async function giveTextConsent(body: {
  phone: string
  channel: 'whatsapp' | 'sms' | 'any'
}) {
  const { data } = await apiClient.post('/communications/text-senders/consent', body)
  return data as { consent: PersonTextConsent; words: string }
}

/** Withdraw it. The row is kept with the time and the reason, never deleted. */
export async function withdrawTextConsent() {
  const { data } = await apiClient.delete('/communications/text-senders/consent')
  return data as { withdrawn: number; words: string }
}
