/**
 * ADR 0225: a password change signs out every other session and ends this
 * session's old tokens; the gateway answers with a new pair for this one.
 * The client must store it at once, or the person who changed their password
 * is signed out by their own change on the next request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { profileApi } from './profile'
import { apiClient } from './client'
import {
  RENEWED_KEY,
  SESSION_RENEWED_EVENT,
  onSessionRenewed,
  storeRenewedSession,
} from '../../lib/sessionRenewed'

vi.mock('./client', () => ({ apiClient: { post: vi.fn() } }))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('accessToken', 'old-access')
  localStorage.setItem('refreshToken', 'old-refresh')
  vi.mocked(apiClient.post).mockReset()
})

describe('profileApi.changePassword keeps this session', () => {
  it('stores the pair the gateway answers with, and announces it', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, accessToken: 'new-access', refreshToken: 'new-refresh' },
    } as any)
    const heard = vi.fn()
    window.addEventListener(SESSION_RENEWED_EVENT, heard)

    await profileApi.changePassword({ currentPassword: 'a', newPassword: 'bbbbbbbb' })

    expect(apiClient.post).toHaveBeenCalledWith('/auth/me/password', {
      currentPassword: 'a',
      newPassword: 'bbbbbbbb',
    })
    expect(localStorage.getItem('accessToken')).toBe('new-access')
    expect(localStorage.getItem('refreshToken')).toBe('new-refresh')
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_RENEWED_EVENT, heard)
  })

  it('keeps the tokens it has when the answer carries no pair (an older gateway)', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } } as any)

    await profileApi.changePassword({ newPassword: 'bbbbbbbb' })

    expect(localStorage.getItem('accessToken')).toBe('old-access')
    expect(localStorage.getItem('refreshToken')).toBe('old-refresh')
  })

  it('stores nothing when the change is refused', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('401'))

    await expect(
      profileApi.changePassword({ currentPassword: 'wrong', newPassword: 'bbbbbbbb' }),
    ).rejects.toThrow()

    expect(localStorage.getItem('accessToken')).toBe('old-access')
  })
})

describe('onSessionRenewed', () => {
  it('hears this tab renew, and another tab renew through storage, until unsubscribed', () => {
    const listener = vi.fn()
    const off = onSessionRenewed(listener)

    storeRenewedSession({ accessToken: 'a', refreshToken: 'r' })
    window.dispatchEvent(new StorageEvent('storage', { key: RENEWED_KEY, newValue: '1' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken', newValue: 'x' }))
    expect(listener).toHaveBeenCalledTimes(2)

    off()
    storeRenewedSession({ accessToken: 'a2', refreshToken: 'r2' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('refuses a half pair', () => {
    expect(storeRenewedSession({ accessToken: 'a' })).toBe(false)
    expect(storeRenewedSession({ accessToken: '', refreshToken: 'r' })).toBe(false)
    expect(localStorage.getItem('accessToken')).toBe('old-access')
  })
})
