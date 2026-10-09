import { describe, expect, it } from 'vitest'
import { readFailureWords, readRetryDelay, retryAfterSeconds, shouldRetryRead } from './readFailure'

/** An axios-shaped failure, as the response interceptor hands it on. */
const failed = (status: number, headers: Record<string, unknown> = {}, data: unknown = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers, data },
  })

describe('readFailureWords — F-403: plain words, never the axios status line', () => {
  it('says a rate limit as a wait, with the seconds the gateway gave', () => {
    const words = readFailureWords(failed(429, { 'retry-after': '42' }))
    expect(words).toBe('too many requests in a short time — try again in 42 seconds')
    expect(words).not.toMatch(/status code|429/)
  })

  it('reads the body when the header is not exposed cross-origin', () => {
    expect(retryAfterSeconds(failed(429, {}, { retryAfter: 17 }))).toBe(17)
  })

  it('has a sentence for each kind of failure, none of them a status line', () => {
    for (const s of [401, 403, 404, 418, 500, 503]) {
      expect(readFailureWords(failed(s))).not.toMatch(/status code|\d{3}/)
    }
    const dropped = Object.assign(new Error('Network Error'), { request: {} })
    expect(readFailureWords(dropped)).toBe('the connection dropped before an answer came')
  })
})

describe('shouldRetryRead / readRetryDelay — F-403: a 429 waits, a 4xx is not asked twice', () => {
  it('never retries a refusal that cannot change', () => {
    expect(shouldRetryRead(0, failed(403))).toBe(false)
    expect(shouldRetryRead(0, failed(404))).toBe(false)
  })

  it('retries a 429, a 5xx and a dropped connection once', () => {
    expect(shouldRetryRead(0, failed(429))).toBe(true)
    expect(shouldRetryRead(0, failed(502))).toBe(true)
    expect(shouldRetryRead(0, Object.assign(new Error('x'), { request: {} }))).toBe(true)
    expect(shouldRetryRead(1, failed(502))).toBe(false)
  })

  it('waits as long as Retry-After says, capped at a minute', () => {
    expect(readRetryDelay(0, failed(429, { 'retry-after': '12' }))).toBe(12_000)
    expect(readRetryDelay(0, failed(429, { 'retry-after': '600' }))).toBe(60_000)
    expect(readRetryDelay(0, failed(500))).toBe(1000)
  })
})
