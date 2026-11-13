import { describe, it, expect, vi, beforeEach } from 'vitest'

// QA round 21: an emailed-code sign-in sends this device's token for THIS
// email and keeps the one the gateway issues, exactly as a password sign-in
// does, so the device's next password sign-in is a known device's.

const h = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('./client', () => ({ apiClient: { post: h.post } }))
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: () => false,
}))

import { signInWithEmailCode } from './passkeys'
import { rememberSignInDevice, signInDeviceFor } from '../../lib/houseMemory'

describe('signInWithEmailCode and the known-device token', () => {
  beforeEach(() => {
    localStorage.clear()
    h.post.mockReset()
  })

  it('a first sign-in sends none and keeps the issued token', async () => {
    h.post.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', signInDevice: 'tok-1' } })
    await signInWithEmailCode('Owner@x.com', '123 456')
    expect(h.post.mock.calls[0][1]).not.toHaveProperty('signInDevice')
    expect(signInDeviceFor('owner@x.com')).toBe('tok-1')
  })

  it('sends the token held for this email only, then keeps the new one', async () => {
    rememberSignInDevice('owner@x.com', 'tok-old')
    rememberSignInDevice('other@x.com', 'tok-other')
    h.post.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', signInDevice: 'tok-2' } })
    const pair = await signInWithEmailCode('owner@x.com', '123456')
    expect(h.post.mock.calls[0][1]).toMatchObject({ email: 'owner@x.com', code: '123456', signInDevice: 'tok-old' })
    expect(signInDeviceFor('owner@x.com')).toBe('tok-2')
    expect(signInDeviceFor('other@x.com')).toBe('tok-other')
    expect(pair).toEqual({ accessToken: 'a', refreshToken: 'r' })
  })
})
