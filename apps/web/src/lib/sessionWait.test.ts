import { describe, it, expect } from 'vitest'
import {
  retryAfterSeconds,
  sessionRetryDelayMs,
  sessionWaitReason,
  sessionWaitWords,
} from './sessionWait'

describe('sessionWaitReason: which /auth/me failures wait instead of signing out', () => {
  it('a 429 is busy; 5xx, 408 and 425 are the server; no answer at all is offline', () => {
    expect(sessionWaitReason({ response: { status: 429 } })).toBe('busy')
    for (const status of [500, 502, 503, 504, 408, 425]) {
      expect(sessionWaitReason({ response: { status } })).toBe('server')
    }
    expect(sessionWaitReason({ isAxiosError: true, request: {} })).toBe('offline')
    expect(sessionWaitReason({ code: 'ERR_NETWORK' })).toBe('offline')
    expect(sessionWaitReason(new Error('Network Error'))).toBe('offline')
    expect(sessionWaitReason({ isAxiosError: true, code: 'ERR_CANCELED', request: {} })).toBeNull()
  })

  it('a 401, a 403, a 404 and a bug in our own code do not wait', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(sessionWaitReason({ response: { status } })).toBeNull()
    }
    expect(sessionWaitReason(new TypeError("Cannot read properties of undefined (reading 'user')"))).toBeNull()
    expect(sessionWaitReason(undefined)).toBeNull()
  })
})

describe('the wait before the next try', () => {
  const now = Date.parse('2026-11-11T12:00:00Z')

  it("follows the gateway's Retry-After, as seconds or as a date", () => {
    expect(retryAfterSeconds('7')).toBe(7)
    expect(retryAfterSeconds(3)).toBe(3)
    expect(retryAfterSeconds('Wed, 11 Nov 2026 12:00:20 GMT', now)).toBe(20)
    expect(retryAfterSeconds('soon')).toBeNull()
    expect(sessionRetryDelayMs(0, { response: { status: 429, headers: { 'retry-after': '7' } } }, now)).toBe(7000)
  })

  it('climbs 1-2-4-8-15-30 s without one, and never waits under 1 s or over 60 s', () => {
    const err = { response: { status: 503 } }
    expect([0, 1, 2, 3, 4, 5, 6, 40].map((a) => sessionRetryDelayMs(a, err, now))).toEqual([
      1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000,
    ])
    expect(sessionRetryDelayMs(0, { response: { status: 429, headers: { 'retry-after': '0' } } }, now)).toBe(1000)
    expect(sessionRetryDelayMs(0, { response: { status: 429, headers: { 'retry-after': '3600' } } }, now)).toBe(60000)
  })

  it('says the person is still signed in, and when the next try is, in plain words', () => {
    const busy = sessionWaitWords({ reason: 'busy', retryAt: now + 12_000, attempt: 1 }, now)
    expect(busy.title).toBe('Mudavym is busy for a moment.')
    expect(busy.body).toContain('still signed in')
    expect(busy.body).toContain('in 12 seconds')
    const offline = sessionWaitWords({ reason: 'offline', retryAt: now, attempt: 3 }, now)
    expect(offline.body).toContain('in a moment')
    for (const w of [busy, offline]) {
      expect(`${w.title} ${w.body}`).not.toMatch(/429|auth\/me|rate limit|token/i)
    }
  })
})
