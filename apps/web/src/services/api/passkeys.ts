/**
 * The signed-in person's passkeys (ADR 0222, Proposed; ADR 0134 §7, founder
 * 2026-09-21: "Passkey + paste (Recommended)").
 *
 * No function here takes a user id: the gateway acts on the token's person
 * only, so there is no way to enrol or remove somebody else's passkey.
 *
 * The browser half of each ceremony is `@simplewebauthn/browser`, which turns
 * the gateway's JSON options into a `navigator.credentials` call and the
 * credential back into JSON. Nothing here touches key material: the private
 * key never leaves the authenticator.
 */

import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { apiClient } from './client'

export interface Passkey {
  id: string
  nickname: string | null
  createdAt: string
  lastUsedAt: string | null
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
  transports: string[]
  rpId: string
  revokedAt: string | null
}

export interface PasskeyReadout {
  /** `false` means the READ failed. It is never "you have none". */
  readable: boolean
  reason: string | null
  passkeys: Passkey[]
  /** Whether this person may add or check one in the current house. */
  eligible: boolean
  eligibilityReason: string | null
}

export interface PasskeyReceipt {
  passkey: Passkey
  audited: boolean
  auditReason: string | null
  notified: boolean
  /**
   * Adding only: whether the "a passkey was added" email reached the account's
   * address (ADR 0229, founder 2026-09-26 round 6). Absent on remove and check.
   */
  mailed?: boolean
}

export const PASSKEYS_QUERY_KEY = ['passkeys'] as const

export async function getPasskeys(): Promise<PasskeyReadout> {
  const { data } = await apiClient.get<PasskeyReadout>('/passkeys')
  return data
}

/** Whether this browser can run a WebAuthn ceremony at all. */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/**
 * The gateway's answer when the sign-in is more than ten minutes old and no
 * emailed code came with the request (founder 2026-09-25, item 29). The caller
 * asks for a code (`sendStepUpCode`) and tries again with it.
 */
export class StepUpRequired extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StepUpRequired'
  }
}

function stepUpRefusal(e: unknown): StepUpRequired | null {
  const res = (e as { response?: { status?: number; data?: { code?: string; message?: string } } })?.response
  if (res?.status === 403 && res.data?.code === 'STEP_UP_REQUIRED') {
    return new StepUpRequired(res.data.message ?? 'Confirm it is you with an emailed code first.')
  }
  return null
}

/**
 * Add a passkey: the gateway checks the role and that the sign-in is recent
 * (or the emailed code) and hands back options, the authenticator makes the
 * credential, the gateway verifies it. Throws `StepUpRequired` when a code is
 * needed first.
 */
export async function addPasskey(input: { nickname: string; emailCode?: string }): Promise<PasskeyReceipt> {
  type Start = { challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }
  const code = input.emailCode?.replace(/\s+/g, '')
  let start: Start
  try {
    const res = await apiClient.post<Start>('/passkeys/registration/options', code ? { emailCode: code } : {})
    start = res.data
  } catch (e) {
    throw stepUpRefusal(e) ?? e
  }
  const response = await startRegistration({ optionsJSON: start.options })
  const nickname = input.nickname.trim()
  const { data } = await apiClient.post<PasskeyReceipt>('/passkeys/registration/verify', {
    challengeId: start.challengeId,
    response,
    ...(nickname ? { nickname } : {}),
  })
  return data
}

/** Email the account's own address a six-digit code, to add a passkey. */
export async function sendStepUpCode(): Promise<{ sent: boolean; sentTo: string; expiresInSeconds: number }> {
  const { data } = await apiClient.post<{ sent: boolean; sentTo: string; expiresInSeconds: number }>(
    '/passkeys/step-up/code',
  )
  return data
}

/* ── signing in without a password (ADR 0222 / ADR 0229) ─────────────────── */

export interface SessionPair {
  accessToken: string
  refreshToken: string
}

/**
 * Sign in with the passkey this device holds. Names nobody in advance: the
 * browser offers the passkey, and its user handle tells the gateway whose it is.
 */
export async function signInWithPasskey(): Promise<SessionPair> {
  const { data: start } = await apiClient.post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    '/auth/passkey/options',
  )
  const response = await startAuthentication({ optionsJSON: start.options })
  const { data } = await apiClient.post<SessionPair>('/auth/passkey/verify', {
    challengeId: start.challengeId,
    response,
  })
  return { accessToken: data.accessToken, refreshToken: data.refreshToken }
}

/** Ask for an emailed sign-in code. The answer never says whether the address has an account. */
export async function requestSignInCode(email: string): Promise<{ message: string; expiresInSeconds: number }> {
  const { data } = await apiClient.post<{ message: string; expiresInSeconds: number }>('/auth/email-code', { email })
  return data
}

/** Sign in with the emailed code. */
export async function signInWithEmailCode(email: string, code: string): Promise<SessionPair> {
  const { data } = await apiClient.post<SessionPair>('/auth/email-code/verify', {
    email,
    code: code.replace(/\s+/g, ''),
  })
  return { accessToken: data.accessToken, refreshToken: data.refreshToken }
}

export async function removePasskey(id: string): Promise<PasskeyReceipt> {
  const { data } = await apiClient.delete<PasskeyReceipt>(`/passkeys/${encodeURIComponent(id)}`)
  return data
}

/** Prove an enrolled passkey still answers. Grants nothing. */
export async function checkPasskey(): Promise<PasskeyReceipt> {
  const { data: start } = await apiClient.post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    '/passkeys/check/options',
  )
  const response = await startAuthentication({ optionsJSON: start.options })
  const { data } = await apiClient.post<PasskeyReceipt>('/passkeys/check/verify', {
    challengeId: start.challengeId,
    response,
  })
  return data
}
