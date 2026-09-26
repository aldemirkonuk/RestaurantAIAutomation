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
 * Add a passkey: the gateway checks the role and the password and hands back
 * options, the authenticator makes the credential, the gateway verifies it.
 */
export async function addPasskey(input: { currentPassword: string; nickname: string }): Promise<PasskeyReceipt> {
  const { data: start } = await apiClient.post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
    '/passkeys/registration/options',
    { currentPassword: input.currentPassword },
  )
  const response = await startRegistration({ optionsJSON: start.options })
  const nickname = input.nickname.trim()
  const { data } = await apiClient.post<PasskeyReceipt>('/passkeys/registration/verify', {
    challengeId: start.challengeId,
    response,
    ...(nickname ? { nickname } : {}),
  })
  return data
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
