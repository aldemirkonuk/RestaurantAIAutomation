import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetConsentBrowser, prepareConsentBrowser, readConsentBrowser, sameSiteReturnPath } from './consent-browser'

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

  it('retains a same-site destination, query and fragment', () => {
    expect(sameSiteReturnPath('/profile?tab=accounts#connected')).toBe('/profile?tab=accounts#connected')
  })
})
