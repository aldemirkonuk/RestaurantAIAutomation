import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetConsentBrowser, prepareConsentBrowser, readConsentBrowser, returnLanding, sameSiteReturnPath } from './consent-browser'

describe('the initiating browser holds the consent proof', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  it('sends only a digest and request reference; expiry and cleanup remove access', async () => {
    const binding = await prepareConsentBrowser()
    const proof = readConsentBrowser(binding.browserRequestId)
    expect(proof).toMatch(/^[a-f0-9]{64}$/)
    expect(binding).not.toHaveProperty('proof')
    expect(binding.browserProofHash).not.toBe(proof)
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(proof!))
    expect(binding.browserProofHash).toBe(Buffer.from(digest).toString('hex'))
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001)
    expect(readConsentBrowser(binding.browserRequestId)).toBeNull()
    vi.restoreAllMocks()
    forgetConsentBrowser(binding.browserRequestId)
    expect(readConsentBrowser(binding.browserRequestId)).toBeNull()
  })

  it('refuses absent, malformed and another tab’s missing proof', async () => {
    const binding = await prepareConsentBrowser()
    sessionStorage.clear()
    expect(readConsentBrowser(binding.browserRequestId)).toBeNull()
    sessionStorage.setItem(`mudavym.oauth.${binding.browserRequestId}`, '{broken')
    expect(readConsentBrowser(binding.browserRequestId)).toBeNull()
    expect(readConsentBrowser('../secret')).toBeNull()
  })

  it('fails before a challenge can be requested when storage is unavailable', async () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked') })
    await expect(prepareConsentBrowser()).rejects.toThrow('storage blocked')
    blocked.mockRestore()
  })

  it.each(['//other.test', '/\\other.test', '/\n/other.test', 'https://other.test', null])('refuses external return %s', value => {
    expect(sameSiteReturnPath(value)).toBe('/settings')
  })

  it.each(['/logout', '/authorize/gmail_send', '/communications/../logout', '/profiles'])('refuses a same-site page off the return list %s (F-279)', value => {
    expect(sameSiteReturnPath(value)).toBe('/settings')
  })

  it('lands a finished flow on the page it started from, query kept (F-279)', () => {
    const url = new URL('/communications?reply=o1&integration_status=error&integration=gmail_read&integration_reason=membership_refused', window.location.origin)
    expect(returnLanding(url)).toBe('/communications?reply=o1&integration_status=error&integration=gmail_read&integration_reason=membership_refused')
  })

  it('never follows a path off the return list; lands on /profile with only the outcome (F-279)', () => {
    const url = new URL('/logout?next=x&integration_status=error&integration_reason=exchange_failed', window.location.origin)
    expect(returnLanding(url)).toBe('/profile?integration_status=error&integration_reason=exchange_failed')
    expect(returnLanding(new URL('/authorize/gmail_send', window.location.origin))).toBe('/profile')
  })

  // Audit pin (F-279): every fallback lands on /profile with ONLY the outcome keys.
  const OUTCOME = 'integration_status=error&integration=gmail_read&integration_reason=exchange_failed'
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com/communications', 'javascript:alert(1)', '%2F%2Fevil.com', '/communications/', '/Communications'])(
    'never follows %s: lands on /profile carrying only the outcome',
    value => {
      const url = new URL(`${value}?${OUTCOME}&next=https://evil.com`, window.location.origin)
      const sameOrigin = url.origin === window.location.origin
      // A foreign origin never reaches returnLanding: completion refuses it first.
      if (!sameOrigin) {
        expect(sameSiteReturnPath(value)).toBe('/settings')
        return
      }
      expect(returnLanding(url)).toBe(`/profile?${OUTCOME}`)
      expect(sameSiteReturnPath(value)).toBe('/settings')
    },
  )

  it('retains a same-site destination, query and fragment', () => {
    expect(sameSiteReturnPath('/profile?tab=accounts#connected')).toBe('/profile?tab=accounts#connected')
  })
})
